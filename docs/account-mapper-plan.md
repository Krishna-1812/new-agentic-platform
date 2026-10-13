# People & Signals: the plan

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
  - optionally, search the web (Claude's paid web search) for the name and LinkedIn URL;
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
- **Where it lives:** on the agents page (`/strategic-agents/people-signals`), open to the whole team, tagged Building until it has proved itself.
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

## Where it stands

- **Phases 1–5 are built:**
  - the Saleshandy client;
  - the free mapping engine;
  - reveals with a credit cap;
  - the email pattern learned from verified emails;
  - the web search for empty seats;
  - priority ranking and Claude briefs;
  - the page, CSV and JSON exports;
  - the chat: ask in plain words, get the people (`tracker/people_chat.py`, `static/js/people_chat.js`).
- **Code:**
  - `tracker/saleshandy_client.py`;
  - `tracker/account_mapper.py` (mapping);
  - `tracker/account_mapper_reveal.py`;
  - `tracker/account_mapper_brief.py`;
  - `tracker/account_mapper_store.py` (runs in `am_runs`, CSV);
  - `tracker/people_chat.py` (reading a message, searching a team or a title).
- **Page:** Strategic Agents → **People & Signals** (`/strategic-agents/people-signals`), tagged Building. Open to the whole team; each person sees only their own runs. The old `/admin/account-mapper` address redirects.
- **The page** (`static/js/account_mapper.js`, `static/css/account_mapper.css`):
  - the hero shows a buying group; the form has a line counter, one-click title presets, "Try an example" and switches for the optional steps, and says plainly how to connect Saleshandy while there is no key (the Map button waits for it);
  - the run list shows each run's seats-filled bar, and "Run again" puts a run's accounts and titles back in the form;
  - a run in progress shows its progress and the accounts finished so far; a failed one says why and offers another go; the team can delete a run;
  - the dashboard has a seats-filled donut, what is hiring or funded, six figures, a **seat map** (every account against every title: found, close match, from the web, nobody) and the accounts to work first;
  - an account shows a score ring, its brief, its buying group, filters (new in role, decision-makers, with an email) and a card per person with a copy button for the address;
  - the first screen, before any run, explains the three steps.
- A client sees the same page without credits, costs, the reveal or delete.
- **Phase 6 waits for the key.**

### Adding the key (Windows laptop)
1. In Saleshandy, open **Settings → API Key → Create API Key**. Name it `northaxis-account-mapper` and click Create. Copy the key straight away, because Saleshandy shows it only once.
2. Open **railway.com**, open the project, then click the **web** service and its **Variables** tab.
3. Click **+ New Variable**. Name: `SALESHANDY_API_KEY`. Value: paste the key (Ctrl+V). Click **Add**, then **Deploy**.
4. When the deployment shows **Active**, open `/strategic-agents/people-signals` and press **Ctrl+F5**. The chip top right should read **Saleshandy: N credits**.
   - If it reads **no key**, the deployment hasn't finished.
   - If it shows an error, the key was copied wrong. Make a new key and replace the variable.

### Using it
1. Type the companies, one a line; add `| domain.com` when you know it. Then type the titles you sell to.
2. Choose the extras:
   - **Account signals** are free and on by default;
   - **Account briefs** cost about $0.005 each on Haiku;
   - **Claude phrases the titles** costs under a cent;
   - **Web search for empty seats** is paid, roughly $0.02 per empty seat.

   Claude's spending per run is capped at twice its estimate, between $0.50 and $3.00.
3. Click **Map accounts**. This uses no Saleshandy credits.
4. Read the results:
   - accounts are ranked by priority (score and reasons);
   - each account card shows the profile, team sizes, new leaders, hiring and funding signals, and the brief;
   - each title shows its best people and "also found".
5. Choose who to reveal. **Best per title** is ticked for you; untick or tick people as you like. Set the **credit cap**, then click **Reveal emails**. A dialog shows the most it can use and your balance, and nothing is spent until you confirm.
6. **Download CSV** gives one row per person, best accounts first: email, label, LinkedIn, the opener. It's ready to import into Saleshandy or a CRM.

**Email labels:**
- **Verified**: Saleshandy verified it.
- **Risky**: for example, a domain that accepts every address.
- **Not found**: no credit was charged.
- **Pattern**: built from the pattern that 2 or more verified emails at that company follow.
- **Pattern, likely**: built from the pattern of 1 verified email.

## Ask in plain words (the chat)

The page opens on a chat. Write what you want, the way you would say it:

- "marketing people at Stripe": a team, most senior first (default 10, "top 5" or "all" changes it);
- "who is the CMO of Databricks?" or "VP Sales and CFO at Notion and Ramp": job titles, several companies;
- "directors in finance at Shopify", "recruiters at Meta in Austin", "top 5 engineers at hubspot.com": a level, a place, a website;
- "and their sales team?" or "what about Notion?": a follow-up keeps the half you did not repeat.

**How it reads a message** (`tracker/people_chat.py`):
- Plain rules read it, free and instantly. They pick out the company (or companies, or a website), the people (a department, a level, a job title or a job family such as engineers), a count and a place.
- Only when the rules find no company or no kind of person, and only for the team with a Claude key, one small Claude call (Haiku, capped at $0.02, about $0.0004 in practice) reads it. The answer shows "Read by Claude" when that happened. A client's messages never use Claude.
- When it still cannot tell, it asks: "Who at Stripe?" with one-click choices.
- The "Looking for ... at ..." line above every answer shows what it understood, so a misreading is seen at once. Searching is free, so asking again costs nothing.

**Which company?** Before it searches for anyone it settles which company each name means (free, one or two Saleshandy company searches per name):
- a website you wrote (`stripe.com`) is trusted;
- a name that exactly one company in Saleshandy answers to goes ahead;
- anything else, several companies of that name, only a near name, or none, is put to you. Each candidate is a card with its website, LinkedIn page, industry, size and headquarters; click **This one** and the search goes ahead there. **None of these** asks you for the website.
- A company's likely website (`position2.com` for "Position2") is also looked up, so it is found when listed under a different name.
- Once the website is known, people are searched only at that website, never by the company's name, which is how namesakes' staff used to slip in.

**What comes back:** each message that names who to find becomes a run (it shows in Recent, History and the CSV like any other). The people appear as rows: name, title, place, decision-maker and new-in-role badges, and how many Saleshandy lists in all. A team is searched by Saleshandy's department (and, when that is thin, by job-title words), without interns, assistants or former staff, most senior first. A place ("in London") narrows the list by the location each person lists; when nobody lists it, it says so and shows everyone.

**Emails and LinkedIn:** Saleshandy's search returns neither. They arrive with the reveal, which is the same credit-capped reveal as the mapping: the people shown are ticked, **Get emails & LinkedIn** shows the most it can use and the balance, and nothing is spent until you confirm. Until then each row has a link that searches LinkedIn for that person (a plain link; it opens nothing on our side). The reveal's field names for the LinkedIn address are still read by guess until the first live reveal.

**Clients** can ask and download the CSV. They never see credits, ticks or the reveal, and their messages are read by rules only. A question that only gets a hint or a clarification does not count against a client's runs; a search does.

**Keeping it:** reloading the page starts a new chat (the one exception is a search still running, which is shown so its answer is not lost). Earlier questions stay in **Recent** and in the account's History: the runs list shows a question as the question, and clicking it brings its answer back. **New chat** clears the thread (and what a follow-up remembers), not your runs.

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
