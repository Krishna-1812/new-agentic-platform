# Account Mapper: the plan

**What it does:** you give it company names and the job titles you sell to. For every company it returns:
- **the right people**, with their LinkedIn profile and a verified work email;
- **a picture of the account**: who's who, who is new, which team is growing, whether the company is hiring, and who to contact first and why.

**Built around Saleshandy.** Saleshandy's Lead Finder holds a database of people and companies, which it says is 700M+ contacts. Its API is public (`https://open-api.saleshandy.com/v1`, key in the `x-api-key` header).

**What costs what:**
- **Searching Saleshandy is free.** Credits are spent only when a contact is revealed.
- The agent does all its searching and its picture of each account for free, then asks you before spending a credit.
- Claude is used only where it adds judgement. It is optional and costs cents.

## What each source gives, and what it costs

| Source | What we get | Cost |
|---|---|---|
| Saleshandy **people search** (`POST /search/people`) | Per person: name, photo, current title, company and website, department, city/state/country, total years of experience, a decision-maker flag, and Saleshandy's lead id. Filters include company domain or name, job title (with words to exclude), seniority, department, years in current role, recent job change, location. | **Free** (no credits; Saleshandy charges only on reveal) |
| Saleshandy **company search** (`POST /search/companies`) | Name, LinkedIn page, website, X, Crunchbase and other links, HQ, founded year, industry, public/private, B2B flag, SIC/NAICS codes, employee count. Filters also answer yes/no questions: is it hiring (open jobs, and for which titles), does it use a given technology, when it last raised money, its web traffic, and its employee-review scores. | **Free** |
| **Counting** with those searches (each search reports its total) | Headcount per department in Saleshandy's data, decision-makers, people new in their role in the last year, leaders who changed jobs recently. | **Free** (one search per count; capped per company) |
| Saleshandy **contact enrichment** (`POST /enrich/contact`, by lead id, LinkedIn URL, or name + company domain) | A verified work email and its verification status. Saleshandy says each comes with 30–50 data points, which should include the LinkedIn URL. | **1 credit per email found.** Nothing is charged when nothing is found, and a contact revealed in the last 30 days is free again. A phone costs 7 credits, so it is **off by default**. |
| Saleshandy **profile only** (same call, `profile_only`) | Name, title, company, location, LinkedIn, with no email | "Reduced credit cost", per Saleshandy. The exact cost is measured on the first run. |
| Saleshandy **company enrichment** (`POST /enrich/company`) | Saleshandy says 30–50 data points per company (funding, technology, traffic and more) | **0.1 credit** per company. Optional. |
| Our **site reader** (built for Market Radar; robots.txt respected) | The company's own about, team, news and careers pages | **Free** |
| **DNS** | Whether the domain receives mail, and its provider (Google Workspace or Microsoft 365) | **Free** |
| **Claude** (Haiku 5.5 by default) | Title phrasings; picking the best person when titles are close; the account brief and an opening line per person | **About $0.005–0.01 per company** on Haiku. Optional. |

**Credits in money:** a top-up pack of 500 credits costs $13, so **an email costs about $0.026**. Credits already in your plan cost nothing extra, but they reset each month.

**A typical run, 10 accounts × 3 titles:**
- mapping and insights are free;
- revealing the best person per title is about **30 credits**, and the agent asks first;
- Claude briefs are about **$0.05–0.10**.

## How a run works

```
companies + titles
   │
   ▼  1. RESOLVE (free)   name → the right company and domain: company search, then our own check
   ▼  2. MAP (free)       people search per company and title, then broadened if empty; candidates ranked
   ▼  3. INSIGHT (free)   counts and signals: team sizes, new leaders, hiring, tech, funding; website read
   ▼  4. PREVIEW          you see everyone found, with free details, plus a credit estimate and your balance
   ▼  5. REVEAL (credits) only who you tick; a credit cap per run; batches of 100; results polled
   ▼  6. FILL GAPS        email pattern learned from verified emails (free); web search for titles
   │                      nobody in Saleshandy holds (optional, paid)
   ▼  7. BRIEF (Claude)   per account: what they do, what changed, who first and why, an opener per person
   ▼
account cards · people table · CSV / JSON export · run history
```

## Phases

### Phase 1: Saleshandy connection (free)
`tracker/saleshandy_client.py`

- One client for the calls we use:
  - credits;
  - rate limits;
  - filters;
  - people search and company search;
  - contact and company enrichment;
  - job status and results.
- Saleshandy quirks handled:
  - no results comes back as `payload: []` rather than an empty list;
  - "unknown" can come back as `""`, and errors come in two shapes;
  - a 429 response waits and retries a bounded number of times;
  - a bad key stops the run with a plain message.
- Every request is logged per run: endpoint, time, status, and credits charged. The page can show exactly what happened.
- Enrichment results are read field by field from several possible names. Saleshandy's spec doesn't fix their shape yet, so each raw record is also kept until the first live run confirms it.
- **"Check connection"** shows your credit balance, today's and this month's use, and the rate limits. It costs nothing.

### Phase 2: free mapping engine
`tracker/account_mapper.py`

- **Titles become search filters:**
  - title phrasings come from built-in rules (CMO = Chief Marketing Officer, VP = Vice President, Head of …), plus Claude if ticked;
  - words to exclude: assistant, intern, former, and so on;
  - each title is also mapped to Saleshandy's seniority and department values, for broadening.
- **Resolve each company:**
  - a domain you give wins;
  - otherwise company search by name;
  - the closest name wins, with the larger company and a matching website breaking ties;
  - other companies with the same name are shown, so a wrong pick is visible.
- **Find people:**
  - company domain + title phrasings, minus the excluded words;
  - if nobody is found, broaden to seniority + department;
  - then search by company name;
  - each fallback is recorded.
- **Rank candidates per title:**
  - an exact title beats a partial one;
  - seniority, the decision-maker flag and department add weight;
  - excluded words disqualify;
  - the best N per title (default 2) are picked; the rest stay visible as "also found".
- **Free insights per company (capped searches):**
  - team size per relevant department;
  - decision-makers;
  - people new in their role in the last year, with names;
  - whether the company is hiring, and for the titles you sell to;
  - whether it recently raised money.

### Phase 3: reveal, with your approval
- **Preview:**
  - everyone found, with what's free;
  - "this reveal uses at most N credits; you have M";
  - you tick who to reveal (default: the best person per title).
- **Reveal:**
  - one enrichment request per 100 people;
  - results are polled until done;
  - each person gets their email, its status (valid / risky) and their LinkedIn URL;
  - a **credit cap per run** that a reveal can't pass;
  - phones only when ticked.
- **Learn the company's email pattern from verified emails:**
  - once two verified emails at a company share a pattern (first.last@), anyone else found there gets that address free, labelled **"pattern, from N verified"**;
  - with one verified email, it's labelled **likely**;
  - with none, there's no address.
- **Titles nobody in Saleshandy holds:**
  - optionally, search the web (the Contact Finder Lab's search: free SearXNG, or Claude's paid search) for the name and LinkedIn URL;
  - then ask Saleshandy for the email by LinkedIn URL;
  - this costs 1 credit, and only when an email is found.

### Phase 4: the insight layer
- **The company's own pages**, read free: about, news or blog, careers. These give what they sell, recent news, and the roles they're hiring for.
- **Claude writes one brief per account** (Haiku 5.5 by default):
  - what the company does, in a line;
  - its size and shape;
  - **what changed**: new leaders, hiring, funding;
  - **who to contact first and why**;
  - **one opening line per person**, built from their title, time in role and the company's news.
- All of it is built only from the facts collected, each with its source. No made-up claims.
- **A run summary ranks the accounts:**
  - the ones with fresh signals (a new leader in your buyer's seat, hiring for it, recent funding) come first.

### Phase 5: the page
- **Steps:** enter companies and titles, then **Map** (free), then **Choose** (credit counter), then **Reveal**, then **Results**.
- **Results:**
  - account cards with the company profile, team-size bars, the new-in-role badges, signals and the brief;
  - a people table: photo, name, title, time in role, decision-maker, location, LinkedIn, email and its status;
  - every value says where it came from.
- **Exports:** CSV, one row per person, ready to import into Saleshandy or a CRM; and JSON with everything.
- **History:** run history kept per user.
- **Where it lives:** an admin page first; it becomes a card among the agents once it has proved itself.
- **Later, only on request:** "Add to a Saleshandy sequence" (`/leads/bulk-actions/add-to-sequence`). It's an outward action, so it always shows a preview and asks first.

### Phase 6: go-live with your key
1. You add `SALESHANDY_API_KEY` in Railway (web → Variables).
2. **Check connection** (free): your balance and limits.
3. **A free mapping run** on 5 accounts whose people you know: does it find them, and are the titles right?
4. **A 5-credit reveal**, after your yes. This confirms the real shape of enrichment results and what "profile only" costs; the parser is tightened to match.
5. Then decide:
   - the default number of people per title;
   - whether to keep the web-search gap filler;
   - whether to open the agent to the team or clients.

## What it won't do

- **It doesn't find everyone.**
  - Small companies, very new hires, and regions Saleshandy covers thinly will have gaps.
  - The agent says **not found** and what it tried, never a guess dressed up as an answer.
- **It never spends credits without your yes,** and never reveals phones unless you tick them.
- **It never opens LinkedIn pages.**
- **It never sends emails or adds anyone to a sequence on its own.**

## Data and keys

- **The key:** `SALESHANDY_API_KEY` lives in Railway → web → Variables, never in git or chat.
- **What goes to Saleshandy:** company names and domains, job titles, and (for reveals) Saleshandy's own lead ids or LinkedIn URLs. Nothing else from this platform goes there.
- **Personal data:** names, titles and work emails of people in the EU/UK are personal data. Keep each run's sources (the JSON has them), use the results for business outreach only, and delete what you don't use.
