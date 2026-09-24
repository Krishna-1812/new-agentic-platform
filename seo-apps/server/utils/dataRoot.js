// ── Where the file-backed tools keep their data ─────────────────────────────
// Robots Monitor, On-Page Audit, Market Potential, Competitor Analysis and
// Content Architect save JSON files, and the Knowledge Base editor writes
// markdown. By default those live next to the code, which on Railway is the
// container's own disk: wiped on every deploy. Set SEO_DATA_ROOT to the mount
// path of a Railway volume (e.g. /data) and all of it lives there instead.
//
// The Knowledge Base and module manifests ship with the code, so on the first
// boot against an empty volume they are copied onto it; after that the
// volume's copy (with the team's edits) is the one in use.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.SEO_DATA_ROOT || '';
const SKIP = /[\\/]bulk-scraper[\\/]output([\\/]|$)/;

// dataDir('robotsMonitor', path.join(__dirname, 'data')): the module's folder
// on the volume when SEO_DATA_ROOT is set, else its old place next to the code.
function dataDir(name, fallback) {
  return ROOT ? path.join(ROOT, name) : fallback;
}

// A folder that ships with the code and is edited at runtime: the repo copy
// without a volume; with one, the volume copy, seeded from the repo if absent.
function seededDir(name, repoDir) {
  if (!ROOT) return repoDir;
  const target = path.join(ROOT, name);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(ROOT, { recursive: true });
    // modules/bulk-scraper/output is ~50 MB of a standalone script's scraped
    // pages that no tool reads; everything else is manifests and markdown.
    fs.cpSync(repoDir, target, { recursive: true, filter: src => !SKIP.test(src) });
    console.log(`[dataRoot] Seeded ${target} from ${repoDir}`);
  }
  return target;
}

module.exports = { dataDir, seededDir, ROOT };
