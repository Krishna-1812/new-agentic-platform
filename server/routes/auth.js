const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'seo-automation-fallback-secret';
const COOKIE_NAME = 'seo_session';
const COOKIE_OPTIONS = {
  httpOnly: true,                                          // JS cannot read it — XSS proof
  secure: process.env.NODE_ENV !== 'development',         // HTTPS only in production
  sameSite: 'strict',                                     // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000                        // 7 days
};

// Brute force tracking: { ip → { count, lockedUntil } }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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

  try {
    checkBruteForce(ip);
  } catch (err) {
    return res.status(err.status || 429).json({ error: err.message });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username === process.env.APP_USERNAME && password === process.env.APP_PASSWORD) {
    clearAttempts(ip);
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res.json({ ok: true });
  }

  recordFailure(ip);
  const record = loginAttempts.get(ip);
  const remaining = MAX_ATTEMPTS - (record?.count || 0);
  res.status(401).json({
    error: remaining > 0
      ? `Invalid username or password. ${remaining} attempt(s) remaining.`
      : 'Invalid username or password.'
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
  res.json({ ok: true });
});

// GET /api/auth/verify  (used by frontend on load to check session)
router.get('/verify', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ valid: false });
  try {
    jwt.verify(token, JWT_SECRET);
    res.json({ valid: true });
  } catch {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
    res.status(401).json({ valid: false });
  }
});

// Middleware used by other routes
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Unauthorised. Please log in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

module.exports = { router, requireAuth };
