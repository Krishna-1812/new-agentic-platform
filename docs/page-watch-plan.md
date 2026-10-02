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
7. **Confirm:** a change is re-checked once a few minutes later before anyone
   is told. A change that vanishes was a glitch and is dropped.
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

**Retention:** the baseline and every snapshot tied to a change are kept for
a year. Routine "no change" snapshots keep only their text fingerprint after
7 days, and their screenshots are deleted.

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

### Phase 1 — Plan and detection engine

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

### Phase 2 — Worker and schedule

- The worker process: due checks, leases, heartbeats, graceful shutdown.
- Schedules (hourly, 6-hourly, daily at a time, weekly), with jitter so
  checks do not all start on the minute.
- Retries with backoff, per-site politeness, and the confirmation re-check.
- Error states: two failures in a row become an "error" state; recovery
  clears it.
- Image storage limits and the retention job.
- Railway setup steps for the worker service; a health endpoint showing the
  worker's last heartbeat and queue depth.

### Phase 3 — Claude intelligence

- The judge: text diff plus before-and-after crops in, structured verdict out
  (summary, explanation, category, importance, noise).
- Per-watch "what matters" instructions.
- Find a page from a name (web search), with candidate links to choose from.
- Feedback (Useful / Not useful / Mute this kind) stored and fed back into
  the next judgements for that watch.
- Cost tracking per check and a monthly cap.

### Phase 4 — The experience

- The agent page under Strategic Agents, in the platform's design system.
- The add-a-page flow: link or name, live preview, area picker on the
  screenshot, ignore areas, schedule, instructions, alert channel, label.
- The dashboard: cards with thumbnails, status and the 30-check strip;
  filters and search.
- The change page: before-and-after slider with boxed areas, text diff,
  Claude's verdict, feedback buttons.
- A page's timeline.
- The card in the Strategic Agents directory.

### Phase 5 — Alerts, hardening and launch

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
