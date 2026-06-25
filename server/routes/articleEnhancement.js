const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { searchGoogle } = require('../services/googleSearch');
const { scrapeUrlsDetailed } = require('../services/scraper');
const store = require('../services/kbStore');

const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ── POST /init ─────────────────────────────────────────────────────────────────
router.post('/init', (req, res) => {
  const { url, models } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' });
  if (!Array.isArray(models) || models.length !== 5) {
    return res.status(400).json({ error: 'Exactly 5 models must be selected' });
  }
  let parsedUrl;
  try { parsedUrl = new URL(url.trim()); }
  catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  const token = generateToken();
  sessions.set(token, { url: parsedUrl.href, models });
  setTimeout(() => sessions.delete(token), 120000);
  res.json({ token });
});

// ── GET /stream/:token ─────────────────────────────────────────────────────────
router.get('/stream/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
  sessions.delete(req.params.token);

  const { url, models } = session;

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
    const kb = await store.readKB('seo-geo-article-enhancement-knowledge-base');
    emit('step', { id: 'kb', status: 'done', message: kb ? 'Enhancement KB loaded' : 'KB not found — using defaults' });

    // Step 7: Generate recommendation report
    emit('step', { id: 'report', status: 'active', message: 'Generating unified enhancement report…' });
    const report = await generateReport(openai, articleData, analysis, llmResults, serpAnalysis, kb);
    emit('step', { id: 'report', status: 'done', message: 'Enhancement recommendations ready' });
    emit('report', { report });

    // Step 8: Generate enhanced article
    emit('step', { id: 'enhance', status: 'active', message: 'Generating enhanced HTML article…' });
    const enhancedHtml = await generateEnhancedArticle(openai, articleData, analysis, report, kb);
    emit('step', { id: 'enhance', status: 'done', message: 'Enhanced article ready' });
    emit('enhanced', { html: enhancedHtml });

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

  const $mainEl = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
  const mainContentHtml = $mainEl.html() || '';

  $('script, style, nav, header, footer, aside, noscript').remove();
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
    mainContentHtml: mainContentHtml.slice(0, 80000),
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

  const kbContext = kb ? `\n\nEnhancement Framework:\n${kb.body.slice(0, 1500)}` : '';

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

// ── generateEnhancedArticle ────────────────────────────────────────────────────
async function generateEnhancedArticle(openai, articleData, analysis, report, kb) {
  const originalContent = articleData.mainContentHtml.slice(0, 30000) || articleData.bodyText.slice(0, 20000);
  const kbGuidance = kb ? kb.body.slice(0, 1200) : '';

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 12000,
    messages: [
      {
        role: 'system',
        content: `You are an expert content enhancer. Enhance an existing article based on SEO and content recommendations.

MARKING RULES — follow exactly:
- Wrap ALL newly added inline text or sentences in: <mark data-enhancement="new">added text</mark>
- Wrap ALL newly added full sections or subsections in: <section data-enhancement="new-section"><h2>New Heading</h2><p>Content</p></section>
- Preserve ALL existing content exactly as written — do not alter any original sentences
- Do NOT mark existing content as new
- Maintain existing HTML structure and formatting

${kbGuidance ? `Enhancement Framework:\n${kbGuidance}` : ''}`,
      },
      {
        role: 'user',
        content: `Article: "${articleData.title}"
Primary keyword: ${analysis.primaryKeyword}

ENHANCEMENT RECOMMENDATIONS:
${report.slice(0, 2500)}

ORIGINAL ARTICLE CONTENT (HTML):
${originalContent}

---

Enhance this article by implementing the priority recommendations. Rules:
1. Preserve all existing content exactly as written
2. Add new inline content using: <mark data-enhancement="new">text</mark>
3. Add new full sections using: <section data-enhancement="new-section"><h2>Heading</h2><p>Content</p></section>
4. Only add content where it genuinely improves the article
5. Return the complete enhanced HTML content

Return ONLY the enhanced HTML. No explanations, no preamble.`,
      }
    ],
  });

  return res.choices[0].message.content || '';
}

module.exports = router;
