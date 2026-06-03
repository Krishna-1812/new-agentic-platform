const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'seo-automation-fallback-secret';
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
  maxAge: 7 * 24 * 60 * 60 * 1000,
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

function clearCookieOptions() {
  const { maxAge, ...options } = COOKIE_OPTIONS;
  return options;
}

// Known users: { username, password, role }
function getUsers() {
  return [
    { username: process.env.SEO_USERNAME, password: process.env.SEO_PASSWORD, role: 'seo' },
    { username: process.env.EXTENDED_USERNAME, password: process.env.EXTENDED_PASSWORD, role: 'extended' },
    // Legacy fallback — supports old APP_USERNAME/APP_PASSWORD as seo role
    ...(process.env.APP_USERNAME ? [{ username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD, role: 'seo' }] : []),
  ].filter(u => u.username && u.password);
}

// Brute force tracking
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkBruteForce(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return;
  if (record.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    const err = new Error(`Too many failed attempts. Try again in ${mins} minute(s).`);
    err.status = 429;
    throw err;
  }
}

function recordFailure(ip) {
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
    record.count = 0;
  }
  loginAttempts.set(ip, record);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const { username, password } = req.body;

  try { checkBruteForce(ip); }
  catch (err) { return res.status(err.status || 429).json({ error: err.message }); }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = getUsers().find(u => u.username === username && u.password === password);

  if (user) {
    clearAttempts(ip);
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res.json({ ok: true, role: user.role });
  }

  recordFailure(ip);
  const record = loginAttempts.get(ip);
  const remaining = MAX_ATTEMPTS - (record?.count || 0);
  res.status(401).json({
    error: remaining > 0
      ? `Invalid username or password. ${remaining} attempt(s) remaining.`
      : 'Invalid username or password.',
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, clearCookieOptions());
  res.json({ ok: true });
});

// GET /api/auth/verify
router.get('/verify', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, role: decoded.role || 'seo' });
  } catch {
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.status(401).json({ valid: false });
  }
});

// requireAuth — any authenticated user
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Unauthorised. Please log in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// requireSeo — SEO team only
function requireSeo(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Unauthorised. Please log in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.role !== 'seo') {
      return res.status(403).json({ error: 'Access restricted to SEO team.' });
    }
    next();
  } catch {
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

module.exports = { router, requireAuth, requireSeo };
