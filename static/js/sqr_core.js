/* Search Query Analysis: the rules and the arithmetic, with no page code.
 *
 * Every search term runs through its account's deterministic rules (below); only the terms no rule settles go to the model, through
 * /strategic-agents/paid-marketing/api/sqr/classify (tracker/paid_sqr.py holds each ruleset's remaining categories). What is left is what to DO
 * about it: the negatives and the keywords worth adding, ranked. That is all here, in one file, so tests/test_sqr_core_js.py can run it in Node.
 *
 * There are no per-client rulebooks: the Automatic rules (autoRuleset) learn each account from its own Google Ads data. The matchers, the
 * hint patterns and the hooks a rulebook can set (coreSignal, coreVeto, modelHint, territoryMap, ambiguousCities, forbiddenNegatives,
 * routeCampaignRe) are kept and exported so one can be added to RULESETS. The ruleset ids here and in tracker/paid_sqr.py must match:
 * tests/test_sqr_core_js.py checks.
 */
(function(root){
"use strict";

// =====================================================================
// CSV parsing: handles quoted fields (Google Ads exports quote fields
// that contain commas), and finds the real header row even when Google
// prepends a title/date-range line before it.
// =====================================================================
function cleanText(text){
  // Strip null bytes (shows up once per character when a UTF-16 export
  // gets misread as UTF-8) and zero-width/BOM characters some tools leave
  // in exported cells.
  return String(text).replace(/\u0000/g, "").replace(/[\u200B\uFEFF]/g, "").replace(/\r\n/g, "\n");
}

function splitCSVLine(line, delim){
  const out = []; let field = "", inQuotes = false;
  for (let i = 0; i < line.length; i++){
    const c = line[i];
    if (inQuotes){
      if (c === '"'){ if (line[i+1] === '"'){ field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { out.push(field); field = ""; }
      else field += c;
    }
  }
  out.push(field);
  return out;
}

function normCell(c){ return String(c == null ? "" : c).trim().toLowerCase(); }
function normKey(c){ return normCell(c).replace(/[^a-z0-9]/g, ""); }

function parseCSV(text){
  text = cleanText(text);
  const lines = text.split("\n").filter((l, i, arr) => l.length || i < arr.length - 1);

  // Auto-detect the delimiter from the first non-empty line: most exports
  // are comma-separated, but some locales/tools use semicolon or tab.
  const sampleLine = lines.find(l => l.trim().length) || "";
  const delim = [",", ";", "\t"].reduce((best, d) => (sampleLine.split(d).length > sampleLine.split(best).length ? d : best), ",");

  const rows = lines.map(l => splitCSVLine(l, delim));

  // Google Ads exports lead with a title line ("Search terms report") and
  // a date-range line before the real header row: matching "search term"
  // as a SUBSTRING wrongly picks the title line itself ("Search terms
  // report" contains it). Match on a normalized (letters+digits only)
  // whole-cell comparison instead, and require more than one column (the
  // title/date lines are always single-cell).
  const HEADER_CELLS = ["searchterm", "searchquery", "query", "negativekeyword", "keyword"];
  const isHeaderRow = r => r.some(c => HEADER_CELLS.includes(normKey(c)));
  let headerIdx = rows.findIndex(r => r.length > 1 && isHeaderRow(r));
  if (headerIdx < 0) headerIdx = rows.findIndex(isHeaderRow);

  const header = headerIdx >= 0 ? rows[headerIdx].map(h => String(h).trim()) : [];
  const out = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < rows.length; i++){
      const r = rows[i];
      if (!r.length || (r.length === 1 && !r[0])) continue;
      const obj = {};
      header.forEach((h, j) => obj[h] = r[j] !== undefined ? r[j] : "");
      out.push(obj);
    }
  }
  return { header, rows: out, headerFound: headerIdx >= 0, preview: rows.slice(0, 5), delim };
}

function pick(row, ...names){
  for (const n of names) if (n in row) return row[n];
  const keys = Object.keys(row);
  for (const n of names){
    const k = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g,"") === n.toLowerCase().replace(/[^a-z0-9]/g,""));
    if (k) return row[k];
  }
  return "";
}
function num(v){
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));   // 1,234.50  $12  €12  CA$12  5%
  return isNaN(n) ? 0 : n;
}
// Conversions are kept as exact decimals for scoring/sorting (impact score,
// tier eligibility), but summing many CSV rows produces floating-point
// noise (171.44999999999999): round only where the number is DISPLAYED.
function fmtConv(v){ return Math.round(Number(v) || 0); }


// =====================================================================
// Matching. A rule's word list matches WHOLE WORDS (or the start of a
// word, for stems like "dentis" or "landscap"), never the middle of one:
// "dent" is in "student", "uk" in "duke", "oral" in "floral", "gum" in
// "argument".
// =====================================================================
function normText(s){ return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const LEAD = "(?:^|[^a-z0-9])";

// A list of names or phrases: each must stand alone as words.
function phraseRe(list){
  const alts = list.map(normText).filter(Boolean).sort((a, b) => b.length - a.length).map(x => reEsc(x).replace(/ /g, "\\s+"));
  return alts.length ? new RegExp(LEAD + "(?:" + alts.join("|") + ")(?![a-z0-9])", "i") : null;
}
// Words short enough to sit inside longer ones, or that are real words on their own ("crown", "bridge"), must stand alone
// (with an optional plural); anything longer is a stem and may continue ("dentis" -> dentist, dentistry).
const WHOLE_WORDS = new Set(["crown", "bridge"]);
function signalRe(list){
  const stems = [], whole = [];
  list.map(normText).filter(Boolean).forEach(x => {
    const e = reEsc(x).replace(/ /g, "\\s+");
    (/^[a-z]+$/.test(x) && (x.length <= 4 || WHOLE_WORDS.has(x)) ? whole : stems).push(e);
  });
  const parts = [];
  if (stems.length) parts.push(LEAD + "(?:" + stems.join("|") + ")");
  if (whole.length) parts.push(LEAD + "(?:" + whole.join("|") + ")(?:s|es)?(?![a-z0-9])");
  return parts.length ? new RegExp(parts.join("|"), "i") : null;
}
const CACHE = new WeakMap();
function matcher(rs, key, make){
  let c = CACHE.get(rs); if (!c) { c = {}; CACHE.set(rs, c); }
  if (!(key in c)) c[key] = make(rs[key] || []);
  return c[key];
}
function has(rs, key, term){ const re = matcher(rs, key, phraseRe); return !!re && re.test(term); }
function core(rs, term){
  const re = matcher(rs, "coreSignal", signalRe);
  // A service word alone does not settle a term that also carries a hint of a category the model is asked about (jobs, schools, DIY, price
  // shopping, general questions, pets, products, charities): "dental hygienist jobs" has "dental" in it and is not a patient.
  return !!re && re.test(term) && !(rs.coreVeto && rs.coreVeto.test(term)) && !(rs.modelHint && rs.modelHint.test(term));
}

// "Dr Smith" is a practitioner, "dr near me" is not.
const NOT_A_NAME = new Set(("near nearby me office offices for who that what how in on at and or the a an is are open appointment appointments visit " +
  "visits consult consultation phone number address hours review reviews location locations clinic center centre dentist dental today now accepts " +
  "takes specialist services service cost price prices best top local good find any").split(" "));
// The competitor from the ruleset's list that a term names ("" when it names none, or is a practitioner or another rule's competitor).
function competitorName(rs, term){
  const re = matcher(rs, "competitors", phraseRe);
  const m = re && re.exec(term);
  return m ? normText(m[0].replace(/^[^a-z0-9]/i, "")) : "";
}

// "Dr" is a doctor when it opens the term or follows a word that introduces one ("dentist dr warren", "my dr patel"). After a street name it is
// Drive ("lakeshore dr springfield", "1200 lakeshore plaza dr suite 100"), and after a house number it is always Drive.
const DR_AFTER = new Set(("dentist dentists dentistry dental my see best top with by for of and office doctor ortho orthodontist surgeon pediatric kids family " +
  "emergency cosmetic new a the visit find meet near nearby at from is").split(" "));
function individual(rs, t){
  const low = t.toLowerCase();
  const re = /(^|[^a-z0-9])dr\.?\s+([a-z]{3,})\b/g; let m;
  while ((m = re.exec(low))) {
    if (NOT_A_NAME.has(m[2])) continue;
    const before = low.slice(0, m.index + m[1].length).trim().split(/\s+/).filter(Boolean);
    if (/\b\d{2,5}\b/.test(before.join(" "))) continue;                 // after a house number
    if (!before.length || DR_AFTER.has(before[before.length - 1])) return true;
  }
  const re2 = /\b([a-z]{3,})\s+(dds|dmd|pllc)\b/gi;
  while ((m = re2.exec(t))) if (!NOT_A_NAME.has(m[1].toLowerCase())) return true;
  return false;
}

// =====================================================================
// Shared helpers
// =====================================================================
// A street address is a number, a street name and a street word. A number that is a measure ("64 slice ct", "24 hour dentist
// way", "10 year warranty st") is not one.
const MEASURE_RE = /\b\d{1,6}\s+(slice|slices|hour|hours|hr|hrs|day|days|minute|minutes|min|week|weeks|month|months|year|years|mg|ml|mm|cm|tesla|percent|pack|piece|pcs|count|oz|lb|lbs|gb|tb)\b/i;
const ADDRESS_RE = /\b\d{1,6}\s+([a-z0-9]+\s+){1,4}(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|parkway|pkwy|court|ct|circle|cir|place|pl)\b/i;
const PHONE_RE = /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const PPT_RE = /\bppt\b/i;
function isAddress(t){
  const m = ADDRESS_RE.exec(t);
  if (!m) return false;
  return !MEASURE_RE.test(m[0]);
}

// A Performance Max campaign is targeted by radius, not by the city in its name, so a place named in a search is not a mismatch there.
function radiusTargeted(row){ return !!row && (/pmax|performance[\s_]?max/i.test(row.campaignType || "") || /pmax|performance[\s_-]?max/i.test(row.campaign || "")); }
function normSlug(campaign){
  return String(campaign || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const CITY_RE = new Map();
function cityHit(city, t, ambiguous){
  let re = CITY_RE.get(city); if (!re) { re = phraseRe([city]); CITY_RE.set(city, re); }
  if (!re.test(t)) return false;
  const guard = ambiguous && ambiguous[city.toLowerCase()];
  return guard ? guard.test(t) : true;
}
function campaignServesCity(slug, territoryMap, term, ambiguous){
  // true if `term` names a city in this campaign's own territory (no mismatch), false if it names a DIFFERENT mapped campaign's city
  // (mismatch), null if the campaign isn't in the map at all (unknown territory -> never flag a mismatch). A city name that is also an
  // ordinary word or a surname (Normal, Cary, Apex, Independence) only counts as another campaign's city when the state is named too.
  const key = Object.keys(territoryMap).sort((a, b) => b.length - a.length).find(k => slug.includes(k));
  if (!key) return null;
  const t = term.toLowerCase();
  if (territoryMap[key].some(c => cityHit(c, t, null))) return true;
  for (const [otherKey, cities] of Object.entries(territoryMap)){
    if (otherKey === key) continue;
    if (cities.some(c => cityHit(c, t, ambiguous))) return false;
  }
  return null;
}

// =====================================================================
// Generic: no client rulebook (CSV mode, and the base of the Automatic rules below)
// =====================================================================
const GENERIC = {
  id: "generic", label: "Automatic",
  note: "For any account without a client rulebook. Nothing is typed in by hand: the account\'s own Google Ads data is the rulebook. Its brand comes from its name, and a search that is exactly a keyword it bids on is relevant. Everything else is read by the model, which is told what the account is: its campaigns, the keywords it bids on and the searches that converted. The model follows the standard Search Query process: relevant, competitor (another named business selling the same thing), not relevant (jobs, courses, do-it-yourself, free or bargain hunting, general questions, wrong area), and Client Review where only the client can decide, such as insurance. A client rulebook, where one is added, is more exact and is picked for its account by tracker/paid_sqr_data.py.",
  classifyDeterministic(){ return null; },
};

// =====================================================================
// AUTOMATIC: the rules for any account that has no client rulebook. Nothing is written by hand: the account's own Google Ads data is the rulebook.
// Two rules are certain enough to apply without the model: the account's own brand (taken from its name) and a search that is exactly a keyword
// the account bids on. Everything else is read by the model, which is told what the account is: its campaigns, the keywords it bids on, and what
// has converted. A client rulebook, when one is added to RULESETS, always beats this.
// =====================================================================
const NAME_NOISE = new Set(("the and of for llc inc ltd corp co company products product ads ad ppc google search digital account us usa ca au uk nz eu na nam eng sem paid adwords " +
  "group holdings international global limited pty gmbh").split(" "));
const NAME_DESCRIPTORS = new Set(("racing dental dentistry family health medical center centre clinic studio design landscape landscaping construction plumbing systems technologies " +
  "technology consulting marketing agency services service solutions associates partners machine precision").split(" "));
// "Acme Widgets Inc." -> "acme widgets"; "AU - Larkspur Products" -> "larkspur"; "Colin Mabery Racing" -> "colin mabery racing", "colin mabery"
function brandPhrases(name){
  const raw = String(name || "").toLowerCase(), parts = [raw.replace(/\([^)]*\)/g, " ")];
  (raw.match(/\(([^)]*)\)/g) || []).forEach(p => parts.push(p.slice(1, -1)));
  const out = new Set();
  parts.forEach(part => {
    const toks = [];
    let letters = false;                       // "k&m" is two one-letter tokens: joined, so they match how the name is typed
    part.replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean).forEach(w => {
      if (NAME_NOISE.has(w) || /^\d{5,}$/.test(w)) return;
      if (w.length === 1) { if (letters) toks[toks.length - 1] += w; else toks.push(w); letters = true; }
      else { toks.push(w); letters = false; }
    });
    if (!toks.length) return;
    const add = ws => { const s = ws.join(" "); if (s.replace(/ /g, "").length >= (ws.length === 1 ? 5 : 8)) { out.add(s); if (ws.length > 1) out.add(ws.join("")); } };
    add(toks);
    if (toks.length >= 3) add(toks.slice(0, 2));
    const last = toks[toks.length - 1];
    // dropping a trailing descriptor ("racing", "dental") leaves two words, or one long enough not to be an ordinary word
    if (toks.length >= 2 && NAME_DESCRIPTORS.has(last) && (toks.length >= 3 || toks[0].length >= 8)) add(toks.slice(0, -1));
  });
  return Array.from(out);
}
const AUTO_JOBS = /\b(jobs?|careers?|hiring|salar(?:y|ies)|employment|openings?|internships?|resumes?|stock|investor|investors)\b/i;
function autoRuleset(profile){
  profile = profile || {};
  const phrases = brandPhrases(profile.name), brandRe = phrases.length ? phraseRe(phrases) : null;
  const kw = new Set((profile.keywords || []).map(k => keyText(typeof k === "string" ? k : k && k.text)).filter(Boolean));
  return Object.assign({}, GENERIC, {
    profile, brandPhrases: phrases,
    classifyDeterministic(term){
      const k = normText(term); if (!k) return null;
      // the brand's own jobs and investor searches are not customers: the model reads those
      if (brandRe && brandRe.test(k.replace(/\b([a-z])\s*&\s*([a-z])\b/g, "$1$2").replace(/[^a-z0-9]+/g, " ")) && !AUTO_JOBS.test(k)) return { status: "Relevant", subtype: "Brand" };
      if (kw.has(k)) return { status: "Relevant", subtype: "A keyword the account bids on" };
      return null;
    },
  });
}

const RULESETS = { generic: GENERIC };

// A rulebook's remaining categories (tracker/paid_sqr.py) are mostly written with its own service words in them, so a core word cannot be
// allowed to settle a term that hints at one: a rulebook sets modelHint from these (hint(HINTS.jobs, HINTS.school, ...)). It only routes the
// term to the model; it decides nothing. "affordable" and "offer" are deliberately absent: "affordable dentist near me" and "do dentists offer
// payment plans" are someone looking to book, not bargain hunting.
const HINT_JOBS = "jobs?|careers?|hiring|salar(?:y|ies)|employment|openings?|internships?|resumes?";
const HINT_SCHOOL = "schools?|colleges?|universit(?:y|ies)|courses?|certif\\w*|degrees?|programs?|classes|training|how to become";
const HINT_DIY = "diy|home remed\\w*|at home|homemade|natural remed\\w*|kits?";
const HINT_PRICE = "cheap|cheapest|free|discounts?|coupons?|low cost|no cost|bargain";
const HINT_INFO = "what is|what are|how to|how do|why|causes? of|symptoms? of|definition|meaning";
const HINT_PET = "dogs?|cats?|pets?|horses?|veterinar\\w*|vet";
const HINT_PRODUCT = "toothpaste|toothbrush(?:es)?|floss|mouthwash|buy|amazon|walmart|cvs|store";
const HINT_CHARITY = "charity|non-?profit|volunteer|free clinic|donat\\w*";
const HINTS = { jobs: HINT_JOBS, school: HINT_SCHOOL, diy: HINT_DIY, price: HINT_PRICE, info: HINT_INFO, pet: HINT_PET, product: HINT_PRODUCT, charity: HINT_CHARITY };
const hint = (...parts) => new RegExp("\\b(?:" + parts.join("|") + ")\\b", "i");


// =====================================================================
// Negative keywords: what a negative blocks, and what is already blocked
// =====================================================================
function matchOf(m){
  const x = String(m || "").toUpperCase().replace(/\s*MATCH$/, "").trim();
  return x === "EXACT" || x === "BROAD" ? x : x === "PHRASE" ? "PHRASE" : "";
}
function keyText(s){ return normText(String(s == null ? "" : s).replace(/[\[\]"+]/g, "")); }
// Does a negative keyword stop `text` (already lowercase, single-spaced) from showing an ad?
function blocks(neg, text){
  const n = neg.text; if (!n) return false;
  const m = neg.match || "PHRASE";
  if (m === "EXACT") return text === n;
  if (m === "BROAD"){ const tw = text.split(" "); return n.split(" ").every(w => tw.indexOf(w) >= 0); }
  return (" " + text + " ").indexOf(" " + n + " ") >= 0;
}

// Existing negatives, indexed by where they apply. `level`: account | campaign | adgroup | list; `campaigns`: the campaigns a campaign-level
// negative or an attached list reaches. An ad-group negative covers one ad group only, so it never counts as covering a campaign.
function buildCover(existing){
  const account = { exact: new Set(), loose: [] }, camp = new Map();
  (existing || []).forEach(e => {
    const n = { text: keyText(e.text), match: matchOf(e.match) || "EXACT" };
    if (!n.text || e.level === "adgroup") return;
    const put = (b) => { if (n.match === "EXACT") b.exact.add(n.text); else b.loose.push(n); };
    if (e.level === "account") put(account);
    else (e.campaigns || []).forEach(c => { let b = camp.get(c); if (!b) { b = { exact: new Set(), loose: [] }; camp.set(c, b); } put(b); });
  });
  return { account, camp };
}
// Does a bucket of existing negatives already stop a suggested negative (text, match)? An existing EXACT negative stops only that one query, so
// it never covers a phrase or broad suggestion's wider reach.
function covers(b, text, match){
  if (!b) return false;
  if (match === "EXACT") return b.exact.has(text) || b.loose.some(n => blocks(n, text));
  return b.loose.some(n => blocks(n, text));
}
// Is a suggested negative already in place? Account-level suggestions need an account-level negative; a campaign suggestion is also covered
// by that campaign's own negatives and attached lists.
function isCovered(cover, text, match, level, campaigns){
  if (covers(cover.account, text, match)) return true;
  if (level.indexOf("Account") === 0) return false;
  return campaigns.length > 0 && campaigns.every(c => covers(cover.camp.get(c), text, match));
}
// Would the active negatives already stop this term in this campaign?
function isBlockedHere(cover, text, campaign){
  const hit = (b) => !!b && (b.exact.has(text) || b.loose.some(n => blocks(n, text)));
  return hit(cover.account) || hit(cover.camp.get(campaign));
}

// =====================================================================
// The pipeline. Rows in, a verdict on every row, then the negatives and
// keywords worth acting on, ranked.
// =====================================================================
const NO_TERM = /^(total:.*|other search terms?|--)$/i;
const PRIORITY = 30, MODEL_CAP = 1000, IMPLIED_MIN_COST = 1, IMPLIED_NOTE = "Not relevant, spent and never converted";
const STATUS_ORDER = ["Relevant", "Competitor", "Not Relevant", "Client Review", "Not reviewed"];
const isPmax = ct => /pmax|performance[\s_]?max/i.test(ct || "");
const isSearchType = ct => !ct || /^search/i.test(String(ct).trim());   // keywords can be added only to Search campaigns

function prepareRows(raw){
  const rows = [];
  (raw || []).forEach(r => {
    const term = String(r.term == null ? "" : r.term).trim();
    if (!term || NO_TERM.test(term)) return;
    rows.push({ term, key: normText(term), campaign: String(r.campaign || "").trim(), adGroup: String(r.adGroup || "").trim(),
      campaignType: String(r.campaignType || "").trim(), clicks: +r.clicks || 0, impressions: +r.impressions || 0, cost: +r.cost || 0,
      conversions: +r.conversions || 0, status: String(r.status || "").toUpperCase() });
  });
  return rows;
}

// What the account itself says is its brand. A keyword of a Brand campaign (not Non-Brand, not a competitor campaign) is the account's own name for
// itself, and the searches containing it are its brand searches whatever spelling a rulebook knew. A one-word keyword is trusted only as the whole
// search (a bare "summit" also names other businesses), and a search that mentions jobs, reviews, investors or a firm's money is read by the model.
const BRAND_CAMPAIGN = /brand/i, NOT_BRAND_CAMPAIGN = /non[\s_-]?brand|competitor|conquest/i;
const NOT_A_CUSTOMER = /\b(partners|capital|equity|holdings|investors?|investments?|stock|ceo|funds?|funding|jobs?|careers?|hiring|salary|reviews?|complaints?)\b/i;
function brandKeywords(keywords, accountName){
  const exact = new Set(), phrases = new Set();
  (keywords || []).forEach(k => {
    const t = keyText(typeof k === "string" ? k : k && k.text); if (!t) return;
    exact.add(t);
    const camp = typeof k === "string" ? "" : String((k && k.campaign) || "");
    if (BRAND_CAMPAIGN.test(camp) && !NOT_BRAND_CAMPAIGN.test(camp) && t.split(" ").length >= 2) phrases.add(t);
  });
  // The account's own name, when it is more than one word ("Maple Grove Dental"): a one-word name ("Summit", "Lakeside") is also other businesses' name.
  const named = brandPhrases(accountName).filter(p => p.indexOf(" ") >= 0);
  return { exact, re: phrases.size ? phraseRe(Array.from(phrases)) : null, nameRe: named.length ? phraseRe(named) : null };
}
function fromKeywords(row, B, ruleset){
  const k = normText(row.term);
  if (B.exact.has(k)) return { status: "Relevant", subtype: "A keyword the account bids on" };
  const guarded = NOT_A_CUSTOMER.test(k) || (ruleset.modelHint && ruleset.modelHint.test(k));
  if (B.re && B.re.test(k) && !guarded) return { status: "Relevant", subtype: "Brand (a keyword of the account's Brand campaign)" };
  if (B.nameRe && B.nameRe.test(k.replace(/\b([a-z])\s*&\s*([a-z])\b/g, "$1$2").replace(/[^a-z0-9]+/g, " ")) && !guarded) return { status: "Relevant", subtype: "Brand (the account's name)" };
  return null;
}

async function analyze(ruleset, rawRows, ctx){
  ctx = ctx || {};
  const status = ctx.status || function(){};
  const rows = prepareRows(rawRows);
  if (!rows.length) throw new Error("There are no search terms in that range.");

  // 1 · the account's own rules, on every row
  const B = brandKeywords(ctx.keywords, ctx.accountName);
  const pending = new Map();                       // term -> what it cost, for choosing what the model reads
  rows.forEach((r, i) => {
    r._slug = normSlug(r.campaign);
    r._det = ruleset.classifyDeterministic(r.term, r._slug, r) || fromKeywords(r, B, ruleset);
    if (r._det) r._det.by = "rule";
    else { const p = pending.get(r.key) || { term: r.term, key: r.key, cost: 0, clicks: 0, conversions: 0 }; p.cost += r.cost; p.clicks += r.clicks; p.conversions += r.conversions; pending.set(r.key, p); }
    if (i > 0 && i % 2000 === 0) status("Applying " + ruleset.label + " rules… " + i.toLocaleString() + " / " + rows.length.toLocaleString(), 0.05 + 0.25 * i / rows.length);
  });

  // 2 · the model reads only terms that were clicked (a term nobody clicked cost nothing and decides nothing), the costliest first, up to a limit
  const cap = ctx.modelCap == null ? MODEL_CAP : ctx.modelCap;
  const ranked = Array.from(pending.values()).sort((a, b) => (b.cost - a.cost) || (b.clicks - a.clicks));
  const eligible = ranked.filter(p => p.clicks > 0 || p.cost > 0 || p.conversions > 0);
  const toRead = eligible.slice(0, cap);
  const readKeys = new Set(toRead.map(p => p.key));
  status(toRead.length ? "Asking the model about " + toRead.length.toLocaleString() + " terms no rule settled…" : "Every term that mattered was settled by a rule.", 0.32);
  const llm = toRead.length && ctx.classify ? await ctx.classify(toRead.map(p => p.term)) : { results: {}, fallback: 0, failures: [] };
  const answers = new Map();
  Object.keys(llm.results || {}).forEach(t => answers.set(normText(t), llm.results[t]));
  rows.forEach(r => {
    if (r._det) return;
    if (readKeys.has(r.key)) r._det = Object.assign({}, answers.get(r.key) || { status: "Not Relevant", subtype: "No Clear Intent", by: "fallback" });
    else r._det = { status: "Not reviewed", subtype: r.clicks > 0 || r.cost > 0 ? "Over the review limit" : "No clicks", by: "skipped" };
  });

  status("Building negatives, keywords and the summary…", 0.95);
  const cover = buildCover(ctx.negatives);
  const kwSet = new Set((ctx.keywords || []).map(k => keyText(k.text)).filter(Boolean));
  const out = { negatives: buildNegatives(rows, cover, ctx.keywords || [], ruleset), keywords: buildKeywords(rows, kwSet, cover) };
  const review = {};
  rows.filter(r => r._det.status === "Client Review").forEach(r => {
    const k = r._det.subtype; const e = review[k] || (review[k] = { subtype: k, count: 0, cost: 0, conversions: 0, ex: [] });
    e.count++; e.cost += r.cost; e.conversions += r.conversions; e.ex.push(r);
  });
  const clientReview = Object.values(review).map(e => ({ subtype: e.subtype, count: e.count, cost: e.cost, conversions: e.conversions,
    examples: Array.from(new Set(e.ex.sort((a, b) => b.cost - a.cost).map(r => r.term))).slice(0, 5) })).sort((a, b) => (b.cost - a.cost) || (b.count - a.count));

  const byStatus = {}, byBy = {};
  rows.forEach(r => { byStatus[r._det.status] = (byStatus[r._det.status] || 0) + 1; byBy[r._det.by || ""] = (byBy[r._det.by || ""] || 0) + 1; });
  const sum = (f, p) => rows.reduce((s, r) => s + (p(r) ? f(r) : 0), 0), all = () => true;
  const totalSpend = sum(r => r.cost, all);
  const relevantSpend = sum(r => r.cost, r => r._det.status === "Relevant");
  return {
    ruleset, rows, allNegatives: out.negatives.all, priorityNegatives: out.negatives.priority, reviewNegatives: out.negatives.review,
    allKeywords: out.keywords.all, priorityKeywords: out.keywords.all.slice(0, PRIORITY), keywordsSkipped: out.keywords.skipped,
    negativesSkipped: out.negatives.skipped, clientReview,
    summary: { totalRows: rows.length, uniqueTerms: new Set(rows.map(r => r.key)).size, totalSpend, totalConv: sum(r => r.conversions, all), byStatus,
      byRule: byBy.rule || 0, byModel: byBy.model || 0, fallback: byBy.fallback || 0, skipped: byBy.skipped || 0, failures: llm.failures || [],
      notReviewedSpend: sum(r => r.cost, r => r._det.status === "Not reviewed"), overLimit: rows.filter(r => r._det.subtype === "Over the review limit").length,
      wastedSpend: sum(r => r.cost, r => r._det.status === "Not Relevant" && r.conversions === 0 && r._det.by !== "fallback"),
      notJudgedSpend: sum(r => r.cost, r => r._det.by === "fallback"),       // a batch the model failed on is not "not relevant": nobody read those terms
      competitorSpend: sum(r => r.cost, r => r._det.status === "Competitor"),
      relevantPct: Math.round(100 * (byStatus["Relevant"] || 0) / rows.length), relevantSpendPct: totalSpend > 0 ? Math.round(100 * relevantSpend / totalSpend) : null },
  };
}

function negativeSpec(r, ruleset){
  const d = r._det;
  if (d.by === "fallback" || d.by === "skipped" || d.noNeg || r.status === "EXCLUDED" || r.status === "ADDED_EXCLUDED") return null;
  // Brand searches that land in a NonBrand campaign belong in the Brand campaign: a campaign-level negative on the brand word routes them there.
  if (d.routeNeg && ruleset && ruleset.routeCampaignRe && ruleset.routeCampaignRe.test(r.campaign) && !isPmax(r.campaignType)) {
    return { text: normText(d.routeNeg), match: "Phrase", level: "Campaign", explicit: true, routing: true };
  }
  const explicit = d.status === "Competitor" || (d.status === "Not Relevant" && d.negMatchType);
  if (!explicit && d.status !== "Not Relevant") return null;
  let match = explicit ? (d.negMatchType || "Exact") : "Exact";
  let text = normText(d.negText || r.term);
  // A suggested negative has to stop the term that raised it: "dental school" would not stop "school of dental hygiene".
  if (explicit && d.negText && match !== "Exact" && (" " + r.key + " ").indexOf(" " + text + " ") < 0) text = r.key;
  // Some words are never to be blocked on their own for an account (a rulebook's forbiddenNegatives, such as the product it sells): block the whole search instead, or nothing.
  if (ruleset && ruleset.forbiddenNegatives && ruleset.forbiddenNegatives.indexOf(text) >= 0) {
    if (text === r.key) return null;
    text = r.key; match = "Exact";
  }
  // A campaign's own negative, Performance Max included (Google accepts campaign-level negative keywords there now, and these accounts use them):
  // turning one into an account-wide block would also stop the term in campaigns where it belongs.
  const level = explicit ? (d.negLevel || "Account") : "Campaign";
  return { text, match, level, explicit };
}

function buildNegatives(rows, cover, keywords, ruleset){
  const groups = new Map(); let skipped = 0;
  rows.forEach(r => {
    const s = negativeSpec(r, ruleset); if (!s) return;
    if (isCovered(cover, s.text, matchOf(s.match), s.level, s.level === "Campaign" ? [r.campaign] : [])) { skipped++; return; }
    const key = s.text + "|" + s.match + "|" + s.level + "|" + (s.level === "Campaign" ? r.campaign : "");
    let g = groups.get(key);
    if (!g) { g = { text: s.text, matchType: s.match, level: s.level, campaign: s.level === "Campaign" ? r.campaign : "", campaigns: new Set(), reason: r._det.subtype, reasonCost: -1,
      by: new Set(), implied: true, routing: !!s.routing, cost: 0, wasted: 0, conversions: 0, clicks: 0, impressions: 0, terms: new Set(), ex: [], rivals: new Set(), rival: false }; groups.set(key, g); }
    if (r._det.status === "Competitor") g.rival = true;
    if (r._det.status === "Competitor") { const n = competitorName(ruleset || {}, r.term); if (n) g.rivals.add(n); }
    g.campaigns.add(r.campaign); g.by.add(r._det.by); if (s.explicit) g.implied = false;
    g.cost += r.cost; g.clicks += r.clicks; g.impressions += r.impressions; g.conversions += r.conversions;
    if (r.conversions === 0) g.wasted += r.cost;
    g.terms.add(r.key); g.ex.push(r);
    if (r.cost > g.reasonCost) { g.reasonCost = r.cost; g.reason = s.routing ? "Brand search in a NonBrand campaign: send it to the Brand campaign" : s.explicit ? r._det.subtype : IMPLIED_NOTE + " (" + r._det.subtype + ")"; }
  });
  // what the relevant rows would lose: the words of each relevant term, so a negative is only compared with terms that share its words
  const rel = rows.filter(r => r._det.status === "Relevant" && r.status !== "EXCLUDED");
  const index = new Map();
  rel.forEach((r, i) => new Set(r.key.split(" ")).forEach(w => { let a = index.get(w); if (!a) { a = []; index.set(w, a); } a.push(i); }));
  // An account with a campaign aimed at competitors wants competitor searches: a block at account level would reach that campaign too.
  const CONQUEST = /compet|conquest/i;
  const conquests = rows.some(r => CONQUEST.test(r.campaign)) || keywords.some(k => CONQUEST.test(k.campaign || ""));
  const kwTexts = keywords.map(k => ({ text: keyText(k.text), campaign: k.campaign || "" })).filter(k => k.text);
  const kwByText = new Map(); kwTexts.forEach(k => { let a = kwByText.get(k.text); if (!a) { a = []; kwByText.set(k.text, a); } a.push(k); });
  const kwConflicts = (neg, g) => {
    const inScope = k => g.level !== "Campaign" || k.campaign === g.campaign;
    if (neg.match === "EXACT") return (kwByText.get(neg.text) || []).filter(inScope).slice(0, 3).map(k => k.text);
    const first = neg.text.split(" ")[0], out = [];
    for (let i = 0; i < kwTexts.length && out.length < 3; i++) { const k = kwTexts[i]; if (k.text.indexOf(first) >= 0 && inScope(k) && blocks(neg, k.text)) out.push(k.text); }
    return out;
  };
  const all = [];
  groups.forEach(g => {
    // an implied negative needs real spend and no conversion: below that it is noise, or a risk
    if (g.implied && (g.cost < IMPLIED_MIN_COST || g.conversions > 0)) { skipped++; return; }
    const neg = { text: g.text, match: matchOf(g.matchType) };
    const words = g.text.split(" ");
    const cand = g.matchType === "Exact" ? (index.get(words[0]) || []) : words.map(w => index.get(w) || []).sort((a, b) => a.length - b.length)[0] || [];
    const hit = { n: 0, clicks: 0, conversions: 0, cost: 0, ex: [] };
    cand.forEach(i => {
      const r = rel[i];
      if (g.level === "Campaign" && r.campaign !== g.campaign) return;
      if (!blocks(neg, r.key)) return;
      hit.n++; hit.clicks += r.clicks; hit.conversions += r.conversions; hit.cost += r.cost; if (hit.ex.length < 3 && hit.ex.indexOf(r.term) < 0) hit.ex.push(r.term);
    });
    const conflicts = kwConflicts(neg, g);
    // An account that bids on a competitor's name on purpose does not want that competitor's searches blocked.
    const bids = Array.from(g.rivals).filter(name => kwTexts.some(k => (g.level !== "Campaign" || k.campaign === g.campaign) && (" " + k.text + " ").indexOf(" " + name + " ") >= 0));
    const risks = [];
    // A routing negative is meant to stop brand terms in this campaign, converted or not; what it stops is the point, not a side effect.
    if (g.routing) { hit.n = 0; hit.clicks = 0; hit.conversions = 0; hit.cost = 0; hit.ex = []; }
    if (g.routing) conflicts.length = 0;
    if (!g.routing && g.conversions > 0) risks.push("converted");
    if (g.routing) { /* no competitor checks */ }
    else if (bids.length) risks.push("you bid on this competitor");
    else if (g.rival && conquests && g.level.indexOf("Account") === 0) risks.push("the account runs a competitor campaign");
    if (!g.routing && (hit.clicks > 0 || hit.conversions > 0)) risks.push("blocks relevant terms");
    if (!g.routing && conflicts.length) risks.push("blocks a keyword you bid on");
    const examples = Array.from(new Map(g.ex.sort((a, b) => b.cost - a.cost).map(r => [r.key, r.term])).values()).slice(0, 3);
    all.push({ text: g.text, matchType: g.matchType, level: g.level, campaign: g.campaign, reason: g.reason, by: g.by.size > 1 ? "mixed" : Array.from(g.by)[0] || "rule",
      implied: g.implied, routing: g.routing, cost: g.cost, wasted: g.routing ? g.cost : g.wasted, impact: g.routing ? g.cost : g.wasted, conversions: g.conversions, clicks: g.clicks, impressions: g.impressions, terms: g.terms.size,
      examples, risks, collateral: hit, conflicts });
  });
  // Ranked by the money wasted on terms that never converted. A negative whose terms did convert, or that would also stop relevant terms or
  // a keyword the account bids on, is held back for a person to look at: it is never in the priority list.
  all.sort((a, b) => (b.wasted - a.wasted) || (b.clicks - a.clicks) || (b.impressions - a.impressions) || (a.text < b.text ? -1 : 1));
  return { all, priority: all.filter(n => !n.risks.length && n.wasted > 0).slice(0, PRIORITY), review: all.filter(n => n.risks.length).sort((a, b) => (b.cost - a.cost) || (b.conversions - a.conversions)).slice(0, PRIORITY), skipped };
}

function buildKeywords(rows, kwSet, cover){
  const groups = new Map(); const skipped = { existing: 0, blocked: 0, type: 0, weak: 0 };
  rows.forEach(r => {
    if (r._det.status !== "Relevant") return;
    const pm = isPmax(r.campaignType);
    const k = r.key + "|" + r.campaign;
    let g = groups.get(k);
    if (!g) { g = { key: r.key, term: r.term, campaign: r.campaign, campaignType: r.campaignType, pmax: pm, status: new Set(), ad: new Map(), clicks: 0, impressions: 0, cost: 0, conversions: 0 }; groups.set(k, g); }
    g.status.add(r.status); g.clicks += r.clicks; g.impressions += r.impressions; g.cost += r.cost; g.conversions += r.conversions;
    const a = g.ad.get(r.adGroup) || { conversions: 0, clicks: 0 }; a.conversions += r.conversions; a.clicks += r.clicks; g.ad.set(r.adGroup, a);
  });
  const list = [];
  groups.forEach(g => {
    if (!g.pmax && !isSearchType(g.campaignType)) { skipped.type++; return; }         // Shopping, Display and the rest take no keywords
    if (kwSet.has(g.key) || g.status.has("ADDED") || g.status.has("ADDED_EXCLUDED") || g.status.has("EXCLUDED")) { skipped.existing++; return; }
    if (isBlockedHere(cover, g.key, g.campaign)) { skipped.blocked++; return; }
    const ctr = g.impressions > 0 ? g.clicks / g.impressions : 0;
    const tier = g.conversions >= 1 ? 1 : (g.conversions > 0 || (g.clicks >= 3 && ctr >= 0.05)) ? 2 : 0;
    if (!tier) { skipped.weak++; return; }
    const best = Array.from(g.ad.entries()).sort((a, b) => (b[1].conversions - a[1].conversions) || (b[1].clicks - a[1].clicks))[0];
    const wordCount = g.term.trim().split(/\s+/).length;
    list.push({ term: g.term, assetType: g.pmax ? "Search Theme" : "Keyword", matchType: g.pmax ? "Search Theme" : (wordCount >= 3 && (g.conversions > 0 || ctr >= 0.05)) ? "Exact Match" : "Phrase Match",
      addLevel: g.pmax ? "Asset Group" : "Ad Group", whereToAdd: g.campaign + (g.pmax || !best || !best[0] ? "" : " / " + best[0]), tier, conversions: g.conversions, ctr,
      clicks: g.clicks, impressions: g.impressions, cost: g.cost, cpa: g.conversions > 0 ? g.cost / g.conversions : null });
  });
  list.sort((a, b) => (a.tier - b.tier) || (b.conversions - a.conversions) || (b.ctr - a.ctr) || (b.clicks - a.clicks) || (a.term < b.term ? -1 : 1));
  return { all: list, skipped };
}

// =====================================================================
// The three CSV exports, for when Google Ads cannot be read
// =====================================================================
function rowsFromCsv(text){
  const p = parseCSV(text);
  if (!p.headerFound) return { error: "Couldn't find a 'Search term' column in that file. First few lines: " + p.preview.map(r => "[" + r.join(" | ") + "]").join("  "), rows: [] };
  const rows = p.rows.map(raw => ({ term: pick(raw, "Search term", "Search Term"), campaign: pick(raw, "Campaign"), adGroup: pick(raw, "Ad group", "Ad Group"),
    campaignType: pick(raw, "Campaign type", "Campaign Type"), clicks: num(pick(raw, "Clicks")), impressions: num(pick(raw, "Impr.", "Impressions")),
    cost: num(pick(raw, "Cost")), conversions: num(pick(raw, "Conversions", "Conv.")), status: pick(raw, "Added/Excluded", "Added / Excluded") }));
  rows.forEach(r => { const s = String(r.status || "").toLowerCase(); r.status = s === "added" ? "ADDED" : s === "excluded" ? "EXCLUDED" : ""; });
  return { rows, header: p.header };
}
function keywordsFromCsv(text){
  if (!text) return [];
  return parseCSV(text).rows.map(r => ({ text: keyText(pick(r, "Keyword")), match: matchOf(pick(r, "Match type")), campaign: pick(r, "Campaign"), adGroup: pick(r, "Ad group") })).filter(k => k.text);
}
function negativesFromCsv(text){
  if (!text) return [];
  return parseCSV(text).rows.map(r => {
    const level = /campaign/i.test(String(pick(r, "Level"))) ? "campaign" : /ad group/i.test(String(pick(r, "Level"))) ? "adgroup" : "account";
    const c = String(pick(r, "Campaign")).trim();
    return { text: keyText(pick(r, "Negative keyword", "Keyword")), match: matchOf(pick(r, "Match type")), level: level === "campaign" && !c ? "account" : level, campaigns: c ? [c] : [] };
  }).filter(k => k.text);
}

const api = { autoRuleset, brandPhrases, hint, HINTS, radiusTargeted, PHONE_RE, brandKeywords, parseCSV, pick, num, fmtConv, normText, keyText, matchOf, blocks, buildCover, isCovered, isBlockedHere, phraseRe, signalRe, has, core, individual, isAddress, competitorName,
  campaignServesCity, prepareRows, analyze, rowsFromCsv, keywordsFromCsv, negativesFromCsv, RULESETS, PRIORITY, MODEL_CAP, STATUS_ORDER };
root.SQRCore = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
