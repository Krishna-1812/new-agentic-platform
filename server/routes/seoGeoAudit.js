'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const OpenAI = require('openai');
const { runAllChecks } = require('../checks/seoGeoChecks');

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const GPT_SYSTEM_PROMPT = `You are a senior SEO and GEO strategist at a full-service SEO agency.

You will receive a JSON object containing:
1. Automated HTML audit results (checks array)
2. Page context (pageType, brandName, vertical, isYMYL, keywords, detectedElements)
3. Schema blocks extracted from the page
4. Rule-based schema recommendations list

Your tasks:
A. Analyze audit findings and produce an expert-level report
B. Validate and finalize schema recommendations
C. Generate context-aware impact and fix text

---

AUDIENCE: Experienced SEO practitioners. No basic explanations. Precise technical language. Skip preamble.

---

PAGE TYPE CONTEXT RULES:
- All recommendations must be appropriate for the detected page type.
- Do not recommend Article schema for location pages.
- Do not recommend author bylines for contact pages or product pages.
- For YMYL pages (isYMYL: true), flag any missing credential, license, or expert review signals as high-priority.
- For healthcare YMYL (Dentist, MedicalOrganization): flag absence of: named doctor, medical credential, state license reference, "Reviewed by [MD/DDS]" text.

---

KEYWORD CONTEXT RULES:
- If keywords are provided, evaluate every flagged check in the context of whether the keyword is the cause.
- For keyword density warnings: if the over-dense keyword is the primary keyword, acknowledge this and recommend targeted reduction, not elimination.
- For heading keyword repetition: if the keyword is in the brand name, lower urgency and note this as a context note.

---

SCHEMA VALIDATION TASK:
You will receive detectedSchemas (with parsed JSON-LD blocks) and schemaRecommendations (rule-based list).

For each item in schemaRecommendations:
1. Confirm it is appropriate given the actual page content
2. Mark relevant: true/false
3. If true, specify 3-5 most important fields to include and provide a starter JSON-LD template

For each detected schema with openingHoursSpecification:
- Plain string values like "Monday" in dayOfWeek are INVALID. Must be http://schema.org/Monday
- Property "canceldayOfWeek" is INVALID. Must be "dayOfWeek"
- Always provide the complete corrected JSON-LD block for any schema with errors

---

OUTPUT FORMAT (return JSON with this exact structure):

{
  "summary": {
    "page_url": "<url>",
    "page_type": "<detected type>",
    "page_type_confidence": <0.0-1.0>,
    "content_vertical": "<vertical>",
    "is_ymyl": <true|false>,
    "overall_score": <0-100>,
    "priority_verdict": "<most critical issue — max 12 words>",
    "geo_readiness": "ready | needs_work | not_ready",
    "eeat_strength": "strong | moderate | weak",
    "quick_wins": ["<fix in < 30 min>"]
  },
  "keyword_analysis": {
    "keyword": "<primary keyword>",
    "overall_status": "well_optimized | needs_work | not_optimized",
    "summary": "<one sentence assessment>"
  },
  "sections": [
    {
      "category": "<category name>",
      "score": <0-100>,
      "issues": [
        {
          "id": "<check ID>",
          "severity": "error | warning | notice",
          "issue": "<concise issue name — max 8 words>",
          "current_state": "<exact finding — include the actual value>",
          "impact": "<what this breaks — context-aware, platform-specific>",
          "context_note": "<if keyword or brand name is relevant — one sentence, omit if not applicable>",
          "fix": "<step-by-step — specific, not generic>",
          "code_example": "<production-ready HTML/JSON-LD if applicable — omit if not needed>",
          "effort": "low | medium | high",
          "priority": <1-N>
        }
      ]
    }
  ],
  "schema_analysis": {
    "detected": [
      {
        "type": "<schema @type>",
        "status": "valid | has_errors | incomplete",
        "fields_present": ["<field>"],
        "fields_missing": ["<field>"],
        "validation_errors": [
          {
            "field": "<field name>",
            "error": "<description>",
            "fix": "<exact corrected value>",
            "severity": "error | warning"
          }
        ],
        "corrected_json_ld": "<full corrected JSON-LD block if errors exist — omit if no errors>"
      }
    ],
    "recommended": [
      {
        "type": "<schema type>",
        "relevant": <true|false>,
        "reason": "<why it applies to this specific page>",
        "priority": "required | recommended | optional",
        "key_fields": ["<field>"],
        "starter_template": "<minimal valid JSON-LD>"
      }
    ]
  },
  "geo_analysis": {
    "csqaf_breakdown": {
      "citations_c": "<score 0-2 with specific finding>",
      "statistics_s": "<score 0-2 with specific finding>",
      "quotations_q": "<score 0-2>",
      "authoritativeness_a": "<score 0-2>",
      "fluency_f": "<score 0-2>",
      "total": "<sum>/10"
    },
    "platform_readiness": {
      "google_aio": "<ready|partial|not_ready — one specific reason>",
      "chatgpt": "<ready|partial|not_ready — one specific reason>",
      "perplexity": "<ready|partial|not_ready — one specific reason>",
      "claude_ai": "<ready|partial|not_ready — one specific reason>",
      "gemini": "<ready|partial|not_ready — one specific reason>",
      "copilot": "<ready|partial|not_ready — one specific reason>"
    },
    "top_geo_fix": "<single most impactful GEO action — specific>"
  },
  "content_recommendations": {
    "rewrite_priority": "<which section + why + example rewrite>",
    "statistics_to_add": "<2-3 specific stat types with suggested sources>",
    "expert_quote_guidance": "<credential + format + example>",
    "faq_recommendation": "<3-5 specific FAQ questions as a list>",
    "word_count_verdict": "<adequate/over/under for this page type + GEO reasoning>"
  }
}

---

RULES:

1. Every fix must be immediately actionable. "Improve content quality" is not a fix.

2. Code examples must be production-ready. Use actual JSON-LD structure and realistic values matching the page topic.

3. For schema fixes: always write the complete corrected JSON-LD block.

4. For GEO fixes: specify which AI engines the fix targets and why.

5. Effort levels: low = under 30 min no dev required; medium = 30 min–2 hours may need dev; high = 2+ hours or structural change.

6. Priority ordering within each category: 1 = highest compound effect on both SEO and GEO signals.

7. Do not include passing checks unless they are notable positive signals.

8. GEO readiness: ready = CSQAF >= 7, named author, ≥4 statistics with sources, Organization schema with sameAs, dateModified present, no promotional language flags. needs_work = CSQAF 4–6 or 2–3 criteria met. not_ready = CSQAF < 4 or <2 criteria met.

9. Be blunt. If the page is poorly optimized for GEO, say so directly.

10. For every schema error, provide the complete corrected JSON-LD block — the practitioner should be able to copy-paste it.

11. For the Dentist schema dayOfWeek error: the corrected block must show each day as a separate OpeningHoursSpecification object with proper http://schema.org/DayName URIs.

12. If rule-based statistics count appears inflated (count > 20 on a local business page), note this and use your own estimate.

13. Context notes are mandatory for: E13 on brand-name-heavy pages, F22 when keyword density involves the primary keyword, F6 on location/service pages.

14. Be specific about YMYL gaps. For a dental location page with no named DDS/DMD, no credential schema, no state license reference — call this out as a direct E-E-A-T risk.`;

async function fetchUrl(url) {
  const resp = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SEOAuditBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: () => true,
  });
  return {
    html: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
    status: resp.status,
    headers: resp.headers,
    finalUrl: resp.request?.res?.responseUrl || url,
    fetchTimeMs: 0,
  };
}

// POST /api/seo-geo-audit/run  — SSE streaming
router.post('/run', async (req, res) => {
  const { url, html: pastedHtml, keywords } = req.body;
  const kwArray = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  if (!url && !pastedHtml) {
    return res.status(400).json({ error: 'Provide a URL or raw HTML.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  const emit = (event, data) => {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
  };

  try {
    let rawHtml = '';
    let httpStatus = null;
    let httpHeaders = {};
    let finalUrl = url || null;
    let fetchTimeMs = 0;
    let inputType = 'html_paste';

    // ── Step 1: Fetch ────────────────────────────────────────────────────────
    if (url) {
      inputType = 'url';
      emit('step', { id: 'fetch', status: 'active', message: `Fetching ${url}…` });
      const t0 = Date.now();
      try {
        const fetched = await fetchUrl(url);
        rawHtml = fetched.html;
        httpStatus = fetched.status;
        httpHeaders = fetched.headers;
        finalUrl = fetched.finalUrl;
        fetchTimeMs = Date.now() - t0;
        emit('step', { id: 'fetch', status: 'done', message: `Fetched ${Math.round(rawHtml.length/1024)}KB in ${fetchTimeMs}ms (HTTP ${httpStatus})` });
      } catch (err) {
        emit('step', { id: 'fetch', status: 'error', message: `Fetch failed: ${err.message}` });
        emit('error', { message: `Could not fetch URL: ${err.message}` });
        res.end();
        return;
      }
    } else {
      rawHtml = pastedHtml;
      emit('step', { id: 'fetch', status: 'done', message: 'Using pasted HTML.' });
    }

    if (!rawHtml || rawHtml.trim().length < 50) {
      emit('error', { message: 'HTML is empty or too short to audit.' });
      res.end();
      return;
    }

    // ── Step 2: Run checks ───────────────────────────────────────────────────
    emit('step', { id: 'checks', status: 'active', message: 'Running all SEO & GEO checks…' });
    const { checks, scores, geo, pageContext, detectedElements, detectedSchemas, schemaRecommendations, kwChecks } = await runAllChecks(rawHtml, finalUrl, httpHeaders, kwArray);
    const kwSuffix = kwArray.length > 0 ? ` · ${kwChecks.length} keyword checks` : '';
    emit('step', { id: 'checks', status: 'done', message: `${checks.length} checks complete — ${scores.counts.errors} errors, ${scores.counts.warnings} warnings${kwSuffix}` });

    // ── Step 3: Build findings payload ───────────────────────────────────────
    emit('step', { id: 'structure', status: 'active', message: 'Structuring findings…' });

    const findings = {
      meta: {
        url: finalUrl || '(pasted HTML)',
        fetch_timestamp: new Date().toISOString(),
        html_size_bytes: rawHtml.length,
        fetch_time_ms: fetchTimeMs,
        http_status: httpStatus,
        input_type: inputType,
        total_checks_run: checks.length,
        errors: scores.counts.errors,
        warnings: scores.counts.warnings,
        notices: scores.counts.notices,
        passed: scores.counts.passed,
        page_type: pageContext?.pageType || 'unknown',
        page_type_confidence: pageContext?.pageTypeConfidence || 0,
        is_ymyl: pageContext?.isYMYL || false,
        content_vertical: pageContext?.detectedVertical || 'other',
        keywords: kwArray,
      },
      checks,
      scores,
      geo,
      pageContext,
      detectedElements,
      detectedSchemas,
      schemaRecommendations,
      kwChecks,
    };

    emit('step', { id: 'structure', status: 'done', message: 'Findings structured.' });

    // ── Step 3.5: Page type AI classification ─────────────────────────────────────────
    // Only run if rule-based confidence < 0.8 and we have enough page signals
    let aiPageType = null;
    if (pageContext && pageContext.pageTypeConfidence < 0.8) {
      try {
        const classInput = {
          url: finalUrl || '(pasted HTML)',
          title: findings.meta.title || '',
          h1: '',
          metaDescription: '',
          h2List: [],
          firstParagraph: '',
          schemaTypes: (detectedSchemas || []).flatMap(s => [].concat(s['@type'] || [])).filter(Boolean),
        };
        // We pass minimal info for classification — the checks already extracted these
        const classCompletion = await getOpenAI().chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: `Classify this page into exactly ONE type: homepage, location, service, article, blog, resource, guide, product, category, about, contact, faq, team, pricing, landing, other. Respond with JSON only: {"pageType":"<type>","confidence":<0.0-1.0>,"contentVertical":"<healthcare|legal|finance|ecommerce|saas|local_service|media|education|other>","isYMYL":<true|false>,"reasoning":"<one sentence>"}`
            },
            {
              role: 'user',
              content: JSON.stringify(classInput)
            }
          ],
        });
        const classRaw = classCompletion.choices[0]?.message?.content || '{}';
        aiPageType = JSON.parse(classRaw);
        if (aiPageType.confidence >= 0.8) {
          findings.meta.page_type = aiPageType.pageType;
          findings.meta.page_type_confidence = aiPageType.confidence;
          findings.meta.is_ymyl = aiPageType.isYMYL;
          findings.meta.content_vertical = aiPageType.contentVertical;
          if (findings.pageContext) {
            findings.pageContext.pageType = aiPageType.pageType;
            findings.pageContext.isYMYL = aiPageType.isYMYL;
            findings.pageContext.detectedVertical = aiPageType.contentVertical;
          }
        }
      } catch {
        // AI classification is best-effort — don't fail the whole audit
      }
    }

    // ── Step 4: GPT-4o mini analysis ─────────────────────────────────────────
    emit('step', { id: 'ai', status: 'active', message: 'Sending to GPT-4o mini for expert analysis…' });

    let aiAnalysis = null;
    try {
      const gptInput = {
        meta: findings.meta,
        scores: findings.scores,
        geo: findings.geo,
        pageContext: findings.pageContext,
        detectedElements: findings.detectedElements,
        detectedSchemas: (findings.detectedSchemas || []).slice(0, 10), // limit
        schemaRecommendations: findings.schemaRecommendations || [],
        kwChecks: findings.kwChecks || [],
        checks: checks.filter(c => c.status !== 'pass' || c.severity === 'info').slice(0, 120),
      };

      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: GPT_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(gptInput) },
        ],
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      aiAnalysis = JSON.parse(raw);
      emit('step', { id: 'ai', status: 'done', message: 'AI analysis complete.' });
    } catch (err) {
      emit('step', { id: 'ai', status: 'error', message: `AI analysis failed: ${err.message}` });
    }

    // ── Step 5: Emit final result ─────────────────────────────────────────────
    emit('result', {
      findings,
      ai: aiAnalysis,
    });

    res.end();
  } catch (err) {
    emit('error', { message: err.message || 'Unexpected error during audit.' });
    res.end();
  }
});

module.exports = router;
