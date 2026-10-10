# Market Radar on Northaxis: how it works and how to set it up

Market Radar is a market-intelligence agent, admin-only, at **/admin/market-radar**.
Give it a company's website and it:

1. **Reads the site** (`market_radar_site.py`, no model): structured data, shop platform, jobs
   board, store locator, sitemap make-up, country signals. Then **one Sonnet call**
   (`market_radar_profile.py`) turns those facts into a typed profile, quoting the page for
   every key claim. You can correct any field. Your corrections are kept when the site is
   read again.
2. **Finds competitors** (`market_radar_rivals.py`). Candidates come from five places: the
   site itself, the model's own knowledge, Google results via Apify, "top 10" articles, and
   (for a local business) every same-category place nearby from Overture Maps. Each
   candidate's homepage is read and judged by Haiku. Sonnet then ranks the survivors as
   direct, indirect, local or aspirational. You confirm, remove or add competitors.
3. **Watches them** (`market_radar_collect.py`; free: no model, no paid search). Each run
   reads every confirmed or suggested competitor's:
   - locations, catalogue and prices, promotions, key pages, review counts and newsroom
     (`market_radar_detectors.py`);
   - open roles (`market_radar_jobs.py`);
   - news (`market_radar_news.py`);
   - and, for B2B companies, new subdomains, SEC filings, Apollo headcount, the UK company
     register and LinkedIn posts (`market_radar_b2b.py`, `market_radar_linkedin.py`).

   Every read is stored as a snapshot. Next time, the difference is the news.
4. **Looks around it.**
   - *Nearby and new* (`market_radar_radar.py`): new businesses nearby, or new brands in the
     category.
   - *Industry pulse* (`market_radar_pulse.py`): the industry's news this month, grouped into
     themes.
5. **Turns headlines into moves** (`market_radar_signals.py`). Haiku sorts headlines into
   typed events (an opening, a price cut, a C-suite change), and each event is scored for
   your company.
6. **Writes a cited report** (`market_radar_report.py`). Sonnet writes it, and every
   statement must cite the evidence pack. Then Haiku checks each statement against its
   evidence, and removes any it doesn't support.
7. **Weekly "what changed" update** (`market_radar_digest.py`, `market_radar_monitor.py`),
   sent by email or Slack. **Off on Northaxis unless you switch it on** (below).

**Cost control.** Every paid call goes through the cost ledger (`market_radar_ledger.py`).
Each call is booked at its worst case before it is sent, and refused if it could take the run
past its cap ($1.00 by default, `MR_RUN_COST_CAP_USD`). The measured cost replaces the
booking afterwards. The cost report (`/admin/market-radar/api/cost-report`) shows what runs
really cost.

## What it costs

| What | Typical cost | Charged by |
|---|---|---|
| Find competitors for a new company (profile, search, checks, ranking) | about $0.10 to $0.25 | Anthropic and Apify |
| A collection plus the report (the first one) | most of the rest of a ~$0.15 to $0.30 first run | Anthropic |
| Weekly refresh, per company | about $0.07 to $0.12 | Anthropic |
| Hard cap, any single run | $1.00 | the ledger refuses past it |
| Google search, per query | about $0.003 ($0.0025 per results page on Apify Starter, $0.0045 on Free) | Apify |
| Real browser for a site that blocks servers | compute units, booked at worst case first | Apify |

The ledger's model rates, per million tokens: Sonnet 5.5 $2 in, $10 out; Haiku 5.5 $0.10 in,
$0.50 out.

## The keys

| Variable | Needed? | What it's for | Where to get it | Cost |
|---|---|---|---|---|
| `DATABASE_URL` | Required | Postgres. The `mr_*` tables create themselves on first use. | Railway: add a Postgres service. Locally: a local Postgres. | Railway usage |
| `ANTHROPIC_API_KEY` | Required | Claude reads sites, ranks competitors and writes reports. | console.anthropic.com → API keys | per call, above |
| `APIFY_API_TOKEN` | Required | Google search, plus a real browser for sites that refuse servers. | console.apify.com → Settings → Integrations | per call, above; the Free plan includes $5 a month |
| `APOLLO_API_KEY` | Optional | Headcount growth; profile fallback. | app.apollo.io → Settings → API | 1 credit per company per monthly read |
| `UNIPILE_API_KEY` + `UNIPILE_DSN` | Optional | Competitors' LinkedIn posts. Needs a LinkedIn account connected in Unipile. | dashboard.unipile.com | Unipile subscription |
| `COMPANIES_HOUSE_API_KEY` | Optional | UK company filings. | developer.company-information.service.gov.uk | free |
| `SEC_USER_AGENT` | Optional | Names you to SEC EDGAR, e.g. `Northaxis Market Radar you@company.com`. | you write it | free |
| `SMTP_HOST/PORT/USER/PASS/FROM`, or `GMAIL_SENDER` + `GOOGLE_SA_JSON`, or `SLACK_BOT_TOKEN` | Optional | Weekly update delivery. | your mail provider, or Slack app settings | — |
| `PUBLIC_BASE_URL` | Optional | Links in emails. Defaults to `https://northaxis.outcomes.digital`. | — | — |

Every optional feature reports itself as skipped when its key is missing; nothing breaks.

**Never commit keys.** Locally they go in `.env` (already ignored by git). On Railway they go
in **web → Variables**.

## Sign-in and admin

- **Admins.** Market Radar is admin-only (`admin_required`). Northaxis's admins are the
  `ADMIN_EMAILS` set in `app.py`. It already holds your own addresses, and nothing from the
  source platform was carried over.
- **Google sign-in** uses `GOOGLE_CLIENT_ID` and is already set up on the live site. To sign
  in on your own computer, add `http://localhost:8080` to that client's Authorised JavaScript
  origins:
  1. Open console.cloud.google.com → APIs & Services → Credentials.
  2. Click your OAuth 2.0 Client ID (type *Web application*).
  3. Under **Authorised JavaScript origins** click **+ Add URI**, enter
     `http://localhost:8080`, then **Save**.
  4. Put the same client ID in your local `.env` as `GOOGLE_CLIENT_ID`.
- **`SECRET_KEY`** must be a long random string:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`

## Run it on your Windows laptop

1. Install **Python 3.11** (python.org; tick "Add python.exe to PATH") and **PostgreSQL 16**
   (postgresql.org/download/windows; remember the password you give the `postgres` user).
2. Open PowerShell in the repository folder:
   ```
   py -3.11 -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```
3. Create a database:
   ```
   & "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres northaxis
   ```
4. Copy `.env.example` to `.env` and fill in at least `DATABASE_URL`
   (`postgresql://postgres:YOURPASSWORD@localhost:5432/northaxis`), `GOOGLE_CLIENT_ID`,
   `SECRET_KEY`, `ANTHROPIC_API_KEY` and `APIFY_API_TOKEN`. Keep `MR_MONITOR_DISABLED=1`.
5. Run the Market Radar tests. They need no keys. The database tests need `initdb` and
   `pg_ctl` on PATH, and must run as an ordinary user, not an administrator:
   ```
   $env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
   python -m pytest tests/ -q -k market_radar
   ```
6. The app reads its settings from the environment, not from `.env` directly, so load the
   file into the PowerShell session first, then start the app:
   ```
   Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }
   python app.py
   ```
   Sign in, then open `http://localhost:8080/admin/market-radar`.

## Before the first paid run: the free self-tests

All three are admin-only POSTs. They spend nothing and write nothing (the schema check rolls
itself back).

- `/admin/external-usage/market-radar-schema-check`: the tables and the cost ledger, on your
  database.
- `/admin/external-usage/market-radar-sources-check`: which free sources answer from this
  machine. Google News is checked above all.
- `/admin/external-usage/market-radar-detectors-check`: every detector against a public
  source known to have what it reads.

Run them from the browser console while signed in, for example:

```
fetch('/admin/external-usage/market-radar-detectors-check',{method:'POST'}).then(r=>r.json()).then(console.log)
```

## Deploying (Railway)

The code deploys with the rest of Northaxis. Nothing runs, and nothing is spent, until an
admin starts a run.

1. Railway → **web → Variables**. Add `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`,
   `MR_MONITOR_DISABLED=1`, and any optional keys. `DATABASE_URL`, `GOOGLE_CLIENT_ID` and
   `SECRET_KEY` are already there.
2. After the redeploy, run the three self-tests above against the live site.
3. **Weekly scheduled runs stay off.** They need `MR_MONITOR_ENABLED=1`, and
   `MR_MONITOR_DISABLED` must not be set. Even then, each company must switch weekly updates
   on in its own card. Turn this on only when you decide to: it spends money every week,
   unattended.
