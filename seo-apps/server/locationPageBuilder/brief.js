// ── Brief persistence ids ───────────────────────────────────────────────────
// The editable content brief sits between keyword approval and content
// generation (see cbhBrief.js, which owns its shape, drafting and saving).
//
// One row per (client, service, location), addressed by an id that is a pure
// function of the tuple so concurrent writers converge on one row instead of
// racing to insert duplicates. Keyword selections use the same tuple key.

const crypto = require('crypto');

function tupleKey({ clientId, serviceId, locationId }) {
  return `${clientId}|${serviceId}|${locationId}`;
}

function briefId(tuple) {
  return `brf_${crypto.createHash('sha1').update(tupleKey(tuple)).digest('hex').slice(0, 16)}`;
}

module.exports = { briefId, tupleKey };
