require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { router: authRouter, requireAuth, requireSeo } = require('./routes/auth');
const searchRoutes = require('./routes/search');
const scrapeRoutes = require('./routes/scrape');
const analyzeRoutes = require('./routes/analyze');
const exportRoutes = require('./routes/export');
const keywordResearchRoutes = require('./routes/keywordResearch');
const kbRoutes = require('./routes/kb');
const modulesRoutes = require('./routes/modules');
const auditRoutes = require('./routes/audit');
const kbContextRoutes = require('./routes/kbContext');
const articleRecommendationRoutes = require('./routes/articleRecommendation');
const imageAltAuditRoutes = require('./routes/imageAltAudit');
const teamInsightsRoutes = require('./routes/teamInsights');
const competitorAnalysisRoutes = require('./routes/competitorAnalysis');
const agentReadinessAuditRoutes = require('./routes/agentReadinessAudit');
const seoGeoAuditRoutes = require('./routes/seoGeoAudit');
const contentEnhancementRoutes = require('./routes/contentEnhancement');

const app = express();
app.set('trust proxy', 1);
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
// ── Extended team + SEO team (all authenticated users) ──────────────────────
app.use('/api/kb',                     kbLimiter, requireAuth, kbRoutes);
app.use('/api/modules',                kbLimiter, requireAuth, modulesRoutes);
app.use('/api/audit',                  kbLimiter, requireAuth, auditRoutes);
app.use('/api/kb-context',             kbLimiter, requireAuth, kbContextRoutes);
app.use('/api/keyword-research',       requireAuth, keywordResearchRoutes);
app.use('/api/article-recommendation', requireAuth, articleRecommendationRoutes);
app.use('/api/image-alt-audit',        requireAuth, imageAltAuditRoutes);
app.use('/api/agent-readiness-audit',  requireAuth, agentReadinessAuditRoutes);
app.use('/api/seo-geo-audit',          requireAuth, seoGeoAuditRoutes);
app.use('/api/content-enhancement',     requireAuth, contentEnhancementRoutes);

// ── SEO team only ────────────────────────────────────────────────────────────
app.use('/api/search',              requireSeo, searchRoutes);
app.use('/api/scrape',              requireSeo, scrapeRoutes);
app.use('/api/analyze',             requireSeo, analyzeRoutes);
app.use('/api/export',              requireSeo, exportRoutes);
app.use('/api/team-insights',       requireSeo, teamInsightsRoutes);
app.use('/api/competitor-analysis', requireSeo, competitorAnalysisRoutes);


// ── Platform auto-login (Position2 Intelligence Platform) ────────────────────
// Intercepts any page load carrying ?pt=<PLATFORM_TOKEN>, sets the JWT session
// cookie server-side, then redirects to the clean URL — all before React renders.
const _jwt = require('jsonwebtoken');
app.use((req, res, next) => {
  const pt = req.query.pt;
  const platformToken = process.env.PLATFORM_TOKEN;
  if (pt && platformToken && pt === platformToken && !req.path.startsWith('/api/')) {
    const secret  = process.env.JWT_SECRET || 'seo-automation-fallback-secret';
    const role    = process.env.PLATFORM_DEFAULT_ROLE || 'seo';
    const token   = _jwt.sign({ username: 'platform_embed', role }, secret, { expiresIn: '7d' });
    const ss      = ((process.env.COOKIE_SAME_SITE || process.env.COOKIE_SAMESITE || 'lax')).toLowerCase();
    const secure  = ss === 'none' ? true : process.env.NODE_ENV !== 'development';
    res.cookie('seo_session', token, { httpOnly: true, secure, sameSite: ss, maxAge: 604800000 });
    const rest    = Object.entries(req.query).filter(([k]) => k !== 'pt').map(([k,v]) => k+'='+v).join('&');
    return res.redirect(302, req.path + (rest ? '?' + rest : ''));
  }
  next();
});

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
  console.log(`   GOOGLE_SHEETS_ID:  ${process.env.GOOGLE_SHEETS_ID ? '✓' : '✗ missing (team insights disabled)'}`);
  console.log(`   GOOGLE_PSI_KEY:    ${process.env.GOOGLE_PSI_API_KEY ? '✓' : '○ optional (PageSpeed)'}`);

});

server.timeout = 180000;
