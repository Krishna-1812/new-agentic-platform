# Agent Readiness Audit Module — What's Built

## Overview

The Agent Readiness Audit is a full-stack module that scores any website 0–100 on its readiness for AI agent traffic. It runs up to 23 automated checks across HTTP infrastructure, bot access, API/auth protocols, and live browser-rendered on-page signals. Results are presented with a CMO executive brief (GPT-4o mini), a prioritized implementation roadmap, and a downloadable PDF report.

**Route:** `/agent-readiness-audit`  
**API endpoint:** `POST /api/agent-readiness-audit`  
**PDF endpoint:** `POST /api/agent-readiness-audit/pdf`

---

## Scoring Model

| Level | Score | Label |
|-------|-------|-------|
| 4 | 90–100 | Agent Native |
| 3 | 75–89 | Agent Ready |
| 2 | 50–74 | AI Aware |
| 1 | 25–49 | Basic Web Presence |
| 0 | 0–24 | Not Indexed |

Scores combine HTTP checks (0–100 weighted) with on-page checks (proportional when URLs provided). When only a homepage URL is provided, the HTTP score is the total. When action/form URLs are added, scores merge proportionally.

---

## Check Categories & Weights

### HTTP Checks (13 checks, always run)

Run via `axios` against the live site — no browser required. These 13 checks run in parallel and are the foundation score.

| Check ID | Label | Weight | Category |
|----------|-------|--------|----------|
| `robots` | robots.txt | 7 | Discoverability |
| `sitemap` | XML sitemap | 7 | Discoverability |
| `linkheaders` | Link headers (RFC 8288) | 6 | Discoverability |
| `markdown` | Markdown negotiation | 10 | Content |
| `aibots` | AI bot rules | 11 | Bot Access |
| `contentsignals` | Content signals | 9 | Bot Access |
| `webbotauth` | Web bot auth (informational) | 0 | Bot Access |
| `apicatalog` | API catalog (RFC 9727) | 8 | API / Auth / MCP |
| `oauth` | OAuth / OIDC discovery | 8 | API / Auth / MCP |
| `oauthresource` | OAuth protected resource | 8 | API / Auth / MCP |
| `mcp` | MCP server card | 10 | API / Auth / MCP |
| `agentskills` | Agent skills index | 10 | API / Auth / MCP |
| `webmcp` | WebMCP | 6 | API / Auth / MCP |

**What each checks:**

- **robots.txt** — Valid `text/plain` response at `/robots.txt`
- **sitemap** — XML sitemap declared in robots.txt or found at `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap/`
- **linkheaders** — `Link:` HTTP header present in homepage response (RFC 8288)
- **markdown** — Site returns `Content-Type: text/markdown` when agent sends `Accept: text/markdown`
- **aibots** — Presence of AI-specific bot rules in robots.txt (GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, cohere-ai, Google-Extended)
- **contentsignals** — `Content-Signal:` directive in robots.txt (AI training/usage governance)
- **webbotauth** — `/.well-known/http-message-signatures-directory` exists (informational only, weight 0)
- **apicatalog** — `/.well-known/api-catalog` returns 200 (RFC 9727)
- **oauth** — Either `/.well-known/openid-configuration` or `/.well-known/oauth-authorization-server` returns 200
- **oauthresource** — `/.well-known/oauth-protected-resource` returns 200
- **mcp** — Any of `/.well-known/mcp/server-card.json`, `/.well-known/mcp/server-cards.json`, `/.well-known/mcp.json` returns 200
- **agentskills** — Either `/.well-known/agent-skills/index.json` or `/.well-known/agent-skills.json` returns 200
- **webmcp** — Always fails (not detectable via HTTP; requires browser-side `navigator.modelContext` evaluation)

---

### On-Page Checks (10 checks, require action/form URL)

Run via Puppeteer (headless Chrome/Edge). The browser opens each provided URL once and runs all applicable checks for that slot.

| Check ID | Label | Max Score | Category | Slot(s) |
|----------|-------|-----------|----------|---------|
| `form_labels` | Form label association | 10 | Forms | `url_form` |
| `input_type` | Input type correctness | 6 | Forms | `url_form` |
| `autocomplete` | Autocomplete attributes | 6 | Forms | `url_form` |
| `schema_search` | Schema.org SearchAction | 5 | On-Page Signals | `url_homepage` |
| `schema_action` | Schema.org transactional actions | 5 | On-Page Signals | `url_action` |
| `captcha` | CAPTCHA detection | 8 | On-Page Signals | `url_form`, `url_action` |
| `cookie_banner` | Cookie banner accessibility | 6 | On-Page Signals | `url_homepage` |
| `js_rendering` | JavaScript rendering gap | 8 | On-Page Signals | all three |
| `vague_buttons` | Vague button labels | 4 | Forms | `url_action`, `url_form` |
| `interactive_divs` | Interactive div detection | 5 | Forms | `url_action`, `url_form` |

**What each checks:**

- **form_labels** — Every `<input>` has a `<label for>`, `aria-label`, or `aria-labelledby`
- **input_type** — Inputs for email/phone/number/date use the correct `type` attribute (not `type="text"`)
- **autocomplete** — All inputs have `autocomplete` attributes set
- **schema_search** — JSON-LD `potentialAction` with `@type: SearchAction` present on homepage
- **schema_action** — JSON-LD `potentialAction` with `BuyAction`, `OrderAction`, `ReserveAction`, or `BookAction`
- **captcha** — No CAPTCHA scripts detected (reCAPTCHA, hCaptcha, Cloudflare Turnstile, FunCaptcha, Arkose)
- **cookie_banner** — If a cookie banner is present, its dismiss button must be a native `<button>` with `tabindex !== -1`
- **js_rendering** — Compares raw HTML (non-JS fetch) vs rendered DOM; flags if forms/buttons/pricing only exist after JS executes
- **vague_buttons** — Flags generic button labels: "Submit", "Continue", "Go", "OK", "Send", etc. (flag-only, informational)
- **interactive_divs** — Detects `<div onclick>` / `<span onclick>` without `role="button"` and `tabindex`

For checks that run on multiple slots (e.g., `captcha` on both `url_form` and `url_action`), the **worst result wins** — a fail on any slot counts as a fail.

---

## Input Fields

The audit accepts up to 3 URLs:

| Field | Required | Purpose |
|-------|----------|---------|
| `url_homepage` | Yes | Main site URL — runs all 13 HTTP checks |
| `url_action` | Optional | Product / service page — schema actions, CAPTCHA, vague buttons, rendering |
| `url_form` | Optional | Contact / checkout page — form label, input type, autocomplete, CAPTCHA |

If only the homepage is provided: 13 checks run (~15s). With action + form URLs: all 23 checks run (~35s).

---

## AI Features

### CMO Executive Brief
- Powered by GPT-4o mini
- Generates a business-level interpretation of the score: headline, summary (2–3 sentences), top risk, 60-day opportunity, and competitive context
- Tailored to the site's industry based on the domain
- Appears as a purple card in the UI and in the PDF

---

## Output Structure

```json
{
  "site": {
    "url": "example.com",
    "full": "https://example.com/",
    "score": 42,
    "level": "Level 2 — AI Aware",
    "date": "May 26, 2026",
    "httpScore": 42,
    "onPageScore": 38,
    "onPageMax": 63
  },
  "cats": [
    { "id": "Discoverability", "score": 67, "passed": 2, "total": 3 },
    { "id": "Content", "score": 0, "passed": 0, "total": 1 },
    ...
  ],
  "checks": [
    {
      "id": "robots",
      "cat": "Discoverability",
      "label": "robots.txt",
      "effort": "done",
      "business": "...",
      "action": null,
      "status": "pass",
      "tech": "Valid robots.txt returned (200, text/plain)"
    },
    ...
  ],
  "onPageChecks": [
    {
      "id": "form_labels",
      "cat": "Forms",
      "label": "Form label association",
      "effort": "quick",
      "business": "...",
      "action": "...",
      "maxScore": 10,
      "flagOnly": false,
      "status": "fail",
      "tech": "3 of 5 inputs unlabeled...",
      "detail": "...",
      "score": 0
    },
    ...
  ],
  "cmoBrief": {
    "headline": "...",
    "summary": "...",
    "risk": "...",
    "opportunity": "...",
    "competitive": "..."
  }
}
```

---

## UI — What's Rendered

### Header bar
- Site URL, readiness level, scan date
- "+10 on-page checks" badge if on-page checks ran
- **Download PDF** button
- Link to the audited site

### Score panel
- SVG score ring with color-coded score (green ≥70, amber 40–69, red <40)
- Pass / fail / info counts
- "Quick wins this week could raise your score to X/100" projection (+16 points from quick-win checks)

### Sub-scores banner (only when on-page checks ran)
- HTTP readiness score (out of 100)
- On-page readiness score (out of on-page max)

### Category bars
- Per-category score bars (Discoverability, Content, Bot Access, API/Auth/MCP, On-Page Signals, Forms)
- Shows passed/total count per category

### CMO Executive Brief
- Headline (bold, large)
- Summary paragraph
- 3-cell grid: Top Risk (red) / 60-Day Opportunity (green) / Competitive Context (purple)

### Findings tab
- Category filter chips (All + each category name)
- Expandable `CheckRow` per check showing:
  - Status badge (Pass / Fail / Info / Flag)
  - Effort badge (Completed / Quick win / Medium lift / Strategic / Low lift)
  - **Technical finding** — raw check result
  - **Business impact** — why it matters to the business
  - **Specific issues found** — details (when failing)
  - **Recommended action** — exact steps to fix it
- Tip banner when on-page checks haven't run

### Priority Roadmap tab
- 3-tier grid: **This week** / **This quarter** / **Strategic horizon**
- Each tier lists applicable checks with status badge, first sentence of action, and effort estimate
- Checks that have already passed show "✓ Done"

---

## PDF Report

Generated server-side via Puppeteer rendering an HTML template.

**Endpoint:** `POST /api/agent-readiness-audit/pdf`  
**Input:** Full result JSON (same structure as audit response)  
**Output:** `application/pdf` download

**PDF contents:**
- Header: site URL, level, scan date, score (large number), pass/fail summary
- CMO executive brief block (if available)
- Score-by-category bar charts (visual)
- "About this audit" text box with check count
- All findings table: Status | Check | Category | Finding (one row per check)

---

## Effort Classification

| Effort label | Meaning | Examples |
|---|---|---|
| `done` | Already passing, no action needed | robots.txt, sitemap, AI bot rules |
| `quick` | 15 min – 2 hours, no dev required or minimal | Content signals (15 min), link headers (~2 hrs) |
| `medium` | 30 min – 2 weeks, developer involvement needed | Markdown negotiation, API catalog, OAuth |
| `high` / `strategic` | 2–8 weeks, architectural work | MCP server card, agent skills index, WebMCP, CAPTCHA replacement |
| `low` | Low effort, backlog item | Web bot auth |

---

## Architecture

```
client/src/pages/AgentReadinessAuditPage.jsx   — React UI
server/routes/agentReadinessAudit.js           — Express route + PDF endpoint
server/checks/onpage.js                        — Puppeteer on-page check runner
```

**Dependencies:**
- `axios` — HTTP checks
- `puppeteer-core` + `@sparticuz/chromium` — on-page checks and PDF generation
- `openai` — CMO brief via GPT-4o mini
- `cheerio` — raw HTML parsing in JS rendering gap check

**Browser launch strategy:** Prefers a locally installed Chrome/Edge (scans known paths); falls back to `@sparticuz/chromium` for Railway deployment.

---

## Known Limitations / Not Yet Built

- **WebMCP** always returns `fail` — the check requires evaluating `navigator.modelContext` in a browser context and cannot be detected via HTTP request. Marked as always-fail with a note.
- **No historical tracking** — audits are not stored; each run is stateless
- **Single-page scoring** — on-page checks evaluate one page per slot; multi-page crawl not supported
- **No scheduled/recurring audits** — no cron or notification system
- **No comparison mode** — can't diff two audit runs or track score over time
