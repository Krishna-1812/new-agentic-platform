const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, BorderStyle, AlignmentType } = require('docx');
const { searchGoogle } = require('../services/googleSearch');
const { scrapeUrlsDetailed } = require('../services/scraper');
const store = require('../services/kbStore');

const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ── POST /init ─────────────────────────────────────────────────────────────────
router.post('/init', (req, res) => {
  const { url, models, kbId } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' });
  if (!Array.isArray(models) || models.length !== 5) {
    return res.status(400).json({ error: 'Exactly 5 models must be selected' });
  }
  let parsedUrl;
  try { parsedUrl = new URL(url.trim()); }
  catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  const token = generateToken();
  sessions.set(token, { url: parsedUrl.href, models, kbId: kbId || 'seo-geo-article-enhancement-knowledge-base' });
  setTimeout(() => sessions.delete(token), 120000);
  res.json({ token });
});

// ── GET /stream/:token ─────────────────────────────────────────────────────────
router.get('/stream/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
  sessions.delete(req.params.token);

  const { url, models, kbId } = session;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let isClosed = false;
  res.on('close', () => { isClosed = true; });

  const emit = (event, data) => {
    if (isClosed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { isClosed = true; }
  };

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Step 1: Crawl article
    emit('step', { id: 'crawl', status: 'active', message: 'Fetching and analyzing article…' });
    const articleData = await fetchArticle(url);
    emit('step', { id: 'crawl', status: 'done', message: `"${articleData.title}" · ${articleData.wordCount} words · ${articleData.h2s.length} H2s` });
    emit('article_meta', {
      title: articleData.title,
      url: articleData.url,
      wordCount: articleData.wordCount,
      h1: articleData.h1,
      h2s: articleData.h2s,
      metaDescription: articleData.metaDescription,
    });

    // Step 2: Analyze article
    emit('step', { id: 'analyze', status: 'active', message: 'Analyzing content structure and gaps…' });
    const analysis = await analyzeArticle(openai, articleData);
    emit('step', { id: 'analyze', status: 'done', message: `Topic: ${analysis.topic} · Intent: ${analysis.intent} · ${analysis.contentGaps.length} gaps found` });
    emit('analysis', analysis);

    // Step 3: Build 5 fanout prompts
    emit('step', { id: 'prompts', status: 'active', message: 'Building 5 specialized analysis prompts…' });
    const fanoutPrompts = buildFanoutPrompts(articleData, analysis);
    emit('step', { id: 'prompts', status: 'done', message: 'SEO · GEO · Intent · E-E-A-T · Conversion prompts ready' });
    emit('prompts', { prompts: fanoutPrompts.map(p => ({ key: p.key, label: p.label })) });

    // Step 4: Parallel — LLM fanout + search/crawl branch
    emit('step', { id: 'llm_fanout', status: 'active', message: `Running ${models.length} model analyses in parallel…` });
    emit('step', { id: 'keywords', status: 'active', message: 'Generating search keywords from analysis…' });

    const [llmResults, searchBranchData] = await Promise.all([
      runLLMFanout(openai, models, fanoutPrompts, emit),
      runSearchBranch(openai, fanoutPrompts, analysis, emit),
    ]);

    emit('step', { id: 'llm_fanout', status: 'done', message: `${llmResults.filter(r => r.success).length}/${models.length} model responses received` });
    emit('llm_results', { results: llmResults.map(r => ({ key: r.key, label: r.label, model: r.model, success: r.success })) });

    // Step 5: SERP pattern analysis
    emit('step', { id: 'serp_analysis', status: 'active', message: 'Analyzing competitor content patterns…' });
    const serpAnalysis = analyzeSERPData(searchBranchData.competitorPages);
    emit('step', { id: 'serp_analysis', status: 'done', message: `${serpAnalysis.successfulPages} competitor pages analyzed` });
    emit('serp_patterns', serpAnalysis);

    // Step 6: Load KB
    emit('step', { id: 'kb', status: 'active', message: 'Loading enhancement framework KB…' });
    const kb = await store.readKB(kbId);
    emit('step', { id: 'kb', status: 'done', message: kb ? `KB "${kbId}" loaded` : 'KB not found — using defaults' });

    // Step 7: Generate recommendation report
    emit('step', { id: 'report', status: 'active', message: 'Generating unified enhancement report…' });
    const report = await generateReport(openai, articleData, analysis, llmResults, serpAnalysis, kb);
    emit('step', { id: 'report', status: 'done', message: 'Enhancement recommendations ready' });
    emit('report', { report });

    // Step 8: Generate enhanced article
    emit('step', { id: 'enhance', status: 'active', message: 'Generating enhanced article…' });
    const enhancedText = await generateEnhancedArticle(openai, articleData, analysis, report, kb);
    emit('step', { id: 'enhance', status: 'done', message: 'Enhanced article ready' });
    emit('enhanced', { text: enhancedText });

  } catch (err) {
    console.error('[article-enhancement] Error:', err.message);
    emit('fail', { message: err.message });
  }

  emit('done', {});
  res.end();
});

// ── fetchArticle ───────────────────────────────────────────────────────────────
async function fetchArticle(url) {
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SEO-Analyzer/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    responseType: 'text',
  });

  const html = response.data;
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const h1 = $('h1').first().text().trim();
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const h4s = $('h4').map((_, el) => $(el).text().trim()).get().filter(Boolean);

  const allHeadings = [...h2s, ...h3s, ...h4s];
  const faqs = allHeadings.filter(h => /^(what|how|why|when|where|who|can|is|are|does|do|will|should)\b/i.test(h));

  const baseHostname = new URL(url).hostname.replace(/^www\./, '');
  const internalLinks = [];
  const externalLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const linkUrl = new URL(href, url);
      const lh = linkUrl.hostname.replace(/^www\./, '');
      if (lh === baseHostname) internalLinks.push(linkUrl.href);
      else externalLinks.push(linkUrl.href);
    } catch {}
  });

  $('script, style, nav, header, footer, aside, noscript').remove();

  const $mainEl = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
  const mainContentHtml = $mainEl.html() || '';

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  return {
    url,
    title,
    metaDescription,
    h1,
    h2s,
    h3s,
    h4s,
    faqs,
    bodyText,
    wordCount,
    internalLinks: internalLinks.slice(0, 50),
    externalLinks: externalLinks.slice(0, 20),
    mainContentHtml: mainContentHtml,
  };
}

// ── analyzeArticle ─────────────────────────────────────────────────────────────
async function analyzeArticle(openai, articleData) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert content strategist and SEO analyst. Respond with valid JSON only.' },
      {
        role: 'user',
        content: `Analyze this article and return a structured assessment.

Title: ${articleData.title}
URL: ${articleData.url}
Meta Description: ${articleData.metaDescription}
H1: ${articleData.h1}
H2s: ${articleData.h2s.join(' | ')}
H3s: ${articleData.h3s.slice(0, 10).join(' | ')}
Word count: ${articleData.wordCount}
Internal links: ${articleData.internalLinks.length}
External links: ${articleData.externalLinks.length}

Content sample (first 3000 chars):
${articleData.bodyText.slice(0, 3000)}

Return JSON with exactly these fields:
{
  "topic": "The core subject in 3-6 words",
  "primaryKeyword": "The most likely target search keyword",
  "intent": "informational or commercial or transactional or navigational",
  "targetAudience": "Who this article is written for",
  "contentStrengths": ["strength 1", "strength 2"],
  "contentGaps": ["missing topic or angle 1", "missing topic 2"],
  "thinSections": ["H2/H3 heading that appears thin or underdeveloped"],
  "seoIssues": ["specific SEO weakness 1", "specific SEO weakness 2"],
  "geoWeaknesses": ["specific GEO/AI-visibility weakness"],
  "missingTopics": ["important related topic not covered"],
  "faqOpportunities": ["question that could become a FAQ entry"]
}`,
      }
    ],
  });

  return JSON.parse(res.choices[0].message.content);
}

// ── buildFanoutPrompts ─────────────────────────────────────────────────────────
function buildFanoutPrompts(articleData, analysis) {
  const { topic, primaryKeyword, intent, contentGaps, thinSections, missingTopics } = analysis;

  const articleContext = `ARTICLE: ${articleData.title}
URL: ${articleData.url}
TOPIC: ${topic}
PRIMARY KEYWORD: ${primaryKeyword}
INTENT: ${intent}
WORD COUNT: ${articleData.wordCount}
H1: ${articleData.h1}
H2s: ${articleData.h2s.join(' | ')}
CONTENT GAPS IDENTIFIED: ${contentGaps.join(', ')}
THIN SECTIONS: ${thinSections.join(', ')}
MISSING TOPICS: ${missingTopics.join(', ')}

CONTENT SAMPLE (first 2500 chars):
${articleData.bodyText.slice(0, 2500)}`;

  return [
    {
      key: 'seo',
      label: 'SEO Content Gap Analysis',
      prompt: `${articleContext}

You are an SEO Content Strategist. Analyze this article from a pure SEO perspective.

Cover:
1. **Keyword coverage** — What primary, secondary, and LSI keywords is the article missing or underusing?
2. **Heading structure** — Are the H2/H3s optimized for featured snippets and PAA? What changes would capture more SERP snippets?
3. **Content gaps vs. search intent** — What subtopics do searchers expect to find on "${primaryKeyword}" that are absent?
4. **Internal linking** — What contextual internal link opportunities exist?
5. **Meta improvements** — How should the title tag and meta description be rewritten?
6. **Thin content** — Which sections are too thin to rank competitively?

For each finding, give a specific, actionable recommendation. Name the exact heading to add, the exact keyword to incorporate, the exact section to expand.`,
    },
    {
      key: 'geo',
      label: 'GEO & AI Visibility Analysis',
      prompt: `${articleContext}

You are a Generative Engine Optimization (GEO) specialist. Analyze this article for AI citation potential and visibility in Google AI Overviews, ChatGPT, Perplexity, Gemini, and Claude.

Cover:
1. **Answer-first structure** — Does the article place a direct, extractable answer within the first 150 words? What needs to change?
2. **Entity completeness** — What important entities are missing or poorly defined?
3. **Structured data opportunities** — What schema markup is missing (FAQ, HowTo, Article)?
4. **Citability signals** — Are there enough specific, factual claims AI models can confidently extract?
5. **Definition gaps** — What key terms are used without definition?
6. **Structured formatting** — Where would numbered lists, definition blocks, or comparison tables improve AI extractability?

For each finding, give a specific recommendation that will improve AI citation likelihood.`,
    },
    {
      key: 'intent',
      label: 'User Intent & Content Quality Analysis',
      prompt: `${articleContext}

You are a Content Quality and User Experience analyst. Analyze this article for intent alignment and content quality.

Cover:
1. **Intent match** — Does the article fully satisfy the "${intent}" intent behind "${primaryKeyword}"? Where does it fall short?
2. **Completeness** — What questions does a typical user arrive with that the article does not answer?
3. **Readability** — Are there sections with complex language, passive voice, or vague phrasing?
4. **Information flow** — Is the content logically ordered? What should move earlier or later?
5. **Thin content** — Which sections have under 100 words on a topic deserving deeper treatment?
6. **FAQ opportunities** — What common user questions should be added as FAQ entries?
7. **Supporting evidence** — Where are claims made without data, examples, or authority references?

Identify exact passages or sections that need improvement and describe precisely what the improvement should be.`,
    },
    {
      key: 'eeat',
      label: 'E-E-A-T & Trust Enhancement Analysis',
      prompt: `${articleContext}

You are an E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) audit specialist.

Cover:
1. **Experience signals** — Is there evidence of first-hand experience or real-world application? What could be added?
2. **Expertise signals** — Does the article demonstrate deep domain knowledge? Where is it thin or vague?
3. **Authoritativeness signals** — Are there citations to recognized authorities? What external references are missing?
4. **Trustworthiness signals** — Are there appropriate disclaimers? Are claims accurate and free of exaggeration?
5. **YMYL considerations** — If this touches health, finance, safety, or legal domains, what additional trust signals are needed?
6. **Author credibility** — Is there an author bio with credentials? What should be added?
7. **Accuracy gaps** — Are there vague or unsupported claims that could undermine trust?

For each gap, give a specific recommendation for what to add, modify, or remove.`,
    },
    {
      key: 'conversion',
      label: 'Conversion, UX & Content Structure Analysis',
      prompt: `${articleContext}

You are a Conversion Rate Optimization and UX specialist. Analyze this article for conversion potential and structural effectiveness.

Cover:
1. **CTA presence and placement** — Are there clear calls-to-action? Where should CTAs be added or improved?
2. **Content structure** — Is the information hierarchy clear? Do headings guide readers effectively?
3. **Engagement elements** — What tables, checklists, or comparison charts are missing?
4. **Trust-building elements** — Are there testimonials, social proof, or case studies that should be added?
5. **Next-step guidance** — Does the article naturally guide users toward a next action?
6. **Micro-conversions** — What low-commitment actions (subscribe, download, share) could be offered?
7. **Abandonment risks** — What content elements might cause users to leave before reaching the key message?

For each finding, give a specific, implementable recommendation that improves conversion without compromising content quality.`,
    },
  ];
}

// ── runLLMFanout ───────────────────────────────────────────────────────────────
async function runLLMFanout(openai, models, fanoutPrompts, emit) {
  const results = await Promise.all(
    fanoutPrompts.map(async (promptObj, i) => {
      const model = models[i];
      try {
        const text = await callLLM(openai, model, promptObj.prompt);
        emit('llm_result', { key: promptObj.key, label: promptObj.label, model, success: true });
        return { key: promptObj.key, label: promptObj.label, model, success: true, text };
      } catch (err) {
        emit('llm_result', { key: promptObj.key, label: promptObj.label, model, success: false, error: err.message });
        return { key: promptObj.key, label: promptObj.label, model, success: false, text: '', error: err.message };
      }
    })
  );
  return results;
}

// ── callLLM ────────────────────────────────────────────────────────────────────
async function callLLM(openai, model, prompt) {
  try {
    const res = await openai.chat.completions.create({
      model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: 'You are an expert SEO, GEO, and content strategist. Provide detailed, actionable analysis.' },
        { role: 'user', content: prompt },
      ],
    });
    return res.choices[0].message.content || '';
  } catch (err) {
    // Retry without max_tokens for models that may have different constraints
    if (err.status === 400 || err.status === 422) {
      const res = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are an expert SEO, GEO, and content strategist. Provide detailed, actionable analysis.' },
          { role: 'user', content: prompt },
        ],
      });
      return res.choices[0].message.content || '';
    }
    throw err;
  }
}

// ── runSearchBranch ────────────────────────────────────────────────────────────
async function runSearchBranch(openai, fanoutPrompts, analysis, emit) {
  // Generate 5 search keywords
  const keywordRes = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an SEO search strategist. Respond with valid JSON only.' },
      {
        role: 'user',
        content: `Topic: "${analysis.topic}"
Primary keyword: "${analysis.primaryKeyword}"

For each of these 5 analysis dimensions, generate ONE focused Google search keyword (2-5 words) that surfaces the best competitor content to compare against. Be specific enough to surface relevant, high-quality pages.

Dimensions:
1. seo — SEO Content Gap Analysis
2. geo — GEO & AI Visibility
3. intent — User Intent & Content Quality
4. eeat — E-E-A-T & Trust
5. conversion — Conversion & UX

Return JSON:
{
  "keywords": [
    {"key": "seo", "keyword": "..."},
    {"key": "geo", "keyword": "..."},
    {"key": "intent", "keyword": "..."},
    {"key": "eeat", "keyword": "..."},
    {"key": "conversion", "keyword": "..."}
  ]
}`,
      }
    ],
  });

  const { keywords } = JSON.parse(keywordRes.choices[0].message.content);
  emit('step', { id: 'keywords', status: 'done', message: `Generated ${keywords.length} search keywords` });
  emit('search_keywords', { keywords });

  // Run 5 Google searches in parallel
  emit('step', { id: 'comp_crawl', status: 'active', message: 'Running SERP searches and crawling competitor pages…' });

  const searchResults = await Promise.all(
    keywords.map(async ({ key, keyword }) => {
      try {
        const data = await searchGoogle(keyword);
        return { key, keyword, results: data.results || [] };
      } catch {
        return { key, keyword, results: [] };
      }
    })
  );

  // Deduplicate URLs — max 2 per domain, max 10 total
  const domainCount = new Map();
  const seenUrls = new Set();
  const urlList = [];

  for (const { results } of searchResults) {
    for (const r of results) {
      if (seenUrls.has(r.url) || urlList.length >= 10) continue;
      try {
        const hostname = new URL(r.url).hostname.replace(/^www\./, '');
        const count = domainCount.get(hostname) || 0;
        if (count >= 2) continue;
        domainCount.set(hostname, count + 1);
        seenUrls.add(r.url);
        urlList.push(r.url);
      } catch {}
    }
  }

  // Crawl competitor pages
  const competitorPages = await scrapeUrlsDetailed(urlList, ({ url, done, total }) => {
    emit('crawl_progress', { url, done, total });
  });

  emit('step', { id: 'comp_crawl', status: 'done', message: `Crawled ${competitorPages.filter(p => p.success).length}/${urlList.length} competitor pages` });

  return { keywords, searchResults, competitorPages, urlList };
}

// ── analyzeSERPData ────────────────────────────────────────────────────────────
function analyzeSERPData(competitorPages) {
  const successful = competitorPages.filter(p => p.success);

  if (successful.length === 0) {
    return { successfulPages: 0, avgWordCount: 0, commonH2Topics: [], commonH3Topics: [], topFAQs: [], contentPatterns: [], pageList: [] };
  }

  const wordCounts = successful.map(p => (p.bodyText || '').split(/\s+/).filter(Boolean).length);
  const avgWordCount = Math.round(wordCounts.reduce((s, n) => s + n, 0) / successful.length);

  const h2Freq = {};
  const h3Freq = {};
  const faqFreq = {};

  for (const page of successful) {
    const seen = new Set();
    for (const h of (page.h2s || [])) {
      const key = h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 60);
      if (key.length > 5 && !seen.has('h2:' + key)) { seen.add('h2:' + key); h2Freq[key] = (h2Freq[key] || 0) + 1; }
    }
    for (const h of (page.h3s || [])) {
      const key = h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 60);
      if (key.length > 5 && !seen.has('h3:' + key)) { seen.add('h3:' + key); h3Freq[key] = (h3Freq[key] || 0) + 1; }
    }
    for (const f of (page.faqs || [])) {
      const key = f.toLowerCase().trim().slice(0, 80);
      if (!seen.has('faq:' + key)) { seen.add('faq:' + key); faqFreq[key] = (faqFreq[key] || 0) + 1; }
    }
  }

  const sortByFreq = obj =>
    Object.entries(obj).sort(([, a], [, b]) => b - a).slice(0, 10).map(([topic, count]) => ({ topic, count }));

  const withFAQ = successful.filter(p => (p.faqs || []).length > 0).length;
  const avgH2 = Math.round(successful.reduce((s, p) => s + (p.h2s || []).length, 0) / successful.length);

  const contentPatterns = [
    `Average word count: ${avgWordCount}`,
    `Average H2 sections: ${avgH2}`,
    withFAQ > successful.length * 0.5 ? `${withFAQ}/${successful.length} competitor pages include FAQ sections` : null,
  ].filter(Boolean);

  return {
    successfulPages: successful.length,
    avgWordCount,
    commonH2Topics: sortByFreq(h2Freq),
    commonH3Topics: sortByFreq(h3Freq),
    topFAQs: sortByFreq(faqFreq),
    contentPatterns,
    pageList: successful.map((p, i) => ({
      url: p.url,
      title: p.title,
      wordCount: wordCounts[i],
    })),
  };
}

// ── generateReport ─────────────────────────────────────────────────────────────
async function generateReport(openai, articleData, analysis, llmResults, serpAnalysis, kb) {
  const successfulResults = llmResults.filter(r => r.success);

  const llmSummary = successfulResults.map(r =>
    `=== ${r.label} (${r.model}) ===\n${r.text.slice(0, 1200)}`
  ).join('\n\n');

  const serpSummary = [
    `Competitor data (${serpAnalysis.successfulPages} pages):`,
    `Avg word count: ${serpAnalysis.avgWordCount}`,
    `Common H2s: ${serpAnalysis.commonH2Topics.slice(0, 6).map(t => `"${t.topic}" (${t.count})`).join(', ')}`,
    `Common FAQs: ${serpAnalysis.topFAQs.slice(0, 4).map(t => `"${t.topic}"`).join(', ')}`,
    serpAnalysis.contentPatterns.join(' | '),
  ].join('\n');

  const kbContext = kb ? `\n\nEnhancement Framework:\n${kb.body}` : '';

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You are a senior SEO and content strategist producing an article enhancement report. Be specific, actionable, and prioritized.${kbContext}`,
      },
      {
        role: 'user',
        content: `Article: "${articleData.title}"
URL: ${articleData.url}
Topic: ${analysis.topic} | Keyword: ${analysis.primaryKeyword} | Words: ${articleData.wordCount}

--- LLM ANALYSIS RESULTS ---
${llmSummary}

--- SERP COMPETITOR ANALYSIS ---
${serpSummary}

---

Produce a unified Enhancement Report with these sections:

## Executive Summary
2-3 sentences on the article's current state and enhancement priority level.

## Priority Enhancements (Top 5)
Rank the 5 most impactful improvements. For each: what to add/change, why it matters, where in the article.

## SEO Improvements
Specific heading changes, keyword additions, internal linking opportunities.

## GEO & AI Visibility
What to add to improve AI citation potential and featured snippet capture.

## Content Gaps to Fill
Each gap with a specific content recommendation (what to write, where to place it).

## Competitor Coverage Gaps
Topics competitor pages cover that this article misses.

## E-E-A-T Recommendations
Trust and authority signals to add.

## Structure & UX
Formatting and structural improvements.

Be specific. Reference actual headings and sections. Do not give generic advice.`,
      }
    ],
  });

  return res.choices[0].message.content || '';
}

// ── htmlChunkToMarkdown ────────────────────────────────────────────────────────
function htmlChunkToMarkdown(html) {
  const $ = cheerio.load(`<body>${html}</body>`);
  const SKIP = new Set(['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'iframe', 'form']);
  const lines = [];

  function text(el) { return $(el).text().replace(/\s+/g, ' ').trim(); }

  function walk(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (!tag || SKIP.has(tag)) return;
    switch (tag) {
      case 'h1': { const t = text(el); if (t) lines.push('# ' + t, ''); break; }
      case 'h2': { const t = text(el); if (t) lines.push('## ' + t, ''); break; }
      case 'h3': { const t = text(el); if (t) lines.push('### ' + t, ''); break; }
      case 'h4': case 'h5': case 'h6': { const t = text(el); if (t) lines.push('#### ' + t, ''); break; }
      case 'p': { const t = text(el); if (t) lines.push(t, ''); break; }
      case 'li': { const t = text(el); if (t) lines.push('- ' + t); break; }
      case 'ul': case 'ol': $(el).children('li').each((_, li) => walk(li)); lines.push(''); break;
      case 'blockquote': { const t = text(el); if (t) lines.push('> ' + t, ''); break; }
      default:
        if (!['span', 'a', 'strong', 'em', 'b', 'i', 'mark', 'code'].includes(tag)) {
          $(el).children().each((_, child) => walk(child));
        }
    }
  }

  $('body').children().each((_, el) => walk(el));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── generateEnhancedArticle ────────────────────────────────────────────────────
async function generateEnhancedArticle(openai, articleData, analysis, report, kb) {
  const sourceHtml = articleData.mainContentHtml || articleData.bodyText || '';
  const kbGuidance = kb ? kb.body : '';
  const reportSlice = report;

  const systemPrompt = `You are an article augmentation assistant. Your job is to INSERT additional content into an existing article section — not to rewrite it.

CORE RULE: The section you receive is EXISTING text. You must output it EXACTLY as written, with your additions inserted inline.

WHAT YOU MAY ADD:
- New sentences inserted within or after existing paragraphs
- New bullet points added to existing lists
- New short paragraphs inserted between existing paragraphs
- Inline phrases or data points added to existing sentences

WHAT YOU MUST NOT DO:
- Do NOT add new ## or ### headings — this causes duplicate sections across the article
- Do NOT rewrite, rephrase, or modify any existing sentence
- Do NOT mark existing text with [NEW] tags — only text YOU INSERT gets tagged
- Do NOT repeat or summarise content already present in the section
- Do NOT add whole new sections that duplicate topics covered elsewhere in the article

MARKING RULES:
- Wrap ONLY the text you insert: [NEW]your inserted text here[/NEW]
- Existing text must appear verbatim without any [NEW] tags
- Return ONLY the section. No preamble or explanation.${kbGuidance ? '\n\nEnhancement Guidance:\n' + kbGuidance : ''}`;

  // Split at H2 boundaries, then sub-split any section still too large
  const h2Chunks = sourceHtml.split(/(?=<h2[\s>])/i).filter(c => c.trim());
  const chunks = (h2Chunks.length > 1 ? h2Chunks : [sourceHtml])
    .flatMap(c => splitHtmlSafely(c, 8000));

  async function enhanceChunk(chunk, index) {
    if (!chunk.trim()) return '';
    const mdChunk = htmlChunkToMarkdown(chunk);
    if (!mdChunk) return '';
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Article: "${articleData.title}" | Keyword: ${analysis.primaryKeyword}

ENHANCEMENT CONTEXT (use to decide what inline additions to make — do NOT add new headings or duplicate sections):
${reportSlice}

EXISTING SECTION ${index + 1} — copy this exactly, inserting additions inline:
${mdChunk}

Return the section with your inline additions inserted. All existing text must be preserved verbatim.`,
          },
        ],
      });
      return res.choices[0].message.content || mdChunk;
    } catch {
      return mdChunk;
    }
  }

  // Process in batches of 5 to avoid rate-limit errors on long articles
  const BATCH = 5;
  const enhancedChunks = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((chunk, j) => enhanceChunk(chunk, i + j)));
    enhancedChunks.push(...results);
  }

  return enhancedChunks.filter(Boolean).join('\n\n');
}

// Split HTML at safe closing-tag boundaries to avoid breaking mid-tag
function splitHtmlSafely(html, maxChars) {
  if (html.length <= maxChars) return [html];
  const SAFE_BREAK = /<\/(?:p|li|div|blockquote|section|h[1-6])>/gi;
  const chunks = [];
  let start = 0;
  while (start < html.length) {
    if (start + maxChars >= html.length) {
      chunks.push(html.slice(start));
      break;
    }
    const window = html.slice(start, start + maxChars);
    const matches = [...window.matchAll(SAFE_BREAK)];
    const cut = matches.length > 0
      ? start + matches[matches.length - 1].index + matches[matches.length - 1][0].length
      : start + maxChars;
    chunks.push(html.slice(start, cut));
    start = cut;
  }
  return chunks;
}

// ── POST /export/docx ──────────────────────────────────────────────────────────
router.post('/export/docx', async (req, res) => {
  const { articleMeta, analysis, llmResults, serpPatterns, report, enhancedText } = req.body;
  if (!report) return res.status(400).json({ error: 'report is required' });

  try {
    const buf = await buildDocx({ articleMeta, analysis, llmResults, serpPatterns, report, enhancedText });
    const slug = (articleMeta?.title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-enhancement.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('[article-enhancement] docx error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── buildDocx ──────────────────────────────────────────────────────────────────
async function buildDocx({ articleMeta, analysis, llmResults, serpPatterns, report, enhancedText }) {
  const TEAL = '2C7A7B';
  const NAVY = '1F2D3D';
  const GREY = '6B7280';

  const run = (text, opts = {}) => new TextRun({ text: String(text || ''), size: 22, font: 'Calibri', ...opts });
  const sectionHeading = t => new Paragraph({
    spacing: { before: 400, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } },
    children: [run(t, { bold: true, color: TEAL, size: 28 })],
  });
  const subSection = t => new Paragraph({ spacing: { before: 180, after: 60 }, children: [run(t, { bold: true, color: NAVY, size: 24 })] });
  const body = t => new Paragraph({ spacing: { after: 80 }, children: [run(t)] });
  const label = (lbl, val) => new Paragraph({
    spacing: { after: 60 },
    children: [run(lbl + ': ', { bold: true, color: GREY }), run(String(val || '—'))],
  });
  const bullet = t => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [run(t)] });
  const rule = () => new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: TEAL } },
    children: [run('')],
  });
  const gap = () => new Paragraph({ spacing: { after: 80 }, children: [run('')] });
  const pageBreak = () => new Paragraph({ pageBreakBefore: true, children: [run('')] });

  // Expand multi-line [NEW]...[/NEW] blocks to per-line markers before line-by-line processing
  function normalizeNewMarkers(text) {
    return (text || '').replace(/\[NEW\]([\s\S]*?)\[\/NEW\]/g, (_, inner) =>
      inner.split('\n').map(l => l.trim() ? `[NEW]${l.trim()}[/NEW]` : '').join('\n')
    );
  }

  // Split a text string on **bold** and [NEW]...[/NEW] markers → array of TextRun
  function inlineRuns(text, baseOpts = {}) {
    const parts = text.split(/(\*\*[^*]+\*\*|\[NEW\].*?\[\/NEW\])/g);
    return parts.map(part => {
      if (!part) return null;
      if (part.startsWith('**') && part.endsWith('**')) {
        return run(part.slice(2, -2), { bold: true, ...baseOpts });
      }
      if (part.startsWith('[NEW]') && part.endsWith('[/NEW]')) {
        return run(part.slice(5, -6), { highlight: 'green', ...baseOpts });
      }
      return run(part, baseOpts);
    }).filter(Boolean);
  }

  // Parse markdown (with [NEW] markers) into docx paragraphs
  function markdownToParagraphs(text) {
    const lines = normalizeNewMarkers(text).split('\n');
    const paras = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { paras.push(gap()); continue; }
      // Check if the whole line is wrapped in [NEW]...[/NEW]
      const isNewLine = trimmed.startsWith('[NEW]') && trimmed.endsWith('[/NEW]');
      const content = isNewLine ? trimmed.slice(5, -6).trim() : trimmed;
      const newOpt = isNewLine ? { highlight: 'green' } : {};

      if (content.startsWith('## ')) {
        paras.push(new Paragraph({ spacing: { before: 180, after: 60 }, children: inlineRuns(content.slice(3), { bold: true, color: NAVY, size: 24, ...newOpt }) }));
      } else if (content.startsWith('# ')) {
        paras.push(new Paragraph({ spacing: { before: 180, after: 60 }, children: inlineRuns(content.slice(2), { bold: true, color: NAVY, size: 24, ...newOpt }) }));
      } else if (content.startsWith('### ')) {
        paras.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: inlineRuns(content.slice(4), { bold: true, ...newOpt }) }));
      } else if (content.startsWith('#### ')) {
        paras.push(new Paragraph({ spacing: { before: 80, after: 30 }, children: inlineRuns(content.slice(5), { bold: true, ...newOpt }) }));
      } else if (content.startsWith('- ') || content.startsWith('* ')) {
        paras.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inlineRuns(content.slice(2), newOpt) }));
      } else if (/^\d+\.\s/.test(content)) {
        paras.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inlineRuns(content.replace(/^\d+\.\s/, ''), newOpt) }));
      } else if (content.startsWith('> ')) {
        paras.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 720 }, children: inlineRuns(content.slice(2), { italic: true, ...newOpt }) }));
      } else {
        paras.push(new Paragraph({ spacing: { after: 80 }, children: inlineRuns(content, newOpt) }));
      }
    }
    return paras;
  }

  const children = [];

  // ── Cover ──
  children.push(new Paragraph({ spacing: { after: 40 }, children: [run('A R T I C L E  E N H A N C E M E N T  R E P O R T', { bold: true, color: TEAL, size: 18 })] }));
  children.push(new Paragraph({ spacing: { after: 80 }, children: [run(articleMeta?.title || 'Article Enhancement Report', { bold: true, color: NAVY, size: 40 })] }));
  if (articleMeta?.url) children.push(new Paragraph({ spacing: { after: 40 }, children: [run(articleMeta.url, { color: GREY, size: 18 })] }));
  children.push(rule());

  // ── Enhanced Article (primary content) ──
  if (enhancedText) {
    children.push(sectionHeading('Enhanced Article'));
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [run('Content ', { italic: true, color: GREY, size: 20 }), run('highlighted in green', { italic: true, highlight: 'green', size: 20 }), run(' was added during enhancement.', { italic: true, color: GREY, size: 20 })],
    }));
    children.push(gap());
    markdownToParagraphs(enhancedText).forEach(p => children.push(p));
    children.push(rule());
  }

  // ── Appendix: Article Metadata ──
  children.push(pageBreak());
  children.push(sectionHeading('Article Metadata'));
  if (articleMeta) {
    children.push(label('Word Count', articleMeta.wordCount?.toLocaleString()));
    children.push(label('H1', articleMeta.h1 || '—'));
    children.push(label('Meta Description', articleMeta.metaDescription || '—'));
    if (articleMeta.h2s?.length) {
      children.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [run('H2 Sections:', { bold: true, color: GREY })] }));
      articleMeta.h2s.forEach(h => children.push(bullet(h)));
    }
  }

  // ── Appendix: Content Analysis ──
  if (analysis) {
    children.push(sectionHeading('Content Analysis'));
    children.push(label('Topic', analysis.topic));
    children.push(label('Primary Keyword', analysis.primaryKeyword));
    children.push(label('Intent', analysis.intent));
    children.push(label('Target Audience', analysis.targetAudience));
    if (analysis.contentStrengths?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Content Strengths:', { bold: true })] }));
      analysis.contentStrengths.forEach(s => children.push(bullet(s)));
    }
    if (analysis.contentGaps?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Content Gaps:', { bold: true })] }));
      analysis.contentGaps.forEach(g => children.push(bullet(g)));
    }
    if (analysis.seoIssues?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('SEO Issues:', { bold: true })] }));
      analysis.seoIssues.forEach(i => children.push(bullet(i)));
    }
    if (analysis.missingTopics?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Missing Topics:', { bold: true })] }));
      analysis.missingTopics.forEach(t => children.push(bullet(t)));
    }
  }

  // ── Appendix: Competitor Analysis ──
  if (serpPatterns) {
    children.push(sectionHeading('Competitor Analysis'));
    children.push(label('Pages Analyzed', serpPatterns.successfulPages));
    children.push(label('Average Word Count', serpPatterns.avgWordCount?.toLocaleString()));
    if (serpPatterns.contentPatterns?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Content Patterns:', { bold: true })] }));
      serpPatterns.contentPatterns.forEach(p => children.push(bullet(p)));
    }
    if (serpPatterns.commonH2Topics?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Common H2 Topics:', { bold: true })] }));
      serpPatterns.commonH2Topics.slice(0, 8).forEach(t => children.push(bullet(`${t.topic} (${t.count} competitor pages)`)));
    }
    if (serpPatterns.topFAQs?.length) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [run('Common FAQ Questions:', { bold: true })] }));
      serpPatterns.topFAQs.slice(0, 6).forEach(f => children.push(bullet(f.topic)));
    }
  }

  // ── Appendix: Enhancement Recommendations ──
  if (report) {
    children.push(sectionHeading('Enhancement Recommendations'));
    markdownToParagraphs(report).forEach(p => children.push(p));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = router;
