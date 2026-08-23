const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { router: authRouter } = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api', apiRoutes);

// Fallback to index.html for single-page app navigation
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 HelpMeLearn server running!`);
  console.log(`💻 Local:   http://localhost:${PORT}`);
  console.log(`📱 Mobile:  http://10.0.0.50:${PORT}`);
  console.log(`====================================================`);
});
