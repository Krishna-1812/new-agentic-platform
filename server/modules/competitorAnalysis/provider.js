// Picks the active data source. Real SEMrush when a key is configured,
// otherwise falls back to the mock so the module still works (with a
// visible "simulated" label) in environments without one.
const mockProvider = require('./mockProvider');
const realProvider = require('./realProvider');

function hasSemrushKey() {
  return !!process.env.SEMRUSH_API_KEY;
}

function getProvider() {
  return hasSemrushKey() ? realProvider : mockProvider;
}

module.exports = { getProvider, hasSemrushKey };
