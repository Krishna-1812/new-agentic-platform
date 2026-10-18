# Paid Marketing Agents

The paid media (PPC) team's agents, ported from the source platform (`ai-positon2/intelligence-platform`, commit
`ddfd61d`) by copying its code and adapting it, never rewriting it: that code carries fixes found against real Google
Ads and Meta accounts. They sit on the Operational Agents page with a **Paid marketing** pill, at
`/strategic-agents/paid-marketing/<agent>`, and open inside every client workspace.

## The rules carried over

- **Read only** toward the ad platforms: Google Ads GAQL `search` and Meta Graph `GET`. No write path, anywhere.
- **Credentials only from the environment**, never logged, returned or put in a URL. A missing one is named and the
  rest of the page still works. The Google Ads manager account comes only from `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: the
  source's default MCC was removed, so an unset one is reported, never replaced.
- **A failure never looks like a result**: a failed read shows as failed or unknown, never as zero or a pass.
- **No em or en dashes** in anything shown or written (model output is stripped of them).
- **Exports are formula-safe**, and every fetch of a user or model supplied URL goes through
  `tracker/event_intel_http.public_get`.

## Status

| Step | What | State |
|---|---|---|
| 1 | The backend: every `tracker/paid_*` module and its module tests | This PR |
| 2 | Performance Summarizer, with the shared page layout, the cards and the workspace wiring | Next |
| 3 | Product, Segment, Geo, Seasonality, Ad Strength, Audience Segments, Asset Coverage | One PR each |
| 4 | Account Audit, Landing Page Check, Experiment Tracker | One PR each |
| 5 | Pacing Desk and Search Query Analysis, with the source's client data taken out | One PR each |
| 6 | Business Research, Keyword Research, Strategy and Campaign Book, QA Agent | One PR each |
| 7 | Call Transcript Analyzer (needs `CALLRAIL_API_KEY`) and Client Feedback (needs Slack and Google OAuth apps) | When those exist |

**Held back from step 1, with their tests:** the Pacing Desk (`paid_pacing*`, `paid_refresh*` and the vendored
engine), Search Query Analysis (`paid_sqr*`) and the Client Feedback Agent (`paid_feedback`). Their code holds the
source's real client names: per-client budget rules, query rulebooks and example prompts. Each comes in its own PR
with those taken out and the algorithm kept.

**What changed from the source in step 1:** the source company's name in model prompts, PDF footers and the fetch
user agents is now the agency's or the brand's (`brand.BRAND`); staff addresses in the tests are the platform's;
the design docs say "the agency". `market_radar_llm` keeps the model's token usage on every reply (the cost ledger
reads it). `pandas` (the pacing engine) and `cryptography` (encrypted OAuth tokens) are in `requirements.txt`.

## Variables (Railway → web → Variables)

| Variable | For |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Every Google Ads read |
| `META_ADS_ACCESS_TOKEN` (a System User token with `ads_read`), optional `META_BUSINESS_ID`, `META_API_VERSION` | Every Meta read |
| `ANTHROPIC_API_KEY` | The written parts (already set) |
| `PAGESPEED_API_KEY` | Optional: the Landing Page Check's speed score |
