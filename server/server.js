require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { router: authRouter, requireAuth } = require('./routes/auth');
const searchRoutes = require('./routes/search');
const scrapeRoutes = require('./routes/scrape');
const analyzeRoutes = require('./routes/analyze');
const exportRoutes = require('./routes/export');
const keywordResearchRoutes = require('./routes/keywordResearch');
const kbRoutes = require('./routes/kb');
const modulesRoutes = require('./routes/modules');
const auditRoutes = require('./routes/audit');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// General rate limit: 20 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' }
});

// KB rate limit: 100 requests per minute (editor auto-saves)
const kbLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many KB requests. Please slow down.' }
});

// Strict rate limit for login: 10 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);

// ── Public routes (no auth required) ────────────────────────────────────────
app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Protected routes (JWT cookie required on every request) ─────────────────
app.use('/api/search',           requireAuth, searchRoutes);
app.use('/api/scrape',           requireAuth, scrapeRoutes);
app.use('/api/analyze',          requireAuth, analyzeRoutes);
app.use('/api/export',           requireAuth, exportRoutes);
app.use('/api/keyword-research', requireAuth, keywordResearchRoutes);
app.use('/api/kb',               kbLimiter, requireAuth, kbRoutes);
app.use('/api/modules',          kbLimiter, requireAuth, modulesRoutes);
app.use('/api/audit',            kbLimiter, requireAuth, auditRoutes);

// ── Serve React frontend ─────────────────────────────────────────────────────
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   GOOGLE_API_KEY:    ${process.env.GOOGLE_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   GOOGLE_CX:         ${process.env.GOOGLE_CX ? '✓' : '✗ missing'}`);
  console.log(`   OPENAI_API_KEY:    ${process.env.OPENAI_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   SEMRUSH_API_KEY:   ${process.env.SEMRUSH_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   APP_USERNAME:      ${process.env.APP_USERNAME ? '✓' : '✗ missing'}`);
  console.log(`   JWT_SECRET:        ${process.env.JWT_SECRET ? '✓' : '✗ missing'}`);
});

server.timeout = 180000;
