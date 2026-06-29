const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, BorderStyle, AlignmentType } = require('docx');
const store = require('../services/kbStore');

const MODELS = [
  'gpt-4o-mini',
  'gpt-5.4-mini',
  'gpt-4o-mini-search-preview',
  'gpt-4.1-mini',
  'gpt-5-mini',
];

const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ── POST /init ─────────────────────────────────────────────────────────────────
router.post('/init', (req, res) => {
  const { url, kbId } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' });
  let parsedUrl;
  try { parsedUrl = new URL(url.trim()); }
  catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  const token = generateToken();
  sessions.set(token, { url: parsedUrl.href, kbId: kbId || 'seo-geo-article-enhancement-knowledge-base' });
  setTimeout(() => sessions.delete(token), 120000);
  res.json({ token });
});

// ── GET /stream/:token ─────────────────────────────────────────────────────────
router.get('/stream/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
  sessions.delete(req.params.token);

  const { url, kbId } = session;

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

    // Step 2: Theme & Query
    emit('step', { id: 'theme', status: 'active', message: 'Identifying article theme and query…' });
    const themeData = await generateThemeAndQuery(openai, articleData);
    emit('step', { id: 'theme', status: 'done', message: `Theme: "${themeData.theme}"` });
    emit('theme_query', themeData);

    // Step 3: LLM Queries — 1 query × 5 models = 5 parallel calls
    emit('step', { id: 'llm_fanout', status: 'active', message: 'Querying 5 models in parallel…' });
    const llmResults = await runLLMQueries(openai, themeData.query, emit);
    emit('llm_results', { results: llmResults.map(r => ({ modelIndex: r.modelIndex, model: r.model, success: r.success })) });
    emit('step', { id: 'llm_fanout', status: 'done', message: `${llmResults.filter(r => r.success).length}/5 responses received` });

    // Step 4: Concept Synthesis — 5 parallel calls (one per model output)
    emit('step', { id: 'synthesis', status: 'active', message: 'Synthesizing concepts from model outputs…' });
    const { allConcepts } = await runConceptSynthesis(openai, themeData.query, llmResults, emit);
    emit('step', { id: 'synthesis', status: 'done', message: `${allConcepts.length} concepts extracted` });

    // Step 5: Load KB
    emit('step', { id: 'kb', status: 'active', message: 'Loading enhancement framework KB…' });
    const kb = await store.readKB(kbId);
    emit('step', { id: 'kb', status: 'done', message: kb ? `KB "${kbId}" loaded` : 'KB not found — using defaults' });

    // Step 6: Generate Recommendations
    emit('step', { id: 'recommend', status: 'active', message: 'Generating enhancement recommendations…' });
    const recommendations = await generateRecommendations(openai, articleData, themeData, allConcepts, kb);
    emit('step', { id: 'recommend', status: 'done', message: 'Enhancement recommendations ready' });
    emit('recommendations', { recommendations });

    // Step 7: Enhance article sections + structural additions
    emit('step', { id: 'enhance', status: 'active', message: 'Enhancing article sections with statistics, citations, and expert quotes…' });
    const enhancedChunks = await generateEnhancedArticle(openai, articleData, recommendations, kb);
    const existingHeadings = [...(articleData.h2s || []), ...(articleData.h3s || [])].join(' ');
    const articleHasFaq = /faq|frequently asked/i.test(existingHeadings);
    const structural = await generateStructuralAdditions(openai, articleData, themeData, recommendations, kb, articleHasFaq);
    let enhancedText = deduplicateAdditions(enhancedChunks);
    if (structural) enhancedText += '\n\n' + structural;
    enhancedText = normalizeNewMarkers(enhancedText);
    emit('step', { id: 'enhance', status: 'done', message: 'Article enhancement complete' });
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

  $('script, style, nav, header, footer, aside, noscript, iframe, form, ' +
    '[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  const NON_CONTENT = [
    /\b(related[-_]?(posts?|articles?|content)|you[-_]?might[-_]?also|recommended[-_]?(posts?|articles?)|more[-_]?(articles?|posts?|reads?))\b/i,
    /\b(share[-_]?(this|post|article|buttons?)|social[-_]?(share|media|links?|icons?)|follow[-_]?us)\b/i,
    /\b(comments?[-_]?(section|area|box|form|list)|discussion|disqus|utterances|livefyre)\b/i,
    /\b(newsletter[-_]?(signup|form|cta|block)|subscribe[-_]?(form|block|cta)|subscription[-_]?form)\b/i,
    /\b(advert(isement)?|ad[-_]?(unit|slot|container|block)|sponsor(ed)?|promo(tion)?[-_]?(box|banner))\b/i,
    /\b(sidebar|side[-_]?bar|widget[-_]?(area|container|block)|flyout|off[-_]?canvas)\b/i,
    /\b(modal|popup|pop[-_]?up|overlay|lightbox|dialog|drawer)\b/i,
    /\b(office[-_]?locations?|locations?[-_]?(list|grid|directory|finder|map)|store[-_]?(finder|locator)|find[-_]?a[-_]?(location|store|office|clinic))\b/i,
    /\b(all[-_]?offices?|our[-_]?offices?|branch(es)?[-_]?(list|directory|map)|clinic[-_]?(list|directory|locations?))\b/i,
    /\b(breadcrumb|pagination|pager|page[-_]?nav(igation)?|prev[-_]?next|post[-_]?nav)\b/i,
    /\b(cookie[-_]?(banner|notice|bar|consent)|gdpr[-_]?(notice|banner|consent)|consent[-_]?(bar|notice))\b/i,
    /\b(call[-_]?to[-_]?action|book[-_]?(now|appointment|consultation|today)|schedule[-_]?(now|today|consultation)|cta[-_]?(block|section|box|banner))\b/i,
    /\b(author[-_]?(bio|info|box|card|profile)|about[-_]?the[-_]?author|written[-_]?by|byline)\b/i,
    /\b(tags?[-_]?(list|cloud|section)|categor(y|ies)[-_]?(list|nav|section)|archive[-_]?(list|nav))\b/i,
    /\b(latest[-_]?articles?|recent[-_]?(posts?|articles?)|trending[-_]?(posts?|articles?)|popular[-_]?(posts?|articles?)|featured[-_]?(posts?|articles?))\b/i,
    /\b(global[-_]?(footer|nav|cta|locations?|offices?)|site[-_]?(footer|wide|global)|page[-_]?footer)\b/i,
  ];

  $('[class], [id]').each((_, el) => {
    const combined = `${($(el).attr('class') || '')} ${($(el).attr('id') || '')}`.toLowerCase();
    if (NON_CONTENT.some(p => p.test(combined))) $(el).remove();
  });

  const ARTICLE_SELECTORS = [
    'article[class*="post"]', 'article[class*="article"]', 'article[class*="blog"]',
    'article[class*="entry"]', 'article[class*="content"]',
    'article',
    '[role="main"]',
    '.post-content', '.entry-content', '.article-content', '.article-body',
    '.blog-content', '.blog-post-content', '.blog-entry-content',
    '.post-body', '.story-body', '.article__body', '.article__content',
    '.content-area', '.main-content', '.page-content', '.primary-content',
    '#content', '#main-content', '#article-content', '#post-content', '#entry-content',
    'main',
  ];

  let $mainEl = null;
  for (const sel of ARTICLE_SELECTORS) {
    try {
      const $el = $(sel).first();
      if ($el.length && $el.text().replace(/\s+/g, ' ').trim().length > 300) {
        $mainEl = $el;
        break;
      }
    } catch {}
  }
  if (!$mainEl) $mainEl = $('body');

  $mainEl.find('ul, ol, nav, div, section').each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length < 30) return;
    const links = $el.find('a');
    const linkText = links.map((_, a) => $(a).text()).get().join(' ').replace(/\s+/g, ' ').trim();
    const linkDensity = text.length > 0 ? linkText.length / text.length : 0;
    if (linkDensity > 0.5 && links.length >= 3) $(el).remove();
  });

  $mainEl.find('ul, ol').each((_, el) => {
    const $el = $(el);
    const $items = $el.children('li');
    if ($items.length < 12) return;
    const lens = $items.map((_, li) => $(li).text().trim().length).get();
    const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
    const shortFraction = lens.filter(l => l < 40).length / (lens.length || 1);
    if (avg < 35 || shortFraction > 0.8) $(el).remove();
  });

  const mainContentHtml = $mainEl.html() || '';

  const $c = cheerio.load(mainContentHtml);
  const h2s = $c('h2').map((_, el) => $c(el).text().trim()).get().filter(Boolean);
  const h3s = $c('h3').map((_, el) => $c(el).text().trim()).get().filter(Boolean);
  const h4s = $c('h4').map((_, el) => $c(el).text().trim()).get().filter(Boolean);
  const allHeadings = [...h2s, ...h3s, ...h4s];
  const faqs = allHeadings.filter(h => /^(what|how|why|when|where|who|can|is|are|does|do|will|should)\b/i.test(h));
  const bodyText = $c('body').text().replace(/\s+/g, ' ').trim();
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
    mainContentHtml,
  };
}

// ── generateThemeAndQuery ──────────────────────────────────────────────────────
async function generateThemeAndQuery(openai, articleData) {
  const res = await openai.chat.completions.create({
    model: 'gpt-5.4-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert content analyst. Respond with valid JSON only.' },
      {
        role: 'user',
        content: `Analyze this article and identify its main theme and the primary user search query it addresses.

Title: ${articleData.title}
H1: ${articleData.h1}
H2s: ${articleData.h2s.join(' | ')}

Content sample (first 3000 chars):
${articleData.bodyText.slice(0, 3000)}

Return JSON:
{
  "theme": "The article's main topic/theme in 4-8 words",
  "query": "The primary user search query this article addresses, 4-12 words, phrased as a natural user search"
}`,
      }
    ],
  });
  return JSON.parse(res.choices[0].message.content);
}

// ── runLLMQueries ──────────────────────────────────────────────────────────────
async function runLLMQueries(openai, query, emit) {
  const results = await Promise.all(MODELS.map(async (model, modelIndex) => {
    try {
      const prompt = `Query: "${query}"

Provide a comprehensive response to this search query. Include:
- Key concepts, definitions, and explanations
- Important statistics, data points, and research findings (with sources where known)
- Best practices, methodologies, or actionable insights
- Expert perspectives or authoritative viewpoints
- Nuanced considerations or common misconceptions

This information will be used to enhance an article on this topic. Focus on depth, accuracy, and specificity.`;
      const text = await callLLM(openai, model, prompt);
      emit('llm_result', { modelIndex, model, success: true });
      return { modelIndex, model, success: true, text };
    } catch (err) {
      emit('llm_result', { modelIndex, model, success: false, error: err.message });
      return { modelIndex, model, success: false, text: '', error: err.message };
    }
  }));

  return results;
}

// ── callLLM ────────────────────────────────────────────────────────────────────
async function callLLM(openai, model, prompt) {
  try {
    const res = await openai.chat.completions.create({
      model,
      max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: 'You are a knowledgeable expert. Provide comprehensive, factual information.' },
        { role: 'user', content: prompt },
      ],
    });
    return res.choices[0].message.content || '';
  } catch (err) {
    if (err.status === 400 || err.status === 422) {
      // Retry without token limit in case the model doesn't support max_completion_tokens
      const res = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a knowledgeable expert. Provide comprehensive, factual information.' },
          { role: 'user', content: prompt },
        ],
      });
      return res.choices[0].message.content || '';
    }
    throw err;
  }
}

// ── synthesizeConcepts ─────────────────────────────────────────────────────────
async function synthesizeConcepts(openai, query, { model, text }) {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert content analyst. Respond with valid JSON only.' },
        {
          role: 'user',
          content: `Query: "${query}"
Model: ${model}

Response to analyze:
${text.slice(0, 1500)}

Extract all distinct concepts, ideas, facts, statistics, and insights from this response.

Return JSON:
{
  "model": "${model}",
  "concepts": [
    "Concept or fact — specific and self-contained"
  ]
}

Rules:
- Each concept must be a standalone, self-contained statement
- Include specific statistics with their source when mentioned
- Aim for 5-10 concepts per response
- Prioritize specificity over generality`,
        }
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    console.error('[synthesis] error for model', model, ':', err.message);
    return { model, concepts: [] };
  }
}

// ── runConceptSynthesis ────────────────────────────────────────────────────────
async function runConceptSynthesis(openai, query, llmResults, emit) {
  const successfulResults = llmResults.filter(r => r.success && r.text);

  const synthResults = await Promise.all(
    successfulResults.map(async (result) => {
      const synth = await synthesizeConcepts(openai, query, result);
      emit('synthesis_result', synth);
      return synth;
    })
  );

  const seenConcepts = new Set();
  const allConcepts = [];
  for (const s of synthResults) {
    for (const concept of (s.concepts || [])) {
      const key = concept.toLowerCase().trim().slice(0, 80);
      if (!seenConcepts.has(key)) {
        seenConcepts.add(key);
        allConcepts.push(concept);
      }
    }
  }

  return { allConcepts };
}

// ── generateRecommendations ────────────────────────────────────────────────────
async function generateRecommendations(openai, articleData, themeData, allConcepts, kb) {
  const kbGuidance = kb ? `\n\nEnhancement Framework:\n${kb.body}` : '';

  const res = await openai.chat.completions.create({
    model: 'gpt-5.4-mini',
    max_completion_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You are a senior SEO and content strategist producing article enhancement recommendations. Be specific, actionable, and prioritized.${kbGuidance}`,
      },
      {
        role: 'user',
        content: `Article: "${articleData.title}"
URL: ${articleData.url}
Theme: ${themeData.theme}
Word count: ${articleData.wordCount}
H1: ${articleData.h1}
H2 sections: ${articleData.h2s.join(' | ')}

Query this article should address: ${themeData.query}

Synthesized concepts from multi-model research:
${allConcepts.join('\n').slice(0, 8000)}

---

Produce a structured Enhancement Recommendations document:

## Priority Enhancements (Top 5)
Rank the 5 most impactful improvements. For each: what to add/change, why it matters, where in the article.

## Content Gaps
Specific topics or concepts from the research that are absent from the article. For each gap: what to add and where.

## SEO & GEO Improvements
Heading optimizations, keyword opportunities, answer-first structures, entity completeness.

## E-E-A-T & Trust Signals
Statistics, expert quotes, and citations the article should incorporate.

## Structure & FAQ
New sections to add (only if explicitly needed), FAQ questions to include.

Be specific. Reference actual H2 headings. Do not give generic advice.`,
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

// ── normalizeNewMarkers ────────────────────────────────────────────────────────
function normalizeNewMarkers(text) {
  if (!text) return '';
  let t = text.replace(/\[\/NEW\][ \t]*\[NEW\]/g, ' ');
  t = t.replace(/\[NEW\]([\s\S]*?)\[\/NEW\]/g, (_, inner) =>
    inner.split('\n').map(l => l.trim() ? `[NEW]${l.trim()}[/NEW]` : '').join('\n')
  );
  t = t.split('\n').map(line => {
    const hasOpen = line.includes('[NEW]');
    const hasClose = line.includes('[/NEW]');
    if (hasOpen && hasClose) return line;
    return line.replace(/\[NEW\]/g, '').replace(/\[\/NEW\]/g, '');
  }).join('\n');
  return t;
}

// ── deduplicateAdditions ───────────────────────────────────────────────────────
function deduplicateAdditions(text) {
  const seenSentences = new Set();
  return text.replace(/\[NEW\]([\s\S]*?)\[\/NEW\]/g, (_, inner) => {
    const sentences = inner.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const s of sentences) {
      const key = s.trim().toLowerCase().replace(/\s+/g, ' ');
      if (key.length > 30 && seenSentences.has(key)) continue;
      if (key.length > 30) seenSentences.add(key);
      kept.push(s);
    }
    const cleaned = kept.join(' ').trim();
    return cleaned ? `[NEW]${cleaned}[/NEW]` : '';
  });
}

// ── generateStructuralAdditions ────────────────────────────────────────────────
async function generateStructuralAdditions(openai, articleData, themeData, recommendations, kb, skipFaq = false) {
  const kbGuidance = kb ? `\n\nKnowledge Base Enhancement Framework:\n${kb.body}` : '';

  const faqBlock = skipFaq
    ? `1. FAQ SECTION: The article already contains a FAQ section — DO NOT add another one. Skip this step entirely.`
    : `1. FAQ SECTION (required):
   Write "## Frequently Asked Questions" as the first heading.
   Add 4-6 questions as ### headings. Each answer must:
   - Directly answer the question in the first sentence (inverted pyramid)
   - Be 50-150 words
   - Be self-contained (no references to "the article above")
   - Be factual and non-promotional
   - Include a sourced statistic where relevant: "[X]% of [population] [action] (Source, Year)"`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'system',
          content: `You are an SEO and GEO content specialist. Your job is to generate ADDITIONAL SECTIONS to append after an existing article. All content you write is new, so wrap everything you produce in a single [NEW]...[/NEW] block.

WHAT TO GENERATE (in this order):

${faqBlock}

2. ADDITIONAL RECOMMENDED SECTIONS — STRICT RULES:
   - ONLY add a new ## section if the enhancement recommendations' "Priority Enhancements" or "Content Gaps" section EXPLICITLY states a specific section title or topic to add.
   - DO NOT infer, imagine, or add sections you think would be useful.
   - DO NOT add generic evergreen sections such as: "Common Mistakes", "Tools", "Trends", "Tips", "Summary", "Key Takeaways", "Best Practices", "Quick Reference" — unless the report names them verbatim.
   - If the report recommends 0 new sections (or you are unsure), output ONLY the FAQ block and nothing else.
   - Maximum 1 additional section beyond the FAQ.

FORMAT RULES:
- Start your output with [NEW]
- End your output with [/NEW]
- Use ## for section headings, ### for FAQ questions
- Bullet lists with "- " prefix for tips/steps
- Do NOT include promotional language
- Do NOT duplicate content already in the article${kbGuidance}`,
        },
        {
          role: 'user',
          content: `Article: "${articleData.title}" | Theme: ${themeData.theme}

ENHANCEMENT RECOMMENDATIONS — scan "Priority Enhancements" and "Content Gaps" for any EXPLICITLY named new sections to add:
${recommendations}

Generate only what is described above. Wrap all output in [NEW]...[/NEW].`,
        },
      ],
    });
    return res.choices[0].message.content || '';
  } catch (err) {
    console.error('[article-enhancement] structural additions error:', err.message);
    return '';
  }
}

// ── generateEnhancedArticle ────────────────────────────────────────────────────
async function generateEnhancedArticle(openai, articleData, recommendations, kb) {
  const sourceHtml = articleData.mainContentHtml || articleData.bodyText || '';
  const kbGuidance = kb ? kb.body : '';

  const systemPrompt = `You are an SEO and GEO content augmentation assistant. Your job is to INSERT substantive, high-value content into an existing article section to improve its AI citability and search performance.

CORE RULE: Existing text must appear VERBATIM. You insert additions only — never rewrite, rephrase, or modify any existing sentence.

WHAT TO ADD (priority order — apply every type that fits this section):

1. STATISTICS — Insert sourced, dated data points. Format exactly: "[X]% of [population] [action] (Source, Year)." Back any claim in the section that data can support. Aim for 1–2 per section where relevant.

2. EXPERT QUOTES — Insert a direct quote from a named, credentialed expert when the section discusses a concept experts have publicly addressed. Format: "As [Full Name], [Credential/Title] at [Organisation] ([Year]): '[quote].'"

3. CITATIONS — Add outbound references to primary sources (research papers, government data, industry reports) in the format "(Source Name, Year)" or as a hyperlink anchor in the text.

4. ANSWER-FIRST SENTENCES — If the section's opening paragraph does not directly answer the section's implied question, insert a direct-answer sentence at the very start.

5. SELF-CONTAINED CONTEXT — If any part of the section references content elsewhere ("as mentioned above", implied context), insert a brief inline clarification so the passage makes sense in isolation.

6. SCANNABLE BULLET LISTS — If a paragraph enumerates 3+ distinct items in prose form without a list, append a [NEW] bullet summary after it. Each bullet should be a specific, scannable data point, not a paraphrase of the prose sentence.

VOLUME LIMIT — be surgical, not exhaustive:
- Per section: at most 2 statistics, 1 expert quote, 1 bullet list (3–5 bullets max), 1 answer-first sentence
- Total new text per section must not exceed 120 words
- If the section is already well-supported with data and quotes, add nothing — return it verbatim

HARD PROHIBITIONS:
- Do NOT add new ## or ### headings — causes duplicate sections across the article
- Do NOT mark existing text with [NEW] — only your insertions get tagged
- Do NOT keyword-stuff — repeating the same phrase across multiple paragraphs scores −9% on AI visibility and is an explicit anti-pattern
- Do NOT define the same term more than once across the article — if a term was already defined in an earlier section, do not re-define it here
- Do NOT rewrite, rephrase, or modify any existing sentence
- Do NOT add generic filler sentences that state the obvious or repeat what the paragraph already says

MARKING RULES:
- Wrap ONLY the text you insert: [NEW]your inserted text here[/NEW]
- Existing text must appear verbatim without any [NEW] tags
- Return ONLY the section. No preamble or explanation.${kbGuidance ? '\n\nKnowledge Base — Enhancement Framework:\n' + kbGuidance : ''}`;

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
            content: `Article: "${articleData.title}"

ARTICLE-LEVEL ENHANCEMENT CONTEXT (use to identify what is missing — do NOT add headings or duplicate content):
${recommendations}

EXISTING SECTION ${index + 1} of ${chunks.length}:
${mdChunk}

Add statistics (with source + year), expert quotes (with name + credential + org + year), citations, and answer-first sentences where they fit. Do NOT add anything already present in this section. Do NOT repeat definitions or phrases that would have appeared in earlier sections. Mark every insertion [NEW]...[/NEW]. Existing text verbatim.`,
          },
        ],
      });
      return res.choices[0].message.content || mdChunk;
    } catch {
      return mdChunk;
    }
  }

  const BATCH = 5;
  const enhancedChunks = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((chunk, j) => enhanceChunk(chunk, i + j)));
    enhancedChunks.push(...results);
  }

  return enhancedChunks.filter(Boolean).join('\n\n');
}

// ── splitHtmlSafely ────────────────────────────────────────────────────────────
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
  const { articleMeta, themeData, llmResults, recommendations, enhancedText } = req.body;
  if (!recommendations) return res.status(400).json({ error: 'recommendations is required' });

  try {
    const buf = await buildDocx({ articleMeta, themeData, llmResults, recommendations, enhancedText });
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
async function buildDocx({ articleMeta, themeData, llmResults, recommendations, enhancedText }) {
  const TEAL = '2C7A7B';
  const NAVY = '1F2D3D';
  const GREY = '6B7280';

  const run = (text, opts = {}) => new TextRun({ text: String(text || ''), size: 22, font: 'Calibri', ...opts });
  const sectionHeading = t => new Paragraph({
    spacing: { before: 400, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } },
    children: [run(t, { bold: true, color: TEAL, size: 28 })],
  });
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

  function normalizeNewMarkersLocal(text) {
    if (!text) return '';
    let t = text.replace(/\[\/NEW\][ \t]*\[NEW\]/g, ' ');
    return t.replace(/\[NEW\]([\s\S]*?)\[\/NEW\]/g, (_, inner) =>
      inner.split('\n').map(l => l.trim() ? `[NEW]${l.trim()}[/NEW]` : '').join('\n')
    );
  }

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

  function markdownToParagraphs(text) {
    const lines = normalizeNewMarkersLocal(text).split('\n');
    const paras = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { paras.push(gap()); continue; }
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

  // Cover
  children.push(new Paragraph({ spacing: { after: 40 }, children: [run('A R T I C L E  E N H A N C E M E N T  R E P O R T', { bold: true, color: TEAL, size: 18 })] }));
  children.push(new Paragraph({ spacing: { after: 80 }, children: [run(articleMeta?.title || 'Article Enhancement Report', { bold: true, color: NAVY, size: 40 })] }));
  if (articleMeta?.url) children.push(new Paragraph({ spacing: { after: 40 }, children: [run(articleMeta.url, { color: GREY, size: 18 })] }));
  children.push(rule());

  // Enhanced Article
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

  // Appendix: Article Metadata
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

  // Appendix: Theme & Query
  if (themeData) {
    children.push(sectionHeading('Theme & Query'));
    children.push(label('Theme', themeData.theme));
    children.push(label('Query', themeData.query));
  }

  // Appendix: Enhancement Recommendations
  if (recommendations) {
    children.push(sectionHeading('Enhancement Recommendations'));
    markdownToParagraphs(recommendations).forEach(p => children.push(p));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = router;
