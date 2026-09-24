const express = require('express');
const router = express.Router();

const COOKIE_NAME = 'seo_session';

function normalizeSameSite(value) {
  const normalized = String(value || '').toLowerCase();
  return ['strict', 'lax', 'none'].includes(normalized) ? normalized : 'lax';
}

const sameSite = normalizeSameSite(process.env.COOKIE_SAME_SITE || process.env.COOKIE_SAMESITE);
const secureCookie = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV !== 'development';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: sameSite === 'none' ? true : secureCookie,
  sameSite,
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
  res.json({ ok: true });
});

router.get('/verify', (req, res) => {
  res.json({ valid: true, role: 'seo' });
});

function requireAuth(req, res, next) {
  req.user = { username: 'public', role: 'seo' };
  next();
}

function requireSeo(req, res, next) {
  req.user = { username: 'public', role: 'seo' };
  next();
}


// GET /api/auth/platform-login?token=xxx
// Silent auto-login for the Position2 Intelligence Platform iframe embed.
router.get('/platform-login', (req, res) => {
  const platformToken = process.env.PLATFORM_TOKEN;
  if (!platformToken || req.query.token !== platformToken) {
    return res.status(401).json({ error: 'Invalid platform token.' });
  }
  const role = process.env.PLATFORM_DEFAULT_ROLE || 'seo';
  const token = jwt.sign({ username: 'platform_embed', role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireSeo };
