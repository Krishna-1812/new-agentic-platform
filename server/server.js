require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const searchRoutes = require('./routes/search');
const scrapeRoutes = require('./routes/scrape');
const analyzeRoutes = require('./routes/analyze');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Rate limit: 5 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Maximum 5 requests per minute. Please wait before trying again.' }
});

app.use('/api/', limiter);

app.use('/api/search', searchRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/export', exportRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve React frontend in production
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`   GOOGLE_CX:      ${process.env.GOOGLE_CX ? '✓ set' : '✗ missing'}`);
  console.log(`   OPENAI_API_KEY:     ${process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' ? '✓ set' : '✗ missing/placeholder'}`);
});

server.timeout = 180000; // 3 minutes for long scraping sessions
