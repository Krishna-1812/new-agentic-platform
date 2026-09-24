// ── SEO Studio access gate ───────────────────────────────────────────────────
// The studio is only ever meant to be used inside the Northaxis platform, which
// frames it in an iframe. The two run as separate Railway services, and
// *.up.railway.app is on the Public Suffix List, so the iframe is cross-site
// and a session cookie set here is a third-party cookie that Safari (and any
// browser blocking them) drops. So instead of a cookie, the platform hands the
// iframe a short-lived signed pass in its URL (?st=...), the client keeps it
// in sessionStorage and sends it with every API call (X-Studio-Token header,
// or ?st= where a header can't be set: EventSource, file downloads).
//
// Pass format: base64url(JSON payload) + "." + base64url(HMAC-SHA256), keyed
// with SEO_STUDIO_SECRET, which both services share. Payload:
//   { e: email, r: 'staff' | 'app', x: expiry (unix seconds) }
// 'staff' may use every tool. 'app' is a signed-in customer of the public
// /app surface, who may only reach the few tools /app offers (APP_PREFIXES).
//
// Without SEO_STUDIO_SECRET every API call is refused, except when
// NODE_ENV=development, where the studio is open for local work.

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const SECRET = process.env.SEO_STUDIO_SECRET || '';
const OPEN_FOR_DEV = !SECRET && process.env.NODE_ENV === 'development';

// API mounts an 'app' pass may reach: the tools /app embeds (keyword research,
// article recommendation, article enhancement), the SEMrush balance their
// pages show, and a read of the knowledge-base list the enhancer uses.
const APP_PREFIXES = [
  '/api/keyword-research',
  '/api/article-recommendation',
  '/api/article-enhancement',
  '/api/semrush',
];
const APP_READ_ONLY_PREFIXES = ['/api/kb'];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sign(body) {
  return b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
}

// Returns the payload for a valid, unexpired pass, else null.
function verifyStudioToken(token) {
  if (!SECRET || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.x !== 'number' || payload.x * 1000 < Date.now()) return null;
  if (payload.r !== 'staff' && payload.r !== 'app') return null;
  return payload;
}

// Only used by tests and local scripts; the platform (app.py) mints the real ones.
function mintStudioToken(email, role, ttlSeconds = 3600) {
  const body = b64url(JSON.stringify({ e: email, r: role, x: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${sign(body)}`;
}

function tokenFrom(req) {
  return req.get('x-studio-token') || (typeof req.query.st === 'string' ? req.query.st : '');
}

function appMayUse(req) {
  const url = (req.originalUrl || '').split('?')[0];
  const under = p => url === p || url.startsWith(p + '/');
  if (APP_PREFIXES.some(under)) return true;
  return req.method === 'GET' && APP_READ_ONLY_PREFIXES.some(under);
}

function requireAuth(req, res, next) {
  if (OPEN_FOR_DEV) {
    req.user = { username: 'local-dev', role: 'staff' };
    return next();
  }
  const payload = verifyStudioToken(tokenFrom(req));
  if (!payload) {
    return res.status(401).json({ error: 'Your session has expired. Reload the page to continue.' });
  }
  req.user = { username: payload.e, role: payload.r };
  if (payload.r === 'app' && !appMayUse(req)) {
    return res.status(403).json({ error: 'This tool is not part of your plan.' });
  }
  next();
}

function requireSeo(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'staff') return res.status(403).json({ error: 'SEO team only.' });
    next();
  });
}

router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// Lets the client decide between the studio and the "open this from Northaxis"
// screen before it makes any real call.
router.get('/verify', (req, res) => {
  if (OPEN_FOR_DEV) return res.json({ valid: true, role: 'staff', open: true });
  const payload = verifyStudioToken(tokenFrom(req));
  if (!payload) return res.json({ valid: false });
  res.json({ valid: true, role: payload.r });
});

module.exports = { router, requireAuth, requireSeo, verifyStudioToken, mintStudioToken, APP_PREFIXES };
