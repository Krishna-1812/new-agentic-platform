# Video Studio: plan

Working name: **Video Studio**.
Status: **being built** (badge "building"). Phases 1 to 5 are built: the
render engine; the sources, brand and plan; building the video with Claude;
the pages people use; and hardening. The badge goes to "live" once the launch
checklist in section 7 has been followed on Railway and the first real client
videos are made.

Tell it what video you want: a launch, an explainer, a product demo, an ad, a
hiring post, a set of results, or anything else. Give it what it should use: a
website, screenshots, a logo, your own script, or a few numbers. It proposes
the video scene by scene, and once you approve, it makes it, with share copy,
ready to download.

The **user defines the video**. The agent offers ready-made starting points
for common kinds (section 2.1), but none of them is required: a free-text
brief alone is enough, and every choice a starting point makes can be changed.

It borrows its method from the `/brag` skill
(github.com/latent-spaces/brag, MIT licence), which makes launch videos inside
a coding assistant: a plan before any animation, a strong first three seconds,
and every video specific to its subject, never generic. It uses the same video
engine, **HyperFrames** (HeyGen, npm `hyperframes`, Apache-2.0), rendered on
the Page Watch worker service. `/brag` itself cannot run on a web page; this
agent generalises it from launch videos to any short video.

---

## 1. What it is for

- Short videos for clients and for ourselves, for LinkedIn, X, Instagram,
  YouTube Shorts, a website, a pitch or an email, without opening a video
  editor.
- Any kind the user describes: announcements, explainers, demos, promotions,
  results, tips, events, hiring, testimonials, recaps.
- A first cut in minutes that a person then changes in plain words ("make the
  title bigger", "drop the pricing scene", "end on the free trial").
- Every video looks like its brand: their colours, fonts, logo, and real
  screenshots or images, not a stock template.

What it is not:
- a general video editor;
- a tool for long videos (over 60 seconds);
- a way to edit footage someone uploads (images can be uploaded, video clips
  cannot).

Narration and music are off in the first version (section 5).

---

## 2. The user journey

### 2.1 Start: say what the video is

`/strategic-agents/video-studio` opens with one large box:
**"What video do you want?"**, for example:

> "A 30-second explainer of our month-end close service for CFOs, calm and
> clear, ending on 'Book a call'."

> "A vertical ad for the Diwali sale: 20% off all plans until 5 November."

> "Show our Q3 results: leads up 42%, cost per lead down 18%, three new
> markets."

Under the box, **starting points** fill in sensible defaults when clicked.
They are a shortcut, not a requirement: **Custom** is the default, and the
brief alone is enough.

| Starting point | Typical use | Suggested shape and length |
|---|---|---|
| Launch / announcement | A new product, site, feature or office | Landscape, 20 s |
| Explainer | What a service is and how it works | Landscape, 30–45 s |
| Product demo | Walk through a product's key screens | Landscape, 30 s |
| Feature highlight | One feature, one benefit | Square, 15 s |
| Promotion / ad | An offer, a sale, a call to action | Vertical, 15 s |
| Results / numbers | Figures, charts, a report's highlights | Square, 20–30 s |
| How-to / tips | Steps or a short list of tips | Vertical, 30 s |
| Event / webinar | Date, speakers, sign-up | Square, 15 s |
| Hiring | A role, the team, how to apply | Vertical, 20 s |
| Testimonial / case study | A client quote, the problem and the result | Landscape, 30 s |
| Recap / update | A month, a project, a campaign in review | Landscape, 30 s |
| Custom | Anything else, defined by the brief | Chosen by the user |

A starting point only pre-fills suggestions (a scene outline, shape, length
and style). It never limits what the brief asks for.

**Choices** are always visible and can be changed:

| Choice | Options | Default |
|---|---|---|
| Shape | Landscape 16:9, Vertical 9:16, Square 1:1, Portrait 4:5 | From the starting point, or landscape |
| Length | 6 to 60 seconds | From the starting point, or what the brief says |
| Style | Polished, Calm, Bold, Playful, Cinematic, Minimal, Corporate, or a free description ("like an Apple keynote", "1990s TV advert") | Inferred from the brief and the brand |
| Words on screen | **Write them for me**, or **Use my script exactly** (paste it) | Write them for me |

**Sources** are optional; give any mix, or none:

- **A website:** one or more addresses; it reads them (section 2.2).
- **Images:** screenshots, product photos, team photos, a logo (up to 12
  images).
- **Text:** a script, bullet points, a press release, a quote, or a client
  email to turn into a testimonial.
- **Numbers:** a small table pasted in or a CSV (up to 50 rows), for charts
  and big-number scenes.
- **Brand:** taken from the website, or set by hand (colours, fonts, logo),
  or from a brand saved earlier for the same client.

The client field works as it does on Page Watch, and each client's brand is
remembered for next time.

Click **Make a plan**.

### 2.2 Reading the sources (about 10–60 seconds)

The same live step list as Page Watch, showing only the steps that apply:

1. Opening the website in a real browser (if one was given)
2. Reading the pages that matter (the given address plus up to 4 linked pages
   that match the brief: product, pricing, features, about)
3. Taking screenshots at desktop and phone width
4. Picking up the brand: logo, colours, fonts
5. Reading your images, text and numbers
6. Writing the plan

A site that blocks robots or needs a login says so here, in plain words, and
offers **"Use my own screenshots instead"**. With no website at all, the
agent works from the brief, the uploads and the brand, and skips steps 1–4.

### 2.3 The plan: approve before anything is made

Nothing is rendered, and almost nothing is spent, until the plan is approved.
The plan screen shows:

- **The idea** in one sentence ("A calm 30-second walk from a messy month-end
  to a closed one").
- **The scenes as cards**, in order. Each card shows its seconds and the words
  on screen (editable in place), plus what it shows: a screenshot, image,
  chart or icon, as a thumbnail you can click to swap.
- **The brand:** colour swatches, fonts, logo; each is editable.
- **The share copy** draft, for the platforms the shape suits.

The user can edit any text, reorder or delete scenes, and add a scene from the
scene menu (section 3.3). Total seconds update live and must stay within the
length chosen.

**Approve and make the video** starts the render. **Try another idea** asks
for a different plan, which costs one more planning call.

### 2.4 Making it (about 3–8 minutes, longer for 60-second videos)

A live step list again, so the wait is never blank:

1. Building the scenes
2. Checking every frame (text fits, contrast is readable, nothing off-screen)
3. Looking at it (key frames shown here as they are taken)
4. Fixing what it found (only when needed; at most two rounds)
5. Rendering the video
6. Picking the cover frame

The user can leave the page; the video carries on and is waiting in the
library. With Slack set up, a message says it is ready.

### 2.5 The result

- The video, playing, with its cover frame.
- **Download MP4**, and **Copy share text** (versions for LinkedIn, X and
  Instagram, as the shape suits).
- **Make changes**: a box for plain-words changes ("slower", "bigger logo",
  "swap scenes 2 and 3", "make it vertical", "end on 'Start free'"). A change
  makes a new version and keeps the old one. Text-only changes skip the full
  rebuild and take about 2 minutes.
- **Make another shape**: the same video as vertical, square or portrait, as
  a new version, with the layouts re-fitted rather than cropped.
- **Versions**: every version, with what changed, its time and its cost.

### 2.6 The library

All videos, newest first, filtered by client and by kind: a thumbnail, the
brief's first line, the kind, shape, length, versions, and a status (planned /
making / ready / failed). **Duplicate** starts a new video from an old one's
brief, sources and brand.

---

## 3. How the agent works

### 3.1 Reading the sources

**Website** (when given). Reuses Page Watch's browser reader
(`tracker/watch_capture.py`) with its safety checks: it refuses private
addresses (SSRF guard), hides cookie banners and chat widgets, and uses real
Chromium.

- Pages: the given address, then up to 4 same-site links chosen by how well
  their words match the brief.
- Each page gets a full-page desktop screenshot (1440 wide) and a phone
  screenshot (390 wide).
- Text: headings, claims, prices, button labels and testimonials, kept with
  their position so a scene can show the real crop around them.
- Brand: the logo (the header image or SVG, or the site icon), the most-used
  background, text and accent colours (computed from CSS, not guessed from
  pixels), and the fonts in use. Fonts the video cannot load are swapped for
  the nearest bundled font, and the plan says so.
- Crops: the hero, each feature block, the pricing table, and any section the
  brief names.

**Uploads.**
- Images: only image types are accepted, with a size limit; each is
  re-encoded before use, which also strips hidden data, and kept at most at
  2560 px.
- Text: kept as given. With **Use my script exactly**, those words are used
  as written and only split into scenes.
- Numbers: parsed into a small table. The plan may only chart or quote
  figures that are in it.

**Brand.** In priority order: set by hand, then saved for this client, then
read from the website, then a neutral default. The plan screen shows which
one was used.

### 3.2 The plan (Claude, one call)

A single structured-output call (JSON schema). It is given:
- the brief and the starting point, if one was chosen;
- the choices, and the sources (text, numbers, and images or crops as
  pictures);
- the brand;
- a cached system prompt, generalised from `/brag`'s method:
  - what the video must achieve and for whom;
  - the hook in the first 2–3 seconds;
  - one idea per scene;
  - specific, never generic;
  - and its style guidance for each style.

Returns:
- the idea;
- the hook;
- 3–12 scenes, each with its type, seconds, words on screen, what it shows,
  and its motion in one line;
- the ending;
- share copy.

Then the server checks it:
- seconds add up to the chosen length;
- every image, crop or data column named exists;
- words fit each scene type's limit;
- **nothing is invented**: every number, price, date, name or quote must come
  from the sources or the brief;
- with **Use my script exactly**, every word of the script is present, in
  order, and nothing is added.

A plan that fails is sent back once with the reasons. If it fails again, the
problems are shown to the user on the plan screen, not hidden.

### 3.3 The scenes: templates first, Claude for the rest

To make quality reliable across every kind of video, most of each video is
built from a **scene library** written and tested once (Phase 3), not written
from scratch each time:

| Scene | What it does |
|---|---|
| Title | Logo and headline, with brand-colour motion |
| Words | Kinetic text: a line or two building word by word |
| Screenshot | A real crop with a slow zoom or pan to the part that matters |
| Image | A photo with gentle motion and an optional caption |
| List | 3–5 points building one by one, each with an icon |
| Steps | Numbered steps 1-2-3, for how-tos and processes |
| Big number | One figure counting up, with its label |
| Chart | A bar, line or donut chart drawn from the numbers given |
| Comparison | Two columns, or before and after with a wipe |
| Quote | A testimonial with name, role and photo |
| Timeline | Dates or milestones in sequence |
| People | Team or speaker photos with names and roles |
| Phone | A phone frame showing a phone screenshot scrolling |
| Logo wall | Client or partner logos |
| Event card | Date, time, place or link, and speakers |
| End card | The action, the address, and the logo at the end |

Each template takes the brand (colours, fonts, logo), the scene's words, and
its picture or data as variables, and works in all four shapes. Claude chooses
the templates, sets the timing and transitions, and writes custom motion only
when no template fits what the user asked for. A brief that needs something
outside the library ("a map with our 3 offices lighting up") gets a custom
scene, checked the same way.

### 3.4 Building and checking (Claude with tools)

Claude works through a short tool loop, the way `/brag` works in Claude Code,
but on the server, in a locked-down folder:

| Tool | What it does |
|---|---|
| `write_file` | Writes the composition files (HTML, CSS, JS) into the job's folder only |
| `check` | Runs `hyperframes check`: timing rules, layout overflow, WCAG contrast. Errors come back as text |
| `snapshot` | Renders chosen frames to PNG; they come back as images Claude looks at |
| `done` | Ends the loop with a summary |

Limits: 30 tool calls, 2 fix rounds after the first full check, and 15
minutes. It also stops when the monthly budget would be exceeded. When it
ends with errors still showing, the run fails cleanly with the reason. It
never renders a video that fails `check`.

### 3.5 Rendering (on the worker)

- `hyperframes render --quality high` on the **page-watch-worker** service. It
  already has Chromium; ffmpeg is already in the build (`railpack.json`), and
  Phase 1 adds Node 22. The HyperFrames version is pinned (currently 0.8.x)
  and upgraded on purpose, with the tests re-run.
- **One render at a time per worker**, as a separate job type, so Page Watch
  checks keep their own threads. If memory gets tight, the renderer moves to
  its own Railway service; the code allows that from the start.
- **The generated page is untrusted code** and is treated that way:
  - it runs in a fresh folder per job;
  - the browser has **no network**: every request except the job's own local
    files is blocked, so a composition cannot reach the site, the database or
    the internet;
  - fonts are bundled, not downloaded;
  - there is a time limit per render (scaled to the video's length);
  - the browser and the folder are removed afterwards.
- The cover frame is chosen from the plan's strongest settled moment and
  extracted with ffmpeg.

### 3.6 Storage

Railway has no disk, so everything is kept in Postgres, as Page Watch does.

| Table | Holds |
|---|---|
| `video_projects` | Owner email, client, the brief, the kind, the choices, status |
| `video_versions` | The plan (JSON), the composition files, the MP4 and cover, the change asked for, Claude's cost, and timings |
| `video_assets` | Screenshots, crops, uploaded images, text and numbers |
| `video_brands` | A saved brand per client: colours, fonts, logo |
| `video_jobs` | The queue: leases and heartbeats, as Page Watch's claim and lease |

An MP4 at 1080p is about 3–8 MB for 20 seconds and up to about 20 MB for 60
seconds. Each project keeps its last 5 versions, and versions older than 90
days lose their MP4 but keep the plan (Make again re-renders them). All reads
are scoped to the signed-in user's email in SQL, as elsewhere.

### 3.7 Cost

These are estimates; Phase 3 measures the real figures.

| Step | Sonnet 5.5 (default) |
|---|---|
| Plan | about $0.03–0.10 |
| Build and check, 15–30 s video | about $0.30–0.90 |
| Build and check, 45–60 s video | about $0.60–1.50 |
| A "Make changes" round | about $0.10–0.40 |
| **One video** | **about $0.40–1.60**, depending mostly on length and how custom it is |

Spending is recorded per call, and there is a monthly cap
(`VIDEO_CLAUDE_MONTHLY_USD`, separate from Page Watch's $5) with the same
behaviour. Past the cap, new plans wait until the 1st, and work in progress is
allowed to finish. Opus can be chosen with `VIDEO_CLAUDE_MODEL` for better
first drafts at about twice the cost. Railway's render time is billed
separately: a few minutes of one CPU per video.

---

## 4. The five phases

Each phase ends merged, tested and working on the live site before the next
begins.

### Phase 1: Render engine and sandbox

- Add Node 22 to the build and pin `hyperframes`, without breaking the
  website's or the worker's existing build. The deploy test covers it.
- Add the job queue and storage tables (`video_jobs`, `video_versions`) and a
  job type on the worker: one render at a time, a lease and heartbeat,
  hand-back on shutdown, and closing interrupted jobs. This is the same
  pattern as Page Watch, reused, not copied.
- Add the sandbox: a per-job folder, a no-network browser (only local files
  load), bundled fonts, time limits, and clean-up.
- Two hand-written test compositions, rendered end to end to an MP4 and a
  cover frame, then stored:
  - a 10-second landscape title + image + end card;
  - a 45-second vertical one with a chart.
- **Done when:**
  - the worker on Railway renders both test videos, and a staff-only page
    downloads them;
  - a composition that tries to load an outside address renders without it,
    and the attempt is logged;
  - a hung render is stopped at its time limit;
  - the full test suite passes.

### Phase 2: Sources, brand and the plan

- Reading the sources:
  - the website: multi-page reading on the Page Watch reader, page choice
    guided by the brief, screenshots, text with positions, crops;
  - uploads: images (checked, re-encoded), text, numbers (CSV or pasted
    table);
  - the brand: from the website, set by hand, or saved per client, with
    fonts mapped to a bundled set of about 20.
- The starting points (section 2.1) as data: each has a suggested outline,
  shape, length and style, all overridable.
- The plan call:
  - structured output and a cached system prompt;
  - server-side checks (seconds, sources, word limits, nothing invented,
    script used exactly) with one retry.
- **Done when:** a test set of **15 briefs** gives a valid plan for each, with
  no invented facts. The set must cover:
  - at least 10 of the 12 starting points, including Custom;
  - every kind of source: website only, uploads only, script only, numbers
    only, brief only, and mixes;
  - two sites that block robots.

  In addition:
  - a script given "exactly" appears word for word;
  - every plan is reviewed for whether it matches what the brief asked for,
    and the briefs, sources and plans are kept as test fixtures.

### Phase 3: Building the video with Claude

- The scene library: the 16 templates in section 3.3. Each one is tested in
  all 4 shapes, with long and short words, light and dark brands, and passes
  `check` on its own.
- The tool loop (`write_file`, `check`, `snapshot`, `done`) with its limits,
  the cost record, and clean failure.
- "Make changes" and "Make another shape": a change edits the plan or the
  composition and re-renders, and text-only changes skip the full loop.
- **Done when:** the 15 Phase 2 briefs each produce a video that passes
  `check`.
  - Every one is watched and scored:
    - does it do what the brief asked;
    - readable, on-brand, no cut-off text;
    - a strong first 3 seconds;
    - correct numbers.
  - At least 12 of 15 must be good enough to post as they are, with at least
    one good video from each starting point tested.
  - The cost and time of each are recorded and replace the estimates in
    section 3.7.

### Phase 4: The experience

- The pages:
  - the start page: the brief box, starting points, choices, sources and
    uploads;
  - live reading steps;
  - the plan editor: scene cards, editable words, swapping a picture,
    reordering, adding a scene from the menu, live total seconds;
  - live making steps with frames;
  - the result: player, Download, Copy share text, Make changes, Make another
    shape, versions;
  - the library, with Duplicate and the client and kind filters.
- Saved brands per client, editable.
- The same design language as Page Watch (paper ground, bento blocks,
  Fraunces headings), and working at phone width with no sideways scrolling.
- The directory card (Signals, badge "building") and the hub counts, with
  their tests updated.
- **Done when:**
  - the whole journey is driven in a real browser at 1440 and 390 wide, with
    no script errors, for a website brief, an uploads-only brief and a
    numbers brief;
  - a staff member makes two different kinds of video without help;
  - the page holds no internal details (model names, worker commands), as
    agreed for Page Watch.

### Phase 5: Hardening and launch

- Failures:
  - a worker restart mid-render (the job is handed back and runs again);
  - a site that never answers;
  - a bad upload (wrong type, too large, a broken CSV);
  - Claude unavailable (the plan step says so, nothing is half-made);
  - the monthly cap reached (a clear message; finishing work is allowed);
  - a render that fails (the reason is shown, and Try again works).
- Load: 3 videos queued at once, including a 60-second one, while Page Watch
  is checking. Measure memory and decide whether the renderer needs its own
  service.
- Keeping: version limits, 90-day MP4 clean-up, and per-user limits (for
  example 20 videos a day).
- Security review of the sandbox, the uploads and the CSV parsing.
- Optional Slack message when a video is ready, to the channel chosen for the
  client.
- A launch checklist in this document (variables, Railway memory), then the
  badge goes from "building" to "live".
- **Done when:**
  - every failure above has a test and a live drill;
  - the load run stays under the worker's memory limit;
  - the checklist has been followed on Railway;
  - the first real client videos (two different kinds) have been made.

---

## 5. Known limits (first version)

- **No music.** The tracks bundled with `/brag` (ende.app "Happy Beats")
  have no stated licence; its own README says to check the terms before
  publishing. A later phase can add a music library you have licensed, or
  allow uploading a track you own.
- **No narration.** `/brag`'s voice uses a local speech model (Kokoro) that is
  too heavy for the worker. It can be added later as its own job. Videos are
  designed to work silently, with all key words on screen, which is how most
  social video is watched anyway.
- **No video clips as input.** Images, text and numbers only; uploaded footage
  can come in a later version.
- **Up to 60 seconds.**
- **Logged-in apps and sites that block robots** need uploaded screenshots.
  The agent cannot click through a product the way `/brag` reads a codebase.
- **Less polish than working by hand.** Claude checks frames and fixes up to
  two rounds; a person in Claude Code can iterate without limit. "Make
  changes" closes most of the gap.

---

## 6. Decisions

The build started on 2026-10-04 with these defaults. Each can be changed at
any time without rework:

1. **Name:** "Video Studio".
2. **Monthly Claude budget:** `VIDEO_CLAUDE_MONTHLY_USD = 10`, which is about
   8–20 videos a month on Sonnet 5.5, depending on length.
3. **Who can use it:** staff only, like the other agents.
4. **Music:** left out (section 5).
5. **Starting points:** the list in section 2.1, with Custom always there.

---

## 7. Progress

### Phase 1 is built

| Part | Where |
|---|---|
| Settings: shapes, lengths, time limits, the pinned engine version | `tracker/video_config.py` |
| Projects, versions (with the MP4 and cover) and the job queue, in Postgres | `tracker/video_store.py` |
| Installing and running HyperFrames; time limits that stop a program and everything it started | `tracker/video_engine.py` |
| The sandbox: job folder, checked file paths, bundled kit, no-network browser, no secrets passed on | `tracker/video_sandbox.py` |
| One render job: check, render, cover, store, with a step log | `tracker/video_render.py` |
| The render thread on the Page Watch worker: one at a time, lease and heartbeat, hand-back on a deploy | `tracker/video_worker.py` |
| GSAP and the fonts, bundled, with their licences | `tracker/video_kit/` |
| The two test videos and the two sandbox drills | `tracker/video_samples.py` |
| The staff engine page | `/strategic-agents/video-studio/engine` |
| Node 22 in the build | `railpack.json` (`"packages"`) |

**How "no network" works.** HyperFrames starts the browser through a small
script that sends every request that is not to the machine itself to a
proxy inside the worker. The proxy refuses it and records the address. The
job's own files load (HyperFrames serves them locally); nothing else does.
The files are also scanned for outside addresses before the render, and
both lists go in the job's log.

**Measured in the cloud container before merging** (real HyperFrames
0.8.111, Chromium headless shell):

| Test | Result |
|---|---|
| 10 s landscape: title, image, end card | passed check; rendered in 22 s; 0.8 MB |
| 45 s vertical with a chart | passed check; rendered in 79 s; 2.0 MB |
| Outside-address drill | rendered; both addresses refused and logged |
| Time-limit drill | stopped at its 60 s limit; no process or folder left behind |

Railway's CPU is slower, so expect renders there to take two to three times
as long.

**Checking it on Railway after the merge** (both services redeploy from
`main` on their own):

1. In Railway, open the **page-watch-worker** service → **Deployments** →
   the newest deployment → **View logs**. Within a minute or two of the start
   you should see `video renderer started (HyperFrames 0.8.111)`. The first
   start also installs HyperFrames with npm, which takes about a minute.
2. Open `/strategic-agents/video-studio/engine` on the website. Under **What
   the worker has**, Node, ffmpeg, Browser and HyperFrames should all be
   green.
3. Click **Render the test videos**. Both should reach **Ready** within
   about 5 minutes. Click **Watch** on each.
4. Click **Outside-address drill**. It should reach **Ready**, and its log
   should have a **blocked** line naming `images.unsplash.com` and
   `api.ipify.org`.
5. Click **Time-limit drill**. After about a minute it should show
   **Failed** with "The render was stopped at its time limit".

If Node shows **Missing**, open the worker's newest build log and search
for `node`. Railpack installs it from the `packages` entry in
`railpack.json`. Without a browser, check that
`RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1` is still set on the worker, as Page
Watch needs. `VIDEO_STUDIO=off` on the worker stops it taking render jobs.

### Phase 2 is built

| Part | Where |
|---|---|
| Starting points (all 12) and the choices check | `tracker/video_starts.py` |
| Uploads: images checked and re-encoded (hidden data removed), text, numbers from CSV or a pasted table | `tracker/video_uploads.py` |
| Reading a website: up to 5 pages chosen by the brief, desktop and phone screenshots, crops, text, colours from the CSS, fonts, the logo | `tracker/video_site.py` (on Page Watch's reader, `watch_capture`) |
| 21 bundled font families, and mapping any brand font onto them | `tracker/video_fonts.py`, `tracker/video_kit/fonts.json`, `scripts/fetch_video_fonts.py` |
| The brand: by hand, then saved for the client, then the website, then a default; readable colours; saved per client | `tracker/video_brand.py` |
| The plan call: structured output, cached system prompt, the checks, one retry, cost record and monthly cap | `tracker/video_plan.py` |
| The "plan" job on the worker, with a live step log | `tracker/video_planner.py` |
| The 15 test briefs | `tracker/video_briefs.py` |
| The staff plan tests page | `/strategic-agents/video-studio/plans` |

New tables: `video_assets`, `video_brands`, `video_ai_calls`.

**What has been checked here.** The cloud container has no Claude key, so
plans were tested with a stand-in Claude:

- **Stand-in Claude.** It reads the real request and follows the rules, or
  breaks a chosen rule on purpose. All 15 briefs run through the real plan
  job, and every check is tested.
- **Real SDK.** One test sends the request through the installed Anthropic
  SDK to a local server, to prove it serializes.
- **Website reading.** This ran live on python.org and djangoproject.com,
  which both read cleanly. On g2.com ("forbidden") and indeed.com (a
  security check), the reader correctly reports that robots are blocked.

**Finishing Phase 2 on Railway.** The finish line needs the real Claude on
the 15 briefs and a person's review:

1. Check that the worker service has `ANTHROPIC_API_KEY`. Page Watch already
   uses it.
2. Optional: set `VIDEO_CLAUDE_MONTHLY_USD` on the worker. Without it, the
   cap is $10 a month.
3. Open `/strategic-agents/video-studio/plans` and click **Run the 15 plan
   tests**. They cost about $1 to $3 and take 15 to 25 minutes, because the
   worker plans one at a time.
4. Open each plan and click **Yes, it matches** or **No, it misses** (with a
   note).
5. Click **Download the results (JSON)**. That file is kept as the test
   fixture of real plans.

**Done when:** all 15 show **Valid plan** and every one is reviewed as
matching its brief.

### Phase 3 is built

| Part | Where |
|---|---|
| The scene library: 16 templates, each laid out for all 4 shapes, with type sized to fit its words | `tracker/video_scenes.py` |
| Putting a plan together as one composition: tracks, wipes between scenes, brand colours and fonts, the cover moment | `tracker/video_build.py` |
| Claude's review loop: `read_file`, `write_file`, `check`, `snapshot`, `done`, with its limits | `tracker/video_agent.py` |
| Changing a plan in plain words, with the same checks | `video_plan.edit_plan` |
| The "build" and "change" jobs; Approve, Make changes, Make another shape | `tracker/video_builder.py` |
| Checking the whole library with the real engine | `scripts/check_video_scenes.py` |
| Videos, scoring and changes on the staff plan tests page | `/strategic-agents/video-studio/plans` |

**How a video is made:**

1. The approved plan is laid out from the templates.
2. `hyperframes check` samples every scene once it has settled.
3. Claude is shown a frame of every scene and the findings. It fixes only
   what is wrong: words cut off or crowded, a weak first three seconds, or a
   "custom" scene that needs its own motion. It may not change the words or
   facts the person approved.
   - Limits: 30 tool calls, 2 fix rounds and 15 minutes, within the monthly
     budget.
4. The program runs the check once more. Only a video that passes is
   rendered.

Without Claude, the templates' version is used if it passes the check.

**Changes:**
- **Words only** (same scenes, timings and pictures): the video is laid out
  again and checked without Claude's review.
- **Anything else**: the video is built in full.
- **Another shape**: the same plan is laid out again for the new shape, not
  cropped.

**What has been checked here:**

- **Real `hyperframes check`.** The 16 templates pass in all 4 shapes, with
  short and long words, on a light brand and a dark one. That is 16
  compositions of 18 scenes each, and the frames were looked at.
  - Only harmless warnings remain: nested sections, a dense track, and
    pictures reused in the test file.
  - Run it with `python scripts/check_video_scenes.py`.
- **The whole pipeline, live with the real engine.** Three briefs went from
  plan to approval, build, check, render and cover:
  - square 25 s (a chart from uploaded numbers);
  - landscape 30 s (uploaded screenshots);
  - vertical 24 s (a script used exactly).
  - Here the plan came from the stand-in Claude and there was no review,
    because this container has no Claude key.
- **A bug found and fixed.** The check's JSON report can be larger than the
  output kept in memory. Read from that cut-off tail, a failing check could
  read as passing. The report is now written to a file and read whole.

**Finishing Phase 3 on Railway.** This needs Phase 2's 15 plans first:

1. On `/strategic-agents/video-studio/plans`, after the 15 plans are valid,
   click **Make the videos of the valid plans**. Each video costs about
   $0.40 to $1.60 and takes a few minutes. The worker makes them one at a
   time, so expect an hour or two for all 15.
2. Watch each video and tick the five boxes: does what the brief asked;
   readable, on brand, nothing cut off; strong first 3 seconds; numbers
   correct; good enough to post as it is.
3. Try **Make changes** and **Make another shape** on two or three of them.

**Done when:**
- at least 12 of the 15 videos are good enough to post;
- at least one good video exists for each starting point tested.

The page shows the average cost and minutes per video; those replace the
estimates in section 3.7.

### Phase 4 is built

| Part | Where |
|---|---|
| The start page: the brief, the 12 starting points, the choices, the sources, the client and the brand; and the library with the client and kind filters and Duplicate | `/strategic-agents/video-studio` (`templates/video_studio.html`) |
| One video: live reading steps, the plan editor, live making steps with the key frames, the result, the versions | `/strategic-agents/video-studio/videos/<id>` (`templates/video_studio_video.html`) |
| Saved brands per client, editable | `/strategic-agents/video-studio/brands` |
| What the pages get and do: drafts, uploads, the live state, edits, Try another idea, Try again, Duplicate, brands | `tracker/video_app.py` |
| The pages' script and styles | `static/js/video-studio.js`, `static/css/video-studio-app.css` (on Page Watch's `page-watch.css`) |
| The directory card (Signals, "Building") and the hub counts | `templates/b2b_agents.html`, `templates/hub.html` |
| The real-browser drive of the whole journey | `scripts/drive_video_studio.py` |

**How it works:**
- **Starting.** The brief, choices, texts and tables are saved as a draft.
  The pictures are then uploaded one per request, so no request is large,
  and the plan is queued. If an upload fails, the draft is removed.
- **The plan editor.** Any words can be edited in place, with the word
  limits shown. Scenes can be reordered, deleted or added from the scene
  menu. A picture is swapped by clicking it (or uploading a new one). Charts
  can be pointed at other columns. The brand's colours, fonts and logo can
  be changed, and so can the share copy and the cover scene. The timeline
  shows the total seconds live, with **Fit** to bring it back to the length.
  - Edits save as you type. The server holds them to the same rules as
    Claude's plan: seconds, word limits, pictures and charts.
  - Words the person types count as facts, because the person stands behind
    them. A figure they add is not flagged as invented, and it stays a fact
    through later changes.
  - Brand edits are corrected for contrast and saved for the client's next
    video.
- **Try another idea** makes a new version with a different idea. It keeps
  the website reading, so the site is not read again (and a site that
  refused is not tried again), and it keeps the brand with any edits. The
  earlier plan stays as its own version.
- **Making.** The six steps are shown live, with the key frames Claude looks
  at. A quick rebuild (words only, or another shape) shows "Not needed" for
  the review steps.
- **The result.** The player, **Download MP4**, **Copy** for each platform the
  shape suits, **Make changes** (with examples), **Make another shape**, and
  every version with what changed, its time and its cost.
- **No internal details on the pages.** Errors are shown without model,
  service or variable names (`video_app.public_error`). Tests check every page
  and the live-state JSON for them.

Fixed on the way: a render no longer wipes out the build's timings, and the
cover step is now in the log.

**What has been checked here:**
- `tests/test_video_app.py` covers drafts and uploads, every phase of a
  video, edits and their rules, Try another idea, Duplicate, the library,
  brands, the routes and the pages.
- **The whole journey in a real browser, at 1440 and 390 wide.** Three briefs
  were driven start to finish: a website brief, an uploads-only brief and a
  numbers brief. Each went through the brief, sources, plan, edits, approve,
  making with frames, result, share text, a change and another shape. The
  library, Duplicate and brands were driven too. There were no script
  errors, no failed requests, no sideways scrolling and no internal details.
  - Run it with `python scripts/drive_video_studio.py`.
  - The drive's worker uses stand-ins for Claude, the website reader and the
    engine, with a real small MP4. The test browser plays VP9, not H.264;
    Chrome, Edge and Safari play the real H.264 videos.

**Finishing Phase 4 on Railway** (after the Phase 2 and 3 checks):
1. Open `/strategic-agents/video-studio`. Make two different kinds of video
   from your own briefs, for example a website explainer and a numbers
   video. Edit each plan before approving it.
2. Ask a colleague to do the same without help, and note anything that
   confused them.

**Done when:** a staff member has made two different kinds of video without
help. The browser drive is done.

### Phase 5 is built

**Every failure, its test and its live drill:**

| Failure | What the person sees | Test (`tests/test_video_hardening.py`) | Live drill |
|---|---|---|---|
| The worker restarts mid-render | "Making" carries on; the job is handed back and runs again. After two lost workers, it fails in plain words. | `test_a_render_stopped_by_a_restart...`, `test_a_job_whose_worker_died_twice...` | Engine page → **Load run**, then redeploy the worker while it renders (below) |
| A site that never answers | The reading says the site took too long, and the plan goes on without it. A slow site stops after a 2-minute reading budget, not 9 minutes. | `test_a_site_that_never_answers...`, `test_a_slow_site_is_read_within_the_budget` | Engine page → **Website never answers** |
| A bad upload | A sentence under the field: not an image, larger than 15 MB, one column, an unclosed quote, over 50 rows, too long. A request over 32 MB gets a JSON answer. | `test_bad_uploads_are_refused...`, `test_a_request_over_the_size_limit...` | By hand on the start page (below) |
| Claude unavailable | The plan step fails with "Claude could not be reached. Try again", and no plan is made. During a change, the video is kept. | `test_claude_unavailable_...` (2) | Engine page → **Claude unreachable**, then **Try again** |
| The monthly budget is reached | New plans, new ideas and changes in words say why. Approving, another shape and downloads still work, with no review. | `test_past_the_budget_finishing_work_is_allowed...` | Engine page → **Budget used up** |
| A render fails | The reason in plain words. **Try again** renders again without rebuilding; a failed build is built again. | `test_a_failed_render_says_why...`, `test_a_failed_build_is_built_again` | Engine page → **Render fails**, then **Try again** |

Drill videos open on the video page like any other, but stay out of the
library and send no Slack message (`tracker/video_drills.py`).

**The load run** (`scripts/load_video_studio.py`, here, with the real engine).
Three videos were queued at once: 10 s landscape, 45 s vertical with a chart,
and 60 s landscape with all 16 templates. Page checks ran beside them in 2
threads with the real browser, as the worker does.

| | |
|---|---|
| Renders | all 3 ready, in 5 minutes together (check + render: 38 s, 105 s, 152 s) |
| Page checks meanwhile | 76, none failed |
| Peak memory, all programs together | **2,063 MB**: browsers 924, ffmpeg 596, Node 187, the rest 356 |

**Decision:** the renderer stays on the worker, which needs **4 GB of memory**
(the 2 GB set for Page Watch is too little; the peak was just over 2 GB). The
worker renders one video at a time, so more videos queue rather than add
memory. If Railway's memory graph for the worker goes past about 3 GB in the
live load run, the renderer moves to its own service.

**Keeping:**
- **Versions:** at most 20 per video. Past that, Duplicate it.
- **Daily limits:** 20 videos (approve, change, another shape) and 40 plans
  (new, another idea, duplicate) per person per day (UTC). Set them with
  `VIDEO_DAILY_VIDEOS` and `VIDEO_DAILY_PLANS`.
- **Clean-up** on the worker every 6 hours:
  - MP4s are removed after `VIDEO_KEEP_DAYS` (90). The cover, plan and
    composition stay, so **Make it again** renders it in a few minutes.
  - Key frames are removed after 30 days.
  - Drafts that were never started are removed after 2 days.

**Slack (optional).** When a video is ready, or making one fails, a message
with a link goes to the client's channel, set on the brands page, or to
`VIDEO_SLACK_CHANNEL`. It uses Page Watch's Slack app and token. Plans and
drills send no message.

**Security review:**
- **The sandbox, attacked with a hostile composition**
  (`scripts/check_video_sandbox.py`, real engine). Every one of these was
  blocked:
  - reading files outside the project through the engine's server (`../`,
    encoded `../`, `/etc/passwd`, `/proc/self/environ`);
  - `file://`;
  - the internet and the cloud metadata address (both refused by the proxy
    trap and logged);
  - a service on the worker's loopback, read across origins;
  - WebRTC to a STUN server, by name and by address.
  - Added: Chromium's flag that stops WebRTC sending UDP around the proxy.
    This container may have blocked UDP itself, and Railway may not.
  - Fixed: the proxy's log now records IP addresses correctly (it logged
    "http").
- **Claude's tools:** reads and writes stay inside the project; a link
  pointing out of it is now refused too. Writes are limited to HTML, CSS and
  JS, with no outside addresses.
- **Uploads:** images are decoded by Pillow and re-encoded. SVG is refused.
  The pixel count is checked from the header. Names are cleaned. Each
  picture is its own request.
- **Tables:**
  - the size is capped (512 KB) before reading;
  - reading stops one row past the limit, so a huge paste is refused, not
    parsed;
  - an unclosed quote is refused;
  - cells are capped at 200 characters.
- **Pages:** every write is JSON only; every read is scoped to its owner;
  all text is set as text, never HTML; errors have their internals removed.

**What has been checked here:**
- **Tests:** 28 tests in `tests/test_video_hardening.py`. The full suite
  passes.
- **Real engine:** the hostile composition and the load run.
- **Real browser:** the drive of the whole journey at 1440 and 390 wide, run
  again.

### Launch checklist (Railway)

Do these on Railway, in order.

1. **Worker memory.** Open Railway → your project → the **page-watch-worker**
   service → **Settings** → **Resources**. Set **Memory** to **4 GB**, then
   save.
2. **Worker variables.** In the same service, open **Variables** → **New
   Variable** for each:
   - `ANTHROPIC_API_KEY`: use **Add Reference** to the web service's variable,
     or paste the key there yourself. Never paste it into chat.
   - `PUBLIC_BASE_URL`: your site's address, for the links in Slack.
   - Optional: `VIDEO_SLACK_CHANNEL` (for example `#videos`),
     `VIDEO_CLAUDE_MONTHLY_USD` (10), `VIDEO_DAILY_VIDEOS` (20),
     `VIDEO_DAILY_PLANS` (40), `VIDEO_KEEP_DAYS` (90).
   - For Slack, `WATCH_SLACK_BOT_TOKEN` (or `GOOGLE_ADS_SLACK_BOT_TOKEN`) must
     already be there for Page Watch. Invite the bot to each video channel:
     in Slack, open the channel → type `/invite @` and the bot's name.
3. **Deploy** the worker (**Deployments** → **Deploy**). Its **Deploy Logs**
   should say `video renderer started`.
4. **Engine page** (`/strategic-agents/video-studio/engine`):
   - **Render the test videos**, then both drills.
   - The four failure drills; open each and use its buttons.
   - **Load run**. While it renders, open Railway → page-watch-worker →
     **Metrics** → **Memory**, and press Win+Shift+S to keep a picture of the
     graph. It must stay under 4 GB.
5. **Restart drill.** Start **Load run** again. While the 60-second video
   renders, open Railway → page-watch-worker → **Deployments** → the ⋮ menu
   on the newest deployment → **Redeploy**. On the engine page the video goes
   back to waiting, then renders again on the new worker.
6. **Bad uploads, by hand**, on `/strategic-agents/video-studio`. Each must
   show a sentence and start nothing:
   - a `.txt` file renamed to `.png`;
   - a picture over 15 MB;
   - a table with one column;
   - a table with a quote mark that is never closed.
7. **The first real client videos.** Make two different kinds (for example
   a website explainer and a results video), approve them, download them and
   share them.
8. **Then the badge goes live.** Tell me the steps above are done, and I'll
   switch the directory card from "Building" to "Live".

**Done when:** every step above has been followed and the first two real
client videos are made.

