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
const agentReadinessAuditRoutes = require('./routes/agentReadinessAudit');
const seoGeoAuditRoutes = require('./routes/seoGeoAudit');
const contentEnhancementRoutes = require('./routes/contentEnhancement');
const articleEnhancementRoutes = require('./routes/articleEnhancement');
const articleEnhancementLiteRoutes = require('./routes/articleEnhancementLite');
const locationPageBuilderRoutes = require('./routes/locationPageBuilder');
const robotsMonitorRoutes = require('./modules/robotsMonitor/routes');
const onPageAuditRoutes = require('./modules/onPageAudit/routes');
const marketPotentialRoutes = require('./modules/marketPotential/routes');
const competitorAnalysisTrackerRoutes = require('./modules/competitorAnalysis/routes');
const contentArchitectRoutes = require('./modules/contentArchitect/routes');
const semrushRoutes = require('./routes/semrush');
const gbpQcRoutes = require('./modules/gbpQc/routes');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// General rate limit: 20 requests per minute.
// Skips routers that have their own (higher) limiter, so the call-heavy
// Location Page Builder + KB editor aren't throttled by the global cap.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
  skip: (req) => {
    const u = req.originalUrl || req.url || '';
    // robots-monitor, on-page-audit and content-architect carry lpbLimiter
    // (300/min) but were missing here, so this 20/min cap throttled them
    // anyway. The SEMrush balance is read by every page's header, so it
    // would otherwise eat the cap just from moving between tools.
    return u.startsWith('/api/location-page-builder') || u.startsWith('/api/kb') || u.startsWith('/api/modules') || u.startsWith('/api/audit') || u.startsWith('/api/market-potential') || u.startsWith('/api/competitor-tracker')
      || u.startsWith('/api/robots-monitor') || u.startsWith('/api/on-page-audit') || u.startsWith('/api/content-architect') || u.startsWith('/api/gbp-qc')
      || u.startsWith('/api/semrush/balance')
      // The client asks /api/auth/verify on every full page load; throttling
      // it would show the "open this from Northaxis" screen to someone who
      // simply clicked around quickly. It only checks a signature.
      || u.startsWith('/api/auth/');
  },
});

// KB rate limit: 100 requests per minute (editor auto-saves)
const kbLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many KB requests. Please slow down.' }
});

// Location Page Builder: dashboard + wizard + entity CRUD + SSE are chatty.
const lpbLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to the page builder. Please slow down a moment.' }
});

app.use('/api/', limiter);

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
app.use('/api/article-enhancement',    requireAuth, articleEnhancementRoutes);
app.use('/api/article-enhancement-lite', requireAuth, articleEnhancementLiteRoutes);
app.use('/api/location-page-builder',   lpbLimiter, requireAuth, locationPageBuilderRoutes);
app.use('/api/robots-monitor',          lpbLimiter, requireAuth, robotsMonitorRoutes);
app.use('/api/on-page-audit',           lpbLimiter, requireAuth, onPageAuditRoutes);
app.use('/api/market-potential',        lpbLimiter, requireAuth, marketPotentialRoutes);
app.use('/api/competitor-tracker',      lpbLimiter, requireAuth, competitorAnalysisTrackerRoutes);
app.use('/api/content-architect',       lpbLimiter, requireAuth, contentArchitectRoutes);
app.use('/api/semrush',                 requireAuth, semrushRoutes);
app.use('/api/gbp-qc',                  lpbLimiter, requireAuth, gbpQcRoutes);

// ── SEO team only ────────────────────────────────────────────────────────────
app.use('/api/search',              requireSeo, searchRoutes);
app.use('/api/scrape',              requireSeo, scrapeRoutes);
app.use('/api/analyze',             requireSeo, analyzeRoutes);
app.use('/api/export',              requireSeo, exportRoutes);


// ── Serve React frontend ─────────────────────────────────────────────────────
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

// ── Module schedulers ────────────────────────────────────────────────────────
require('./modules/onPageAudit/store').init().catch(err => {
  console.error('[OnPageAudit] Store init failed:', err.message);
});

require('./modules/marketPotential/store').init().catch(err => {
  console.error('[MarketPotential] Store init failed:', err.message);
});

require('./modules/competitorAnalysis/store').init().catch(err => {
  console.error('[CompetitorAnalysis] Store init failed:', err.message);
});

// Sweeps expired rows out of the shared `cache` table (nothing else deletes
// them — TTL is applied on read). Enforces the 180-day SEMrush retention.
try {
  require('./jobs/cachePurge').init();
} catch (err) {
  console.error('[CachePurge] Scheduler init failed:', err.message);
}

require('./modules/robotsMonitor/monitorStore').init().then(() => {
  require('./modules/robotsMonitor/monitorScheduler').init().catch(err => {
    console.error('[RobotsMonitor] Scheduler init failed:', err.message);
  });
}).catch(err => {
  console.error('[RobotsMonitor] Store init failed:', err.message);
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   GOOGLE_API_KEY:    ${process.env.GOOGLE_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   GOOGLE_CX:         ${process.env.GOOGLE_CX ? '✓' : '✗ missing'}`);
  console.log(`   OPENAI_API_KEY:    ${process.env.OPENAI_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✓' : '○ optional (Claude Sonnet 5 in Article Enhancer)'}`);
  console.log(`   GEMINI_API_KEY:    ${process.env.GEMINI_API_KEY ? '✓' : '○ optional (Gemini 3.5 Flash in Article Enhancer)'}`);
  console.log(`   SEMRUSH_API_KEY:   ${process.env.SEMRUSH_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   SEO_STUDIO_SECRET: ${process.env.SEO_STUDIO_SECRET ? '✓' : (process.env.NODE_ENV === 'development' ? '○ unset: studio open (development)' : '✗ missing — every API call will be refused')}`);
  console.log(`   DATABASE:          ${require('./services/supabase').databaseBackend() || '✗ missing (Location + Service Pages disabled)'}`);
  console.log(`   GOOGLE_PSI_KEY:    ${process.env.GOOGLE_PSI_API_KEY ? '✓' : '○ optional (PageSpeed)'}`);

});

// Long enough for the slowest legitimate request: a cold Clear Behavioral
// Health page generation is a competitor SERP + a 5-page scrape + up to two
// authoritative-source lookups + a Sonnet write + one correction pass. A warm
// run measures ~65s; a cold one can take several times that, and 180s cut it
// off mid-write. The dev proxy in client/vite.config.js must stay ABOVE this.
//
// Raised from 300s after a measured run: one CBH write alone is ~137s now that
// the educational bodies carry real paragraphs, so a draft plus its correction
// pass lands either side of 300s and was being cut off at exactly the timeout.
// The work completed server-side and had nobody to return it to.
server.timeout = 600000;
