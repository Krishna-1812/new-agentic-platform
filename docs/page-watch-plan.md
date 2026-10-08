# Page Watch — plan

Page Watch watches any web page and tells you, in plain words and with a
before-and-after picture, when something on it changes. Give it a link or a
name ("HubSpot pricing"), choose how often to look, and it reports only the
changes that matter.

"Page Watch" is a working name. The display name lives in one constant
(`tracker/watch_config.py: NAME`), so renaming it later is a one-line change.

---

## 1. What it is for

The agency watches pages it does not control and needs to know when they
change:

- **Competitors:** pricing, plans, packaging, homepage messaging, new landing
  and "vs" pages, product launches.
- **Clients' own sites:** a landing page that broke, went `noindex`, lost its
  form, or changed an offer that the ads still promise.
- **Anything else:** a careers page (hiring signals), a terms or policy page,
  a partner directory, a government notice.

Visualping does this as a separate product. Page Watch does it inside the
platform, tied to the clients and Slack channels the agency already uses, and
with Claude judging which changes matter.

---

## 2. The user journey

### Adding a page (about 30 seconds)

1. **Paste a link or type a name.** `vercel.com/pricing`, or "Vercel pricing".
   A name is turned into candidate links by Claude with web search; the user
   picks one.
2. **See it live.** Page Watch opens the page in a real browser and shows the
   screenshot it took and the text it read, so the user can confirm it sees
   what they see (and not a cookie wall or a "verify you are human" page,
   which it detects and says so).
3. **Choose what to watch.**
   - The whole page, or one area: click on the screenshot to pick a section
     (for example the pricing table). The click is mapped to the page element
     under it.
   - Text, visuals, or both.
   - Optional: areas to ignore (a rotating banner, a live counter).
4. **Choose when.** Every hour, every 6 hours, daily or weekly, at a time of
   day in India time. Daily at 09:00 is the default.
5. **Say what matters (optional).** Plain words, for example "only tell me
   about price or plan changes". Claude uses this when judging each change.
6. **Choose where alerts go.** Slack channel (default), and later email.
7. **Label it** with a client or group, so the dashboard can be filtered.

The first check runs straight away and becomes the baseline.

### Day to day

- **Nothing changed:** nothing is posted. The dashboard shows a green tick and
  when it last looked.
- **Something changed:** a Slack message arrives with:
  - one line saying what changed ("Vercel raised Pro from $20 to $25/month"),
  - how important it is (Important / Worth a look / Minor),
  - the before-and-after image with the changed areas boxed,
  - the exact words added and removed,
  - a link to the full change page, and buttons: Useful / Not useful / Mute
    this kind.
- **The page broke or blocked us:** after two failed checks in a row, one
  message says so ("Page returned 404 twice", "Site now shows a bot check").
  It does not repeat every check.

### The dashboard

- Every watched page as a card: a thumbnail, the label, status (no change /
  changed / error / paused), when it last checked and next checks, and a strip
  showing the last 30 checks.
- Filter by client, status and importance. Search.
- **A change page:** a before-and-after slider over the two screenshots with
  the changed areas boxed, the text differences, Claude's summary and
  reasoning, and the history of every earlier change.
- **A page's timeline:** every check and every change, newest first.

---

## 3. How the agent works

### One check

1. **Load the page** in headless Chromium at a fixed desktop size
   (1440 × 900), with the same user agent and language every time.
2. **Make it stable before looking:**
   - freeze animations, transitions and the blinking cursor;
   - wait for fonts and for the network to go quiet;
   - scroll to the bottom and back so lazy-loaded content appears;
   - close or hide cookie banners and chat widgets (known selectors plus a
     size-and-position rule for fixed overlays).
3. **Read it:**
   - the visible text, split into blocks (headings, paragraphs, list items,
     table cells, buttons), each with its position on the page;
   - the title, final address after redirects and HTTP status;
   - a full-page screenshot, capped at a sensible height.
4. **Take a control screenshot** a few seconds later. Anything that differs
   between the two shots changes on its own (a carousel, a counter, an ad)
   and is ignored when comparing with the last check.
   Some things differ only between visits, not within one: a button colour
   chosen at random on each load, an A/B test, a quote of the day. So when a
   page is first added it is read twice more straight after its baseline
   (**calibration**); whatever differs between those readings is learned as
   noise for that watch.
5. **Compare with the last good check:**
   - **Text:** the blocks are normalised (spacing, invisible characters,
     relative times such as "3 minutes ago") and compared as a sequence, so
     the result is "these 2 lines were added, this price changed from $20 to
     $25", not a wall of diff.
   - **Visuals:** the two screenshots are compared in small cells; cells that
     changed (and are not in the noise or ignore areas) are joined into
     boxes. Each box is matched to the text blocks inside it, so a visual
     change can be named ("the Sign Up button").
   - **Layout:** if the page got taller or shorter, the comparison lines the
     two pages up, pixel row by pixel row, so everything below an inserted
     section is not counted as changed. Content that only moved on its own
     (one column of a two-column page shifting up, a fixed sidebar left in
     place while the page moved) is recognised by matching it at the offset
     its unchanged text moved by, and left out. Ignored and learned areas
     follow their content the same way: a banner inserted above an ignored
     area is still seen, and what the area covered stays ignored. When a
     change becomes the new baseline, the areas move with it.
6. **Decide:** no change, or a change with its evidence (text added, removed
   and changed; prices; visual boxes; how much of the page changed).
7. **Confirm:** a change is re-checked 3 minutes later before anyone is
   told. The first reading is kept as "suspected" (in the database, so a
   deploy in between does not lose it), and the re-check decides:
   - **still there:** recorded as a change;
   - **gone:** a glitch. Nothing is recorded but the check, and the areas
     involved get a flicker count. An area that flickers **twice** is
     learned as noise; once is not enough, so a real change that happened
     to be undone within minutes never silences that part of the page;
   - **different again** (a third state, like a carousel or a live counter):
     that part is left out of this re-check and counted as a flicker, so it
     is learned the second time. A real change caught half-loaded the first
     time is therefore delayed by one check, never lost.
8. **Judge (Claude):** Claude gets the text differences, the before-and-after
   crops of each changed area, and the user's "what matters" note. It returns
   a one-line summary, a short explanation, a category (price, product,
   messaging, legal, design, availability, other), an importance level, and
   whether it is noise.
9. **Tell:** Important and Worth-a-look changes are posted to Slack straight
   away. Minor ones go into a daily digest. Noise is recorded but not posted.

### What is stored

| Table | One row per | Holds |
|---|---|---|
| `watch_targets` | watched page | link, label, client, area, ignore areas, schedule, instructions, alert channel, status, next check time |
| `watch_checks` | check | when, outcome (same / changed / error), timings, final address, status code, error |
| `watch_snapshots` | successful check that is kept | the text blocks, page facts, and a pointer to the screenshot |
| `watch_changes` | change | the text diff, the visual boxes, Claude's verdict, feedback, alert state |
| `watch_images` | screenshot or crop | compressed image bytes (WebP), size, kind |

Every read a user can reach is scoped to their email in the SQL itself, as
in the other agents. Without `DATABASE_URL`, an in-memory store with the same
functions is used, so tests need no database.

**Retention** (once an hour, by one worker): a "no change" check stores only
its row in `watch_checks`, never a reading, so nothing else accumulates.

- **Changes:** kept for a year, with their pictures and both readings. At
  most 300 per watch.
- **Check log:** kept for 400 days.
- **Never deleted:** the current baseline, and a reading waiting for its
  re-check.
- **Orphans:** a glitch's reading and replaced copies of images are deleted
  after a day.

### Safety

The pages come from users, and the server opens them, so:

- every request the browser makes (including redirects and sub-resources) is
  checked first: http(s) only, and the host must resolve only to public
  addresses (no private, loopback, link-local or cloud-metadata addresses);
- WebSockets and service workers are switched off; downloads are refused;
- certificate errors are not ignored;
- analytics beacons are not sent, so a check does not count as a visit;
- the checker identifies itself in its user agent and keeps to one request at
  a time per site, with a minimum gap between checks of the same site.

### Where it runs

- **The website (web service)** stores watches, shows the pages, and answers
  Slack. It never opens a browser.
- **A worker (a second Railway service from the same code)** runs the checks:
  `python -m tracker.watch_worker`. It picks due checks from Postgres with a
  lease (so two workers never take the same check), keeps a heartbeat, and
  restarts cleanly after a deploy. Chromium needs roughly 400–700 MB, so it
  must not share the website's 1 GB.

---

## 4. The five phases

Each phase ends with a merged PR: tests added, the full suite green, the
secret check clean.

### Phase 1 — Plan and detection engine (done)

The heart of the agent, proven on real sites before anything is built on it.

- This plan.
- Storage (Postgres and in-memory) for watches, checks, snapshots, changes
  and images.
- Safe browser capture: the stabilising steps, text blocks with positions,
  full-page screenshot, control screenshot, page facts, blocked-page and
  bot-check detection. Plain-HTTP capture as a fallback (text only).
- Text comparison: normalisation, block matching, added / removed / changed,
  price and number changes.
- Visual comparison: cell diff, noise and ignore masks, box merging, layout
  alignment when the height changes, boxes matched to text, and the
  before-and-after composite image.
- One function that runs a check end to end against the stored baseline.
- **An accuracy harness** that measures the two numbers that matter:
  - false alarms: each test page checked twice with nothing changed should
    report "no change";
  - detection: known edits made in the browser (a price, a button colour, a
    removed section, an added banner) must each be found and boxed.

### Phase 2 — Worker and schedule (done)

- The worker process: due checks, leases, heartbeats, graceful shutdown.
- Schedules (hourly, 6-hourly, daily at a time, weekly), with jitter so
  checks do not all start on the minute.
- Retries with backoff, per-site politeness, and the confirmation re-check.
- Error states: two failures in a row become an "error" state; recovery
  clears it.
- Image storage limits and the retention job.
- Railway setup steps for the worker service; a health endpoint showing the
  worker's last heartbeat and queue depth.

### Phase 3 — Claude intelligence (done)

`tracker/watch_judge.py`. Every recorded change is judged straight away.

- **Model and effort:** Claude Opus 5.5 at medium effort, with the server-side
  refusal fallback on.
- **What Claude is shown:**
  - the evidence the engine found;
  - up to three close-ups of the changed areas, before and after;
  - the watch's "what matters" note;
  - the user's ratings of its last 8 changes.
- **The answer:** structured, against a fixed schema, so it is always
  readable.
- **Page text:** fenced off and declared to be data, never instructions.
- **When Claude is not used:** without a key, past the monthly cap, or when
  Claude fails or declines, a rules verdict takes over. A check never fails
  because of Claude.
- **Cost:** every call is logged with its cost in `watch_ai_calls`. A
  verdict costs about 2–5 cents.
- **Feedback** (`give_feedback`): Useful, Not useful, or Mute this kind,
  which mutes the category on that watch so its changes are never alerted.
- **Finding a page by name** (`find_pages`): Claude with web search returns
  up to 4 candidate links. Each is checked like a pasted link. A link typed
  directly is used as it is, without Claude.
- **Settings:**
  - `WATCH_CLAUDE_MODEL` (default `claude-sonnet-5-5`);
  - `WATCH_CLAUDE_EFFORT` (default `medium`);
  - `WATCH_CLAUDE_MONTHLY_USD` (default 5, all watches together);
  - `WATCH_JUDGE=off`;
  - the worker needs `ANTHROPIC_API_KEY` in its own Variables.

The plan as first written:

- The judge: text diff plus before-and-after crops in, structured verdict out
  (summary, explanation, category, importance, noise).
- Per-watch "what matters" instructions.
- Find a page from a name (web search), with candidate links to choose from.
- Feedback (Useful / Not useful / Mute this kind) stored and fed back into
  the next judgements for that watch.
- Cost tracking per check and a monthly cap.

### Phase 4 — The experience (done)

The pages are `templates/page_watch*.html`, `static/css/page-watch.css` and
`static/js/page-watch.js`, with `tracker/watch_web.py` behind the routes.

- **`/strategic-agents/page-watch`:**
  - **Hero:** a link-or-name box and figures for pages watched, changed,
    can't read and Claude's spending this month.
  - **The add flow:** find (Claude's candidates for a name), then read (the
    worker's first look, shown live while it happens), then set up.
  - **Setting up:** the real screenshot, with "pick an area" (drag a box;
    it becomes the nearest common container of the text inside, found
    again on every visit) and "ignore an area"; schedule, the note for
    Claude, the client, the Slack channel, and what to compare.
  - **Dashboard:** cards with a thumbnail, state, the latest verdict and a
    strip of the last 30 checks; filters by state and client, and search.
    Built in four queries however many watches there are, and refreshed
    while pages are being read.
  - **Below the dashboard:** how it works, and the worker's and Claude's
    status.
- **`/watches/<id>`:**
  - the page's picture;
  - its changes and every check;
  - settings, the area picker and muted categories;
  - check now, pause and resume, and stop watching.
- **`/changes/<id>`:**
  - Claude's verdict, set in the importance colour;
  - Useful, Not useful and Mute this kind;
  - before and after as a slider, side by side, or the alert picture, with
    the changed areas boxed;
  - the edited, added and removed words, the prices, and the page facts.
- **Safety:**
  - every route is staff-only and scoped to the signed-in user;
  - writes accept JSON only;
  - page text is shown as text, never as HTML;
  - images are private and immutable once stored.
- **A save can't race a running check:** a change to what is watched is
  refused (409) while the page is being read. A check asked for during a
  check is kept rather than overwritten.

The plan as first written:

- The agent page under Strategic Agents, in the platform's design system.
- The add-a-page flow: link or name, live preview, area picker on the
  screenshot, ignore areas, schedule, instructions, alert channel, label.
- The dashboard: cards with thumbnails, status and the 30-check strip;
  filters and search.
- The change page: before-and-after slider with boxed areas, text diff,
  Claude's verdict, feedback buttons.
- A page's timeline.
- The card in the Strategic Agents directory.

### Phase 5 — Alerts, hardening and launch (done)

`tracker/watch_alerts.py`, the routes it needs, and
`.github/workflows/page-watch-watchdog.yml`.

- **What happens to each recorded change:**
  - **Important or Worth a look:** posted to the watch's Slack channel (or
    `WATCH_SLACK_CHANNEL`) straight away. The message carries a coloured
    bar, the summary, Claude's explanation, the before-and-after picture,
    "See the change", and Useful / Not useful / Mute this kind buttons.
  - **Minor:** queued for the daily digest (`WATCH_DIGEST_AT`, 09:30 India
    time). There is one digest per channel; the first worker to reach it
    posts it, once.
  - **Muted or noise:** recorded, not posted.
- **The picture in Slack:** a signed link (HMAC from `SECRET_KEY`) that
  expires after 30 days. Slack fetches it without a login.
- **The buttons:** clicks arrive at the Slack app's existing
  `/api/slack/interactions` URL. They are verified with its signing
  secret, recorded as feedback on the change, and confirmed with a reply
  only the person who clicked sees.
- **Mondays:** a weekly summary goes to `WATCH_SLACK_CHANNEL`.
- **A failing watch:** posted once after two failed checks in a row, and
  once more when it reads again.
- **The watchdog:** a GitHub Action every 30 minutes calls
  `/api/page-watch/watchdog` (`WATCH_CRON_TOKEN`). The site posts once when
  the checker stops, falls behind or has no browser, and stays quiet until
  it is healthy again.
- **`WATCH_ALERTS=off`** silences everything; changes are still recorded.
- **Tested** (`tests/test_watch_alerts.py`, `tests/test_watch_hardening.py`):
  - **Soak:** 40 visits of an unchanged page, each with sub-threshold
    noise, 1px jitter, a carousel caught mid-turn and a changing "minutes
    ago" line, all came back "same". A real edit made after them was still
    found.
  - **Load:** 400 watches with 30 checks each. The dashboard took 0.4 s in
    memory and under 3 s on Postgres, including setup. A claim took well
    under a second.
  - **Failures:** a capture that raises, a database failing mid-check, a
    site that times out.
- **Live drills** on the real worker, browser and Postgres:
  - SIGTERM and SIGKILL in the middle of a check (Phase 2);
  - **the database stopped for 15 s under a running worker:** it logged
    the errors, stayed up, and checked normally when the database came
    back.

The plan as first written:

- Slack alerts with the composite image (served from a signed, expiring link,
  as the Google Ads digest charts are), buttons wired to feedback.
- A daily digest for minor changes; a weekly summary.
- Failure alerts (page down, blocked, worker silent).
- Load test (hundreds of watches), a soak test (repeated checks for false
  alarms), and failure drills (worker killed mid-check, database restart,
  site timing out).
- HANDOFF and README updates; the exact Railway steps for the worker.

---

## 5. Known limits

- **Sites that block cloud servers** (G2, Capterra, Crunchbase in the
  benchmark) show a bot check. Page Watch detects this and says so; reading
  them would need a paid unblocking proxy.
- **Pages behind a login** are not in scope for the first version.
- **Pages that change on every load** (live prices, random testimonials) are
  handled by the control shot and ignore areas, but a page that is different
  on every visit can only be watched for parts that are stable.

---

## 6. Setting up the worker on Railway

The worker is a second service in the same Railway project, built from the
same GitHub repo. It is needed once watches can be added (Phase 4); until
then it would sit idle. Steps:

1. **Railway → your project → Create (top right) → GitHub Repo →** pick this
   repository. Railway adds a new service and starts a first deploy. That
   deploy runs the website (`gunicorn` in its log); step 2 fixes it.
2. Open the new service → **Settings** (the "Filter Settings…" box at the top
   finds each one):
   - **Service name:** `page-watch-worker`.
   - **Custom Start Command** (filter `start`): `python -m tracker.watch_worker`.
     This is what makes it the checker and not the website.
   - **Healthcheck Path** (filter `health`): empty. The worker serves no
     pages; the website's health page shows its heartbeat.
   - **Restart Policy:** Always if the plan offers it, otherwise On Failure
     with 10 retries.
   - **Draining Seconds** (filter `drain`), if shown: `75`.
   - **Region:** the same as the web service.
   - **Networking:** add no public domain.
   Do not use **Config-as-code → Railway Config File**: Railway deprecated it,
   and since 2026-08-28 a new service cannot opt in (the path is removed as
   soon as it is saved). `railway.worker.toml` records the same settings for
   reference.
3. **Variables** (the worker's own tab):
   - `DATABASE_URL`: open **web → Variables → DATABASE_URL** and add the same
     value to the worker the same way. If it is a reference such as
     `${{Postgres.DATABASE_URL}}`, use **Add Reference** to make the same
     reference; never paste the database password into chat.
   - `ANTHROPIC_API_KEY`: the same key the web service uses. Add it with
     **Add Reference** pointing at the web service's variable, or paste it
     into Railway yourself. Never paste it into chat. Without it, changes
     are still found and rated by rules, just not by Claude.
   - `RAILPACK_PYTHON_PLAYWRIGHT_INSTALL` = `1`. This makes the build install
     Chromium and its system libraries. Without it every check falls back to
     text only and the health page says `no_browser`.
   - Optional: `WATCH_WORKER_THREADS` = `2` (the default). Each thread runs
     one browser, about 400–700 MB.
4. **Settings → Resources:** give it at least 2 GB of memory (1 GB is too
   little for two browsers and image comparison).
5. **Deploy**, then open the newest deployment → **Deploy Logs**. It should
   say `page_watch.worker: … started: 2 threads, version …` and nothing
   about `gunicorn`. Then open
   `https://<your site>/strategic-agents/page-watch/health` while signed in
   as staff. `"status": "ok"` and a worker with `"alive": true` means it is
   running. Other values:
   - `idle`: no watches yet;
   - `no_worker`: no heartbeat for 3 minutes;
   - `no_browser`: see step 3;
   - `behind`: checks are running more than 15 minutes late. Add threads or
     memory.

Deploys: Railway sends SIGTERM; the worker stops taking checks, gives running
ones up to 60 seconds (Draining Seconds 75, where Railway offers it), and hands
back the rest to be checked at once. A worker that dies outright loses its
watches within 3 minutes (the lease), and the next worker takes them.

---

## 7. Switching it on: the launch checklist

Everything is built; three services need a few settings. Never paste a key or
token into chat; set it in Railway or GitHub yourself.

**A. The worker service** (section 6 first, then these Variables on it):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the same reference the web service uses (Add Reference) |
| `RAILPACK_PYTHON_PLAYWRIGHT_INSTALL` | `1` |
| `ANTHROPIC_API_KEY` | reference the web service's (Claude's verdicts) |
| `SECRET_KEY` | reference the web service's (signs the pictures in Slack) |
| `GOOGLE_ADS_SLACK_BOT_TOKEN` | reference the web service's (the same Slack app posts the alerts) |
| `PUBLIC_BASE_URL` | the site's address, for example `https://northaxis.outcomes.digital` |
| `WATCH_SLACK_CHANNEL` | the channel for alerts, digests and notices, for example `page-watch` |

**B. The web service** (Railway → web → Variables → New Variable):

| Variable | Value |
|---|---|
| `WATCH_CRON_TOKEN` | a long random value (Railway can make one: type `${{ secret(48) }}`) |
| `WATCH_SLACK_CHANNEL` | the same channel as on the worker |
| `PUBLIC_BASE_URL` | as on the worker, if it is not already set |

**C. GitHub** → the repository → Settings → Secrets and variables →
Actions → New repository secret: name `WATCH_CRON_TOKEN`, value the same as
on the web service (Railway → web → Variables → the eye icon to reveal it).
The watchdog then starts on its own; Actions → Page Watch watchdog → Run
workflow tests it at once.

**D. Slack:** in each channel alerts go to, type `/invite @` and the Slack
app's name (the same app that posts the Google Ads digest). Its button URL
is already set, so Useful / Not useful / Mute work without changes.

**E. Check it:** add a page on `/strategic-agents/page-watch`; it should be
read within a minute. `/strategic-agents/page-watch/health` should say
`"status": "ok"`.
