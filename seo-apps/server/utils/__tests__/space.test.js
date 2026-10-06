// Spaces in the studio (utils/space.js, docs/account-memory-plan.md): what the signed pass names, and
// what On-Page Audit, Content Architect and Market Potential list, open and delete for each space.
// Run: node utils/__tests__/space.test.js
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.SEO_STUDIO_SECRET = 'space-test-secret';
process.env.SEO_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-space-'));
delete process.env.NODE_ENV;

const assert = require('assert');
const express = require('express');
const auth = require('../../routes/auth');
const space = require('../space');

const LUMINA = 'acct:7';
const BLOOM = 'acct:8';

// ── The pass ─────────────────────────────────────────────────────────────────
function userFrom(token) {
  const req = { method: 'GET', originalUrl: '/api/on-page-audit/list', query: {}, get: () => token };
  let out = null;
  auth.requireAuth(req, { status() { return this; }, json() { return this; } }, () => { out = req.user; });
  return out;
}
assert.strictEqual(userFrom(auth.mintStudioToken('Ana@x.com', 'staff', 60, { s: LUMINA })).space, LUMINA);
assert.strictEqual(userFrom(auth.mintStudioToken('ana@x.com', 'staff', 60)).space, 'me:ana@x.com');
assert.strictEqual(userFrom(auth.mintStudioToken('ana@x.com', 'staff', 60, { s: 'acct:1 or 1=1' })).space,
  'me:ana@x.com', 'only a real account space counts');
assert.strictEqual(userFrom(auth.mintStudioToken('ana@x.com', 'staff', 60, { s: 'me:raj@x.com' })).space,
  'me:ana@x.com', 'a pass cannot claim someone else\'s General work');

// ── The rules ────────────────────────────────────────────────────────────────
const req = (who, sp) => ({ user: { username: who, space: sp || `me:${who}` } });
const ana = req('ana@x.com'), raj = req('raj@x.com'), anaL = req('ana@x.com', LUMINA), rajL = req('raj@x.com', LUMINA);
assert.deepStrictEqual(space.stamp(anaL), { space: LUMINA, owner: 'ana@x.com' });
assert.ok(space.listed({ space: LUMINA }, rajL) && !space.listed({ space: LUMINA }, raj));
assert.ok(!space.listed({ space: BLOOM }, anaL) && !space.listed({}, anaL), 'an account lists only its own');
assert.ok(space.listed({}, ana) && space.listed({ space: 'me:ana@x.com' }, ana) && !space.listed({ space: 'me:ana@x.com' }, raj));
assert.ok(space.reachable({ space: LUMINA }, raj) && !space.reachable({ space: 'me:ana@x.com' }, raj));

// ── Through the routes ───────────────────────────────────────────────────────
async function main() {
  const app = express();
  app.use(express.json());
  app.use((r, res, next) => { r.user = JSON.parse(r.get('x-test-user')); next(); });
  app.use('/api/on-page-audit', require('../../modules/onPageAudit/routes'));
  app.use('/api/content-architect', require('../../modules/contentArchitect/routes'));
  app.use('/api/market-potential', require('../../modules/marketPotential/routes'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (r, method, url, body) => fetch(base + url, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(r.user) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));

  try {
    // On-Page Audit: saved files, as the auditor writes them.
    const store = require('../../modules/onPageAudit/store');
    const audit = (id, extra) => store.saveAudit({ id, url: `https://${id}.in`, auditDate: new Date().toISOString(),
      sections: [], ...extra });
    await audit('a_lum', { space: LUMINA, owner: 'ana@x.com' });
    await audit('a_blo', { space: BLOOM, owner: 'ana@x.com' });
    await audit('a_ana', { space: 'me:ana@x.com', owner: 'ana@x.com' });
    await audit('a_old', {});
    const ids = async (r) => (await call(r, 'GET', '/api/on-page-audit/list')).body.map((a) => a.id).sort();
    assert.deepStrictEqual(await ids(rajL), ['a_lum'], 'the account lists its own audits, the whole team\'s');
    assert.deepStrictEqual(await ids(ana), ['a_ana', 'a_old'], 'General: your own, and those from before');
    assert.deepStrictEqual(await ids(raj), ['a_old']);
    assert.strictEqual((await call(raj, 'GET', '/api/on-page-audit/result/a_ana')).status, 404);
    assert.strictEqual((await call(raj, 'GET', '/api/on-page-audit/result/a_lum')).status, 200);
    assert.strictEqual((await call(rajL, 'DELETE', '/api/on-page-audit/a_lum')).status, 403, 'only its maker deletes it');
    assert.strictEqual((await call(anaL, 'DELETE', '/api/on-page-audit/a_lum')).status, 200);

    // Content Architect projects.
    const ca = require('../../modules/contentArchitect/store');
    const pL = await ca.createProject({ domain: 'https://lumina.in', host: 'lumina.in', ...space.stamp(anaL) });
    const pA = await ca.createProject({ domain: 'https://mine.in', host: 'mine.in', ...space.stamp(ana) });
    const projects = async (r) => (await call(r, 'GET', '/api/content-architect/projects')).body.map((p) => p.id);
    assert.deepStrictEqual(await projects(rajL), [pL.id]);
    assert.deepStrictEqual(await projects(raj), []);
    assert.deepStrictEqual(await projects(ana), [pA.id]);
    assert.strictEqual((await call(raj, 'GET', `/api/content-architect/projects/${pA.id}`)).status, 404);
    assert.strictEqual((await call(raj, 'GET', `/api/content-architect/projects/${pA.id}/clusters`)).status, 404,
      'every route under a project checks it');
    assert.strictEqual((await call(rajL, 'GET', `/api/content-architect/projects/${pL.id}`)).status, 200);
    assert.strictEqual((await call(rajL, 'DELETE', `/api/content-architect/projects/${pL.id}`)).status, 403);

    // Market Potential scenarios.
    const mp = require('../../modules/marketPotential/store');
    await mp.init();
    const save = (r, name) => call(r, 'POST', '/api/market-potential/scenarios', { name, serviceId: 'svc_1' });
    const sL = (await save(anaL, 'Lumina plan')).body.scenario;
    await save(ana, 'My plan');
    const names = async (r) => (await call(r, 'GET', '/api/market-potential/scenarios')).body.scenarios.map((s) => s.name);
    assert.deepStrictEqual(await names(rajL), ['Lumina plan']);
    assert.deepStrictEqual(await names(ana), ['My plan']);
    assert.deepStrictEqual(await names(raj), []);
    assert.strictEqual((await call(rajL, 'DELETE', `/api/market-potential/scenarios/${sL.id}`)).status, 403);
    assert.strictEqual((await call(anaL, 'DELETE', `/api/market-potential/scenarios/${sL.id}`)).status, 200);
    console.log('space: all checks passed');
  } finally {
    server.close();
    fs.rmSync(process.env.SEO_DATA_ROOT, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
