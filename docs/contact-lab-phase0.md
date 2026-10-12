# Contact Finder Lab: Phase 0

> **Hidden (2026-10-12).** People & Signals (`/strategic-agents/people-signals`, built on Saleshandy) does this job now. The lab's page and API answer "not found" and it is off the admin menu. Its engine stays in the code because People & Signals uses its web search and email-pattern helpers. To bring it back, set `CONTACT_LAB_HIDDEN = False` in `app.py` and restore the menu entry.

**What it answers:** can company names and job titles be turned into the right people, their LinkedIn profiles and their work emails without a data platform? And which way of searching should do it: our own free search service (SearXNG), or Claude's paid web search?

**Where:** Admin → **Contact Finder Lab** (`/admin/contact-lab`). Admins only.

**Code:**
- `tracker/contact_lab.py`: the steps.
- `tracker/contact_lab_search.py`: the two ways of searching, and the cost cap.
- `tracker/contact_lab_store.py`: runs, kept in the `cl_runs` table.
- `static/js/contact_lab.js`: the page.
- `deploy/searxng/`: the search service.

## How a run works

The same searches go through each way of searching you tick, for every company:

1. **The website**, unless you gave it (`Acme | acme.com`).
2. **People:** for each job title, its two commonest phrasings, searched as LinkedIn results ("Jane Doe – CFO – Acme | LinkedIn"). LinkedIn's own pages are never opened. Its terms forbid scraping, and logged-out pages are a login wall anyway.
3. **The company's own pages** (team, about, leadership, contact): read free, respecting robots.txt.
4. **Addresses the web shows** at the company's email domain.

Then, for each company:

- **Who's right:** does each person still work there, in a title you asked for? With Claude ticked, one model call per company decides this from the search results. On a free run, text matching decides; it catches "ex. Stripe" and "a Stripe company".
- **Emails:** each person gets a likely work email with a label:
  - **Published**: seen on a public page.
  - **Pattern, confirmed**: 2 or more real addresses at the company follow that pattern.
  - **Pattern, likely**: 1 real address follows it, or 2 or more have its shape.
  - **Guess**: the commonest pattern, with nothing seen at this company to confirm it.

  No mailbox is ever probed. The run checks that the domain receives mail (DNS). When the website's own domain doesn't (corecareclinic.com doesn't), it uses the domain the company's addresses do (corecareclinic.org).
- **Port 25:** once per run, it checks whether this server can reach a mail server at all. It connects to Gmail's inbound server, reads the greeting and says QUIT, naming no address. That decides whether mailbox checks could ever be built from this server.

**The scoreboard shows, for each way of searching:**
- the right people it found;
- LinkedIn profiles, websites and addresses found;
- the share of its searches that were refused, and by which engine and why (captcha, rate limit, access denied);
- its time;
- its cost.

**Download JSON** keeps everything for review.

## Costs

| | Cost |
|---|---|
| Our search service (SearXNG) | Free per search. It runs as a small Railway service, a few dollars a month. |
| Claude web search | $10 per 1,000 searches, plus the tokens of the results the model reads |
| Claude checks | One small call per company, plus one per run for the job titles |
| A run | Capped at **$3.00**. It stops itself before a call that could pass the cap, and keeps what it found. |

A company with 3 job titles makes **8 Claude searches**, or 7 when you give the website. The page shows the estimate before you run. Roughly, per company with 3 titles:

| Model | Per company (estimate) |
|---|---|
| Claude Haiku 5.5 | about $0.09 |
| Claude Sonnet 5.5 | about $0.25 |
| Claude Opus 5.5 | about $0.42 |

Phase 0 measures the real figures.

## Setting up the search service on Railway (Windows laptop)

**1. Add the service**
1. Open **railway.com** in your browser and open the project.
2. Click **+ Create** (top right), then **GitHub Repo**, and choose `Krishna-1812/new-agentic-platform`.
3. A new service appears. Click it, then the **Settings** tab.
4. Under **Source**, set **Root Directory** to `deploy/searxng`.
5. Rename the service `searxng`: click its name at the top of the panel, type `searxng`, press Enter.
6. In **Settings → Networking**, do **not** click Generate Domain. The service must stay private.

**2. Give it its secret**
1. Still on the `searxng` service, open the **Variables** tab and click **+ New Variable**.
2. For the name, type `SEARXNG_SECRET`.
3. For the value, make a long random string:
   1. Press the **Windows key**, type `powershell`, press Enter.
   2. Paste this and press Enter:

      ```
      -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
      ```

   3. Copy the line it prints and paste it in as the value.
4. Click **Add**, then **Deploy** when Railway offers it. Wait for the deployment to show **Active**, about 2 minutes.

**3. Point the web service at it**
1. Click the **web** service, open **Variables**, then **+ New Variable**.
2. Name: `SEARXNG_URL`. Value: `http://searxng.railway.internal:8080`.
3. Click **Add**, then **Deploy**.

**4. Check it**
1. Open `/admin/contact-lab` on the live site and press **Ctrl+F5**.
2. The chip top right should read **Search service: up**.
3. If it reads **down**, the `searxng` service hasn't finished deploying, or the service isn't named `searxng`.

## Running Phase 0

1. **Pick the companies:** 10 real target accounts and 3 job titles. Mix sizes:
   - 3 large;
   - 4 mid-size B2B;
   - 2 small or local;
   - 1 outside the US.

   Companies whose right people you already know make the best test.
2. **Run A (free):** tick only **Our search service**. It costs nothing.
3. **Run B (paid):** the same companies and titles, both ways ticked, model **Claude Haiku 5.5**. About $0.87 for 10 companies, capped at $3.00.
4. **Run C (optional, paid):** 5 of the companies, both ways ticked, model **Claude Opus 5.5**, to see whether the stronger model checks people better. About $1.90; all 10 would pass the $3.00 cap.
5. **Download JSON** from each run and send the files back for review.

**What decides the next phase:**
- **Is the free route good enough?** If our search service finds most of the right people that Claude's search finds, and few of its searches are refused, it does the searching and Claude's search becomes the backup.
- **Does the check catch wrong people?** It should catch the wrong company, people who left, and wrong titles.
- **Are the emails trustworthy?** How many come out published or confirmed, against guessed.
- **What does it cost per company?**

## Limits and care

- **Engine terms:** our search service asks Google, Bing and the rest from a server. They often refuse that, and sending such queries is against their terms. It's a cost-saving experiment; switch it off by removing `SEARXNG_URL`.
- **Personal data:** names, titles and work emails of people in the EU or UK are personal data. Keep each run's sources (the JSON has them), use the results only for business outreach, and delete what you don't use.
