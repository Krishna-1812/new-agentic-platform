// The studio pass gate (routes/auth.js). Run: node routes/__tests__/auth.test.js
process.env.SEO_STUDIO_SECRET = 'cross-check-secret';
delete process.env.NODE_ENV;

const assert = require('assert');
const auth = require('../auth');

// Minted by app.py's _studio_pass for {e: sudheer@markifydigital.com,
// r: staff, x: 4102444800 (year 2100)} with the secret above; the same string
// is asserted on the Python side (tests/test_seo_studio.py), so the two
// implementations can't drift apart without one of them failing.
const FROM_PYTHON = 'eyJlIjoic3VkaGVlckBtYXJraWZ5ZGlnaXRhbC5jb20iLCJyIjoic3RhZmYiLCJ4Ijo0MTAyNDQ0ODAwfQ.5f8_nH9huXrRgSauept0y55TZqsXXQr-yoGTF1Fh6rM';

function fakeReq({ token, query = {}, method = 'GET', url = '/api/kb' } = {}) {
  return {
    method,
    originalUrl: url,
    query,
    get: h => (h.toLowerCase() === 'x-studio-token' ? token : undefined),
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function gate(mw, req) {
  const res = fakeRes();
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { passed, res, req };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

test('a pass minted by the Python side verifies here', () => {
  const p = auth.verifyStudioToken(FROM_PYTHON);
  assert.deepStrictEqual(p, { e: 'sudheer@markifydigital.com', r: 'staff', x: 4102444800 });
});

test('no pass is refused with 401', () => {
  const { passed: ok, res } = gate(auth.requireAuth, fakeReq());
  assert.strictEqual(ok, false);
  assert.strictEqual(res.statusCode, 401);
});

test('a tampered signature is refused', () => {
  const bad = FROM_PYTHON.slice(0, -1) + (FROM_PYTHON.endsWith('A') ? 'B' : 'A');
  assert.strictEqual(auth.verifyStudioToken(bad), null);
});

test('a tampered payload is refused', () => {
  const [, sig] = FROM_PYTHON.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'x@evil.com', r: 'staff', x: 4102444800 })).toString('base64url');
  assert.strictEqual(auth.verifyStudioToken(forged + '.' + sig), null);
});

test('an expired pass is refused', () => {
  assert.strictEqual(auth.verifyStudioToken(auth.mintStudioToken('a@b.com', 'staff', -5)), null);
});

test('an unknown role is refused', () => {
  assert.strictEqual(auth.verifyStudioToken(auth.mintStudioToken('a@b.com', 'admin')), null);
});

test('garbage is refused without throwing', () => {
  for (const t of ['', '.', 'abc', 'a.b', null, undefined, 42]) assert.strictEqual(auth.verifyStudioToken(t), null);
});

test('staff pass via header reaches any tool', () => {
  const t = auth.mintStudioToken('sudheer@markifydigital.com', 'staff');
  const { passed: ok, req } = gate(auth.requireAuth, fakeReq({ token: t, url: '/api/competitor-tracker/clients' }));
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(req.user, { username: 'sudheer@markifydigital.com', role: 'staff' });
});

test('the pass is also accepted as ?st= (EventSource, downloads)', () => {
  const t = auth.mintStudioToken('sudheer@markifydigital.com', 'staff');
  const { passed: ok } = gate(auth.requireAuth, fakeReq({ query: { st: t }, url: '/api/keyword-research/stream/x?st=' + t }));
  assert.strictEqual(ok, true);
});

test("an 'app' pass reaches the three /app tools and the SEMrush balance", () => {
  const t = auth.mintStudioToken('someone@gmail.com', 'app');
  for (const url of ['/api/keyword-research/init', '/api/article-recommendation/init',
    '/api/article-enhancement/stream/abc', '/api/semrush/balance']) {
    assert.strictEqual(gate(auth.requireAuth, fakeReq({ token: t, url, method: 'POST' })).passed, true, url);
  }
});

test("an 'app' pass is kept out of every other tool (403)", () => {
  const t = auth.mintStudioToken('someone@gmail.com', 'app');
  for (const url of ['/api/competitor-tracker/clients', '/api/location-page-builder/pages',
    '/api/robots-monitor/clients', '/api/gbp-qc/clients', '/api/article-enhancement-lite/init',
    '/api/keyword-researchx']) {
    const { passed: ok, res } = gate(auth.requireAuth, fakeReq({ token: t, url }));
    assert.strictEqual(ok, false, url);
    assert.strictEqual(res.statusCode, 403, url);
  }
});

test("an 'app' pass may read the knowledge-base list but not change it", () => {
  const t = auth.mintStudioToken('someone@gmail.com', 'app');
  assert.strictEqual(gate(auth.requireAuth, fakeReq({ token: t, url: '/api/kb' })).passed, true);
  assert.strictEqual(gate(auth.requireAuth, fakeReq({ token: t, url: '/api/kb/x', method: 'PUT' })).passed, false);
});

test("requireSeo lets staff through and refuses an 'app' pass", () => {
  const staff = auth.mintStudioToken('s@markifydigital.com', 'staff');
  const app = auth.mintStudioToken('someone@gmail.com', 'app');
  assert.strictEqual(gate(auth.requireSeo, fakeReq({ token: staff, url: '/api/search' })).passed, true);
  assert.strictEqual(gate(auth.requireSeo, fakeReq({ token: app, url: '/api/search' })).res.statusCode, 403);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
