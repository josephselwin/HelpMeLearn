const express = require('express');
const router = express.Router();
const https = require('https');
const crypto = require('crypto');
const { dbQuery } = require('../database');

// ----------------------------------------------------
// 0. Public Auth Config
// ----------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    const dbSetting = await dbQuery.get('SELECT value FROM settings WHERE key = "googleClientId"');
    const clientId = (dbSetting && dbSetting.value) || process.env.GOOGLE_CLIENT_ID || '';
    res.json({ googleClientId: clientId });
  } catch (e) {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
  }
});

/**
 * Helper: Verify Google JWT ID Token via Google's tokeninfo API
 */
function verifyGoogleToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.email) {
            resolve({
              email: parsed.email.toLowerCase(),
              name: parsed.name || parsed.given_name || parsed.email.split('@')[0],
              picture: parsed.picture || '',
              email_verified: parsed.email_verified === 'true' || parsed.email_verified === true
            });
          } else {
            reject(new Error(parsed.error_description || 'Invalid Google Token'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Helper: Get Session from Request Cookie or Header
 */
async function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/helpmelearn_session=([^;]+)/);
  const sessionId = match ? match[1] : req.headers['x-session-id'];

  if (!sessionId) return null;

  const session = await dbQuery.get(
    'SELECT * FROM user_sessions WHERE id = ? AND expires_at > ?',
    [sessionId, Date.now()]
  );

  return session || null;
}

// ----------------------------------------------------
// 1. Google OAuth Sign-In Endpoint
// ----------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is required.' });
    }

    // Step A: Verify Token with Google
    const payload = await verifyGoogleToken(credential);
    const userEmail = payload.email;

    // Step B: Check Whitelist / Admin Status
    const totalAllowed = await dbQuery.get('SELECT COUNT(*) as count FROM allowed_users');
    let allowedUser = await dbQuery.get('SELECT * FROM allowed_users WHERE LOWER(email) = ?', [userEmail]);

    // Bootstrap rule: If allowed_users table is empty OR email matches ADMIN_EMAIL env, auto-provision as admin!
    const isEnvAdmin = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === userEmail;
    if (totalAllowed.count === 0 || isEnvAdmin) {
      if (!allowedUser) {
        const result = await dbQuery.run(
          'INSERT INTO allowed_users (email, name, role) VALUES (?, ?, ?)',
          [userEmail, payload.name, 'admin']
        );
        allowedUser = { id: result.lastID, email: userEmail, name: payload.name, role: 'admin' };
      } else if (allowedUser.role !== 'admin') {
        await dbQuery.run('UPDATE allowed_users SET role = "admin" WHERE id = ?', [allowedUser.id]);
        allowedUser.role = 'admin';
      }
    }

    if (!allowedUser) {
      return res.status(403).json({
        error: 'Access Denied',
        message: `Your email address (${userEmail}) has not been provisioned by an administrator. Please request access.`
      });
    }

    // Step C: Create Session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

    await dbQuery.run(
      'INSERT INTO user_sessions (id, email, name, picture, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, userEmail, payload.name, payload.picture, allowedUser.role, expiresAt]
    );

    // Set HTTP-only Cookie
    res.cookie('helpmelearn_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Authentication successful!',
      sessionId,
      user: {
        email: userEmail,
        name: payload.name,
        picture: payload.picture,
        role: allowedUser.role
      }
    });
  } catch (err) {
    console.error('[Auth Error]', err.message);
    res.status(401).json({ error: 'Authentication failed: ' + err.message });
  }
});

// ----------------------------------------------------
// 2. Get Current Authenticated User Session
// ----------------------------------------------------
router.get('/me', async (req, res) => {
  try {
    const session = await getSessionFromReq(req);
    if (!session) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        email: session.email,
        name: session.name,
        picture: session.picture,
        role: session.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. Logout
// ----------------------------------------------------
router.post('/logout', async (req, res) => {
  try {
    const session = await getSessionFromReq(req);
    if (session) {
      await dbQuery.run('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    }
    res.clearCookie('helpmelearn_session');
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 4. Admin Whitelist Management
// ----------------------------------------------------
router.get('/whitelist', async (req, res) => {
  try {
    const session = await getSessionFromReq(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin authorization required.' });
    }

    const users = await dbQuery.all('SELECT * FROM allowed_users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/whitelist', async (req, res) => {
  try {
    const session = await getSessionFromReq(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin authorization required.' });
    }

    const { email, name, role } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const userRole = role === 'admin' ? 'admin' : 'user';

    await dbQuery.run(
      'INSERT OR REPLACE INTO allowed_users (email, name, role) VALUES (?, ?, ?)',
      [cleanEmail, name || cleanEmail.split('@')[0], userRole]
    );

    res.json({ message: `Access granted for ${cleanEmail} (${userRole})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/whitelist/:id', async (req, res) => {
  try {
    const session = await getSessionFromReq(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin authorization required.' });
    }

    const userId = req.params.id;
    const target = await dbQuery.get('SELECT * FROM allowed_users WHERE id = ?', [userId]);

    if (!target) {
      return res.status(404).json({ error: 'User not found in whitelist.' });
    }

    // Prevent admin from deleting themselves if they are the only admin
    if (target.email === session.email) {
      const adminCount = await dbQuery.get('SELECT COUNT(*) as count FROM allowed_users WHERE role = "admin"');
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the only admin user.' });
      }
    }

    await dbQuery.run('DELETE FROM allowed_users WHERE id = ?', [userId]);
    await dbQuery.run('DELETE FROM user_sessions WHERE LOWER(email) = ?', [target.email.toLowerCase()]);

    res.json({ message: `Access revoked for ${target.email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, getSessionFromReq };
