// ── Spaces: whose saved work a request may list and open ───────────────────
// The platform's rule (tracker/workspace.py, docs/account-memory-plan.md), for the studio's own
// saved lists (On-Page audits, Content Architect projects, Market Potential scenarios):
//
//   "acct:<id>"   a client account's work. Listed only inside that account; anyone on the team
//                 (every staff pass) may open it.
//   "me:<email>"  a person's General work. Only they list or open it.
//   none          saved before spaces. It stays where it was: in everyone's General list.
//
// req.user.space comes from the signed pass (routes/auth.js spaceFor), never from the browser.

const ACCOUNT = /^acct:[0-9]+$/;

function isAccount(space) {
  return typeof space === 'string' && ACCOUNT.test(space);
}

// What a new item is stamped with.
function stamp(req) {
  const user = (req && req.user) || {};
  return { space: user.space || `me:${String(user.username || '').toLowerCase()}`,
           owner: String(user.username || '').toLowerCase() };
}

// Whether an item belongs in this request's list.
function listed(item, req) {
  const here = stamp(req).space;
  const space = item && item.space;
  if (isAccount(here)) return space === here;
  return !space || space === here;
}

// Whether this request may open (and carry on) an item, wherever it was listed.
function reachable(item, req) {
  if (!item) return false;
  const space = item.space;
  if (!space || isAccount(space)) return true;
  return space === stamp(req).space;
}

module.exports = { isAccount, stamp, listed, reachable };
