'use strict';

const cheerio = require('cheerio');
const axios = require('axios');

// ── helpers ──────────────────────────────────────────────────────────────────

function stemWord(w) {
  return w.toLowerCase().replace(/(?:ing|ed|er|s|es|ly)$/, '');
}

function visibleText($) {
  $('script, style, noscript, [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"]').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function makeResult(id, category, name, requiresHttp = false) {
  return { id, category, name, status: 'pass', severity: 'info', value: null, detail: '', requires_http: requiresHttp };
}

function pass(r, value, detail) { r.status = 'pass'; r.value = value; r.detail = detail; return r; }
function fail(r, severity, value, detail) { r.status = 'fail'; r.severity = severity; r.value = value; r.detail = detail; return r; }
function warn(r, value, detail) { r.status = 'warning'; r.severity = 'warning'; r.value = value; r.detail = detail; return r; }
function notice(r, value, detail) { r.status = 'notice'; r.severity = 'notice'; r.value = value; r.detail = detail; return r; }
function info(r, value, detail) { r.status = 'pass'; r.severity = 'info'; r.value = value; r.detail = detail; return r; }
function skipped(r, reason) { r.status = 'skipped'; r.severity = 'info'; r.detail = `Skipped — ${reason}`; return r; }

const PROMO_WORDS = ['best','world-class','leading','#1','top-rated','award-winning','innovative','revolutionary',
  'state-of-the-art','cutting-edge','industry-leading','unmatched','unbeatable','game-changing',
  'transform','disruptive','amazing','incredible','unbeatable'];

const AUTHORITATIVE_DOMAINS = ['.gov','.edu','pubmed','ncbi','arxiv','springer','nature.com',
  'sciencedirect','who.int','cdc.gov','nih.gov','bmj.com','thelancet.com','jamanetwork.com'];

const NON_DESCRIPTIVE_ANCHORS = new Set(['click here','here','read more','learn more','more',
  'this','link','page','this page','continue','view more']);

// ── §1.3: Statistics counter constants ───────────────────────────────────────

const STATISTIC_PATTERNS = [
  /\d+\.?\d*\s*%\s*(of\s+\w+|reduction|increase|improvement|patients|cases|adults|children|people)/i,
  /\d+\s+(out\s+of|in\s+every|per)\s+\d+/i,
  /\d+\s+(million|billion|thousand)\s+(people|patients|adults|Americans|cases|dentists)/i,
  /according\s+to\s+[A-Z][^,]+,\s*\d/i,
  /\d+[^.]*\(\s*(CDC|ADA|WHO|NIH|NIDCR|study|research|survey|report)/i,
  /(studies?|research|data|survey|report)\s+(show|found|indicate|suggest|reveal)[^.]*\d/i,
];
const STATISTIC_EXCLUSIONS = [
  /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/,
  /\d{5}(-\d{4})?/,
  /\$[\d,]+(\.\d{2})?/,
  /\d{1,2}:\d{2}\s*(AM|PM|am|pm)/,
  /\d+\s*(st|nd|rd|th)\s+(floor|suite|ste)/i,
  /copyright\s+©?\s*\d{4}/i,
  /©\s*\d{4}/,
  /established\s+in\s+\d{4}/i,
  /since\s+\d{4}/i,
  /\(\s*\d{4}\s*\)/,
];

// ── §1.4: Outdated year exclusion contexts ────────────────────────────────────

const YEAR_EXCLUSION_CONTEXTS = [
  /copyright/i, /©/, /all\s+rights\s+reserved/i, /since\s+\d{4}/i,
  /established/i, /founded/i, /\d{4}\s*[-–—]\s*\d{4}/, /privacy\s+policy/i,
  /terms\s+of\s+(service|use)/i,
];

function countStatistics(textContent) {
  let count = 0;
  const sentences = textContent.split(/[.!?]+/);
  for (const sentence of sentences) {
    if (STATISTIC_EXCLUSIONS.some(p => p.test(sentence))) continue;
    if (STATISTIC_PATTERNS.some(p => p.test(sentence))) count++;
  }
  return count;
}

// ── §1.7: LocalBusiness subtype registry ─────────────────────────────────────

const LOCAL_BUSINESS_SUBTYPES = new Set([
  'LocalBusiness',
  'Dentist','MedicalOrganization','Hospital','Physician','MedicalClinic','Pharmacy','Optician','Veterinary',
  'Restaurant','Bakery','BarOrPub','CafeOrCoffeeShop','FastFoodRestaurant','Hotel','LodgingBusiness','BedAndBreakfast',
  'Store','AutoDealer','AutoRepair','BeautySalon','HairSalon','HealthClub','SportsClub','GymOrHealthClub',
  'LegalService','Attorney','AccountingService','FinancialService','InsuranceAgency','RealEstateAgent',
  'HomeAndConstructionBusiness','Plumber','Electrician','Locksmith','HVACBusiness','MovingCompany',
  'CleaningService','LandscapingBusiness',
  'School','Library','Museum','PerformingArtsTheater','PlaceOfWorship','GovernmentOffice','FireStation','PoliceStation',
  'TravelAgency','TaxiService','Florist','PetStore',
]);

const VALID_DAY_OF_WEEK_URIS = new Set([
  'http://schema.org/Monday','https://schema.org/Monday',
  'http://schema.org/Tuesday','https://schema.org/Tuesday',
  'http://schema.org/Wednesday','https://schema.org/Wednesday',
  'http://schema.org/Thursday','https://schema.org/Thursday',
  'http://schema.org/Friday','https://schema.org/Friday',
  'http://schema.org/Saturday','https://schema.org/Saturday',
  'http://schema.org/Sunday','https://schema.org/Sunday',
  'http://schema.org/PublicHolidays','https://schema.org/PublicHolidays',
]);
const PLAIN_DAY_STRINGS = new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','publicholidays']);

function validateOpeningHours(spec) {
  const errors = [];
  if (spec.canceldayOfWeek) {
    errors.push({ field: 'canceldayOfWeek', error: 'Invalid property name — should be "dayOfWeek" not "canceldayOfWeek".', severity: 'error' });
  }
  const days = spec.dayOfWeek || spec.canceldayOfWeek;
  if (days) {
    const dayArray = Array.isArray(days) ? days : [days];
    for (const day of dayArray) {
      if (PLAIN_DAY_STRINGS.has(day.toLowerCase())) {
        errors.push({ field: 'dayOfWeek', error: `"${day}" must be a schema.org URI — use "http://schema.org/${day}" instead of plain string.`, severity: 'error' });
      } else if (!VALID_DAY_OF_WEEK_URIS.has(day)) {
        errors.push({ field: 'dayOfWeek', error: `"${day}" is not a valid schema.org dayOfWeek URI.`, severity: 'error' });
      }
    }
  }
  return errors;
}

// ── HTTP check queue ──────────────────────────────────────────────────────────

async function headRequest(url, timeout = 5000) {
  try {
    const r = await axios.head(url, { timeout, maxRedirects: 1, validateStatus: () => true });
    return { status: r.status, final: r.request?.res?.responseUrl || url };
  } catch {
    try {
      const r = await axios.get(url, { timeout, maxRedirects: 1, validateStatus: () => true });
      return { status: r.status, final: r.request?.res?.responseUrl || url };
    } catch {
      return { status: 'timeout', final: url };
    }
  }
}

async function batchHttpChecks(tasks, concurrency = 10) {
  const results = {};
  const queue = [...tasks];
  async function worker() {
    while (queue.length) {
      const { key, url } = queue.shift();
      results[key] = await headRequest(url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ── A. Title Tag ──────────────────────────────────────────────────────────────

function checksA($) {
  const titles = $('title');
  const titleText = titles.first().text().trim();
  const len = titleText.length;

  const A1 = makeResult('A1','Title Tag','Title tag present');
  const A2 = makeResult('A2','Title Tag','Title tag not empty');
  const A3 = makeResult('A3','Title Tag','Title length: not too short');
  const A4 = makeResult('A4','Title Tag','Title length: not too long');
  const A5 = makeResult('A5','Title Tag','Title does not exactly match H1');
  const A6 = makeResult('A6','Title Tag','Brand name detected in title');
  const A7 = makeResult('A7','Title Tag','No keyword stuffing in title');
  const A8 = makeResult('A8','Title Tag','No special/disruptive characters');
  const A9 = makeResult('A9','Title Tag','Only one title tag present');

  if (titles.length === 0) {
    fail(A1,'error',null,'No <title> element found.');
    fail(A2,'error',null,'No title tag to evaluate.');
    fail(A3,'warning',null,'No title tag present.');
    fail(A4,'warning',null,'No title tag present.');
    pass(A5,null,'No title tag to compare.');
    pass(A6,null,'No title tag present.');
    pass(A7,null,'No title tag present.');
    pass(A8,null,'No title tag present.');
    pass(A9,null,'Only 0 title tags — none found.');
  } else {
    pass(A1, titleText, 'Title tag present.');
    titleText.length > 0 ? pass(A2, titleText, 'Title tag has content.') : fail(A2,'error','','Title tag is empty.');
    len >= 30 ? pass(A3, `${len} chars`, `Title is ${len} characters.`) : warn(A3, `${len} chars`, `Title is only ${len} characters (min 30).`);
    len <= 60 ? pass(A4, `${len} chars`, `Title is ${len} characters.`) : warn(A4, `${len} chars`, `Title is ${len} characters (max 60).`);

    const h1Text = $('h1').first().text().trim().toLowerCase();
    titleText.toLowerCase() === h1Text && h1Text.length > 0
      ? warn(A5, titleText, 'Title exactly matches H1 — differentiate them.')
      : pass(A5, titleText, 'Title differs from H1.');

    const segments = titleText.split(/[|\-–—]/);
    const brand = segments.length > 1 ? segments[segments.length - 1].trim() : null;
    brand ? info(A6, brand, `Brand segment detected: "${brand}".`) : notice(A6, null, 'No brand separator detected in title.');

    const roots = titleText.toLowerCase().split(/\s+/).map(stemWord);
    const freq = {};
    roots.forEach(w => { if (w.length > 3) freq[w] = (freq[w] || 0) + 1; });
    const stuffed = Object.entries(freq).filter(([,c]) => c >= 3);
    stuffed.length ? warn(A7, stuffed.map(([w,c]) => `"${w}"×${c}`).join(', '), 'Same root word appears 3+ times.') : pass(A7, null, 'No keyword stuffing detected.');

    // CHANGE 1 — §1.1: A8 title special characters
    const TITLE_SEPARATOR_WHITELIST = ['|', '-', '–', '—', '·', '•'];
    const stripped = titleText.replace(/\s*[|–—·•\-]\s*/g, ' ');
    const disruptive = stripped.match(/[#$%^*~`@{}\[\]<>\\]/g);
    disruptive ? notice(A8, disruptive.join(''), `Disruptive characters found: ${disruptive.join('')}`) : pass(A8, null, 'No disruptive characters.');

    titles.length === 1 ? pass(A9, '1', 'Exactly one title tag.') : fail(A9,'error', `${titles.length}`, `${titles.length} title tags found — only one allowed.`);
  }

  return [A1,A2,A3,A4,A5,A6,A7,A8,A9];
}

// ── B. Meta Description ───────────────────────────────────────────────────────

function checksB($) {
  const metas = $('meta[name="description"], meta[name="Description"]');
  const content = metas.first().attr('content') || '';
  const len = content.trim().length;

  const B1 = makeResult('B1','Meta Description','Meta description present');
  const B2 = makeResult('B2','Meta Description','Meta description not empty');
  const B3 = makeResult('B3','Meta Description','Length: not too short');
  const B4 = makeResult('B4','Meta Description','Length: not too long');
  const B5 = makeResult('B5','Meta Description','No promotional tone detected');
  const B6 = makeResult('B6','Meta Description','Only one meta description tag');

  metas.length > 0 ? pass(B1, content.substring(0,80), 'Meta description present.') : warn(B1,'warning',null,'Meta description missing.');
  len > 0 ? pass(B2, `${len} chars`, 'Meta description has content.') : warn(B2,'warning','','Meta description is empty.');
  len >= 120 ? pass(B3, `${len} chars`, `Length is ${len} characters.`) : notice(B3, `${len} chars`, `Length is ${len} characters (min 120 recommended).`);
  len <= 160 ? pass(B4, `${len} chars`, `Length is ${len} characters.`) : warn(B4, `${len} chars`, `Length is ${len} characters (max 160).`);

  const promoFound = PROMO_WORDS.filter(w => content.toLowerCase().includes(w));
  promoFound.length ? notice(B5, promoFound.join(', '), `Promotional words detected: ${promoFound.join(', ')}.`) : pass(B5, null, 'No promotional tone detected.');

  metas.length === 1 ? pass(B6, '1', 'Exactly one meta description.') : warn(B6, `${metas.length}`, `${metas.length} meta description tags found.`);

  return [B1,B2,B3,B4,B5,B6];
}

// ── C. Meta Robots & Indexability ─────────────────────────────────────────────

function checksC($, httpHeaders) {
  const robotsMeta = $('meta[name="robots"], meta[name="Robots"]').attr('content') || '';
  const rc = robotsMeta.toLowerCase();

  const checks = ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','C11'].map((id, i) =>
    makeResult(id, 'Meta Robots', ['Page is not noindex','Page is not nofollow','Not both noindex+nofollow',
      'No noarchive directive','No nosnippet directive','No noimageindex directive',
      'max-snippet value recorded','max-image-preview value recorded','No meta refresh redirect',
      'Meta refresh delay ≠ 0','X-Robots-Tag header recorded'][i], id === 'C11'));

  const [C1,C2,C3,C4,C5,C6,C7,C8,C9,C10,C11] = checks;

  rc.includes('noindex') ? fail(C1,'error',robotsMeta,'Page has noindex directive — will not be indexed.') : pass(C1, robotsMeta||'(not set)', 'No noindex directive.');
  rc.includes('nofollow') ? warn(C2, robotsMeta, 'Page has nofollow directive.') : pass(C2, robotsMeta||'(not set)', 'No nofollow directive.');
  rc.includes('noindex') && rc.includes('nofollow') ? fail(C3,'error',robotsMeta,'Both noindex and nofollow present.') : pass(C3, null, 'Not both noindex+nofollow.');
  rc.includes('noarchive') ? notice(C4, robotsMeta, 'noarchive directive present.') : pass(C4, null, 'No noarchive directive.');
  rc.includes('nosnippet') ? notice(C5, robotsMeta, 'nosnippet directive present.') : pass(C5, null, 'No nosnippet directive.');
  rc.includes('noimageindex') ? notice(C6, robotsMeta, 'noimageindex directive present.') : pass(C6, null, 'No noimageindex directive.');

  const maxSnippet = robotsMeta.match(/max-snippet:\s*(-?\d+)/i);
  maxSnippet ? info(C7, maxSnippet[1], `max-snippet:${maxSnippet[1]}`) : info(C7, null, 'max-snippet not set.');

  const maxImg = robotsMeta.match(/max-image-preview:\s*(\w+)/i);
  maxImg ? info(C8, maxImg[1], `max-image-preview:${maxImg[1]}`) : info(C8, null, 'max-image-preview not set.');

  const refresh = $('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]');
  if (refresh.length) {
    warn(C9, refresh.attr('content'), 'Meta refresh redirect detected.');
    const delay = parseInt((refresh.attr('content') || '').split(';')[0]) || 0;
    delay === 0 ? fail(C10,'error','delay=0','Meta refresh with delay=0 is a hard redirect.') : pass(C10, `delay=${delay}`, `Refresh delay is ${delay}s.`);
  } else {
    pass(C9, null, 'No meta refresh redirect.');
    pass(C10, null, 'No meta refresh present.');
  }

  const xRobots = httpHeaders?.['x-robots-tag'] || null;
  xRobots ? info(C11, xRobots, `X-Robots-Tag: ${xRobots}`) : info(C11, null, 'X-Robots-Tag header not present (or URL not provided).');

  return checks;
}

// ── D. Canonical Tags ─────────────────────────────────────────────────────────

function checksD($, pageUrl, httpHeaders) {
  const canonicals = $('head link[rel="canonical"]');
  const canonHref = canonicals.first().attr('href') || '';

  const D1 = makeResult('D1','Canonical','Canonical tag present');
  const D2 = makeResult('D2','Canonical','Only one canonical tag');
  const D3 = makeResult('D3','Canonical','Canonical href is not empty');
  const D4 = makeResult('D4','Canonical','Canonical is self-referencing');
  const D5 = makeResult('D5','Canonical','Canonical points to different URL');
  const D6 = makeResult('D6','Canonical','Canonical URL uses HTTPS');
  const D7 = makeResult('D7','Canonical','Canonical has consistent trailing slash');
  const D8 = makeResult('D8','Canonical','Canonical target is live',true);
  const D9 = makeResult('D9','Canonical','Canonical target is not noindex',true);

  canonicals.length > 0 ? pass(D1, canonHref, 'Canonical tag present.') : warn(D1,'warning',null,'No canonical tag found.');
  canonicals.length <= 1 ? pass(D2, `${canonicals.length}`, 'Only one canonical tag.') : fail(D2,'error',`${canonicals.length}`,`${canonicals.length} canonical tags found.`);
  canonHref.length > 0 ? pass(D3, canonHref, 'Canonical href has a value.') : fail(D3,'error','','Canonical href is empty.');

  if (pageUrl && canonHref) {
    canonHref === pageUrl ? info(D4, canonHref, 'Canonical is self-referencing.') : pass(D4, canonHref, 'Canonical does not self-reference.');
    canonHref !== pageUrl ? notice(D5, canonHref, `Canonical points to: ${canonHref}`) : pass(D5, null, 'Canonical matches page URL.');
    canonHref.startsWith('http://') ? warn(D6,'warning',canonHref,'Canonical uses HTTP on an HTTPS page.') : pass(D6, canonHref, 'Canonical uses HTTPS.');
    const pageTrail = pageUrl.endsWith('/');
    const canonTrail = canonHref.endsWith('/');
    pageTrail !== canonTrail ? notice(D7, null, `Trailing slash mismatch: page="${pageUrl}", canonical="${canonHref}".`) : pass(D7, null, 'Trailing slash consistent.');
  } else {
    skipped(D4,'URL not provided'); skipped(D5,'URL not provided');
    skipped(D6,'URL not provided'); skipped(D7,'URL not provided');
  }

  skipped(D8, 'Run HTTP checks separately');
  skipped(D9, 'Run HTTP checks separately');

  return [D1,D2,D3,D4,D5,D6,D7,D8,D9];
}

// ── E. Heading Structure ──────────────────────────────────────────────────────

function checksE($) {
  const h1s = $('h1'); const h2s = $('h2'); const h3s = $('h3');
  const h4s = $('h4'); const h5s = $('h5'); const h6s = $('h6');
  const h1Text = h1s.first().text().trim();

  const E1=makeResult('E1','Headings','H1 tag present');
  const E2=makeResult('E2','Headings','Exactly one H1 tag');
  const E3=makeResult('E3','Headings','H1 is not empty');
  const E4=makeResult('E4','Headings','H1 does not exactly match title');
  const E5=makeResult('E5','Headings','H1 length: not too short');
  const E6=makeResult('E6','Headings','H1 length: not too long');
  const E7=makeResult('E7','Headings','H2 tags present');
  const E8=makeResult('E8','Headings','Heading hierarchy not skipped');
  const E9=makeResult('E9','Headings','No empty headings');
  const E10=makeResult('E10','Headings','Heading counts per level');
  const E11=makeResult('E11','Headings','H2/H3 written as questions');
  const E12=makeResult('E12','Headings','Sub-query coverage signal');
  const E13=makeResult('E13','Headings','No keyword stuffing in headings');

  h1s.length > 0 ? pass(E1, h1Text.substring(0,60), 'H1 present.') : fail(E1,'error',null,'No H1 found.');
  h1s.length === 1 ? pass(E2,'1','Exactly one H1.') : warn(E2,`${h1s.length}`,`${h1s.length} H1 tags found.`);
  h1Text.length > 0 ? pass(E3, h1Text, 'H1 has content.') : fail(E3,'error','','H1 is empty.');

  const titleText = $('title').first().text().trim().toLowerCase();
  h1Text.toLowerCase() === titleText && h1Text.length > 0
    ? warn(E4, h1Text, 'H1 exactly matches title tag.') : pass(E4, h1Text, 'H1 differs from title.');

  h1Text.length >= 20 ? pass(E5,`${h1Text.length} chars`,`H1 is ${h1Text.length} chars.`) : notice(E5,`${h1Text.length} chars`,`H1 is short (${h1Text.length} chars, min 20).`);
  h1Text.length <= 70 ? pass(E6,`${h1Text.length} chars`,`H1 is ${h1Text.length} chars.`) : notice(E6,`${h1Text.length} chars`,`H1 is ${h1Text.length} chars (max 70).`);
  h2s.length > 0 ? pass(E7,`${h2s.length}`,'H2 tags present.') : notice(E7,'0','No H2 tags found.');

  // Hierarchy check
  let hierarchyOk = true;
  let seenH2 = false, seenH3 = false, seenH4 = false, seenH5 = false;
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h2') seenH2 = true;
    if (tag === 'h3' && !seenH2) hierarchyOk = false;
    if (tag === 'h3') seenH3 = true;
    if (tag === 'h4' && !seenH3) hierarchyOk = false;
    if (tag === 'h4') seenH4 = true;
    if (tag === 'h5' && !seenH4) hierarchyOk = false;
    if (tag === 'h5') seenH5 = true;
    if (tag === 'h6' && !seenH5) hierarchyOk = false;
  });
  hierarchyOk ? pass(E8, null, 'Heading hierarchy is valid.') : warn(E8, null, 'Heading levels are skipped (e.g. H3 without H2).');

  const emptyHeadings = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => { if (!$(el).text().trim()) emptyHeadings.push(el.tagName); });
  emptyHeadings.length ? warn(E9, emptyHeadings.join(', '), `Empty headings found: ${emptyHeadings.join(', ')}.`) : pass(E9, null, 'No empty headings.');

  const counts = { H1: h1s.length, H2: h2s.length, H3: h3s.length, H4: h4s.length, H5: h5s.length, H6: h6s.length };
  info(E10, JSON.stringify(counts), `Heading counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}.`);

  const qHeadings = $('h2,h3').filter((_, el) => $(el).text().trim().endsWith('?')).length;
  info(E11, `${qHeadings}`, `${qHeadings} H2/H3 headings written as questions.`);
  info(E12, `${h2s.length + h3s.length}`, `${h2s.length + h3s.length} H2+H3 sections total.`);

  // CHANGE 12 — §1.13: E13 stemmer normalisation
  const allHeadingText = $('h1,h2,h3,h4,h5,h6').map((_, el) => $(el).text()).get().join(' ');
  const hRoots = allHeadingText.toLowerCase().split(/\s+/).map(w => stemWord(w.replace(/[^a-zA-Z]/g, '')));
  const hFreq = {};
  hRoots.forEach(w => { if (w.length > 3) hFreq[w] = (hFreq[w]||0)+1; });
  const hStuffed = Object.entries(hFreq).filter(([,c])=>c>=3);
  hStuffed.length ? warn(E13, hStuffed.map(([w,c])=>`"${w}"×${c}`).join(', '), 'Keyword stuffing in headings.') : pass(E13, null, 'No heading keyword stuffing.');

  return [E1,E2,E3,E4,E5,E6,E7,E8,E9,E10,E11,E12,E13];
}

// ── §1.2: F6 first paragraph helper ──────────────────────────────────────────

function findFirstContentParagraph($) {
  const excludeSelectors = [
    '[class*="banner"]', '[class*="promo"]', '[class*="cta"]',
    '[class*="alert"]', '[class*="offer"]', '[class*="notice"]',
    '[class*="badge"]', '[class*="tag"]', '[class*="pill"]',
    'header', 'nav', 'aside', 'footer'
  ].join(', ');
  const containers = ['main', 'article', '[class*="content"]', '[class*="body"]', 'body']
    .map(sel => $(sel).first())
    .filter(el => el.length);
  for (const container of containers) {
    const paragraphs = container.find('p').toArray();
    for (const p of paragraphs) {
      const el = $(p);
      if (el.closest(excludeSelectors).length > 0) continue;
      const words = el.text().trim().split(/\s+/).filter(Boolean);
      if (words.length >= 20) return el.text().trim();
    }
  }
  return $('p').first().text().trim();
}

// ── F. Content Quality & Structure ────────────────────────────────────────────

function checksF($, rawHtml) {
  const $clone = cheerio.load(rawHtml);
  $clone('script,style,noscript').remove();
  const bodyText = $clone('body').text().replace(/\s+/g,' ').trim();
  const wc = wordCount(bodyText);
  const htmlLen = rawHtml.length;
  const textRatio = htmlLen > 0 ? ((bodyText.length / htmlLen) * 100) : 0;

  const F = (id, name) => makeResult(id, 'Content Quality', name);

  const F1=F('F1','Word count recorded');
  const F2=F('F2','Word count: not critically thin');
  const F3=F('F3','Word count: not thin');
  const F4=F('F4','Word count in GEO sweet spot');
  const F5=F('F5','Text-to-HTML ratio');
  const F6=F('F6','Direct answer in first paragraph (BLUF)');
  const F7=F('F7','Answer within first 30% of content');
  const F8=F('F8','Named author byline present');
  const F9=F('F9','Author is named (not generic)');
  const F10=F('F10','Author links to bio page');
  const F11=F('F11','Publication date visible');
  const F12=F('F12','Last updated date visible');
  const F13=F('F13','"Last Reviewed by Expert" present');
  const F14=F('F14','Expert quotes present');
  const F15=F('F15','Statistics count: target met');
  const F16=F('F16','Statistics include source attribution');
  const F17=F('F17','Outbound citations to primary sources');
  const F18=F('F18','HTML comparison tables present');
  const F19=F('F19','FAQ section present');
  const F20=F('F20','Brand name in opening paragraph');
  const F21=F('F21','Promotional language detected');
  const F22=F('F22','Keyword stuffing: body text');
  const F23=F('F23','Content length: no long-form without structure');
  const F24=F('F24','Content length: grounding budget signal');
  const F25=F('F25','No hidden text blocks');
  const F26=F('F26','Outdated statistics year check');
  const F27=F('F27','Source citation count recorded');
  const F28=F('F28','CSQAF score (composite)');

  info(F1, `${wc}`, `Word count: ${wc}.`);
  wc < 300 ? fail(F2,'error',`${wc}`,'Critically thin content — under 300 words.') : pass(F2,`${wc}`,'Word count above 300.');
  wc >= 300 && wc < 600 ? warn(F3,`${wc}`,'Thin content — 300–599 words.') : pass(F3,`${wc}`,'Word count not thin.');

  if (wc >= 800 && wc <= 1500) info(F4,`${wc}`,'Word count is in the GEO spoke sweet spot (800–1,500).');
  else if (wc > 3000) notice(F4,`${wc}`,`Word count is ${wc} — over 3,000 is a GEO grounding risk.`);
  else info(F4,`${wc}`,`Word count: ${wc}.`);

  if (textRatio < 5) fail(F5,'error',`${textRatio.toFixed(1)}%`,`Text-to-HTML ratio is ${textRatio.toFixed(1)}% (critical — under 5%).`);
  else if (textRatio < 10) warn(F5,`${textRatio.toFixed(1)}%`,`Text-to-HTML ratio is ${textRatio.toFixed(1)}% (under 10%).`);
  else pass(F5,`${textRatio.toFixed(1)}%`,`Text-to-HTML ratio: ${textRatio.toFixed(1)}%.`);

  // CHANGE 2 — §1.2: F6 first paragraph detection (BLUF)
  const firstP = findFirstContentParagraph($);
  const firstPWords = wordCount(firstP);
  firstPWords >= 40 && /[.!?]$/.test(firstP)
    ? pass(F6,firstP.substring(0,100),'First paragraph has direct answer (BLUF).')
    : warn(F6,firstP.substring(0,100),`First paragraph is short (${firstPWords} words) or lacks a complete sentence.`);

  const h1Kw = $('h1').first().text().trim().toLowerCase().split(/\s+/)[0] || '';
  const first30 = bodyText.split(/\s+/).slice(0, Math.floor(wc * 0.3)).join(' ').toLowerCase();
  h1Kw && first30.includes(h1Kw)
    ? pass(F7, h1Kw, 'Primary keyword appears in first 30% of content.')
    : notice(F7, h1Kw || '(no H1)', 'Primary keyword not found in first 30% of body text.');

  // CHANGE 8 — §1.9: F8/F9 author detection context validation
  const AUTHOR_CONTEXTS = '[rel="author"], [class*="author"], [class*="byline"], [itemprop="author"]';
  const structuralAuthor = $(AUTHOR_CONTEXTS).first();
  const genericAuthorNames = new Set(['team','staff','admin','editor','webmaster','support','marketing']);
  let hasAuthor = false;
  let authorValue = null;
  if (structuralAuthor.length) {
    const authorText = structuralAuthor.text().trim();
    if (authorText && !genericAuthorNames.has(authorText.toLowerCase())) {
      hasAuthor = true; authorValue = authorText;
    }
  }
  if (!hasAuthor) {
    const contentArea = $('main, article, [class*="content"], [class*="post-body"]').first();
    if (contentArea.length) {
      const bylineMatch = contentArea.text().match(/\b(by|written by|author:)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
      if (bylineMatch) {
        const matchText = bylineMatch[0];
        const notInTeam = !contentArea.find('[class*="team"], [class*="staff"], [class*="doctor"], [class*="provider"]').text().includes(bylineMatch[2]);
        if (notInTeam) { hasAuthor = true; authorValue = bylineMatch[2]; }
      }
    }
  }
  hasAuthor ? pass(F8, authorValue || '(found)', 'Named author byline detected.') : warn(F8, null, 'No author byline found (E-E-A-T/GEO signal missing).');

  if (!hasAuthor) {
    warn(F9, null, 'No author to evaluate.');
  } else {
    const authorText = (authorValue || '').toLowerCase();
    genericAuthorNames.has(authorText)
      ? warn(F9, authorValue, `Author name is generic ("${authorValue}").`)
      : pass(F9, authorValue || '(found)', 'Author appears to be a named individual.');
  }

  const authorLink = $('[rel="author"] a, [class*="author"] a').first().attr('href') || '';
  authorLink && (authorLink.includes('/author/') || authorLink.includes('/about/'))
    ? pass(F10, authorLink, 'Author links to bio page.')
    : notice(F10, authorLink||null, 'Author does not link to /author/ or /about/ bio page.');

  const timeEl = $('time[datetime], time').first().attr('datetime') || $('time').first().text();
  const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\w+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})\b/;
  const hasDate = timeEl || datePattern.test(rawHtml) || rawHtml.toLowerCase().includes('datepublished');
  hasDate ? pass(F11, String(timeEl||'').substring(0,30), 'Publication date found.') : notice(F11,null,'No publication date detected.');

  const updatedPattern = /last\s+updated|updated\s+on|last\s+modified|reviewed\s+on/i;
  updatedPattern.test(rawHtml) ? pass(F12,null,'Last updated date signal found.') : notice(F12,null,'No "last updated" date signal found.');

  const reviewedPattern = /reviewed\s+by|medically\s+reviewed|fact.?checked\s+by|legally\s+reviewed/i;
  reviewedPattern.test(rawHtml) ? pass(F13,null,'"Reviewed by expert" signal found.') : notice(F13,null,'No expert review attribution found.');

  const blockquotes = $('blockquote').length;
  const credentialPattern = /\b(MD|PhD|CEO|Director|Professor|Founder|RN|CPA|JD|MBA)\b/;
  const expertQuoteCount = blockquotes + (rawHtml.match(/"[^"]{50,}"/g) || []).filter(q => credentialPattern.test(q)).length;
  expertQuoteCount > 0 ? pass(F14,`${expertQuoteCount}`,`${expertQuoteCount} expert quote(s) found.`) : warn(F14,'0','No expert quotes detected (GEO +40.3% signal missing).');

  // CHANGE 3 — §1.3: Statistics counter fix
  const statCount = countStatistics(bodyText);
  statCount >= 4 ? pass(F15,`${statCount}`,`${statCount} statistics found (target: 5–7).`) : warn(F15,`${statCount}`,`Only ${statCount} statistics found (target: ≥4).`);

  const sourcePattern = /\((?:Source|source)[,:\s][^)]{1,60}\)|\[[^\]]{3,50}\]|\baccording\s+to\b/gi;
  const sourcedStats = (rawHtml.match(sourcePattern) || []).length;
  sourcedStats > 0 ? pass(F16,`${sourcedStats}`,`${sourcedStats} sourced statistic(s) found.`) : warn(F16,'0','No source attribution found near statistics.');

  const externalLinks = $('a[href]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return href.startsWith('http') && !href.includes(($('meta[property="og:url"]').attr('content')||'').split('/')[2]||'__none__');
  });
  const primarySources = externalLinks.filter((_, el) => AUTHORITATIVE_DOMAINS.some(d => ($(el).attr('href')||'').includes(d)));
  primarySources.length > 0 ? pass(F17,`${primarySources.length}`,`${primarySources.length} outbound link(s) to primary sources.`) : warn(F17,'0','No outbound citations to .gov/.edu/research domains (GEO +41.5% signal missing).');

  const dataTables = $('table').filter((_, el) => $(el).find('th').length > 0).length;
  dataTables > 0 ? pass(F18,`${dataTables}`,`${dataTables} HTML table(s) with headers found.`) : notice(F18,'0','No comparison tables found.');

  const hasFaq = $('[class*="faq"],[id*="faq"]').length > 0 ||
    $('h2,h3').filter((_, el) => /frequently asked|faq/i.test($(el).text())).length > 0;
  hasFaq ? pass(F19,null,'FAQ section detected.') : notice(F19,null,'No FAQ section detected.');

  const orgName = ($('script[type="application/ld+json"]').map((_, el) => $(el).html()).get()
    .map(j => { try { return JSON.parse(j); } catch { return {}; } })
    .find(s => s['@type'] === 'Organization')?.name || '').toLowerCase();
  const firstPLower = firstP.toLowerCase();
  orgName && firstPLower.includes(orgName)
    ? pass(F20,orgName,'Brand name in opening paragraph (Gemini GEO signal).')
    : notice(F20,orgName||null,'Brand name not found in opening paragraph.');

  const promoCount = PROMO_WORDS.reduce((acc, w) => acc + (bodyText.toLowerCase().split(w).length - 1), 0);
  promoCount > 0 ? warn(F21,`${promoCount}`,`${promoCount} promotional language occurrence(s) detected (GEO penalty).`) : pass(F21,'0','No promotional language detected.');

  // CHANGE 12 — §1.13: F22 normalise before stemming
  const words = bodyText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const stopWords = new Set(['about','above','after','again','against','there','their','these','those','which','would','could','should']);
  const wordFreq = {};
  words.forEach(w => { if (!stopWords.has(w)) wordFreq[stemWord(w.replace(/[^a-zA-Z]/g,''))] = (wordFreq[stemWord(w.replace(/[^a-zA-Z]/g,''))]||0)+1; });
  const topWord = Object.entries(wordFreq).sort(([,a],[,b])=>b-a)[0];
  const density = topWord && wc > 0 ? (topWord[1]/wc*100) : 0;
  density > 4 ? warn(F22,`"${topWord[0]}" at ${density.toFixed(1)}%`,`Keyword density too high: "${topWord[0]}" at ${density.toFixed(1)}%.`) : pass(F22, topWord?`"${topWord[0]}" at ${density.toFixed(1)}%`:null,'No excessive keyword density detected.');

  wc > 5000 && h2s_count($) < 5
    ? warn(F23,`${wc} words`,`Over 5,000 words with fewer than 5 H2 sections.`)
    : pass(F23,`${wc} words`,'Content length vs structure ratio is acceptable.');

  wc > 3000 ? notice(F24,`${wc} words`,`${wc} words — over 3,000 is a GEO grounding budget risk.`) : pass(F24,`${wc} words`,'Word count within GEO grounding range.');

  const hiddenTexts = [];
  $('[style]').each((_, el) => {
    const style = ($(el).attr('style')||'').replace(/\s/g,'').toLowerCase();
    if ((style.includes('display:none') || style.includes('visibility:hidden')) && wordCount($(el).text()) > 20)
      hiddenTexts.push($(el).text().substring(0,40));
  });
  hiddenTexts.length ? fail(F25,'error',`${hiddenTexts.length} block(s)`,`Hidden text blocks with >20 words detected.`) : pass(F25,null,'No hidden text blocks detected.');

  // CHANGE 4 — §1.4: F26 outdated year detection
  const currentYear = new Date().getFullYear();
  const oldStatYears = [];
  const sentences = bodyText.split(/[.!?]+/);
  for (const sentence of sentences) {
    if (YEAR_EXCLUSION_CONTEXTS.some(p => p.test(sentence))) continue;
    if (!STATISTIC_PATTERNS.some(p => p.test(sentence))) continue;
    const years = sentence.match(/\b(20\d{2})\b/g) || [];
    years.forEach(y => { if (parseInt(y) <= currentYear - 3) oldStatYears.push(y); });
  }
  const uniqueOldStat = [...new Set(oldStatYears)];
  uniqueOldStat.length > 0
    ? warn(F26, uniqueOldStat.join(', '), `Statistics cite outdated year(s): ${uniqueOldStat.join(', ')} (≥3 years old).`)
    : pass(F26, null, 'No outdated year references in statistics.');

  info(F27,`${primarySources.length}`,`${primarySources.length} outbound links to authoritative domains.`);

  // CSQAF composite (0-10)
  let csqaf = 0;
  if (sourcedStats > 0) csqaf += 2;
  else if (statCount > 0) csqaf += 1;
  if (statCount >= 4) csqaf += 2;
  else if (statCount >= 2) csqaf += 1;
  if (expertQuoteCount > 0) csqaf += 2;
  if (hasAuthor) csqaf += 2;
  if (promoCount === 0) csqaf += 2; else if (promoCount < 3) csqaf += 1;
  csqaf = Math.min(10, csqaf);
  info(F28,`${csqaf}/10`,`CSQAF composite score: ${csqaf}/10.`);

  return {
    checks: [F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12,F13,F14,F15,F16,F17,F18,F19,F20,F21,F22,F23,F24,F25,F26,F27,F28],
    geo: {
      csqaf_score: csqaf,
      statistics_count: statCount,
      expert_quotes: expertQuoteCount,
      named_author: hasAuthor,
      primary_source_citations: primarySources.length,
      html_tables: dataTables,
      faq_section: hasFaq,
      direct_answer_opening: firstPWords >= 40,
      promotional_language_count: promoCount,
    }
  };
}

function h2s_count($) { return $('h2').length; }

// ── G. Images ─────────────────────────────────────────────────────────────────

function checksG($) {
  const imgs = $('img');
  const total = imgs.length;

  const G = (id,name,req=false) => makeResult(id,'Images',name,req);
  const G1=G('G1','All non-decorative images have alt text');
  const G2=G('G2','No empty alt on non-decorative images');
  const G3=G('G3','Alt text length: not too long');
  const G4=G('G4','No keyword stuffing in alt text');
  const G5=G('G5','Decorative images have empty alt');
  const G6=G('G6','Image dimensions specified');
  const G7=G('G7','Lazy loading implemented');
  const G8=G('G8','Modern image formats used');
  const G9=G('G9','No empty src attributes');
  const G10=G('G10','No large inline base64 images');
  const G11=G('G11','figure + figcaption used for content images');
  const G12=G('G12','No hotlinked external images');
  const G13=G('G13','Broken images check',true);

  const missingAlt = [], emptyAltNonDec = [], longAlt = [], stuffedAlt = [];
  const noDims = [], noLazy = [], oldFormat = [], emptySrc = [], bigBase64 = [];
  let lazyCount = 0;

  imgs.each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt');
    const isDecor = $(el).attr('role') === 'presentation' || $(el).closest('[role="presentation"]').length > 0;
    const isIcon = /icon|logo|spacer|pixel/i.test(src);

    // CHANGE 5 — §1.5: G1/G2 decorative image detection
    const isDecorativeByAttr = $(el).attr('aria-hidden') === 'true'
      || $(el).attr('role') === 'presentation' || $(el).attr('role') === 'none'
      || $(el).closest('[role="presentation"]').length > 0
      || /\b(icon|spacer|pixel|separator|decoration|divider|bg)\b/i.test($(el).attr('class') || '')
      || /spacer|pixel|dot\.gif|blank/i.test(src)
      || (parseInt($(el).attr('width')) <= 4 && parseInt($(el).attr('width')) > 0)
      || (parseInt($(el).attr('height')) <= 4 && parseInt($(el).attr('height')) > 0);
    const isDecorFull = isDecor || isIcon || isDecorativeByAttr;

    // G1: missing alt (undefined) on non-decorative
    if (!isDecorFull && alt === undefined) missingAlt.push(src.substring(0,40));
    // G2: empty alt="" on non-decorative (empty alt is correct only on decorative)
    if (!isDecorFull && alt !== undefined && alt.trim() === '') emptyAltNonDec.push(src.substring(0,40));

    if (alt && alt.length > 125) longAlt.push(alt.substring(0,40));
    if (alt) {
      const altRoots = alt.toLowerCase().split(/\s+/).map(stemWord);
      const af = {};
      altRoots.forEach(w => { if (w.length > 3) af[w]=(af[w]||0)+1; });
      if (Object.values(af).some(c=>c>=3)) stuffedAlt.push(alt.substring(0,40));
    }
    if (!$(el).attr('width') && !$(el).attr('height')) noDims.push(src.substring(0,40));
    if ($(el).attr('loading') === 'lazy') lazyCount++;
    if (/\.(jpg|jpeg|png)$/i.test(src)) oldFormat.push(src.substring(0,40));
    if (!src || src.trim() === '') emptySrc.push('(empty src)');
    if (src.startsWith('data:image') && src.length > 50000) bigBase64.push('(base64 image)');
  });

  // CHANGE 5 — updated G1/G2 pass/fail
  missingAlt.length || emptyAltNonDec.length
    ? fail(G1,'error',`${missingAlt.length + emptyAltNonDec.length} imgs`,`${missingAlt.length} non-decorative image(s) missing alt text, ${emptyAltNonDec.length} have empty alt="".`)
    : pass(G1,`${total} imgs`,'All non-decorative images have non-empty alt text.');
  emptyAltNonDec.length
    ? warn(G2,`${emptyAltNonDec.length}`,`${emptyAltNonDec.length} non-decorative image(s) have empty alt="".`)
    : pass(G2,null,'No problematic empty alt attributes.');

  longAlt.length ? notice(G3,`${longAlt.length} imgs`,`${longAlt.length} alt attribute(s) over 125 characters.`) : pass(G3,null,'All alt texts are reasonable length.');
  stuffedAlt.length ? warn(G4,`${stuffedAlt.length} imgs`,`${stuffedAlt.length} alt attribute(s) with keyword stuffing.`) : pass(G4,null,'No alt text keyword stuffing.');
  info(G5,null,'Decorative image check recorded.');
  noDims.length ? warn(G6,`${noDims.length}`,`${noDims.length} image(s) missing width/height attributes.`) : pass(G6,null,'All images specify dimensions.');

  // CHANGE 11 — §1.12: G7 lazy loading threshold
  const nonHeroImgs = Math.max(0, total - 1); // skip first image (LCP)
  const pct = nonHeroImgs > 0 ? (lazyCount / nonHeroImgs) : 1;
  if (nonHeroImgs === 0 || pct >= 0.8) pass(G7, `${lazyCount}/${total}`, `${lazyCount} of ${total} images use lazy loading.`);
  else if (pct >= 0.5) notice(G7, `${lazyCount}/${nonHeroImgs}`, `${lazyCount}/${nonHeroImgs} non-hero images have lazy loading. Target: ≥80%.`);
  else warn(G7, `${lazyCount}/${nonHeroImgs}`, `Only ${lazyCount}/${nonHeroImgs} non-hero images have loading="lazy" (${Math.round(pct*100)}%). Missing lazy loading forces all images to load at page open.`);

  oldFormat.length ? notice(G8,`${oldFormat.length}`,`${oldFormat.length} image(s) use JPEG/PNG — consider WebP/AVIF.`) : pass(G8,null,'Modern image formats in use.');
  emptySrc.length ? fail(G9,'error',`${emptySrc.length}`,`${emptySrc.length} image(s) with empty src.`) : pass(G9,null,'No empty image src attributes.');
  bigBase64.length ? warn(G10,`${bigBase64.length}`,`${bigBase64.length} large inline base64 image(s) detected.`) : pass(G10,null,'No large inline base64 images.');
  const figcaptions = $('figure figcaption').length;
  info(G11,`${figcaptions}`,`${figcaptions} figure/figcaption pairs found.`);
  const hotlinked = imgs.filter((_, el) => {
    const src = $(el).attr('src')||'';
    return src.startsWith('http') && !/cdn\.|cloudfront\.|amazonaws\.|imgix\.|cloudinary\./.test(src);
  }).length;
  hotlinked > 0 ? notice(G12,`${hotlinked}`,`${hotlinked} potentially hotlinked external image(s).`) : pass(G12,null,'No hotlinked external images detected.');
  skipped(G13, 'HTTP checks run separately');

  return [G1,G2,G3,G4,G5,G6,G7,G8,G9,G10,G11,G12,G13];
}

// ── H. Internal Links ─────────────────────────────────────────────────────────

function checksH($, pageUrl) {
  const domain = pageUrl ? (new URL(pageUrl).hostname) : '';
  const allLinks = $('a[href]');
  const internal = allLinks.filter((_, el) => {
    const href = $(el).attr('href')||'';
    return href.startsWith('/') || (domain && href.includes(domain));
  });

  const H = (id,name,req=false) => makeResult(id,'Internal Links',name,req);
  const H1=H('H1','Total internal link count');
  const H2=H('H2','No nofollow on internal links');
  const H3=H('H3','No mixed nofollow/dofollow');
  const H4=H('H4','No internal links to noindex pages',true);
  const H5=H('H5','No empty anchor text on internal links');
  const H6=H('H6','No non-descriptive anchor text');
  const H7=H('H7','No JavaScript-only internal links');
  const H8=H('H8','No hash-only fragment links as primary nav');
  const H9=H('H9','Internal links to redirected pages',true);
  const H10=H('H10','Internal links to 4xx pages',true);
  const H11=H('H11','Link distribution by DOM area');

  info(H1,`${internal.length}`,`${internal.length} internal links found.`);

  const nofollowInternal = internal.filter((_, el) => ($(el).attr('rel')||'').includes('nofollow'));
  nofollowInternal.length ? warn(H2,`${nofollowInternal.length}`,`${nofollowInternal.length} internal link(s) with nofollow.`) : pass(H2,null,'No nofollow on internal links.');

  pass(H3, null, 'Mixed nofollow check — review manually if needed.');

  skipped(H4, 'HTTP checks run separately');

  const emptyAnchors = internal.filter((_, el) => {
    const text = $(el).text().trim();
    const hasImg = $(el).find('img[alt]').length > 0;
    return !text && !hasImg;
  });
  emptyAnchors.length ? warn(H5,`${emptyAnchors.length}`,`${emptyAnchors.length} internal link(s) with empty anchor text.`) : pass(H5,null,'No empty anchor text on internal links.');

  const nonDescriptive = internal.filter((_, el) => NON_DESCRIPTIVE_ANCHORS.has($(el).text().trim().toLowerCase())).length;
  nonDescriptive ? warn(H6,`${nonDescriptive}`,`${nonDescriptive} non-descriptive anchor text link(s) found.`) : pass(H6,null,'No non-descriptive anchor text.');

  const jsLinks = internal.filter((_, el) => {
    const href = $(el).attr('href')||'';
    return (href === '#' || href.startsWith('javascript:')) && $(el).attr('onclick');
  });
  jsLinks.length ? warn(H7,`${jsLinks.length}`,`${jsLinks.length} JavaScript-only link(s) detected.`) : pass(H7,null,'No JS-only links.');

  const hashLinks = $('a[href^="#"]').length;
  hashLinks > 5 ? notice(H8,`${hashLinks}`,`${hashLinks} hash-only fragment links.`) : pass(H8,`${hashLinks}`,`${hashLinks} fragment links.`);

  skipped(H9,'HTTP checks run separately');
  skipped(H10,'HTTP checks run separately');

  const navLinks = $('nav a').length;
  const mainLinks = $('main a, article a').length;
  const footerLinks = $('footer a').length;
  info(H11,`nav:${navLinks} main:${mainLinks} footer:${footerLinks}`,`Link distribution — nav:${navLinks}, main:${mainLinks}, footer:${footerLinks}.`);

  return [H1,H2,H3,H4,H5,H6,H7,H8,H9,H10,H11];
}

// ── I. External Links ─────────────────────────────────────────────────────────

function checksI($, pageUrl) {
  const domain = pageUrl ? (new URL(pageUrl).hostname) : '';
  const allLinks = $('a[href]');
  const external = allLinks.filter((_, el) => {
    const href = $(el).attr('href')||'';
    return href.startsWith('http') && (!domain || !href.includes(domain));
  });
  const total = allLinks.length;

  const I = (id,name,req=false) => makeResult(id,'External Links',name,req);
  const I1=I('I1','Total external link count');
  const I2=I('I2','Total link count: not excessive');
  const I3=I('I3','No external links to HTTP');
  const I4=I('I4','rel=noopener noreferrer on target=_blank');
  const I5=I('I5','Outbound citations to primary sources');
  const I6=I('I6','Broken external links',true);
  const I7=I('I7','External links to redirect pages',true);

  info(I1,`${external.length}`,`${external.length} external links found.`);
  total > 100 ? warn(I2,`${total}`,`${total} total links — over 100 can dilute link equity.`) : pass(I2,`${total}`,`${total} total links.`);

  const httpExt = external.filter((_, el) => ($(el).attr('href')||'').startsWith('http://'));
  httpExt.length ? warn(I3,`${httpExt.length}`,`${httpExt.length} external link(s) use HTTP.`) : pass(I3,null,'All external links use HTTPS.');

  const blankNoOpener = $('a[target="_blank"]').filter((_, el) => !($(el).attr('rel')||'').includes('noopener'));
  blankNoOpener.length ? warn(I4,`${blankNoOpener.length}`,`${blankNoOpener.length} target="_blank" link(s) missing rel="noopener noreferrer".`) : pass(I4,null,'All target="_blank" links have noopener.');

  // CHANGE 6 — §1.6: I5 zero citations shows as pass
  const primaryCount = external.filter((_, el) => AUTHORITATIVE_DOMAINS.some(d => ($(el).attr('href')||'').includes(d))).length;
  if (primaryCount >= 3) pass(I5,`${primaryCount}`,`${primaryCount} outbound links to primary sources.`);
  else if (primaryCount >= 1) notice(I5,`${primaryCount}`,`${primaryCount} outbound link(s) to primary sources — target ≥3.`);
  else notice(I5,'0','No outbound citations to .gov/.edu/research domains. Adding ≥2 citations is a validated GEO signal (+41.5% visibility).');

  skipped(I6,'HTTP checks run separately');
  skipped(I7,'HTTP checks run separately');

  return [I1,I2,I3,I4,I5,I6,I7];
}

// ── J. Structured Data / Schema ───────────────────────────────────────────────

function checksJ($) {
  const J = (id,name) => makeResult(id,'Schema','Schema: '+name);
  const results = [];
  const add = r => { results.push(r); return r; };

  const J1=add(J('J1','Schema markup present'));
  const J2=add(J('J2','Schema type(s) detected'));
  const J3=add(J('J3','JSON-LD is valid JSON'));

  const blocks = $('script[type="application/ld+json"]');
  const parsedSchemas = [];
  let parseErrors = 0;

  blocks.each((_, el) => {
    try {
      const obj = JSON.parse($(el).html()||'');
      parsedSchemas.push(obj);
    } catch {
      parseErrors++;
    }
  });

  blocks.length > 0 ? pass(J1,`${blocks.length} block(s)`,`${blocks.length} JSON-LD block(s) found.`) : warn(J1,'0','No schema markup found.');
  const types = parsedSchemas.map(s => [].concat(s['@type']||[])).flat().filter(Boolean);
  types.length ? info(J2, types.join(', '), `Schema types: ${types.join(', ')}.`) : info(J2, null, 'No schema types detected.');
  parseErrors === 0 ? pass(J3, null, 'All JSON-LD blocks are valid JSON.') : fail(J3,'error',`${parseErrors} error(s)`,`${parseErrors} JSON-LD block(s) failed JSON parsing.`);

  // CHANGE 7 — §1.8: J4 updated to use subtype registry
  const J4=add(J('J4','Organization schema present'));
  const orgSchema = parsedSchemas.find(s => {
    const types = [].concat(s['@type'] || []);
    return types.includes('Organization') || types.some(t => LOCAL_BUSINESS_SUBTYPES.has(t));
  });
  orgSchema ? pass(J4, [].concat(orgSchema['@type']||[])[0], 'Organization/LocalBusiness schema found.') : warn(J4,null,'No Organization schema found.');

  const articleSchema = parsedSchemas.find(s => ['Article','BlogPosting','NewsArticle'].includes(s['@type']));
  const faqSchema = parsedSchemas.find(s => s['@type'] === 'FAQPage');
  const personSchema = parsedSchemas.find(s => s['@type'] === 'Person');
  const productSchema = parsedSchemas.find(s => s['@type'] === 'Product');
  const breadcrumbSchema = parsedSchemas.find(s => s['@type'] === 'BreadcrumbList');
  const videoSchema = parsedSchemas.find(s => s['@type'] === 'VideoObject');

  const J5=add(J('J5','Organization: name field'));
  const J6=add(J('J6','Organization: url field'));
  const J7=add(J('J7','Organization: logo field'));
  const J8=add(J('J8','Organization: description field'));
  const J9=add(J('J9','Organization: sameAs array'));
  const J10=add(J('J10','sameAs links to LinkedIn'));
  const J11=add(J('J11','sameAs links to Wikidata'));
  const J12=add(J('J12','sameAs links to YouTube'));
  const J13=add(J('J13','@id used in schema'));

  if (orgSchema) {
    orgSchema.name ? pass(J5,orgSchema.name,'Organization name present.') : fail(J5,'error',null,'Organization schema missing name field.');
    orgSchema.url ? pass(J6,orgSchema.url,'Organization url present.') : warn(J6,null,'Organization schema missing url field.');
    orgSchema.logo ? pass(J7,typeof orgSchema.logo==='object'?orgSchema.logo.url:orgSchema.logo,'Organization logo present.') : warn(J7,null,'Organization schema missing logo field.');
    orgSchema.description ? pass(J8,orgSchema.description.substring(0,60),'Organization description present.') : warn(J8,null,'Organization schema missing description field.');
    const sameAs = orgSchema.sameAs || [];
    sameAs.length >= 1 ? pass(J9,`${sameAs.length} profiles`,`sameAs has ${sameAs.length} profile(s).`) : warn(J9,'0','Organization schema missing sameAs (GEO entity signal).');
    sameAs.some(u=>u.includes('linkedin.com')) ? pass(J10,null,'sameAs includes LinkedIn.') : notice(J10,null,'sameAs missing LinkedIn.');
    sameAs.some(u=>u.includes('wikidata.org')) ? pass(J11,null,'sameAs includes Wikidata.') : notice(J11,null,'sameAs missing Wikidata.');
    sameAs.some(u=>u.includes('youtube.com')) ? pass(J12,null,'sameAs includes YouTube.') : notice(J12,null,'sameAs missing YouTube.');
    orgSchema['@id'] ? pass(J13,orgSchema['@id'],'@id present in schema.') : warn(J13,null,'@id missing from Organization schema.');
  } else {
    [J5,J6,J7,J8,J9,J10,J11,J12,J13].forEach(r => skipped(r,'No Organization schema'));
  }

  const J14=add(J('J14','Article schema on editorial pages'));
  const J15=add(J('J15','Article: author field'));
  const J16=add(J('J16','Article: datePublished'));
  const J17=add(J('J17','Article: dateModified'));

  if (articleSchema) {
    pass(J14,articleSchema['@type'],'Article schema present.');
    articleSchema.author ? pass(J15,typeof articleSchema.author==='object'?articleSchema.author.name:articleSchema.author,'Article author present.') : fail(J15,'error',null,'Article schema missing author.');
    articleSchema.datePublished ? pass(J16,articleSchema.datePublished,'datePublished present.') : warn(J16,null,'Article schema missing datePublished.');
    articleSchema.dateModified ? pass(J17,articleSchema.dateModified,'dateModified present (GEO freshness signal).') : warn(J17,null,'Article schema missing dateModified.');
  } else {
    notice(J14,null,'No Article/BlogPosting schema — consider adding if this is editorial content.');
    [J15,J16,J17].forEach(r => skipped(r,'No Article schema'));
  }

  const J18=add(J('J18','FAQPage schema present'));
  const J19=add(J('J19','FAQPage Q&A format correct'));
  if (faqSchema) {
    pass(J18,null,'FAQPage schema found.');
    const items = [].concat(faqSchema.mainEntity || []);
    const valid = items.every(i => i['@type']==='Question' && i.acceptedAnswer && i.acceptedAnswer['@type']==='Answer');
    valid ? pass(J19,`${items.length} Q&A pairs`,'FAQPage structure is correct.') : fail(J19,'error',null,'FAQPage items have incorrect structure.');
  } else {
    notice(J18,null,'No FAQPage schema.'); skipped(J19,'No FAQPage schema');
  }

  const J20=add(J('J20','Person schema on bio pages'));
  const J21=add(J('J21','Person: name, jobTitle, affiliation, sameAs'));
  if (personSchema) {
    pass(J20,null,'Person schema found.');
    const hasAll = personSchema.name && personSchema.jobTitle && personSchema.affiliation && personSchema.sameAs;
    hasAll ? pass(J21,null,'Person schema has all required fields.') : warn(J21,null,'Person schema missing one or more of: name, jobTitle, affiliation, sameAs.');
  } else {
    info(J20,null,'No Person schema detected.'); skipped(J21,'No Person schema');
  }

  // CHANGE 7 — §1.8: J22/J23 LocalBusiness subtype registry + validation
  const J22=add(J('J22','LocalBusiness / subtype schema'));
  const J23=add(J('J23','LocalBusiness: address, telephone, geo, openingHours'));

  const lbSchema = parsedSchemas.find(s => [].concat(s['@type']||[]).some(t => LOCAL_BUSINESS_SUBTYPES.has(t)));

  if (lbSchema) {
    const lbType = [].concat(lbSchema['@type']||[]).find(t => LOCAL_BUSINESS_SUBTYPES.has(t));
    // Validate OpeningHoursSpecification if present
    const ohsArray = [].concat(lbSchema.openingHoursSpecification || []);
    const ohsErrors = ohsArray.flatMap(ohs => validateOpeningHours(ohs));

    if (ohsErrors.length > 0) {
      warn(J22, lbType, `${lbType} schema detected with ${ohsErrors.length} validation error(s): ${ohsErrors.map(e=>e.error).join('; ')}`);
    } else {
      pass(J22, lbType, `${lbType} schema found (LocalBusiness subtype).`);
    }

    const missingFields = [];
    if (!lbSchema.address) missingFields.push('address');
    if (!lbSchema.telephone) missingFields.push('telephone');
    if (!lbSchema.geo) missingFields.push('geo');
    if (!lbSchema.openingHoursSpecification) missingFields.push('openingHoursSpecification');
    if (!lbSchema.sameAs) missingFields.push('sameAs');

    missingFields.length === 0
      ? pass(J23, null, 'LocalBusiness schema has all key fields.')
      : warn(J23, missingFields.join(', '), `LocalBusiness missing field(s): ${missingFields.join(', ')}.`);
  } else {
    info(J22, null, 'No LocalBusiness/subtype schema detected.');
    skipped(J23, 'No LocalBusiness schema');
  }

  const J24=add(J('J24','Product + Offer schema'));
  productSchema ? pass(J24,null,'Product schema found.') : info(J24,null,'No Product schema.');

  const J25=add(J('J25','BreadcrumbList schema'));
  breadcrumbSchema ? pass(J25,null,'BreadcrumbList schema found.') : notice(J25,null,'No BreadcrumbList schema.');

  const J26=add(J('J26','VideoObject schema'));
  const hasVideo = $('iframe[src*="youtube.com"], iframe[src*="vimeo.com"]').length > 0;
  if (hasVideo && !videoSchema) warn(J26,null,'Video embed detected but no VideoObject schema.'); else if (videoSchema) pass(J26,null,'VideoObject schema found.'); else info(J26,null,'No video content detected.');

  const J27=add(J('J27','HowTo schema'));
  info(J27, null, parsedSchemas.find(s=>s['@type']==='HowTo') ? 'HowTo schema present.' : 'No HowTo schema.');

  const J28=add(J('J28','Schema format is JSON-LD'));
  const hasMicrodata = $('[itemscope]').length > 0;
  hasMicrodata ? warn(J28,null,'Microdata attributes detected — JSON-LD is preferred.') : pass(J28,null,'No Microdata detected.');

  const J29=add(J('J29','No conflicting schema types'));
  const hasConflict = types.includes('Article') && types.includes('Product');
  hasConflict ? warn(J29,types.join(', '),'Conflicting schema types detected (Article + Product).') : pass(J29,null,'No conflicting schema types.');

  const J30=add(J('J30','YMYL: MedicalOrganization schema'));
  const J31=add(J('J31','YMYL: Attorney/FinancialService schema'));
  info(J30,null,'YMYL medical schema check — review if applicable.');
  info(J31,null,'YMYL legal/financial schema check — review if applicable.');

  return results;
}

// ── K. Open Graph & Social Meta ───────────────────────────────────────────────

function checksK($, pageUrl) {
  const og = prop => $(`meta[property="${prop}"]`).attr('content') || null;
  const tw = name => $(`meta[name="${name}"]`).attr('content') || null;

  const K = (id,name,req=false) => makeResult(id,'Open Graph','OG: '+name,req);
  const K1=K('K1','og:title');  const K2=K('K2','og:description'); const K3=K('K3','og:image');
  const K4=K('K4','og:image URL accessible',true); const K5=K('K5','og:url');
  const K6=K('K6','og:url matches canonical'); const K7=K('K7','og:type'); const K8=K('K8','og:site_name');
  const K9=K('K9','twitter:card'); const K10=K('K10','twitter:title');
  const K11=K('K11','twitter:description'); const K12=K('K12','twitter:image');

  const ogTitle = og('og:title');
  ogTitle ? pass(K1,ogTitle.substring(0,60),'og:title present.') : warn(K1,null,'og:title missing.');
  const ogDesc = og('og:description');
  ogDesc ? pass(K2,ogDesc.substring(0,60),'og:description present.') : warn(K2,null,'og:description missing.');
  const ogImg = og('og:image');
  ogImg ? pass(K3,ogImg,'og:image present.') : warn(K3,null,'og:image missing.');
  skipped(K4,'HTTP checks run separately');
  const ogUrl = og('og:url');
  ogUrl ? pass(K5,ogUrl,'og:url present.') : warn(K5,null,'og:url missing.');

  const canonHref = $('link[rel="canonical"]').attr('href') || '';
  if (ogUrl && canonHref) {
    ogUrl === canonHref ? pass(K6,null,'og:url matches canonical.') : warn(K6,`og:${ogUrl} vs canon:${canonHref}`,'og:url does not match canonical URL.');
  } else { skipped(K6,'og:url or canonical missing'); }

  og('og:type') ? pass(K7,og('og:type'),'og:type present.') : notice(K7,null,'og:type missing.');
  og('og:site_name') ? pass(K8,og('og:site_name'),'og:site_name present.') : notice(K8,null,'og:site_name missing.');
  tw('twitter:card') ? pass(K9,tw('twitter:card'),'twitter:card present.') : notice(K9,null,'twitter:card missing.');
  tw('twitter:title') ? pass(K10,tw('twitter:title').substring(0,40),'twitter:title present.') : notice(K10,null,'twitter:title missing.');
  tw('twitter:description') ? pass(K11,tw('twitter:description').substring(0,40),'twitter:description present.') : notice(K11,null,'twitter:description missing.');
  tw('twitter:image') ? pass(K12,tw('twitter:image'),'twitter:image present.') : notice(K12,null,'twitter:image missing.');

  return [K1,K2,K3,K4,K5,K6,K7,K8,K9,K10,K11,K12];
}

// ── L. Hreflang ───────────────────────────────────────────────────────────────

function checksL($) {
  const hreflangs = $('link[rel="alternate"][hreflang]');
  const L = (id,name) => makeResult(id,'Hreflang',name);
  const L1=L('L1','Hreflang tags detected'); const L2=L('L2','Language codes valid');
  const L3=L('L3','x-default tag present'); const L4=L('L4','Self-referencing hreflang');
  const L5=L('L5','Hreflang conflicts with canonical');

  if (hreflangs.length === 0) {
    info(L1,null,'No hreflang tags detected.'); [L2,L3,L4,L5].forEach(r=>skipped(r,'No hreflang tags'));
    return [L1,L2,L3,L4,L5];
  }

  info(L1,`${hreflangs.length} tags`,`${hreflangs.length} hreflang tag(s) found.`);
  const langPattern = /^[a-z]{2}(-[A-Z]{2})?$|^x-default$/;
  const invalid = [];
  hreflangs.each((_, el) => { if (!langPattern.test($(el).attr('hreflang')||'')) invalid.push($(el).attr('hreflang')); });
  invalid.length ? notice(L2,invalid.join(', '),`Invalid hreflang codes: ${invalid.join(', ')}.`) : pass(L2,null,'All hreflang codes are valid.');

  const hasXDefault = hreflangs.filter((_, el) => $(el).attr('hreflang') === 'x-default').length > 0;
  hasXDefault ? pass(L3,null,'x-default hreflang present.') : notice(L3,null,'No x-default hreflang tag.');
  info(L4,null,'Self-referencing hreflang — review manually.');
  const canonHref = $('link[rel="canonical"]').attr('href') || '';
  const conflict = canonHref && hreflangs.filter((_, el) => $(el).attr('href') !== canonHref && $(el).attr('hreflang') !== 'x-default').length > 0;
  conflict ? warn(L5,canonHref,'Hreflang URL may conflict with canonical.') : pass(L5,null,'No hreflang/canonical conflict detected.');

  return [L1,L2,L3,L4,L5];
}

// ── M. Technical HTML Foundation ──────────────────────────────────────────────

function checksM($, rawHtml, httpHeaders) {
  const M = (id,name) => makeResult(id,'Technical','Tech: '+name);
  const M1=M('M1','DOCTYPE declared'); const M2=M('M2','Character encoding declared');
  const M3=M('M3','HTML lang attribute present'); const M4=M('M4','HTML lang attribute is valid');
  const M5=M('M5','Viewport meta present'); const M6=M('M6','Viewport: width=device-width');
  const M7=M('M7','Viewport: initial-scale=1'); const M8=M('M8','Viewport: user-scalable not disabled');
  const M9=M('M9','No frames or iframes (non-content)'); const M10=M('M10','No incompatible plugins');
  const M11=M('M11','HTML file size acceptable'); const M12=M('M12','DOM element count acceptable');
  const M13=M('M13','No CSS in body'); const M14=M('M14','Inline CSS not excessive');
  const M15=M('M15','Inline JS not excessive'); const M16=M('M16','No render-blocking JS in head');
  const M17=M('M17','External CSS file count'); const M18=M('M18','External JS file count');
  const M19=M('M19','Render-blocking resource count'); const M20=M('M20','Resource hints present');
  const M21=M('M21','No mixed content'); const M22=M('M22','No meta refresh redirect');

  rawHtml.trimStart().toLowerCase().startsWith('<!doctype') ? pass(M1,null,'DOCTYPE declared.') : warn(M1,null,'DOCTYPE missing or not first line.');
  $('meta[charset]').length ? pass(M2,$('meta[charset]').attr('charset'),'Charset declared.') : warn(M2,null,'No charset meta tag found.');

  const htmlLang = $('html').attr('lang') || '';
  htmlLang ? pass(M3,htmlLang,'HTML lang attribute present.') : warn(M3,null,'HTML lang attribute missing.');
  const validLang = /^[a-z]{2}(-[A-Z]{2})?$/.test(htmlLang);
  validLang ? pass(M4,htmlLang,'HTML lang is valid BCP 47.') : warn(M4,htmlLang,`HTML lang "${htmlLang}" may not be valid BCP 47.`);

  const vp = $('meta[name="viewport"]');
  const vpContent = vp.attr('content') || '';
  vp.length ? pass(M5,vpContent,'Viewport meta present.') : fail(M5,'error',null,'Viewport meta tag missing.');
  vpContent.includes('width=device-width') ? pass(M6,vpContent,'width=device-width present.') : fail(M6,'error',vpContent,'Viewport missing width=device-width.');
  vpContent.includes('initial-scale=1') ? pass(M7,vpContent,'initial-scale=1 present.') : warn(M7,vpContent,'Viewport missing initial-scale=1.');
  vpContent.includes('user-scalable=no') ? warn(M8,vpContent,'user-scalable=no disables zoom (accessibility issue).') : pass(M8,null,'user-scalable not disabled.');

  const frames = $('frame, frameset').length;
  const nonContentIframes = $('iframe').filter((_, el) => !/youtube\.com|vimeo\.com|maps\.google|google\.com\/maps/i.test($(el).attr('src')||'')).length;
  frames + nonContentIframes > 0 ? warn(M9,`${frames} frames, ${nonContentIframes} iframes`,`${frames} frame(s) and ${nonContentIframes} non-content iframe(s) found.`) : pass(M9,null,'No frames or non-content iframes.');

  const oldPlugins = rawHtml.match(/\.swf|flash|silverlight|java applet/gi) || [];
  oldPlugins.length ? fail(M10,'error',oldPlugins[0],'Incompatible plugin references detected.') : pass(M10,null,'No incompatible plugins.');

  const sizeKB = Math.round(rawHtml.length / 1024);
  sizeKB > 100 ? warn(M11,`${sizeKB}KB`,`HTML is ${sizeKB}KB — over 100KB.`) : pass(M11,`${sizeKB}KB`,`HTML size: ${sizeKB}KB.`);

  const domCount = $('*').length;
  domCount > 1500 ? warn(M12,`${domCount}`,`DOM has ${domCount} elements — over 1,500.`) : pass(M12,`${domCount}`,`DOM element count: ${domCount}.`);

  $('body style').length ? notice(M13,null,'<style> tag found outside <head>.') : pass(M13,null,'No CSS in body.');
  const inlineCssLen = $('style').map((_, el) => $(el).html()?.length||0).get().reduce((a,b)=>a+b,0);
  inlineCssLen > 5000 ? notice(M14,`${inlineCssLen} chars`,`Inline CSS is ${inlineCssLen} characters.`) : pass(M14,`${inlineCssLen} chars`,`Inline CSS: ${inlineCssLen} chars.`);

  const inlineJsLen = $('script:not([src]):not([type="application/ld+json"])').map((_, el) => $(el).html()?.length||0).get().reduce((a,b)=>a+b,0);
  inlineJsLen > 10000 ? notice(M15,`${inlineJsLen} chars`,`Inline JS is ${inlineJsLen} characters.`) : pass(M15,`${inlineJsLen} chars`,`Inline JS: ${inlineJsLen} chars.`);

  const blockingJS = $('head script[src]').filter((_, el) => !$(el).attr('async') && !$(el).attr('defer')).length;
  blockingJS ? warn(M16,`${blockingJS}`,`${blockingJS} render-blocking <script> tag(s) in <head>.`) : pass(M16,null,'No render-blocking JS in head.');

  const cssList = $('link[rel="stylesheet"]').length;
  cssList > 6 ? notice(M17,`${cssList}`,`${cssList} external CSS files — consider consolidating.`) : pass(M17,`${cssList}`,`${cssList} external CSS files.`);

  const jsList = $('script[src]').length;
  jsList > 10 ? notice(M18,`${jsList}`,`${jsList} external JS files.`) : pass(M18,`${jsList}`,`${jsList} external JS files.`);

  const blockingCSS = $('head link[rel="stylesheet"]:not([media])').length;
  const totalBlocking = blockingJS + blockingCSS;
  totalBlocking > 0 ? warn(M19,`${totalBlocking}`,`${totalBlocking} render-blocking resource(s).`) : pass(M19,'0','No render-blocking resources.');

  const hints = $('link[rel="preconnect"], link[rel="preload"], link[rel="prefetch"], link[rel="dns-prefetch"]').length;
  hints > 0 ? pass(M20,`${hints}`,`${hints} resource hint(s) found.`) : notice(M20,'0','No resource hints (preconnect/preload/prefetch).');

  const mixedContent = $('img[src^="http://"], script[src^="http://"], link[href^="http://"]').length;
  mixedContent ? fail(M21,'error',`${mixedContent}`,`${mixedContent} mixed content reference(s) found.`) : pass(M21,null,'No mixed content detected.');

  $('meta[http-equiv="refresh"]').length ? warn(M22,null,'Meta refresh redirect present.') : pass(M22,null,'No meta refresh redirect.');

  return [M1,M2,M3,M4,M5,M6,M7,M8,M9,M10,M11,M12,M13,M14,M15,M16,M17,M18,M19,M20,M21,M22];
}

// ── N. URL Signals ────────────────────────────────────────────────────────────

function checksN(pageUrl) {
  const N = (id,name) => makeResult(id,'URL Signals',name);
  const checks = [N('N1','URL length'), N('N2','No underscores in slug'), N('N3','URL param count'),
    N('N4','No year string in URL'), N('N5','URL directory depth'), N('N6','No keyword stuffing in slug'),
    N('N7','URL slug is descriptive')];
  const [N1,N2,N3,N4,N5,N6,N7] = checks;

  if (!pageUrl) { checks.forEach(r => skipped(r,'URL not provided')); return checks; }

  let parsed;
  try { parsed = new URL(pageUrl); } catch { checks.forEach(r => skipped(r,'Invalid URL')); return checks; }

  const fullLen = pageUrl.length;
  fullLen > 115 ? warn(N1,`${fullLen} chars`,`URL is ${fullLen} characters (max 115).`) : pass(N1,`${fullLen} chars`,`URL length: ${fullLen} chars.`);

  const slug = parsed.pathname;
  slug.includes('_') ? notice(N2,slug,'URL slug contains underscores — use hyphens.') : pass(N2,slug,'No underscores in URL.');

  const paramCount = [...parsed.searchParams].length;
  paramCount > 2 ? warn(N3,`${paramCount}`,`${paramCount} URL parameters.`) : pass(N3,`${paramCount}`,`${paramCount} URL parameter(s).`);

  /\/20\d{2}[\/\-]/.test(slug) ? notice(N4,slug,'URL contains year pattern — can cause freshness issues.') : pass(N4,slug,'No year in URL slug.');

  const depth = slug.split('/').filter(Boolean).length;
  depth > 3 ? warn(N5,`${depth} levels`,`URL is ${depth} levels deep (max 3).`) : pass(N5,`${depth} levels`,`URL depth: ${depth}.`);

  const slugParts = slug.toLowerCase().split(/[\/-]/).filter(Boolean);
  const slugFreq = {};
  slugParts.map(stemWord).forEach(w => { slugFreq[w]=(slugFreq[w]||0)+1; });
  const stuffed = Object.entries(slugFreq).filter(([,c])=>c>=3);
  stuffed.length ? warn(N6,slug,'Keyword stuffing in URL slug.') : pass(N6,slug,'No URL slug stuffing.');

  /^\d+$/.test(slugParts[slugParts.length-1]||'') ? notice(N7,slug,'URL slug appears purely numeric.') : pass(N7,slug,'URL slug is descriptive.');

  return checks;
}

// ── O. Page Speed Signals ─────────────────────────────────────────────────────

function checksO($, rawHtml) {
  const O = (id,name) => makeResult(id,'Page Speed',name);
  const O1=O('O1','No render-blocking JS in head'); const O2=O('O2','No render-blocking CSS');
  const O3=O('O3','Image lazy loading'); const O4=O('O4','Image dimensions specified');
  const O5=O('O5','No large inline base64 images'); const O6=O('O6','Preconnect for third-party domains');
  const O7=O('O7','Preload for critical resources'); const O8=O('O8','HTML document size acceptable');

  const blockingJS = $('head script[src]').filter((_, el) => !$(el).attr('async') && !$(el).attr('defer')).length;
  blockingJS ? warn(O1,`${blockingJS}`,`${blockingJS} render-blocking script(s) in <head>.`) : pass(O1,null,'No render-blocking JS in head.');

  const blockingCSS = $('head link[rel="stylesheet"]:not([media])').length;
  blockingCSS ? warn(O2,`${blockingCSS}`,`${blockingCSS} potentially render-blocking CSS file(s).`) : pass(O2,null,'No render-blocking CSS.');

  const imgCount = $('img').length;
  const lazyCount = $('img[loading="lazy"]').length;
  imgCount > 3 && lazyCount === 0 ? warn(O3,'0 lazy',`${imgCount} images, none with loading="lazy".`) : pass(O3,`${lazyCount}/${imgCount}`,`${lazyCount}/${imgCount} images use lazy loading.`);

  const noDims = $('img').filter((_, el) => !$(el).attr('width') && !$(el).attr('height')).length;
  noDims ? warn(O4,`${noDims}`,`${noDims} image(s) missing dimensions.`) : pass(O4,null,'All images have dimensions.');

  const base64Imgs = $('img[src^="data:image"]').filter((_, el) => ($(el).attr('src')||'').length > 50000).length;
  base64Imgs ? warn(O5,`${base64Imgs}`,`${base64Imgs} large base64 image(s).`) : pass(O5,null,'No large base64 images.');

  const thirdPartyDomains = new Set();
  $('[src^="http"], [href^="http"]').each((_, el) => {
    const url = $(el).attr('src') || $(el).attr('href') || '';
    try { thirdPartyDomains.add(new URL(url).hostname); } catch {}
  });
  const preconnects = new Set();
  $('link[rel="preconnect"]').each((_, el) => {
    try { preconnects.add(new URL($(el).attr('href')||'').hostname); } catch {}
  });
  const missing = [...thirdPartyDomains].filter(d => !preconnects.has(d)).length;
  missing > 0 ? notice(O6,`${missing} domain(s)`,`${missing} third-party domain(s) without preconnect hint.`) : pass(O6,null,'Third-party domains have preconnect hints.');

  const firstMainImg = $('main img, article img').first().attr('src') || '';
  const hasPreload = $('link[rel="preload"][as="image"]').length > 0;
  firstMainImg && !hasPreload ? notice(O7,firstMainImg,'LCP candidate image lacks <link rel="preload">.') : pass(O7,null,'Preload hint for critical image found or not applicable.');

  const sizeKB = Math.round(rawHtml.length / 1024);
  sizeKB > 100 ? warn(O8,`${sizeKB}KB`,`HTML is ${sizeKB}KB — over 100KB.`) : pass(O8,`${sizeKB}KB`,`HTML size: ${sizeKB}KB.`);

  return [O1,O2,O3,O4,O5,O6,O7,O8];
}

// ── P. Semantic HTML ──────────────────────────────────────────────────────────

function checksP($) {
  const P = (id,name) => makeResult(id,'Semantic HTML',name);
  const P1=P('P1','<main> element present'); const P2=P('P2','<nav> element present');
  const P3=P('P3','<header> element present'); const P4=P('P4','<footer> element present');
  const P5=P('P5','<article> wraps editorial content'); const P6=P('P6','<section> used');
  const P7=P('P7','Semantic HTML ratio'); const P8=P('P8','Data tables use proper structure');
  const P9=P('P9','No layout tables'); const P10=P('P10','Lists use ul/ol properly');
  const P11=P('P11','<figure> + <figcaption> used');

  $('main').length ? pass(P1,null,'<main> element present.') : warn(P1,null,'No <main> element — important for accessibility and SEO.');
  $('nav').length ? pass(P2,null,'<nav> element present.') : notice(P2,null,'No <nav> element found.');
  $('header').length ? pass(P3,null,'<header> element present.') : notice(P3,null,'No <header> element found.');
  $('footer').length ? pass(P4,null,'<footer> element present.') : notice(P4,null,'No <footer> element found.');
  $('article').length ? pass(P5,null,'<article> element present.') : notice(P5,null,'No <article> element — consider wrapping editorial content.');
  $('section').length ? info(P6,`${$('section').length}`,`${$('section').length} <section> element(s).`) : info(P6,'0','No <section> elements.');

  const semanticCount = $('main, nav, header, footer, article, section, aside, figure').length;
  const divSpanCount = $('div, span').length;
  const ratio = divSpanCount > 0 ? semanticCount / divSpanCount : 1;
  ratio < 0.1 ? warn(P7,ratio.toFixed(3),`Semantic ratio is ${ratio.toFixed(3)} — heavy use of div/span.`) : pass(P7,ratio.toFixed(3),`Semantic HTML ratio: ${ratio.toFixed(3)}.`);

  const badTables = $('table').filter((_, el) => $(el).find('th').length === 0).length;
  badTables ? warn(P8,`${badTables}`,`${badTables} table(s) without <th> headers.`) : pass(P8,null,'All tables use <th> headers.');

  $('table').filter((_, el) => $(el).find('th').length === 0 && $(el).find('td').length > 2).length
    ? warn(P9,null,'Possible layout table(s) detected.')
    : pass(P9,null,'No layout tables detected.');

  info(P10,null,'Faux list check — review manually if needed.');
  const figcaptions = $('figure figcaption').length;
  info(P11,`${figcaptions}`,`${figcaptions} figure/figcaption pairs.`);

  return [P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11];
}

// ── Q. Accessibility ──────────────────────────────────────────────────────────

function checksQ($) {
  const Q = (id,name) => makeResult(id,'Accessibility',name);
  const Q1=Q('Q1','All images have alt text'); const Q2=Q('Q2','Form inputs have labels');
  const Q3=Q('Q3','Buttons have accessible text'); const Q4=Q('Q4','Anchor tags not empty');
  const Q5=Q('Q5','iframes have title attribute'); const Q6=Q('Q6','Videos have captions');
  const Q7=Q('Q7','ARIA roles usage'); const Q8=Q('Q8','Skip navigation link');
  const Q9=Q('Q9','Language attribute set');

  const missingAlt = $('img').filter((_, el) => $(el).attr('alt') === undefined).length;
  missingAlt ? fail(Q1,'error',`${missingAlt}`,`${missingAlt} image(s) missing alt text.`) : pass(Q1,null,'All images have alt text.');

  const unlabelledInputs = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').filter((_, el) => {
    const id = $(el).attr('id');
    return !$(el).attr('aria-label') && (!id || $(`label[for="${id}"]`).length === 0);
  }).length;
  unlabelledInputs ? warn(Q2,`${unlabelledInputs}`,`${unlabelledInputs} input(s) without labels.`) : pass(Q2,null,'All form inputs have labels.');

  const emptyButtons = $('button').filter((_, el) => !$(el).text().trim() && !$(el).attr('aria-label') && !$(el).find('img[alt]').length).length;
  emptyButtons ? warn(Q3,`${emptyButtons}`,`${emptyButtons} button(s) without accessible text.`) : pass(Q3,null,'All buttons have accessible text.');

  const emptyAnchors = $('a[href]').filter((_, el) => !$(el).text().trim() && !$(el).find('img[alt]').length).length;
  emptyAnchors ? warn(Q4,`${emptyAnchors}`,`${emptyAnchors} anchor tag(s) without text.`) : pass(Q4,null,'No empty anchors.');

  const iframesNoTitle = $('iframe').filter((_, el) => !$(el).attr('title')).length;
  iframesNoTitle ? warn(Q5,`${iframesNoTitle}`,`${iframesNoTitle} iframe(s) without title attribute.`) : pass(Q5,null,'All iframes have title attributes.');

  const videosNoCaptions = $('video').filter((_, el) => $(el).find('track[kind="captions"]').length === 0).length;
  videosNoCaptions ? warn(Q6,`${videosNoCaptions}`,`${videosNoCaptions} video(s) without captions track.`) : pass(Q6,null,'All videos have captions.');

  const ariaCount = $('[aria-role], [aria-label], [aria-describedby], [role]').length;
  info(Q7,`${ariaCount}`,`${ariaCount} ARIA attribute(s) found.`);

  $('a[href="#main"], a[href="#content"], a[href="#maincontent"]').first().length
    ? pass(Q8,null,'Skip navigation link found.')
    : notice(Q8,null,'No skip navigation link found.');

  const htmlLang = $('html').attr('lang') || '';
  htmlLang ? pass(Q9,htmlLang,'HTML lang attribute set.') : fail(Q9,'error',null,'HTML lang attribute missing.');

  return [Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8,Q9];
}

// ── R. E-E-A-T Signals ────────────────────────────────────────────────────────

function checksR($, rawHtml) {
  const R = (id,name) => makeResult(id,'E-E-A-T',name);
  const R1=R('R1','Named author byline'); const R2=R('R2','Author bio page linked');
  const R3=R('R3','Author credentials visible'); const R4=R('R4','Publication date visible');
  const R5=R('R5','Last updated date visible'); const R6=R('R6','Professional license mentioned');
  const R7=R('R7','External links to regulatory sources'); const R8=R('R8','About page linked');
  const R9=R('R9','Contact information present'); const R10=R('R10','Privacy policy linked');
  const R11=R('R11','Editorial or review policy linked');

  const hasAuthor = /rel=["']author["']|class=["'][^"']*author[^"']*["']|written\s+by|by\s+[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(rawHtml);
  hasAuthor ? pass(R1,null,'Author byline detected.') : warn(R1,null,'No author byline (E-E-A-T signal missing).');

  const authorLink = $('[rel="author"] a, [class*="author"] a').first().attr('href') || '';
  authorLink && (authorLink.includes('/author/') || authorLink.includes('/about/'))
    ? pass(R2,authorLink,'Author links to bio page.') : warn(R2,null,'Author does not link to bio page.');

  const credentialPattern = /\b(MD|PhD|CPA|JD|MBA|RN|CEO|Founder|Director|Professor)\b/;
  credentialPattern.test(rawHtml) ? pass(R3,null,'Author credentials detected.') : notice(R3,null,'No professional credentials detected near author.');

  const datePattern = /\b(20\d{2})\b/;
  datePattern.test(rawHtml) ? pass(R4,null,'Date found on page.') : notice(R4,null,'No publication date detected.');

  /last\s+updated|updated\s+on|last\s+modified/i.test(rawHtml) ? pass(R5,null,'"Last updated" signal found.') : notice(R5,null,'No "last updated" date found.');
  /license\s+#|license\s+number|board\s+certified/i.test(rawHtml) ? pass(R6,null,'Professional license mentioned.') : notice(R6,null,'No professional license reference found (relevant for YMYL).');

  const regLinks = $('a[href]').filter((_, el) => AUTHORITATIVE_DOMAINS.some(d => ($(el).attr('href')||'').includes(d))).length;
  regLinks > 0 ? pass(R7,`${regLinks}`,`${regLinks} regulatory/authoritative outbound link(s).`) : notice(R7,'0','No links to regulatory or authoritative sources.');

  $('a[href*="/about"]').length ? pass(R8,null,'About page linked.') : notice(R8,null,'No About page link found.');

  const hasPhone = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(rawHtml);
  const hasEmail = $('a[href^="mailto:"]').length > 0 || $('a[href^="tel:"]').length > 0;
  hasPhone || hasEmail ? pass(R9,null,'Contact information found.') : warn(R9,null,'No contact information detected.');

  $('a[href*="privacy"]').length || /privacy policy/i.test(rawHtml)
    ? pass(R10,null,'Privacy policy linked.') : notice(R10,null,'No privacy policy link found.');

  /editorial policy|review policy|fact.?check/i.test(rawHtml)
    ? pass(R11,null,'Editorial/review policy found.') : notice(R11,null,'No editorial or review policy link.');

  return [R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11];
}

// ── S. Security Signals ───────────────────────────────────────────────────────

function checksS($, rawHtml) {
  const S = (id,name) => makeResult(id,'Security',name);
  const S1=S('S1','No mixed content'); const S2=S('S2','No frames loading external HTTP');
  const S3=S('S3','No unrecognized third-party scripts'); const S4=S('S4','No hidden content blocks');
  const S5=S('S5','No obfuscated links'); const S6=S('S6','HTML comments: no sensitive data');

  const mixedContent = $('img[src^="http://"], script[src^="http://"], link[href^="http://"]').length;
  mixedContent ? fail(S1,'error',`${mixedContent}`,`${mixedContent} mixed content reference(s).`) : pass(S1,null,'No mixed content.');

  const httpIframes = $('iframe[src^="http://"]').length;
  httpIframes ? warn(S2,`${httpIframes}`,`${httpIframes} iframe(s) loading external HTTP content.`) : pass(S2,null,'No external HTTP iframes.');

  const knownCDNs = /googletagmanager|google-analytics|googlefonts|googleapis|jquery|cloudflare|jsdelivr|unpkg|bootstrapcdn|cdnjs|fontawesome/i;
  const unknownScripts = $('script[src]').filter((_, el) => {
    const src = $(el).attr('src')||'';
    return src.startsWith('http') && !knownCDNs.test(src);
  }).length;
  unknownScripts > 0 ? notice(S3,`${unknownScripts}`,`${unknownScripts} unrecognized third-party script(s).`) : pass(S3,null,'All scripts from known CDNs/sources.');

  const hiddenBlocks = $('[style]').filter((_, el) => {
    const s = ($(el).attr('style')||'').replace(/\s/g,'').toLowerCase();
    return (s.includes('display:none') || s.includes('visibility:hidden')) && wordCount($(el).text()) > 20;
  }).length;
  hiddenBlocks ? fail(S4,'error',`${hiddenBlocks}`,`${hiddenBlocks} hidden text block(s) with >20 words.`) : pass(S4,null,'No hidden text blocks.');

  const obfLinks = $('a[href]').filter((_, el) => {
    const href = $(el).attr('href')||'';
    return /[?&](ref|aff|affiliate|redirect)=|\/go\/|\/out\//i.test(href) || /^data:/i.test(href);
  }).length;
  obfLinks ? warn(S5,`${obfLinks}`,`${obfLinks} potentially obfuscated/affiliate link(s).`) : pass(S5,null,'No obfuscated links detected.');

  const comments = [];
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let m;
  const sensitivePatterns = /api[_-]?key|password|secret|token|admin|todo|internal|email.*@/i;
  while ((m = commentRegex.exec(rawHtml)) !== null) {
    if (sensitivePatterns.test(m[1])) comments.push(m[1].substring(0,40));
  }
  comments.length ? notice(S6,`${comments.length} comment(s)`,`${comments.length} HTML comment(s) may contain sensitive data.`) : pass(S6,null,'No sensitive data in HTML comments.');

  return [S1,S2,S3,S4,S5,S6];
}

// ── T. GEO-Specific Signals ───────────────────────────────────────────────────

function checksT($, rawHtml, geoData) {
  const T = (id,name) => makeResult(id,'GEO Signals',name);
  const T1=T('T1','JavaScript-content ratio'); const T2=T('T2','Content is Q&A structured');
  const T3=T('T3','CSQAF score'); const T4=T('T4','dateModified schema present and recent');
  const T5=T('T5','VideoObject schema on video page'); const T6=T('T6','Video transcript on page');
  const T7=T('T7','llms.txt referenced'); const T8=T('T8','Content word count in GEO sweet spot');
  const T9=T('T9','Page targets single focused topic'); const T10=T('T10','sameAs entity linking ≥3');

  const visText = visibleText(cheerio.load(rawHtml));
  const jsRatio = rawHtml.length > 0 ? (visText.length / rawHtml.length * 100) : 0;
  jsRatio < 15 ? warn(T1,`${jsRatio.toFixed(1)}%`,`Visible text is ${jsRatio.toFixed(1)}% of HTML — page may be JS-rendered (GEO crawl risk).`) : pass(T1,`${jsRatio.toFixed(1)}%`,`Text-to-HTML ratio: ${jsRatio.toFixed(1)}%.`);

  const qCount = $('h2,h3').filter((_, el) => $(el).text().trim().endsWith('?')).length;
  const faqEl = $('[class*="faq"],[id*="faq"]').length;
  const t2Score = qCount + faqEl;
  t2Score > 0 ? pass(T2,`${t2Score} signals`,`${qCount} question headings + ${faqEl} FAQ blocks.`) : notice(T2,'0','No Q&A structure detected.');

  const csqaf = geoData?.csqaf_score || 0;
  csqaf < 4 ? warn(T3,`${csqaf}/10`,`CSQAF score ${csqaf}/10 — below threshold (GEO not ready).`) :
  csqaf >= 7 ? pass(T3,`${csqaf}/10`,`CSQAF score ${csqaf}/10 — GEO ready.`) :
  notice(T3,`${csqaf}/10`,`CSQAF score ${csqaf}/10 — GEO needs work.`);

  const schemaBlocks = $('script[type="application/ld+json"]').map((_, el) => {
    try { return JSON.parse($(el).html()||'{}'); } catch { return {}; }
  }).get();
  const articleSchema = schemaBlocks.find(s => ['Article','BlogPosting','NewsArticle'].includes(s['@type']));
  if (articleSchema?.dateModified) {
    const daysOld = (Date.now() - new Date(articleSchema.dateModified).getTime()) / 86400000;
    daysOld < 365 ? pass(T4,articleSchema.dateModified,`dateModified is ${Math.round(daysOld)} days old.`) : warn(T4,articleSchema.dateModified,`dateModified is ${Math.round(daysOld)} days old — over 365 days.`);
  } else { warn(T4,null,'No dateModified in schema (GEO freshness signal missing).'); }

  const hasVideoEmbed = $('iframe[src*="youtube.com"], iframe[src*="vimeo.com"]').length > 0;
  const hasVideoSchema = schemaBlocks.some(s => s['@type'] === 'VideoObject');
  if (hasVideoEmbed && !hasVideoSchema) warn(T5,null,'Video embed found without VideoObject schema.');
  else if (hasVideoSchema) pass(T5,null,'VideoObject schema present.');
  else info(T5,null,'No video content detected.');

  const videoText = $('div,section').filter((_, el) => {
    const text = $(el).text().trim();
    return text.length > 500 && $(el).prev('iframe').length > 0;
  }).length;
  videoText ? pass(T6,null,'Video transcript text block detected.') : notice(T6,null,'No video transcript detected near video embed.');

  // CHANGE 9 — §1.10: T7 llms.txt absence is notice not pass
  const hasLlms = $('a[href*="llms.txt"]').length > 0 || /llms\.txt/i.test(rawHtml);
  hasLlms
    ? pass(T7, null, 'llms.txt referenced in page HTML.')
    : notice(T7, null, 'llms.txt not referenced. Adding /llms.txt is a low-effort GEO signal for AI engine prioritization.');

  const wc = wordCount(visText);
  wc >= 800 && wc <= 1500 ? pass(T8,`${wc}`,`Word count ${wc} is in GEO sweet spot (800–1,500).`) :
  wc < 300 ? fail(T8,'error',`${wc}`,'Under 300 words — too thin for GEO.') :
  wc > 3000 ? notice(T8,`${wc}`,`${wc} words — over 3,000 is a GEO grounding budget risk.`) :
  info(T8,`${wc}`,`Word count: ${wc}.`);

  info(T9,null,'Topic focus check — review H1/H2 alignment manually.');

  const orgSchema = schemaBlocks.find(s => ['Organization','LocalBusiness'].includes(s['@type']));
  const sameAsCount = (orgSchema?.sameAs || []).length;
  sameAsCount >= 3 ? pass(T10,`${sameAsCount}`,`sameAs has ${sameAsCount} profiles (≥3 required).`) : warn(T10,`${sameAsCount}`,`sameAs has only ${sameAsCount} profile(s) — add ≥3 authoritative profiles.`);

  return [T1,T2,T3,T4,T5,T6,T7,T8,T9,T10];
}

// ── U. Miscellaneous ──────────────────────────────────────────────────────────

function checksU($, rawHtml) {
  const U = (id,name) => makeResult(id,'Miscellaneous',name);
  const U1=U('U1','Favicon declared'); const U2=U('U2','RSS/Atom feed linked');
  const U3=U('U3','Breadcrumb visible in HTML'); const U4=U('U4','HTML comments: sensitive data');
  const U5=U('U5','Excessive affiliate links'); const U6=U('U6','Total link count');
  const U7=U('U7','Encoding declared'); const U8=U('U8','llms.txt referenced');

  $('link[rel="icon"], link[rel="shortcut icon"]').length ? pass(U1,null,'Favicon declared.') : notice(U1,null,'No favicon link found in <head>.');
  $('link[rel="alternate"][type="application/rss+xml"]').length ? info(U2,null,'RSS/Atom feed linked.') : info(U2,null,'No RSS/Atom feed linked.');
  $('[class*="breadcrumb"], nav[aria-label*="breadcrumb"], [id*="breadcrumb"]').length ? pass(U3,null,'Breadcrumb element detected.') : notice(U3,null,'No breadcrumb detected.');

  const sensitiveComments = [];
  const cr = /<!--([\s\S]*?)-->/g; let cm;
  while ((cm = cr.exec(rawHtml)) !== null) {
    if (/api[_-]?key|password|secret|token|admin|todo|email.*@/i.test(cm[1])) sensitiveComments.push(cm[1].substring(0,30));
  }
  sensitiveComments.length ? notice(U4,`${sensitiveComments.length}`,`${sensitiveComments.length} HTML comment(s) may contain sensitive data.`) : pass(U4,null,'No sensitive HTML comments.');

  const affiliateLinks = $('a[href]').filter((_, el) => /[?&](ref|aff|affiliate)=|shareasale|clickbank|cj\.com/i.test($(el).attr('href')||'')).length;
  affiliateLinks > 10 ? warn(U5,`${affiliateLinks}`,`${affiliateLinks} affiliate link(s) — over 10 may look spammy.`) : info(U5,`${affiliateLinks}`,`${affiliateLinks} affiliate link(s).`);

  const totalLinks = $('a[href]').length;
  totalLinks > 100 ? warn(U6,`${totalLinks}`,`${totalLinks} total links — over 100.`) : info(U6,`${totalLinks}`,`${totalLinks} total links.`);

  $('meta[charset]').length ? pass(U7,$('meta[charset]').attr('charset'),'Encoding declared.') : warn(U7,null,'No charset declaration.');

  // CHANGE 9 — §1.10: U8 llms.txt absence is notice not pass
  /llms\.txt/i.test(rawHtml)
    ? pass(U8, null, 'llms.txt referenced.')
    : notice(U8, null, 'llms.txt not referenced on page.');

  return [U1,U2,U3,U4,U5,U6,U7,U8];
}

// ── Score calculation ─────────────────────────────────────────────────────────

// CHANGE 10 — §1.11: GEO Signals score formula fix
function calculateScores(checks) {
  function categoryScore(cats) {
    const relevant = checks.filter(c => cats.includes(c.category) && c.status !== 'skipped' && c.status !== 'na');
    const total = relevant.length;
    if (total === 0) return 100;
    let score = 0;
    for (const c of relevant) {
      if (c.status === 'pass') score += 100;
      else if (c.status === 'warning') score += 50;
      else if (c.status === 'notice') score += 75;
      // fail/error = 0
    }
    return Math.max(0, Math.min(100, Math.round(score / total)));
  }

  // GEO weighted score
  const GEO_CHECK_WEIGHTS = { T1:15, T2:10, T3:20, T4:15, T5:5, T6:5, T7:5, T8:10, T9:10, T10:5 };
  function geoWeightedScore() {
    const geoChecks = checks.filter(c => c.category === 'GEO Signals' && c.status !== 'skipped' && c.status !== 'na');
    let weightedSum = 0, totalWeight = 0;
    for (const c of geoChecks) {
      const w = GEO_CHECK_WEIGHTS[c.id] || 5;
      totalWeight += w;
      if (c.status === 'pass') weightedSum += w * 100;
      else if (c.status === 'warning') weightedSum += w * 50;
      else if (c.status === 'notice') weightedSum += w * 75;
    }
    return totalWeight > 0 ? Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight))) : 100;
  }

  const allNonSkipped = checks.filter(c => c.status !== 'skipped' && c.status !== 'na');
  const totalErrors = allNonSkipped.filter(c => c.status === 'fail' && c.severity === 'error').length;
  const totalWarnings = allNonSkipped.filter(c => c.status === 'fail' || c.status === 'warning').length;
  const totalNotices = allNonSkipped.filter(c => c.status === 'notice').length;
  const totalPassed = allNonSkipped.filter(c => c.status === 'pass').length;
  const deductions = totalErrors * 8 + totalWarnings * 3 + totalNotices * 0.5;
  const overall = Math.max(0, Math.min(100, Math.round(100 - (allNonSkipped.length > 0 ? (deductions / allNonSkipped.length) * 100 : 0))));

  return {
    overall,
    title_meta: categoryScore(['Title Tag','Meta Description']),
    content_structure: categoryScore(['Headings','Content Quality','Semantic HTML']),
    technical: categoryScore(['Technical','URL Signals','Page Speed']),
    schema: categoryScore(['Schema']),
    geo_signals: geoWeightedScore(),
    eeat: categoryScore(['E-E-A-T']),
    counts: { errors: totalErrors, warnings: totalWarnings, notices: totalNotices, passed: totalPassed }
  };
}

// ── §2: Page type detection (rule-based) ─────────────────────────────────────

const URL_PAGE_TYPE_PATTERNS = [
  { type: 'homepage',  pattern: /^https?:\/\/[^\/]+\/?$/ },
  { type: 'article',   pattern: /\/(blog|news|article|post|editorial|insight|story|press)\// },
  { type: 'article',   pattern: /\/(blog|news|article|post)s?\/[^\/]+\/?$/ },
  { type: 'location',  pattern: /\/(location|office|branch|store|clinic|venue|outlet|practice|dental-office|dental-offices)\// },
  { type: 'location',  pattern: /\/[a-z]{2}\/[a-z-]+\/?$/ },
  { type: 'service',   pattern: /\/(service|treatment|procedure|offering|solution|therapy)\// },
  { type: 'product',   pattern: /\/(product|item|shop|buy|purchase|catalog)\// },
  { type: 'category',  pattern: /\/(category|cat|collection|department)\// },
  { type: 'about',     pattern: /\/(about|about-us|our-story|company|who-we-are)\/?$/ },
  { type: 'contact',   pattern: /\/(contact|contact-us|get-in-touch|reach-us)\/?$/ },
  { type: 'faq',       pattern: /\/(faq|faqs|frequently-asked|help|support)\// },
  { type: 'resource',  pattern: /\/(resource|guide|whitepaper|ebook|case-study|report|template|checklist)\// },
  { type: 'team',      pattern: /\/(team|staff|people|doctors|physicians|attorneys|our-team)\// },
  { type: 'pricing',   pattern: /\/(pricing|plans|packages|rates|fees)\/?$/ },
  { type: 'landing',   pattern: /\/(lp|landing|campaign)\// },
];

function detectPageType($, pageUrl, parsedSchemas) {
  let pageType = 'other';
  let confidence = 0.5;

  // Stage 1a: URL patterns
  if (pageUrl) {
    for (const { type, pattern } of URL_PAGE_TYPE_PATTERNS) {
      if (pattern.test(pageUrl)) { pageType = type; confidence = 0.7; break; }
    }
  }

  // Stage 1b: DOM signals override/confirm
  const schemaTypes = new Set(parsedSchemas.flatMap(s => [].concat(s['@type'] || [])));
  const hasLocalBusiness = [...schemaTypes].some(t => LOCAL_BUSINESS_SUBTYPES.has(t));
  const hasArticle = schemaTypes.has('Article') || schemaTypes.has('BlogPosting') || schemaTypes.has('NewsArticle');
  const hasProduct = schemaTypes.has('Product');

  const hasMap = $('iframe[src*="google.com/maps"], iframe[src*="maps.google"]').length > 0;
  const hasOpeningHours = /opening hours|hours of operation|mon.*fri|monday.*friday/i.test($('body').text());
  const hasAddress = $('[class*="address"], [itemprop="address"]').length > 0 || /PostalAddress/i.test(JSON.stringify(parsedSchemas));
  const hasArticleEl = $('article').length > 0;
  const hasAuthorByline = $('[rel="author"], [class*="byline"], [class*="author"]').length > 0;
  const hasTimeEl = $('time[datetime]').length > 0;

  if (hasLocalBusiness && (hasMap || hasAddress || hasOpeningHours)) { pageType = 'location'; confidence = 0.9; }
  else if (hasArticle || (hasArticleEl && hasAuthorByline && hasTimeEl)) { pageType = 'article'; confidence = 0.85; }
  else if (hasProduct) { pageType = 'product'; confidence = 0.85; }

  // Extract context
  const allSchemaJson = JSON.stringify(parsedSchemas).toLowerCase();
  const hasMedicalContent = [...schemaTypes].some(t => ['Dentist','Physician','MedicalOrganization','Hospital','MedicalClinic','Pharmacy'].includes(t))
    || /medical|dental|dentist|physician|clinic|healthcare|patient/i.test($('body').text().substring(0, 2000));
  const hasLegalContent = [...schemaTypes].some(t => ['Attorney','LegalService'].includes(t));
  const hasFinancialContent = [...schemaTypes].some(t => ['FinancialService','AccountingService','InsuranceAgency'].includes(t));

  const brandName = parsedSchemas.find(s => s['@type'] === 'Organization' || LOCAL_BUSINESS_SUBTYPES.has(s['@type']))?.name
    || $('meta[property="og:site_name"]').attr('content')
    || (() => { const t = $('title').first().text(); const segs = t.split(/[|\-–]/); return segs.length > 1 ? segs[segs.length-1].trim() : ''; })()
    || '';

  const h1Text = $('h1').first().text().trim();
  const cityMatch = pageUrl?.match(/\/([a-z]+)(?:\/[a-z-]+)?$/) || h1Text.match(/\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);

  return {
    pageType,
    pageTypeConfidence: confidence,
    brandName: brandName.substring(0, 60),
    primaryCity: cityMatch ? cityMatch[1] : '',
    primaryService: h1Text.split(/\s+/).slice(0, 4).join(' '),
    hasEcommerce: hasProduct,
    hasMedicalContent,
    hasLegalContent,
    hasFinancialContent,
    isYMYL: hasMedicalContent || hasLegalContent || hasFinancialContent,
    detectedVertical: hasMedicalContent ? 'healthcare' : hasLegalContent ? 'legal' : hasFinancialContent ? 'finance' : hasProduct ? 'ecommerce' : 'other',
    keywords: [], // filled in by caller
  };
}

// ── §5: Schema detection + recommendation engine ──────────────────────────────

function extractSchemaBlocks($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '');
      if (parsed['@graph']) blocks.push(...parsed['@graph']);
      else if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch { blocks.push({ _parseError: true }); }
  });
  return blocks;
}

function getSchemaRecommendations(pageType, pageContext, detectedElements, detectedTypes) {
  const detected = new Set(detectedTypes);
  const recs = [];
  const add = (type, source, priority) => { if (!detected.has(type)) recs.push({ type, source, priority }); };

  const pageTypeSchemas = {
    homepage:  [['Organization','required'],['WebSite','required']],
    location:  [[pageContext.hasMedicalContent ? 'Dentist' : 'LocalBusiness','required'],['GeoCoordinates','recommended']],
    service:   [['Service','recommended']],
    article:   [['Article','required'],['Person','recommended'],['BreadcrumbList','recommended']],
    blog:      [['BlogPosting','required'],['Person','recommended'],['BreadcrumbList','recommended']],
    product:   [['Product','required'],['Offer','required'],['AggregateRating','recommended']],
    about:     [['Organization','required'],['AboutPage','recommended'],['Person','recommended']],
    contact:   [['ContactPage','recommended'],['PostalAddress','recommended']],
    faq:       [['FAQPage','required']],
    resource:  [['Article','recommended'],['HowTo','optional'],['BreadcrumbList','recommended']],
    guide:     [['HowTo','recommended'],['BreadcrumbList','recommended']],
    team:      [['Person','recommended']],
    pricing:   [['Offer','recommended']],
  };
  for (const [type, priority] of (pageTypeSchemas[pageType] || [])) add(type, 'page_type', priority);

  if (detectedElements.hasPhone || detectedElements.hasAddress) add('ContactPoint','element','recommended');
  if (detectedElements.hasOpeningHours) add('OpeningHoursSpecification','element','recommended');
  if (detectedElements.hasFAQSection) add('FAQPage','element','recommended');
  if (detectedElements.hasVideoEmbed) add('VideoObject','element','recommended');
  if (detectedElements.hasReviewText) add('AggregateRating','element','recommended');
  if (detectedElements.hasBreadcrumb) add('BreadcrumbList','element','recommended');
  if (detectedElements.hasAuthorByline) add('Person','element','recommended');
  if (detectedElements.hasSocialLinks) add('sameAs (within Organization)','element','recommended');
  if (detectedElements.hasMapEmbed) add('GeoCoordinates','element','recommended');
  if (detectedElements.hasNumberedSteps) add('HowTo','element','optional');
  if (pageContext.hasMedicalContent) { add('MedicalOrganization','ymyl','recommended'); }
  if (pageContext.hasLegalContent) add('LegalService','ymyl','required');
  if (pageContext.hasFinancialContent) add('FinancialService','ymyl','required');

  const seen = new Set();
  return recs.filter(r => { if (seen.has(r.type)) return false; seen.add(r.type); return true; });
}

function detectPageElements($, rawHtml) {
  return {
    hasPhone: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(rawHtml),
    hasAddress: $('[itemprop="address"], [class*="address"]').length > 0,
    hasOpeningHours: /opening hours|hours of operation|mon.*-.*fri/i.test($('body').text()),
    hasFAQSection: $('[class*="faq"],[id*="faq"]').length > 0 || $('h2,h3').filter((_, el) => /faq|frequently asked/i.test($(el).text())).length > 0,
    hasVideoEmbed: $('iframe[src*="youtube.com"], iframe[src*="vimeo.com"]').length > 0,
    hasImages: $('img').length > 0,
    imageCount: $('img').length,
    hasReviewText: $('[class*="review"], [class*="rating"], [itemprop="review"]').length > 0 || $('[class*="star"]').length > 0,
    hasStarRating: $('[class*="star"],[data-rating]').length > 0,
    hasBreadcrumb: $('[class*="breadcrumb"],[aria-label*="breadcrumb"]').length > 0,
    hasAuthorByline: $('[rel="author"],[class*="author"],[class*="byline"]').length > 0,
    hasStaffSection: $('[class*="team"],[class*="staff"],[class*="doctor"],[class*="provider"]').length > 0,
    hasSocialLinks: $('a[href*="facebook.com"], a[href*="twitter.com"], a[href*="linkedin.com"], a[href*="instagram.com"]').length > 0,
    hasMapEmbed: $('iframe[src*="maps.google"], iframe[src*="google.com/maps"]').length > 0,
    hasGeoCoords: /latitude|longitude|GeoCoordinates/i.test(rawHtml),
    hasInsuranceText: /insurance|insured|accepts.*insurance/i.test(rawHtml),
    hasNumberedSteps: $('ol li').length >= 3 || /step\s+\d/i.test($('h2,h3').text()),
    hasPriceRange: /\$\d|\bprice range\b/i.test(rawHtml),
    hasEventText: /event|appointment|schedule|webinar/i.test(rawHtml),
  };
}

// ── §3: Keyword check suite ───────────────────────────────────────────────────

function generateVariants(keyword) {
  const stopWords = new Set(['in','near','the','a','an','of','for','at','by','on','with']);
  const words = keyword.toLowerCase().split(/\s+/);
  const variants = new Set([keyword.toLowerCase()]);
  const sigWords = words.filter(w => !stopWords.has(w));
  variants.add(sigWords.join(' '));
  // simple plural/singular
  for (const w of sigWords) {
    if (w.endsWith('s')) variants.add(keyword.replace(w, w.slice(0,-1)));
    else variants.add(keyword.replace(w, w + 's'));
  }
  return [...variants].filter(v => v.length > 0);
}

function keywordPresent(text, keyword) {
  const variants = generateVariants(keyword);
  const lowerText = text.toLowerCase();
  return variants.some(v => lowerText.includes(v));
}

function checksKW($, rawHtml, keywords) {
  const results = [];
  const kw = keywords[0]; // primary keyword
  const kw2 = keywords[1] || null;

  const KW = (id, name) => makeResult(id, 'Keyword Analysis', name);

  const titleText = $('title').first().text().trim();
  const h1Text = $('h1').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const $clone = cheerio.load(rawHtml);
  $clone('script,style,noscript').remove();
  const bodyText = $clone('body').text().replace(/\s+/g,' ').trim();
  const first100 = bodyText.split(/\s+/).slice(0, 100).join(' ');
  const h2Texts = $('h2').map((_, el) => $(el).text()).get().join(' ');
  const allHeadings = $('h1,h2,h3,h4,h5,h6').map((_, el) => $(el).text()).get();
  const imgAlts = $('img[alt]').map((_, el) => $(el).attr('alt')).get().join(' ');
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDesc = $('meta[property="og:description"]').attr('content') || '';

  const KW1 = KW('KW1','Primary keyword in title tag');
  keywordPresent(titleText, kw) ? pass(KW1, titleText.substring(0,80), 'Keyword found in title.') : fail(KW1,'error',titleText.substring(0,80),`Keyword "${kw}" not found in title.`);

  const KW2 = KW('KW2','Primary keyword in H1');
  keywordPresent(h1Text, kw) ? pass(KW2, h1Text.substring(0,80), 'Keyword found in H1.') : fail(KW2,'error',h1Text.substring(0,80),`Keyword "${kw}" not found in H1.`);

  const KW3 = KW('KW3','Primary keyword in meta description');
  keywordPresent(metaDesc, kw) ? pass(KW3, metaDesc.substring(0,80), 'Keyword found in meta description.') : warn(KW3, metaDesc.substring(0,80), `Keyword "${kw}" not found in meta description.`);

  const KW4 = KW('KW4','Keyword in first 100 words');
  keywordPresent(first100, kw) ? pass(KW4, first100.substring(0,80), 'Keyword found in first 100 words.') : warn(KW4, first100.substring(0,80), `Keyword "${kw}" not found in first 100 words.`);

  const KW5 = KW('KW5','Keyword in URL slug');
  const urlPath = (() => { try { return new URL(rawHtml.match(/https?:\/\/[^\s"'>]+/)?.[0] || '').pathname; } catch { return ''; } })();
  const kwSlug = kw.split(' ')[0]; // primary noun
  urlPath && urlPath.toLowerCase().includes(kwSlug.toLowerCase())
    ? pass(KW5, urlPath, 'Keyword found in URL slug.')
    : warn(KW5, urlPath || '(URL not available)', `Primary keyword not found in URL slug.`);

  const KW6 = KW('KW6','Keyword in at least one H2');
  keywordPresent(h2Texts, kw) ? pass(KW6, h2Texts.substring(0,80), 'Keyword found in H2.') : warn(KW6, h2Texts.substring(0,80), `Keyword "${kw}" not found in any H2.`);

  const KW7 = KW('KW7','Keyword in image alt text');
  keywordPresent(imgAlts, kw) ? pass(KW7, imgAlts.substring(0,80), 'Keyword found in image alt text.') : notice(KW7, imgAlts.substring(0,80), `Keyword "${kw}" not found in any image alt text.`);

  const wc = wordCount(bodyText);
  const kwOccurrences = generateVariants(kw).reduce((acc, v) => {
    const regex = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
    return acc + (bodyText.match(regex) || []).length;
  }, 0);
  const density = wc > 0 ? (kwOccurrences / wc * 100) : 0;
  const KW8 = KW('KW8','Keyword density in body text');
  if (density >= 0.5 && density <= 3.0) pass(KW8, `${density.toFixed(1)}%`, `Keyword density ${density.toFixed(1)}% is within target range (0.5–3.0%).`);
  else if (density < 0.5) notice(KW8, `${density.toFixed(1)}%`, `Keyword density ${density.toFixed(1)}% is below 0.5% — page may be under-optimized.`);
  else warn(KW8, `${density.toFixed(1)}%`, `Keyword density ${density.toFixed(1)}% is above 3.0% — risk of over-optimization.`);

  const schemaText = $('script[type="application/ld+json"]').map((_, el) => $(el).html()).get().join(' ');
  const KW9 = KW('KW9','Keyword in schema name field');
  keywordPresent(schemaText, kw) ? pass(KW9, null, 'Keyword found in schema markup.') : notice(KW9, null, `Keyword "${kw}" not found in schema name fields.`);

  const KW10 = KW('KW10','Keyword in OG title');
  keywordPresent(ogTitle, kw) ? pass(KW10, ogTitle.substring(0,80), 'Keyword found in OG title.') : notice(KW10, ogTitle.substring(0,80), `Keyword "${kw}" not found in og:title.`);

  const KW11 = KW('KW11','Keyword in OG description');
  keywordPresent(ogDesc, kw) ? pass(KW11, ogDesc.substring(0,80), 'Keyword found in OG description.') : notice(KW11, ogDesc.substring(0,80), `Keyword "${kw}" not found in og:description.`);

  const KW12 = KW('KW12','Keyword variant coverage');
  const variants = generateVariants(kw);
  const foundVariants = variants.filter(v => bodyText.toLowerCase().includes(v));
  foundVariants.length >= 2 ? pass(KW12, foundVariants.slice(0,3).join(', '), `${foundVariants.length} keyword variants found in body.`) : notice(KW12, kw, `Only ${foundVariants.length} variant(s) found — add more natural variations.`);

  const KW13 = KW('KW13','Keyword not over-repeated in headings');
  const kwInHeadings = allHeadings.filter(h => keywordPresent(h, kw)).length;
  const kwHeadingPct = allHeadings.length > 0 ? kwInHeadings / allHeadings.length : 0;
  kwHeadingPct <= 0.4 ? pass(KW13, `${kwInHeadings}/${allHeadings.length} headings`, 'Keyword not over-repeated in headings.') : warn(KW13, `${kwInHeadings}/${allHeadings.length} headings (${Math.round(kwHeadingPct*100)}%)`, `Keyword appears in ${Math.round(kwHeadingPct*100)}% of headings — target ≤40%.`);

  const KW14 = KW('KW14','Keyword position in title');
  const kwPosInTitle = titleText.toLowerCase().indexOf(kw.toLowerCase());
  if (kwPosInTitle === -1) notice(KW14, titleText.substring(0,60), 'Keyword not found in title.');
  else if (kwPosInTitle <= 40) pass(KW14, `Position ${kwPosInTitle}`, `Keyword appears early in title (position ${kwPosInTitle} of ${titleText.length}).`);
  else notice(KW14, `Position ${kwPosInTitle}`, `Keyword appears late in title (position ${kwPosInTitle} — target ≤40 chars from start).`);

  results.push(KW1,KW2,KW3,KW4,KW5,KW6,KW7,KW8,KW9,KW10,KW11,KW12,KW13,KW14);

  // Second keyword if provided
  if (kw2) {
    const KW2_1 = KW('KW2_1',`Secondary keyword in title`);
    const KW2_2 = KW('KW2_2',`Secondary keyword in H1`);
    const KW2_3 = KW('KW2_3',`Secondary keyword in body`);
    keywordPresent(titleText, kw2) ? pass(KW2_1, titleText.substring(0,80), 'Secondary keyword in title.') : notice(KW2_1, titleText.substring(0,80), `Secondary keyword "${kw2}" not in title.`);
    keywordPresent(h1Text, kw2) ? pass(KW2_2, h1Text.substring(0,80), 'Secondary keyword in H1.') : notice(KW2_2, h1Text.substring(0,80), `Secondary keyword "${kw2}" not in H1.`);
    keywordPresent(bodyText, kw2) ? pass(KW2_3, null, 'Secondary keyword found in body.') : warn(KW2_3, null, `Secondary keyword "${kw2}" not found in body text.`);
    results.push(KW2_1, KW2_2, KW2_3);
  }

  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────

// CHANGE 15 — Updated runAllChecks signature and return value
async function runAllChecks(rawHtml, pageUrl, httpHeaders, keywords = []) {
  const $ = cheerio.load(rawHtml, { decodeEntities: false });

  // Extract schema blocks first (needed for page type detection)
  const parsedSchemas = extractSchemaBlocks($);
  const schemaTypes = parsedSchemas.flatMap(s => [].concat(s['@type'] || [])).filter(Boolean);

  // Page type detection
  const pageContext = detectPageType($, pageUrl, parsedSchemas);
  pageContext.keywords = keywords || [];

  // Detected elements
  const detectedElements = detectPageElements($, rawHtml);

  // Schema recommendations
  const schemaRecommendations = getSchemaRecommendations(
    pageContext.pageType, pageContext, detectedElements, schemaTypes
  );

  const a = checksA($);
  const b = checksB($);
  const c = checksC($, httpHeaders);
  const d = checksD($, pageUrl, httpHeaders);
  const e = checksE($);
  const fResult = checksF($, rawHtml);
  const f = fResult.checks;
  const geoData = fResult.geo;
  const g = checksG($);
  const h = checksH($, pageUrl);
  const i = checksI($, pageUrl);
  const j = checksJ($);
  const k = checksK($, pageUrl);
  const l = checksL($);
  const m = checksM($, rawHtml, httpHeaders);
  const n = checksN(pageUrl);
  const o = checksO($, rawHtml);
  const p = checksP($);
  const q = checksQ($);
  const r = checksR($, rawHtml);
  const s = checksS($, rawHtml);
  const t = checksT($, rawHtml, geoData);
  const u = checksU($, rawHtml);

  // Keyword checks (only when keywords provided)
  let kwChecks = [];
  if (keywords && keywords.length > 0) {
    kwChecks = checksKW($, rawHtml, keywords);
  }

  const allChecks = [...a,...b,...c,...d,...e,...f,...g,...h,...i,...j,...k,...l,...m,...n,...o,...p,...q,...r,...s,...t,...u,...kwChecks];
  const scores = calculateScores(allChecks);

  return {
    checks: allChecks,
    scores,
    geo: geoData,
    pageContext,
    detectedElements,
    detectedSchemas: parsedSchemas,
    schemaRecommendations,
    kwChecks,
  };
}

module.exports = { runAllChecks, batchHttpChecks, headRequest };
