'use strict';

const cheerio = require('cheerio');

const AUTHORITATIVE_DOMAINS = [
  '.gov', '.edu', 'nih.gov', 'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov',
  'cdc.gov', 'who.int', 'ada.org', 'nidcr.nih.gov', 'mayoclinic.org',
  'clevelandclinic.org', 'jamanetwork.com', 'thelancet.com', 'bmj.com',
  'nature.com', 'springer.com', 'sciencedirect.com',
];

const HEALTHCARE_CREDENTIALS = [
  'dds', 'dmd', 'md', 'do', 'phd', 'rdh', 'fagd', 'facd', 'orthodontist',
  'prosthodontist', 'periodontist', 'pediatric dentist', 'oral surgeon',
];

const STRUCTURE_ENTITIES = [
  'definition', 'symptoms', 'causes', 'risk factors', 'diagnosis', 'treatment',
  'prevention', 'cost', 'recovery', 'timeline', 'complications', 'types',
  'when to see', 'faq', 'frequently asked',
];

function visibleText($) {
  const clone = $.root().clone();
  clone.find('script, style, noscript, iframe, svg').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function result(id, category, name, status, severity, value, detail, recommendation) {
  return { id, category, name, status, severity, value, detail, recommendation };
}

function pass(id, category, name, value, detail) {
  return result(id, category, name, 'pass', 'info', value, detail, null);
}

function fail(id, category, name, severity, value, detail, recommendation) {
  return result(id, category, name, 'fail', severity, value, detail, recommendation);
}

function detectSchemaBlocks($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text() || '{}');
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...parsed['@graph']);
      else blocks.push(parsed);
    } catch {
      blocks.push({ _parseError: true });
    }
  });
  return blocks;
}

function schemaTypeList(blocks) {
  return blocks
    .flatMap(block => [].concat(block['@type'] || []))
    .filter(Boolean)
    .map(String);
}

function extractFaqs($) {
  const faqs = [];
  const seen = new Set();

  const add = text => {
    const q = normalize(text);
    if (!q || q.length < 8 || q.length > 220) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    if (q.includes('?') || /^(what|why|how|when|where|who|can|does|is|are|should)\b/i.test(q)) {
      seen.add(key);
      faqs.push(q);
    }
  };

  $('[itemtype*="FAQPage"] [itemprop="name"], details summary, [class*="faq"] h2, [class*="faq"] h3, [class*="faq"] h4, [id*="faq"] h2, [id*="faq"] h3, [id*="faq"] h4').each((_, el) => add($(el).text()));
  $('h2,h3,h4').each((_, el) => add($(el).text()));

  return faqs.slice(0, 12);
}

function countStatistics(text) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  return sentences.filter(sentence => {
    if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(sentence)) return false;
    if (/\d{5}(-\d{4})?/.test(sentence)) return false;
    return /\d+\.?\d*\s*%|\d+\s+(million|billion|thousand)|\d+\s+(out of|in every|per)\s+\d+|according to .*?\d/i.test(sentence);
  }).length;
}

function countExpertQuotes(text) {
  const quoteMatches = text.match(/"[^"]{40,220}"/g) || [];
  return quoteMatches.filter(q => /dr\.|doctor|dentist|expert|specialist|clinician|dds|dmd|md/i.test(q)).length;
}

function hasDirectAnswerOpening(paragraphs, h1) {
  const first = normalize(paragraphs[0] || '');
  if (!first) return false;
  const topicWords = normalize(h1).toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 4);
  const hasTopic = topicWords.length === 0 || topicWords.some(w => first.toLowerCase().includes(w));
  const answerShape = /\b(is|are|refers to|means|occurs when|happens when|defined as)\b/i.test(first);
  return first.length <= 450 && hasTopic && answerShape;
}

function linkHostname(href) {
  try { return new URL(href).hostname.toLowerCase(); } catch { return ''; }
}

function isAuthoritativeHref(href) {
  const host = linkHostname(href);
  if (!host) return false;
  return AUTHORITATIVE_DOMAINS.some(domain => host === domain || host.endsWith(domain));
}

function extractCitations($, pageUrl) {
  const pageHost = linkHostname(pageUrl || '');
  const external = [];
  const authoritative = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = normalize($(el).text());
    const host = linkHostname(href);
    if (!host || (pageHost && host.endsWith(pageHost))) return;
    const item = { href, text: text.substring(0, 120), host };
    external.push(item);
    if (isAuthoritativeHref(href)) authoritative.push(item);
  });

  return { external, authoritative };
}

function extractSignals($, rawHtml, pageUrl, primaryKeyword) {
  const bodyText = visibleText($);
  const title = normalize($('title').first().text());
  const metaDescription = normalize($('meta[name="description"]').first().attr('content'));
  const h1s = $('h1').map((_, el) => normalize($(el).text())).get().filter(Boolean);
  const h2s = $('h2').map((_, el) => normalize($(el).text())).get().filter(Boolean);
  const h3s = $('h3').map((_, el) => normalize($(el).text())).get().filter(Boolean);
  const headingOrder = $('h1,h2,h3,h4,h5,h6').map((_, el) => ({
    tag: el.tagName.toLowerCase(),
    text: normalize($(el).text()),
  })).get().filter(h => h.text);
  const paragraphs = $('p').map((_, el) => normalize($(el).text())).get().filter(t => t.length > 35);
  const schemaBlocks = detectSchemaBlocks($);
  const schemaTypes = schemaTypeList(schemaBlocks);
  const faqs = extractFaqs($);
  const citations = extractCitations($, pageUrl);
  const textLower = bodyText.toLowerCase();

  const authorText = normalize($('[rel="author"], [class*="author"], [class*="byline"], [itemprop="author"]').map((_, el) => $(el).text()).get().join(' '));
  const reviewerText = normalize($('[class*="reviewed"], [class*="reviewer"], [itemprop="reviewedBy"], [itemprop="reviewer"]').map((_, el) => $(el).text()).get().join(' '));
  const credentialText = `${authorText} ${reviewerText} ${bodyText.substring(0, 2500)}`.toLowerCase();
  const credentials = HEALTHCARE_CREDENTIALS.filter(c => credentialText.includes(c));
  const dateSignals = $('time[datetime], [itemprop="dateModified"], [itemprop="datePublished"], [class*="date"], [class*="updated"]').map((_, el) => normalize($(el).attr('datetime') || $(el).text())).get().filter(Boolean);
  const questionHeadings = [...h2s, ...h3s].filter(h => h.includes('?') || /^(what|why|how|when|where|who|can|does|is|are|should)\b/i.test(h));
  const tableCount = $('table').length;
  const listItemCount = $('ul li, ol li').length;
  const takeawaySignal = /key takeaways|quick answer|summary|in brief|at a glance|bottom line/i.test(bodyText);
  const statisticsCount = countStatistics(bodyText);
  const expertQuoteCount = countExpertQuotes(bodyText);
  const internalLinks = $('a[href]').map((_, el) => $(el).attr('href') || '').get().filter(href => {
    const host = linkHostname(href);
    const pageHost = linkHostname(pageUrl || '');
    return href.startsWith('/') || (host && pageHost && host.endsWith(pageHost));
  }).length;
  const entityCoverage = STRUCTURE_ENTITIES.filter(term => textLower.includes(term));
  const hasPrimaryKeyword = primaryKeyword ? textLower.includes(primaryKeyword.toLowerCase()) : null;

  return {
    title,
    metaDescription,
    h1s,
    h2s,
    h3s,
    headingOrder,
    paragraphs,
    bodyText,
    wordCount: wordCount(bodyText),
    schemaBlocks,
    schemaTypes,
    faqs,
    citations,
    authorText,
    reviewerText,
    credentials,
    dateSignals,
    questionHeadings,
    tableCount,
    listItemCount,
    takeawaySignal,
    directAnswerOpening: hasDirectAnswerOpening(paragraphs, h1s[0] || title),
    statisticsCount,
    expertQuoteCount,
    internalLinks,
    entityCoverage,
    hasPrimaryKeyword,
    hasArticleElement: $('article').length > 0,
    rawHtmlBytes: Buffer.byteLength(rawHtml || '', 'utf8'),
  };
}

function hasSchemaType(types, candidates) {
  return types.some(t => candidates.includes(t));
}

function runChecks(signals, inputType) {
  const checks = [];

  checks.push(signals.h1s.length === 1
    ? pass('CSA1', 'Content Structure', 'Single clear H1', signals.h1s[0], 'Exactly one H1 found.')
    : fail('CSA1', 'Content Structure', 'Single clear H1', 'error', `${signals.h1s.length} H1s`, 'The page should expose one primary H1 for search and AI parsers.', 'Use one descriptive H1 that names the article topic or page purpose.'));

  checks.push(signals.h2s.length >= 4
    ? pass('CSA2', 'Content Structure', 'Enough H2 sections', `${signals.h2s.length} H2s`, 'The page has enough section breaks for scanability.')
    : fail('CSA2', 'Content Structure', 'Enough H2 sections', 'warning', `${signals.h2s.length} H2s`, 'Thin heading structure makes the page harder to parse into answer units.', 'Add H2s for definition, causes, symptoms, diagnosis, treatment, FAQs, and next steps where relevant.'));

  checks.push(signals.questionHeadings.length >= 3
    ? pass('CSA3', 'Content Structure', 'Question-led headings', `${signals.questionHeadings.length} question headings`, 'Question headings align with conversational AI queries.')
    : fail('CSA3', 'Content Structure', 'Question-led headings', 'warning', `${signals.questionHeadings.length} question headings`, 'Few headings are phrased as user questions.', 'Rewrite key sections as natural questions, such as "What causes this?" or "How is it treated?".'));

  checks.push(signals.directAnswerOpening
    ? pass('CSA4', 'Content Structure', 'Direct Answer Formatting', 'present', 'The opening paragraph gives a direct answer.')
    : fail('CSA4', 'Content Structure', 'Direct Answer Formatting', 'warning', 'missing', 'The page does not appear to start with a concise definition or answer.', 'Add a 2-3 sentence answer-first summary immediately below the H1.'));

  checks.push(signals.takeawaySignal
    ? pass('CSA5', 'Content Structure', 'Summary or key takeaways', 'present', 'A summary signal was detected.')
    : fail('CSA5', 'Content Structure', 'Summary or key takeaways', 'notice', 'missing', 'AI systems benefit from explicit summary blocks.', 'Add a "Key Takeaways" or "Quick Answer" block near the top.'));

  checks.push(signals.tableCount > 0
    ? pass('CSA6', 'Content Structure', 'HTML Comparison Tables', `${signals.tableCount} table(s)`, 'Tables help AI extract structured comparisons.')
    : fail('CSA6', 'Content Structure', 'HTML Comparison Tables', 'notice', 'none', 'No HTML tables were detected.', 'Add an HTML table for types, treatment options, severity levels, costs, or timelines.'));

  checks.push(signals.faqs.length >= 3
    ? pass('CSA7', 'Content Structure', 'FAQ Block Implementation', `${signals.faqs.length} FAQ-like questions`, 'FAQ-style questions were detected.')
    : fail('CSA7', 'Content Structure', 'FAQ Block Implementation', 'warning', `${signals.faqs.length} questions`, 'The page has limited FAQ coverage for long-tail answer queries.', 'Add 4-6 concise FAQs based on real patient/searcher questions.'));

  checks.push(signals.authorText || hasSchemaType(signals.schemaTypes, ['Person'])
    ? pass('AUTH1', 'Authority', 'Author Bio & Byline Optimization', signals.authorText || 'Person schema detected', 'A named author signal was detected.')
    : fail('AUTH1', 'Authority', 'Author Bio & Byline Optimization', 'error', 'missing', 'No clear named author was detected.', 'Ask the client to add a named author byline, reviewer, credentials, short bio, and profile URL.'));

  checks.push(signals.reviewerText || /reviewed by/i.test(signals.bodyText)
    ? pass('AUTH2', 'Authority', 'Expert reviewer', signals.reviewerText || 'reviewed by text detected', 'Expert review signal detected.')
    : fail('AUTH2', 'Authority', 'Expert reviewer', 'error', 'missing', 'No expert reviewer signal was detected.', 'For YMYL content, add "Medically reviewed by [Name], DDS/DMD" with date reviewed.'));

  checks.push(signals.credentials.length > 0
    ? pass('AUTH3', 'Authority', 'Credentials present', signals.credentials.join(', '), 'Professional credential language was detected.')
    : fail('AUTH3', 'Authority', 'Credentials present', 'warning', 'missing', 'No professional credentials were detected in author/reviewer signals.', 'Include credentials such as DDS, DMD, MD, RDH, or specialty role where accurate.'));

  checks.push(signals.dateSignals.length > 0
    ? pass('AUTH4', 'Authority', 'Freshness dates', signals.dateSignals.slice(0, 2).join(' | '), 'Date signal detected.')
    : fail('AUTH4', 'Authority', 'Freshness dates', 'warning', 'missing', 'No publish/update/review date was detected.', 'Add visible "Published", "Updated", and/or "Reviewed" dates and mirror them in schema.'));

  checks.push(signals.citations.authoritative.length >= 2
    ? pass('AUTH5', 'Authority', 'Authoritative citations', `${signals.citations.authoritative.length} authoritative links`, 'Primary or trusted source citations detected.')
    : fail('AUTH5', 'Authority', 'Authoritative citations', 'error', `${signals.citations.authoritative.length} authoritative links`, 'The page has too few citations to trusted sources.', 'Cite primary sources such as .gov, .edu, ADA, NIH, PubMed, or peer-reviewed journals.'));

  checks.push(signals.statisticsCount >= 2
    ? pass('AUTH6', 'Authority', 'Statistics & Data Density', `${signals.statisticsCount} statistic(s)`, 'Evidence-backed claims detected.')
    : fail('AUTH6', 'Authority', 'Statistics & Data Density', 'warning', `${signals.statisticsCount} statistic(s)`, 'Few evidence-backed statistics were detected.', 'Add 2-3 sourced statistics that support prevalence, outcomes, risk, or treatment context.'));

  checks.push(signals.expertQuoteCount > 0
    ? pass('AUTH7', 'Authority', 'Expert Quote Integration', `${signals.expertQuoteCount} quote(s)`, 'Expert quote signal detected.')
    : fail('AUTH7', 'Authority', 'Expert Quote Integration', 'notice', 'missing', 'No expert quote was detected.', 'Add a short quote from a credentialed expert that explains the most common patient misconception or decision point.'));

  const csqafMissing = [];
  if (signals.citations.authoritative.length < 2) csqafMissing.push('Citations');
  if (signals.statisticsCount < 2) csqafMissing.push('Statistics');
  if (signals.expertQuoteCount < 1) csqafMissing.push('Quotations');
  if (!signals.authorText && !signals.reviewerText && signals.credentials.length === 0) csqafMissing.push('Authoritativeness');
  if (!signals.directAnswerOpening || signals.h2s.length < 4) csqafMissing.push('Fluency');
  checks.push(csqafMissing.length === 0
    ? pass('CSQAF1', 'CSQAF', 'CSQAF Elements', 'complete', 'Citations, statistics, quotes, authority, and fluency signals are present.')
    : fail('CSQAF1', 'CSQAF', 'CSQAF Elements', 'error', csqafMissing.join(', '), `Missing CSQAF elements: ${csqafMissing.join(', ')}.`, 'Add specific citations, sourced statistics, expert quotes, credentialed author/reviewer signals, and answer-first section formatting for each missing CSQAF element.'));

  checks.push(hasSchemaType(signals.schemaTypes, ['Article', 'BlogPosting', 'NewsArticle', 'MedicalWebPage'])
    ? pass('SCH1', 'Schema', 'Article or medical page schema', signals.schemaTypes.join(', '), 'Article-like schema detected.')
    : fail('SCH1', 'Schema', 'Article or medical page schema', 'warning', signals.schemaTypes.join(', ') || 'none', 'No Article/BlogPosting/MedicalWebPage schema was detected.', 'Add Article or MedicalWebPage schema with headline, author, reviewedBy, datePublished, dateModified, and citations.'));

  checks.push(hasSchemaType(signals.schemaTypes, ['FAQPage']) || signals.faqs.length >= 3
    ? pass('SCH2', 'Schema', 'FAQ schema opportunity', hasSchemaType(signals.schemaTypes, ['FAQPage']) ? 'FAQPage schema detected' : 'FAQ content detected', 'FAQ signal is present.')
    : fail('SCH2', 'Schema', 'FAQ schema opportunity', 'notice', 'missing', 'No FAQPage schema or strong FAQ section was detected.', 'If FAQs are visible on the page, add matching FAQPage JSON-LD.'));

  checks.push(signals.entityCoverage.length >= 5
    ? pass('ENT1', 'Entity Clarity', 'Topic coverage breadth', signals.entityCoverage.join(', '), 'Core explanatory topic types were covered.')
    : fail('ENT1', 'Entity Clarity', 'Topic coverage breadth', 'warning', signals.entityCoverage.join(', ') || 'limited', 'The page may not cover enough adjacent entity/topic angles.', 'Add clear subsections for definition, causes, symptoms, diagnosis, treatment, risks, and next steps where relevant.'));

  if (signals.hasPrimaryKeyword !== null) {
    checks.push(signals.hasPrimaryKeyword
      ? pass('ENT2', 'Entity Clarity', 'Primary keyword present', 'present', 'Primary keyword appears in body text.')
      : fail('ENT2', 'Entity Clarity', 'Primary keyword present', 'warning', 'missing', 'Primary keyword was not found in body text.', 'Use the primary keyword naturally in the opening answer, one H2, and relevant body copy.'));
  }

  checks.push(signals.internalLinks >= 3
    ? pass('ENT3', 'Entity Clarity', 'Internal link support', `${signals.internalLinks} internal links`, 'Internal links help connect the page to related services and entities.')
    : fail('ENT3', 'Entity Clarity', 'Internal link support', 'notice', `${signals.internalLinks} internal links`, 'The page has limited internal linking.', 'Add links to relevant service, location, provider, FAQ, or appointment pages.'));

  checks.push(inputType === 'html_paste'
    ? pass('SRC1', 'Input', 'HTML paste supported', 'html paste', 'Analysis ran from pasted HTML, useful for blocked sites.')
    : pass('SRC1', 'Input', 'URL fetch supported', 'url', 'Analysis ran from fetched URL.'));

  return checks;
}

function calculateScores(checks) {
  const weights = {
    'Content Structure': 25,
    Authority: 30,
    CSQAF: 15,
    Schema: 15,
    'Entity Clarity': 10,
    Input: 5,
  };

  const grouped = {};
  for (const check of checks) {
    if (!grouped[check.category]) grouped[check.category] = [];
    grouped[check.category].push(check);
  }

  const categories = Object.entries(weights).map(([category, weight]) => {
    const items = grouped[category] || [];
    if (items.length === 0) return { category, score: 100, passed: 0, total: 0, weight };
    const earned = items.reduce((sum, item) => {
      if (item.status === 'pass') return sum + 1;
      if (item.severity === 'notice') return sum + 0.55;
      if (item.severity === 'warning') return sum + 0.3;
      return sum;
    }, 0);
    const score = Math.round((earned / items.length) * 100);
    return {
      category,
      score,
      passed: items.filter(i => i.status === 'pass').length,
      total: items.length,
      weight,
    };
  });

  const overall = Math.round(categories.reduce((sum, c) => sum + (c.score * c.weight / 100), 0));
  return {
    overall,
    categories,
    counts: {
      pass: checks.filter(c => c.status === 'pass').length,
      fail: checks.filter(c => c.status === 'fail').length,
      error: checks.filter(c => c.severity === 'error' && c.status !== 'pass').length,
      warning: checks.filter(c => c.severity === 'warning' && c.status !== 'pass').length,
      notice: checks.filter(c => c.severity === 'notice' && c.status !== 'pass').length,
    },
  };
}

function buildRecommendations(checks, signals) {
  const failed = checks.filter(c => c.status !== 'pass' && c.recommendation);
  const priorityOrder = { error: 1, warning: 2, notice: 3, info: 4 };
  const topFixes = failed
    .sort((a, b) => priorityOrder[a.severity] - priorityOrder[b.severity])
    .slice(0, 8)
    .map(c => ({
      id: c.id,
      category: c.category,
      title: c.name,
      severity: c.severity,
      current_state: c.detail,
      recommendation: c.recommendation,
    }));

  return {
    topFixes,
    sectionIdeas: [
      'Add an answer-first summary directly under the H1.',
      'Add a Key Takeaways block with 3-5 bullets.',
      'Use question-led H2s for the highest-intent queries.',
      'Add an HTML comparison table for types, causes, treatments, or timelines.',
      'Add visible FAQs and mirror them in FAQPage schema.',
    ],
    authorityIdeas: [
      'Add named author and expert reviewer credentials.',
      'Add publish, modified, and review dates.',
      'Cite primary or trusted third-party sources for medical/statistical claims.',
      'Add one expert quote that clarifies a common misconception.',
    ],
    faqIdeas: signals.faqs.length >= 3 ? signals.faqs.slice(0, 6) : [
      'What is the condition or topic?',
      'What causes it?',
      'How is it diagnosed?',
      'What treatment options are available?',
      'When should someone contact a professional?',
    ],
  };
}

function runContentEnhancementChecks(rawHtml, options = {}) {
  const $ = cheerio.load(rawHtml || '', { decodeEntities: false });
  const pageUrl = options.pageUrl || null;
  const primaryKeyword = options.primaryKeyword || '';
  const inputType = options.inputType || 'html_paste';
  const signals = extractSignals($, rawHtml || '', pageUrl, primaryKeyword);
  const checks = runChecks(signals, inputType);
  const scores = calculateScores(checks);
  const recommendations = buildRecommendations(checks, signals);

  return {
    meta: {
      url: pageUrl || '(pasted HTML)',
      inputType,
      title: signals.title,
      metaDescription: signals.metaDescription,
      h1: signals.h1s[0] || '',
      wordCount: signals.wordCount,
      htmlSizeBytes: signals.rawHtmlBytes,
      primaryKeyword,
      analyzedAt: new Date().toISOString(),
    },
    signals: {
      h1s: signals.h1s,
      h2s: signals.h2s,
      h3s: signals.h3s,
      headingOrder: signals.headingOrder.slice(0, 80),
      faqs: signals.faqs,
      schemaTypes: signals.schemaTypes,
      authorText: signals.authorText,
      reviewerText: signals.reviewerText,
      credentials: signals.credentials,
      dateSignals: signals.dateSignals,
      authoritativeCitations: signals.citations.authoritative.slice(0, 10),
      externalCitations: signals.citations.external.slice(0, 20),
      tableCount: signals.tableCount,
      listItemCount: signals.listItemCount,
      directAnswerOpening: signals.directAnswerOpening,
      takeawaySignal: signals.takeawaySignal,
      statisticsCount: signals.statisticsCount,
      expertQuoteCount: signals.expertQuoteCount,
      internalLinks: signals.internalLinks,
      entityCoverage: signals.entityCoverage,
    },
    checks,
    scores,
    recommendations,
  };
}

module.exports = { runContentEnhancementChecks };
