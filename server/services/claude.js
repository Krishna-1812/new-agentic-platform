const OpenAI = require('openai');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY is not configured. Please update your .env file with a valid OpenAI API key.');
  }
  return new OpenAI({ apiKey });
}

async function analyzeContent(keyword, scrapedPages) {
  const client = getClient();

  const successfulPages = scrapedPages.filter(p => p.success && p.content && p.content.length > 150);

  if (successfulPages.length === 0) {
    throw new Error('No content was successfully scraped. Cannot generate analysis.');
  }

  const pagesText = successfulPages.map((page, i) => {
    const headingsText = page.headings && page.headings.length > 0
      ? `H2 Headings found: ${page.headings.join(' | ')}\n`
      : '';
    return `--- COMPETITOR PAGE ${i + 1} ---\nURL: ${page.url}\n${headingsText}CONTENT:\n${page.content}\n`;
  }).join('\n');

  const prompt = `You are an expert SEO content strategist. Analyze the following ${successfulPages.length} competitor pages for the keyword "${keyword}" and return ONLY a valid JSON object — no markdown, no explanation, no wrapper text.

The JSON must match this EXACT structure:

{
  "sections": [
    {
      "h2": "Section headline (match common competitor H2 patterns)",
      "recommendations": ["Bullet point 1 about what competitors cover", "Bullet point 2 about why it matters for ranking"]
    }
  ],
  "wordCountBenchmark": 1500,
  "semanticKeywords": ["keyword1", "keyword2", "keyword3"],
  "contentGaps": ["gap or topic missing from competitor content"]
}

STRICT REQUIREMENTS:
- sections: up to 6 entries based on the most commonly recurring H2 themes across competitor pages
- h2: write as a compelling, SEO-friendly heading (title case)
- recommendations: an ARRAY of short bullet point strings (3-6 bullets per section) — each bullet is one clear, specific insight about what competitors cover in this section and why it matters for ranking
- Do NOT include a "content" field at all
- wordCountBenchmark: estimate the average word count of the competitor pages as a plain integer
- semanticKeywords: 10-15 LSI / semantically related keywords found across pages
- contentGaps: 3-6 notable topics or subtopics underrepresented or missing from competitor coverage
- Base ALL output STRICTLY on what appears in the scraped competitor pages below

COMPETITOR PAGES:
${pagesText}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are an expert SEO content strategist. Always respond with valid JSON only.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const responseText = completion.choices[0]?.message?.content || '';

  let analysis;
  try {
    analysis = JSON.parse(responseText);
  } catch (parseErr) {
    // Try extracting JSON if there's any wrapper text
    const objMatch = responseText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      analysis = JSON.parse(objMatch[0]);
    } else {
      throw new Error('GPT returned an invalid JSON response. Please try again.');
    }
  }

  // Validate structure
  if (!analysis.sections || !Array.isArray(analysis.sections)) {
    throw new Error('GPT response missing required "sections" array.');
  }

  // Cap at 6 sections
  analysis.sections = analysis.sections.slice(0, 6);

  return analysis;
}

module.exports = { analyzeContent };
