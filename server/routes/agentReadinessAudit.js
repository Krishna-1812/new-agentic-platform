const express = require('express');
const router = express.Router();
const axios = require('axios');
const OpenAI = require('openai');

// ── Scoring weights (must sum to 100, webbotauth = 0 = informational) ────────
const WEIGHTS = {
  robots: 7, sitemap: 7, linkheaders: 6,
  markdown: 10,
  aibots: 11, contentsignals: 9, webbotauth: 0,
  apicatalog: 8, oauth: 8, oauthresource: 8, mcp: 10, agentskills: 10, webmcp: 6,
};

const CATEGORIES = {
  Discoverability: ['robots', 'sitemap', 'linkheaders'],
  Content:         ['markdown'],
  'Bot Access':    ['aibots', 'contentsignals', 'webbotauth'],
  'API / Auth / MCP': ['apicatalog', 'oauth', 'oauthresource', 'mcp', 'agentskills', 'webmcp'],
};

function levelFromScore(score) {
  if (score >= 90) return 'Level 4 — Agent Native';
  if (score >= 75) return 'Level 3 — Agent Ready';
  if (score >= 50) return 'Level 2 — AI Aware';
  if (score >= 25) return 'Level 1 — Basic Web Presence';
  return 'Level 0 — Not Indexed';
}

async function safeFetch(url, opts = {}) {
  try {
    const r = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentReadinessBot/1.0)', ...opts.headers },
      ...opts,
    });
    return { status: r.status, headers: r.headers, data: r.data };
  } catch (e) {
    return { status: null, headers: {}, data: null, error: e.message };
  }
}

async function runChecks(inputUrl) {
  const origin = new URL(inputUrl).origin;

  // Fetch robots.txt and homepage in parallel upfront
  const [robotsResp, homeResp, mdResp] = await Promise.all([
    safeFetch(`${origin}/robots.txt`),
    safeFetch(inputUrl),
    safeFetch(inputUrl, { headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' } }),
  ]);

  const robotsText = typeof robotsResp.data === 'string' ? robotsResp.data : '';

  // ── 1. robots.txt ─────────────────────────────────────────────────────────
  const robotsOk = robotsResp.status === 200 &&
    (robotsResp.headers['content-type'] || '').includes('text/plain');
  const checks = {};

  checks.robots = {
    status: robotsOk ? 'pass' : 'fail',
    tech: robotsOk
      ? `Valid robots.txt returned (${robotsResp.status}, ${(robotsResp.headers['content-type'] || '').split(';')[0]})`
      : `robots.txt returned ${robotsResp.status || 'no response'}`,
  };

  // ── 2. XML sitemap ────────────────────────────────────────────────────────
  let sitemapFound = false, sitemapTech = '';
  const sitemapDeclared = robotsText.match(/^Sitemap:\s*(.+)$/im);
  if (sitemapDeclared) {
    const r = await safeFetch(sitemapDeclared[1].trim());
    sitemapFound = r.status === 200;
    sitemapTech = sitemapFound
      ? `Sitemap found at ${new URL(sitemapDeclared[1].trim()).pathname}`
      : `Sitemap declared in robots.txt but returned ${r.status}`;
  } else {
    for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/']) {
      const r = await safeFetch(`${origin}${p}`);
      if (r.status === 200) { sitemapFound = true; sitemapTech = `Sitemap found at ${p}`; break; }
    }
    if (!sitemapFound) sitemapTech = 'No sitemap found in robots.txt or common paths';
  }
  checks.sitemap = { status: sitemapFound ? 'pass' : 'fail', tech: sitemapTech };

  // ── 3. Link headers (RFC 8288) ────────────────────────────────────────────
  const linkHeader = homeResp.headers['link'] || '';
  checks.linkheaders = {
    status: linkHeader ? 'pass' : 'fail',
    tech: linkHeader
      ? `Link header found: ${linkHeader.substring(0, 120)}`
      : 'No Link header present in HTTP response',
  };

  // ── 4. Markdown negotiation ───────────────────────────────────────────────
  const mdCt = mdResp.headers['content-type'] || '';
  checks.markdown = {
    status: mdCt.includes('text/markdown') ? 'pass' : 'fail',
    tech: mdCt.includes('text/markdown')
      ? 'Site correctly returned text/markdown content'
      : `Site returned ${mdCt.split(';')[0] || 'unknown'} when agent sent Accept: text/markdown`,
  };

  // ── 5. AI bot rules ───────────────────────────────────────────────────────
  const aiBots = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'cohere-ai', 'Google-Extended'];
  const foundBots = aiBots.filter(b => robotsText.toLowerCase().includes(b.toLowerCase()));
  checks.aibots = {
    status: foundBots.length > 0 ? 'pass' : 'fail',
    tech: foundBots.length > 0
      ? `AI-specific bot rules detected in robots.txt: ${foundBots.join(', ')}`
      : 'No AI-specific bot rules found in robots.txt',
  };

  // ── 6. Content signals ────────────────────────────────────────────────────
  const hasContentSignal = /Content-Signal/i.test(robotsText);
  checks.contentsignals = {
    status: hasContentSignal ? 'pass' : 'fail',
    tech: hasContentSignal
      ? 'Content-Signal directive found in robots.txt'
      : 'No Content-Signal directives in robots.txt',
  };

  // Run remaining well-known checks in parallel
  const [wbAuth, apiCat, oidc, oauthAs, opr] = await Promise.all([
    safeFetch(`${origin}/.well-known/http-message-signatures-directory`),
    safeFetch(`${origin}/.well-known/api-catalog`),
    safeFetch(`${origin}/.well-known/openid-configuration`),
    safeFetch(`${origin}/.well-known/oauth-authorization-server`),
    safeFetch(`${origin}/.well-known/oauth-protected-resource`),
  ]);

  // MCP paths in parallel
  const [mcp1, mcp2, mcp3] = await Promise.all([
    safeFetch(`${origin}/.well-known/mcp/server-card.json`),
    safeFetch(`${origin}/.well-known/mcp/server-cards.json`),
    safeFetch(`${origin}/.well-known/mcp.json`),
  ]);

  const [skills1, skills2] = await Promise.all([
    safeFetch(`${origin}/.well-known/agent-skills/index.json`),
    safeFetch(`${origin}/.well-known/agent-skills.json`),
  ]);

  // ── 7. Web bot auth (informational) ──────────────────────────────────────
  checks.webbotauth = {
    status: wbAuth.status === 200 ? 'pass' : 'info',
    tech: wbAuth.status === 200
      ? 'HTTP message signatures directory found'
      : `/.well-known/http-message-signatures-directory returned ${wbAuth.status || 'no response'} (informational only)`,
  };

  // ── 8. API catalog ────────────────────────────────────────────────────────
  checks.apicatalog = {
    status: apiCat.status === 200 ? 'pass' : 'fail',
    tech: apiCat.status === 200
      ? '/.well-known/api-catalog found'
      : `/.well-known/api-catalog returned ${apiCat.status || 'no response'}`,
  };

  // ── 9. OAuth / OIDC ───────────────────────────────────────────────────────
  const oauthFound = oidc.status === 200 || oauthAs.status === 200;
  checks.oauth = {
    status: oauthFound ? 'pass' : 'fail',
    tech: oauthFound
      ? 'OAuth/OIDC discovery endpoint found'
      : `Both /.well-known/openid-configuration and oauth-authorization-server returned ${oidc.status || 'no response'}`,
  };

  // ── 10. OAuth protected resource ──────────────────────────────────────────
  checks.oauthresource = {
    status: opr.status === 200 ? 'pass' : 'fail',
    tech: opr.status === 200
      ? '/.well-known/oauth-protected-resource found'
      : `/.well-known/oauth-protected-resource returned ${opr.status || 'no response'}`,
  };

  // ── 11. MCP server card ───────────────────────────────────────────────────
  const mcpPass = [mcp1, mcp2, mcp3].find(r => r.status === 200);
  checks.mcp = {
    status: mcpPass ? 'pass' : 'fail',
    tech: mcpPass
      ? 'MCP server card found'
      : 'All MCP card paths returned 404 (server-card.json, server-cards.json, mcp.json)',
  };

  // ── 12. Agent skills index ────────────────────────────────────────────────
  const skillsPass = skills1.status === 200 || skills2.status === 200;
  checks.agentskills = {
    status: skillsPass ? 'pass' : 'fail',
    tech: skillsPass
      ? 'Agent skills index found'
      : 'Both agent-skills index paths returned 404',
  };

  // ── 13. WebMCP ────────────────────────────────────────────────────────────
  checks.webmcp = {
    status: 'fail',
    tech: 'WebMCP requires browser-side evaluation of navigator.modelContext (not detectable via HTTP)',
  };

  // ── Score & categories ────────────────────────────────────────────────────
  let score = 0;
  for (const [id, check] of Object.entries(checks)) {
    if (check.status === 'pass') score += WEIGHTS[id] || 0;
  }

  const cats = Object.entries(CATEGORIES).map(([name, ids]) => {
    const maxPts = ids.reduce((s, id) => s + (WEIGHTS[id] || 0), 0);
    const earnedPts = ids.reduce((s, id) =>
      s + (checks[id]?.status === 'pass' ? WEIGHTS[id] || 0 : 0), 0);
    const passed = ids.filter(id => checks[id]?.status === 'pass').length;
    const total = ids.length;
    return {
      id: name,
      score: maxPts > 0 ? Math.round((earnedPts / maxPts) * 100) : 0,
      passed,
      total,
    };
  });

  return { checks, score, level: levelFromScore(score), cats };
}

// ── CMO brief via OpenAI ─────────────────────────────────────────────────────
async function generateCmoBrief(siteUrl, score, level, checks, openai) {
  const passedChecks = Object.entries(checks).filter(([, c]) => c.status === 'pass').map(([id]) => id);
  const failedChecks = Object.entries(checks).filter(([, c]) => c.status === 'fail').map(([id]) => id);

  const prompt = `You are a senior digital strategist advising CMOs on AI readiness.

Site: ${siteUrl}
Agent-readiness score: ${score}/100 (${level})
Scan date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

Passing (${passedChecks.length}): ${passedChecks.join(', ') || 'none'}
Failing (${failedChecks.length}): ${failedChecks.join(', ') || 'none'}

Generate a CMO-level executive briefing. Be specific to this site's industry based on its domain. Address the CMO directly as "you". Plain language — no technical jargon. Return ONLY this JSON object, no markdown or preamble:
{
  "headline": "A punchy 10-15 word headline capturing the core risk or opportunity",
  "summary": "2-3 sentences explaining what this score means for the business, the competitive context, and what is at stake",
  "risk": "1 sentence naming the single most important business risk from this scan",
  "opportunity": "1 sentence on the top opportunity available if they act within the next 60 days",
  "competitive": "1 sentence on competitive positioning specific to their industry"
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

// ── Static check metadata ────────────────────────────────────────────────────
const CHECK_META = {
  robots:         { cat: 'Discoverability', label: 'robots.txt',                effort: 'done',   business: 'Crawl rules are accessible to all agents. This is the foundation — without it, agents cannot know what they are and are not allowed to index.', action: null },
  sitemap:        { cat: 'Discoverability', label: 'XML sitemap',               effort: 'done',   business: 'Agents can enumerate your full content structure. This accelerates discovery of all your pages, not just those linked from the homepage.', action: null },
  linkheaders:    { cat: 'Discoverability', label: 'Link headers (RFC 8288)',   effort: 'quick',  business: 'Without Link headers, agents cannot auto-discover your API or documentation endpoints. They rely on guesswork instead of following your signposts — adding friction to every automated interaction.', action: 'Add Link: </.well-known/api-catalog>; rel="api-catalog" to your server\'s HTTP response headers. ~1–2 hours with a developer.' },
  markdown:       { cat: 'Content',         label: 'Markdown negotiation',      effort: 'medium', business: 'AI agents parse raw HTML including nav menus and footers — not your actual content. This degrades how AI tools summarize and cite your information, creating risk of misquotation or incomplete representation.', action: 'Enable Markdown for Agents via Cloudflare or server middleware. When a request includes Accept: text/markdown, respond with Content-Type: text/markdown. ~1–3 days of dev time.' },
  aibots:         { cat: 'Bot Access',      label: 'AI bot rules',              effort: 'done',   business: "You're actively managing AI crawler access. This signals technical governance maturity to partners, platforms, and regulators.", action: null },
  contentsignals: { cat: 'Bot Access',      label: 'Content signals',           effort: 'quick',  business: "You haven't declared whether your content can be used for AI training. That's an IP governance gap — and increasingly one partners, distributors, and regulators will ask about.", action: 'Add one line to robots.txt: Content-Signal: ai-train=no, search=yes, ai-input=yes. 15 minutes. No developer needed.' },
  webbotauth:     { cat: 'Bot Access',      label: 'Web bot auth',              effort: 'low',    business: "Your server can't cryptographically identify itself for agent-to-agent trust verification. Not urgent today — will matter as authenticated agent networks mature in 2026–27.", action: 'Backlog for H2 2026. Publish a JWKS at /.well-known/http-message-signatures-directory.' },
  apicatalog:     { cat: 'API / Auth / MCP', label: 'API catalog (RFC 9727)',   effort: 'medium', business: "Agents and AI platforms can't auto-discover your APIs or developer resources. Your tools, integrations, and documentation are dark to the AI ecosystem.", action: 'Create /.well-known/api-catalog as application/linkset+json with service-desc and service-doc relations for any existing API. ~3–5 days.' },
  oauth:          { cat: 'API / Auth / MCP', label: 'OAuth / OIDC discovery',   effort: 'medium', business: "AI agents can't programmatically authenticate with any protected resources you offer — blocking agentic access to portals, dashboards, or any authenticated endpoints.", action: 'If you have protected APIs, publish /.well-known/openid-configuration with auth endpoint details. If no public APIs exist yet, deprioritize.' },
  oauthresource:  { cat: 'API / Auth / MCP', label: 'OAuth protected resource', effort: 'medium', business: "Agents can't discover which authorization servers grant access to your resources. Pair this fix with OAuth / OIDC discovery.", action: 'Publish /.well-known/oauth-protected-resource alongside the OAuth discovery setup.' },
  mcp:            { cat: 'API / Auth / MCP', label: 'MCP server card',          effort: 'high',   business: 'You have zero MCP presence. As Claude, ChatGPT, and other AI agents use MCP to interact with tools and services, you\'re not in the room. Competitors who publish an MCP card get invoked — you don\'t.', action: 'Publish /.well-known/mcp/server-card.json with serverInfo, transport endpoint, and capabilities. Strategic priority for 2026.' },
  agentskills:    { cat: 'API / Auth / MCP', label: 'Agent skills index',       effort: 'high',   business: 'No declared capabilities for AI agents. Competitors with Agent Skills can be invoked directly by AI assistants. You can only be found passively via web search.', action: 'Publish /.well-known/agent-skills/index.json. Define skills for key user intents specific to your business.' },
  webmcp:         { cat: 'API / Auth / MCP', label: 'WebMCP',                   effort: 'high',   business: 'Your website cannot expose interactive capabilities to in-browser AI agents. As Chrome and Safari ship native AI APIs, sites with WebMCP registered tools will surface above those without.', action: 'Implement navigator.modelContext.provideContext() for key site actions. Q3/Q4 2026 priority.' },
};

// ── Route ─────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let parsedUrl;
  try { parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  try {
    const { checks, score, level, cats } = await runChecks(parsedUrl.href);

    // Build full check list with metadata merged in
    const fullChecks = Object.entries(checks).map(([id, result]) => ({
      id,
      ...CHECK_META[id],
      status: result.status,
      tech: result.tech,
    }));

    // Generate CMO brief
    let cmoBrief = null;
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      cmoBrief = await generateCmoBrief(parsedUrl.href, score, level, checks, openai);
    } catch (e) {
      console.warn('[agent-readiness] CMO brief failed:', e.message);
    }

    res.json({
      site: {
        url: parsedUrl.hostname,
        full: parsedUrl.href,
        score,
        level,
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      },
      cats,
      checks: fullChecks,
      cmoBrief,
    });
  } catch (err) {
    console.error('[agent-readiness] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
