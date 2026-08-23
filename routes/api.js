const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { dbQuery, uploadsDir } = require('../database');
const { extractTextFromDocument } = require('../services/docParser');
const { generateQuestionsFromText } = require('../services/aiGenerator');
const { getSessionFromReq } = require('./auth');

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'doc-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF (.pdf), Word (.docx), and Text (.txt) files are supported.'));
    }
  }
});

/**
 * Helper to get current API Settings from DB
 */
async function getApiSettings() {
  const rows = await dbQuery.all('SELECT key, value FROM settings');
  const settingsMap = {};
  rows.forEach(r => settingsMap[r.key] = r.value);
  return settingsMap;
}

// ----------------------------------------------------
// 1. Upload & Process Document
// ----------------------------------------------------
router.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document file uploaded.' });
    }

    const { originalname, path: filePath, mimetype, size } = req.file;
    const documentTitle = req.body.title || path.basename(originalname, path.extname(originalname));
    const session = await getSessionFromReq(req);
    const ownerEmail = session ? session.email : (req.body.owner_email || 'system');

    console.log(`[Upload] Processing "${documentTitle}" uploaded by ${ownerEmail} (${mimetype}, ${size} bytes)`);

    // Step A: Extract Text
    const { text, wordCount } = await extractTextFromDocument(filePath, mimetype);

    // Step B: Save Document to DB with owner_email
    const docResult = await dbQuery.run(
      `INSERT INTO documents (title, original_name, file_path, mime_type, file_size, text_content, word_count, owner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentTitle, originalname, filePath, mimetype, size, text, wordCount, ownerEmail]
    );

    const documentId = docResult.lastID;

    // Step C: Generate Questions
    const apiSettings = await getApiSettings();
    const questions = await generateQuestionsFromText(text, documentTitle, apiSettings);

    // Step D: Insert Questions to DB
    for (const q of questions) {
      await dbQuery.run(
        `INSERT INTO questions (document_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, quote_reference, difficulty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          q.question_text,
          q.option_a,
          q.option_b,
          q.option_c,
          q.option_d,
          q.correct_option,
          q.explanation,
          q.quote_reference || '',
          q.difficulty || 'medium'
        ]
      );
    }

    // Step E: Update Question Count
    await dbQuery.run('UPDATE documents SET question_count = ? WHERE id = ?', [questions.length, documentId]);

    const createdDoc = await dbQuery.get('SELECT * FROM documents WHERE id = ?', [documentId]);

    res.status(201).json({
      message: 'Document successfully processed and test bank generated!',
      document: createdDoc,
      questionCount: questions.length
    });
  } catch (err) {
    console.error('[Upload Error]', err);
    res.status(500).json({ error: err.message || 'Failed to process document.' });
  }
});

// ----------------------------------------------------
// 2. List All Documents
// ----------------------------------------------------
router.get('/documents', async (req, res) => {
  try {
    const docs = await dbQuery.all(`
      SELECT d.*, 
             COUNT(q.id) as question_count,
             (SELECT MAX(created_at) FROM test_attempts WHERE document_id = d.id) as last_tested_at,
             (SELECT COUNT(*) FROM test_attempts WHERE document_id = d.id) as total_tests_taken
      FROM documents d
      LEFT JOIN questions q ON d.id = q.document_id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. Get Single Document Details & Question Bank
// ----------------------------------------------------
router.get('/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = await dbQuery.get('SELECT * FROM documents WHERE id = ?', [docId]);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const questions = await dbQuery.all('SELECT * FROM questions WHERE document_id = ? ORDER BY id ASC', [docId]);
    const attempts = await dbQuery.all('SELECT * FROM test_attempts WHERE document_id = ? ORDER BY created_at DESC', [docId]);

    res.json({
      document: doc,
      questions,
      attempts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 4. Delete Document (and questions/tests)
// ----------------------------------------------------
router.delete('/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = await dbQuery.get('SELECT * FROM documents WHERE id = ?', [docId]);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Ownership Verification: Only the uploader or an admin can delete the document/test bank
    const session = await getSessionFromReq(req);
    const userEmail = session ? session.email.toLowerCase() : '';
    const userRole = session ? session.role : '';
    const docOwner = (doc.owner_email || '').toLowerCase();

    if (userRole !== 'admin' && docOwner && userEmail !== docOwner) {
      return res.status(403).json({
        error: 'Permission Denied',
        message: 'You can only delete documents that you uploaded.'
      });
    }

    // Delete physical file
    if (fs.existsSync(doc.file_path)) {
      try {
        fs.unlinkSync(doc.file_path);
      } catch (e) {
        console.warn('Could not delete physical file:', e.message);
      }
    }

    // Cascading DB deletion
    await dbQuery.run('DELETE FROM test_attempts WHERE document_id = ?', [docId]);
    await dbQuery.run('DELETE FROM questions WHERE document_id = ?', [docId]);
    await dbQuery.run('DELETE FROM documents WHERE id = ?', [docId]);

    res.json({ message: `Document "${doc.title}" and all associated tests have been removed.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 5. Generate Test Session (Randomized selection)
// ----------------------------------------------------
router.post('/tests/generate', async (req, res) => {
  try {
    const { documentId, count } = req.body;

    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required.' });
    }

    const doc = await dbQuery.get('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const allQuestions = await dbQuery.all('SELECT * FROM questions WHERE document_id = ?', [documentId]);

    if (allQuestions.length === 0) {
      return res.status(400).json({ error: 'No questions available for this document.' });
    }

    // Random shuffle questions
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());

    const numQuestions = (count === 'all' || !count) 
      ? shuffled.length 
      : Math.min(parseInt(count, 10) || 10, shuffled.length);

    const selectedQuestions = shuffled.slice(0, numQuestions).map(q => ({
      id: q.id,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      difficulty: q.difficulty
      // Note: correct_option, explanation, quote_reference are kept secret until grading
    }));

    res.json({
      testSessionId: 'test-' + Date.now(),
      document: {
        id: doc.id,
        title: doc.title
      },
      totalAvailable: allQuestions.length,
      questionCount: selectedQuestions.length,
      questions: selectedQuestions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 6. Submit & Grade Test
// ----------------------------------------------------
router.post('/tests/submit', async (req, res) => {
  try {
    const { documentId, timeTakenSeconds, userAnswers } = req.body;
    // userAnswers: [{ questionId: 12, selectedOption: 0 }]

    if (!documentId || !Array.isArray(userAnswers)) {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    const doc = await dbQuery.get('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    let score = 0;
    const gradedResults = [];

    for (const ans of userAnswers) {
      const q = await dbQuery.get('SELECT * FROM questions WHERE id = ?', [ans.questionId]);
      if (q) {
        const isCorrect = ans.selectedOption === q.correct_option;
        if (isCorrect) score++;

        gradedResults.push({
          questionId: q.id,
          question_text: q.question_text,
          options: [q.option_a, q.option_b, q.option_c, q.option_d],
          correct_option: q.correct_option,
          selectedOption: ans.selectedOption,
          isCorrect,
          explanation: q.explanation,
          quote_reference: q.quote_reference,
          difficulty: q.difficulty
        });
      }
    }

    const totalQuestions = gradedResults.length;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    // Save test attempt to DB
    const attemptResult = await dbQuery.run(
      `INSERT INTO test_attempts (document_id, document_title, score, total_questions, percentage, time_taken_seconds, answers_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, doc.title, score, totalQuestions, percentage, timeTakenSeconds || 0, JSON.stringify(gradedResults)]
    );

    res.json({
      attemptId: attemptResult.lastID,
      documentTitle: doc.title,
      score,
      totalQuestions,
      percentage,
      timeTakenSeconds: timeTakenSeconds || 0,
      results: gradedResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 7. Get Recent Test History
// ----------------------------------------------------
router.get('/tests/history', async (req, res) => {
  try {
    const attempts = await dbQuery.all(`
      SELECT * FROM test_attempts 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    res.json(attempts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 8. Settings Management (API Keys / Providers)
// ----------------------------------------------------
router.get('/settings', async (req, res) => {
  try {
    const settings = await getApiSettings();
    const provider = settings.provider || process.env.AI_PROVIDER || 'offline';
    const defaultModel = provider === 'gemini' ? 'gemini-3.6-flash' : 'gpt-4o-mini';

    const safeSettings = {
      provider,
      hasOpenAIKey: Boolean(settings.apiKey || process.env.OPENAI_API_KEY),
      hasGeminiKey: Boolean(settings.apiKey || process.env.GEMINI_API_KEY),
      model: settings.model || defaultModel,
      azureEndpoint: settings.azureEndpoint || '',
      googleClientId: settings.googleClientId || process.env.GOOGLE_CLIENT_ID || ''
    };
    res.json(safeSettings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { provider, apiKey, model, azureEndpoint, azureDeployment, googleClientId } = req.body;

    if (provider) await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['provider', provider]);
    if (apiKey !== undefined && apiKey !== '') {
      await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['apiKey', apiKey]);
    }

    const selectedModel = model || (provider === 'gemini' ? 'gemini-3.6-flash' : 'gpt-4o-mini');
    await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['model', selectedModel]);

    if (azureEndpoint) await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['azureEndpoint', azureEndpoint]);
    if (azureDeployment) await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['azureDeployment', azureDeployment]);
    if (googleClientId !== undefined) await dbQuery.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['googleClientId', googleClientId.trim()]);

    res.json({ message: 'Settings saved successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
