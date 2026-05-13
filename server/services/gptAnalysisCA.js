const OpenAI = require('openai');

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey: key });
}

// Validate and filter competitor list using GPT
async function validateCompetitors(brandName, targetUrl, country, semrushResults) {
  const openai = getClient();

  const tableLines = semrushResults.map(r =>
    `${r.domain} | ${r.competitionLevel.toFixed(2)} | ${r.commonKeywords} | ${r.organicTraffic} | ${r.authorityScore}`
  ).join('\n');

  const systemPrompt = `You are an expert SEO competitive intelligence analyst. Your job is to evaluate a list of organic search competitors and determine which ones are true business competitors for a given brand — not just topical overlaps.

You must think about:
1. Whether the competitor operates in the same geographic market
2. Whether they serve the same customer segment or vertical
3. Whether they offer similar products or services (not just similar content)
4. Whether a potential customer would realistically consider both brands

Return your analysis as a strict JSON array. Do not include any text outside the JSON.`;

  const userPrompt = `Brand: ${brandName}
Website: ${targetUrl}
Country: ${country}

The following domains were identified by Semrush as having keyword overlap with ${targetUrl}.
Evaluate each one and decide if it is a TRUE business competitor in ${country}.

For each domain, return:
- domain: the domain string
- status: "keep" | "exclude"
- reason: one sentence explaining why you are keeping or excluding it
- competitorType: "direct" | "indirect" | "aggregator" | "informational" (only for kept competitors)

Semrush results (domain | competition_level | common_keywords | organic_traffic | authority_score):
${tableLines}

Return only a JSON array. No markdown, no explanation outside the array.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const text = response.choices[0]?.message?.content || '[]';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[gptAnalysisCA] validateCompetitors error:', err.message);
    // Fall back: keep all as "keep" with no reasoning
    return semrushResults.map(r => ({
      domain: r.domain,
      status: 'keep',
      reason: 'GPT validation unavailable — included based on Semrush competition score.',
      competitorType: 'direct',
    }));
  }
}

// Generate executive summary of the competitive landscape
async function generateCompetitorSummary(brandName, country, competitors) {
  const openai = getClient();
  const list = competitors.map(c =>
    `${c.domain} (Authority: ${c.authorityScore}, Traffic: ${c.organicTraffic}, Type: ${c.competitorType || 'direct'})`
  ).join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Based on this competitive set for ${brandName} in ${country}, write a 3–4 sentence executive summary of the competitive landscape. Mention the market leader, key traffic gaps, and the overall level of competition. Write in a professional, analytical tone suitable for a client-facing SEO report.

Competitors (kept):
${list}`,
      }],
      temperature: 0.5,
      max_tokens: 300,
    });
    return response.choices[0]?.message?.content?.trim() || '';
  } catch {
    return `${brandName} operates in a competitive landscape with ${competitors.length} identified competitors. Review the data below for detailed insights.`;
  }
}

// Draft Observations & Recommendations for a section
async function generateObsRecs(sectionName, brandName, country, dateRange, dataSummary) {
  const openai = getClient();

  const systemPrompt = `You are a senior SEO analyst at a digital marketing agency. You write concise, insight-led Observations & Recommendations for competitor analysis reports delivered to clients.

Your output must follow this exact structure:
- 2–3 bullet observations (start each with "•")
- 2–3 bullet recommendations (start each with "→")

Each bullet is 1–2 sentences max. Use specific numbers from the data. Write in a professional but direct tone. Do not use filler phrases. Do not add headers or section labels — output the bullets only.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Section: ${sectionName}
Brand: ${brandName}
Country: ${country}
Date range: ${dateRange}

Data:
${dataSummary}

Write Observations & Recommendations for this section of a competitive SEO audit.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 500,
    });
    return response.choices[0]?.message?.content?.trim() || '';
  } catch {
    return `• Analysis could not be generated for this section.\n→ Please add observations and recommendations manually.`;
  }
}

// Generate final executive summary from all O&R bullets
async function generateExecutiveSummary(brandName, allObsRecs) {
  const openai = getClient();
  const combined = Object.entries(allObsRecs)
    .map(([section, text]) => `=== ${section} ===\n${text}`)
    .join('\n\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `You are a senior SEO analyst. Based on the following section-by-section observations and recommendations for ${brandName}, write a 4–5 sentence executive summary paragraph for the deck cover. Focus on the most critical findings and overall strategic direction. Professional, client-facing tone.

${combined}`,
      }],
      temperature: 0.5,
      max_tokens: 400,
    });
    return response.choices[0]?.message?.content?.trim() || '';
  } catch {
    return `This competitive analysis covers ${brandName}'s organic search performance relative to key competitors. Review each section for detailed insights and actionable recommendations.`;
  }
}

module.exports = {
  validateCompetitors,
  generateCompetitorSummary,
  generateObsRecs,
  generateExecutiveSummary,
};
