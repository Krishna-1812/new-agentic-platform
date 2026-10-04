# Launch Video: plan

Working name: **Launch Video**.
Status: **planned**. Nothing is built yet; Phase 1 starts after this plan is
agreed.

Give it a website. It reads the site, proposes a short video (the angle, the
scenes and the words on screen), and once you approve, it makes a 15–25 second
launch video with share copy, ready to download.

It is the `/brag` skill (github.com/latent-spaces/brag, MIT licence) rebuilt as
an agent on the website. `/brag` is a set of instructions for a coding
assistant working on someone's computer; it cannot run on a web page. The
agent keeps what `/brag` does well (its planning rubric, its tone presets, its
rule that every video is specific to the product) and runs the same video
engine, **HyperFrames** (HeyGen, npm `hyperframes`, Apache-2.0), on the
Page Watch worker service.

---

## 1. What it is for

- A short video for a client's launch, new feature or new site, for LinkedIn,
  X or a pitch, without opening a video editor.
- A first cut in minutes that a person can then change in plain words ("make
  the title bigger", "drop the pricing scene", "end on the free trial").
- Every video looks like the client's brand: their colours, fonts, logo and
  real screenshots, not a stock template.

What it is not: a general video editor, a tool for long videos (over 45
seconds), or a way to edit footage someone uploads. Narration and music are
off in the first version (section 5).

---

## 2. The user journey

### 2.1 Start

`/strategic-agents/launch-video` shows one box: **"A website"**, plus three
optional choices that are always visible:

| Choice | Options | Default |
|---|---|---|
| Style | Polished, Cinematic, App Store, Deadpan, Playful, Startup parody | Polished |
| Shape | Landscape 16:9, Vertical 9:16 (Reels, Shorts), Square 1:1 | Landscape |
| Length | 15, 20 or 25 seconds | 20 |

A **"Tell it more"** field takes an optional brief: "it's a new pricing page",
"aim it at CFOs", "mention the 14-day trial". The client field works as on
Page Watch.

Click **Make a plan**.

### 2.2 Reading the site (about 30–60 seconds)

The same live step list as Page Watch:

1. Opening the site in a real browser
2. Reading every page that matters (home, plus up to 4 linked pages: product,
   pricing, features, about)
3. Taking screenshots at desktop and phone width
4. Picking up the brand: logo, colours, fonts
5. Writing the plan

A site that blocks robots or needs a login says so here, in plain words, and
offers **"Use my own screenshots instead"** (upload up to 6 images).

### 2.3 The plan: approve before anything is made

Nothing is rendered, and almost nothing is spent, until the plan is approved.
The plan screen shows:

- **The angle** in one sentence ("A 20-second 'before and after' of a finance
  team's month-end").
- **The scenes as cards**, in order. Each card has its seconds, the words on
  screen (editable in place), and which screenshot it uses (a thumbnail; click
  to swap for another).
- **The brand** it picked up: colour swatches, fonts, logo. Each is editable.
- **The share copy** draft.

The user can edit any text, reorder or delete scenes, and add a scene from a
short menu (title, screenshot with zoom, feature list, big number, quote, call
to action). Total seconds update live and must stay within the length chosen.

**Approve and make the video** starts the render. **Try another angle** asks
for a different plan, which costs one more planning call.

### 2.4 Making it (about 3–6 minutes)

A live step list again, so the wait is never blank:

1. Building the scenes
2. Checking every frame (text fits, contrast is readable, nothing off-screen)
3. Looking at it (key frames shown here as they are taken)
4. Fixing what it found (only when needed; at most two rounds)
5. Rendering the video
6. Picking the cover frame

The user can leave the page; the video carries on, and the result is waiting
in the library. With Slack set up, a message says it is ready.

### 2.5 The result

- The video, playing, with its cover frame.
- **Download MP4**, and **Copy share text** (one version for LinkedIn, one
  for X).
- **Make changes**: a box for plain-words changes ("slower", "bigger logo",
  "swap scenes 2 and 3", "end on 'Start free'"). A change makes a new version
  and keeps the old one. Small text changes skip the full rebuild and take
  about 2 minutes.
- **Versions**: every version, with what changed, its time and its cost.

### 2.6 The library

All videos, newest first, filtered by client: a thumbnail, the site, style,
shape, versions, and the status of each (planned / making / ready / failed).
Filters work as on the Page Watch board.

---

## 3. How the agent works

### 3.1 Reading the site

Reuses Page Watch's browser reader (`tracker/watch_capture.py`) with its
safety checks: it refuses private addresses (SSRF guard), hides cookie
banners and chat widgets, and uses real Chromium.

- **Pages.** The home page, then up to 4 same-site links chosen by their
  words (product, features, pricing, how it works, about). Each page gets a
  full-page desktop screenshot (1440 wide) and a phone screenshot (390 wide).
- **Text.** Headings, the main claims, prices, button labels and testimonials,
  kept with their position so a scene can show the real screenshot crop
  around them.
- **Brand.** The logo (the header image or SVG, or the site icon as a
  fallback), the most-used background, text and accent colours (computed from
  CSS, not guessed from pixels), and the font families in use. Fonts the video
  cannot load (section 3.5) are swapped for the nearest bundled font, and the
  plan screen says so.
- **Crops.** Ready-made crops of the hero, each feature block and the pricing
  table, so the plan can name them and the scenes can use them.

### 3.2 The plan (Claude, one call)

A single structured-output call (JSON schema). It is given the site's text,
the crops as images, the brand, the user's choices and brief, and a cached
system prompt. That prompt carries `/brag`'s nine-question planning rubric,
its seven tone presets and its "specific, not generic" rules, condensed.

Returns: the angle, the hook (first 2–3 seconds), 4–7 scenes (type, seconds,
words on screen, which crop, the motion in one line), the outro, and share
copy for LinkedIn and X.

The server then checks it: seconds add up, every crop named exists, words fit
a scene's limit, and nothing is invented. Prices and numbers must appear on
the site, so the plan cannot claim "10,000 customers" unless the site does. A
plan that fails is sent back once with the reasons.

### 3.3 The scenes: templates first, Claude for the rest

To make quality reliable, most of each video is built from a **scene library**
written and tested once (Phase 3), not written from scratch each time:

| Scene | What it does |
|---|---|
| Title | Logo and headline, with brand-colour motion |
| Screenshot | A real crop with a slow zoom or pan to the part that matters |
| Feature list | 3–4 lines that build one by one, each with an icon |
| Big number | One figure counting up, with its label |
| Quote | A testimonial with name and role |
| Before / after | Two crops with a wipe |
| Phone | A phone frame showing the phone screenshot scrolling |
| Call to action | The action words, the address, and the logo at the end |

Each template takes the brand (colours, fonts, logo) and the scene's words and
crop as variables. Claude chooses the templates, sets the timing and
transitions, and writes custom motion only when no template fits. That keeps
it in step with `/brag`'s rule that each video is made for its product, while
most frames come from code that is already proven.

### 3.4 Building and checking (Claude with tools)

Claude works through a short tool loop, the way `/brag` works in Claude Code,
but on the server, in a locked-down folder:

| Tool | What it does |
|---|---|
| `write_file` | Writes the composition files (HTML, CSS, JS) into the job's folder only |
| `check` | Runs `hyperframes check`: timing rules, layout overflow, WCAG contrast. Errors come back as text |
| `snapshot` | Renders chosen frames to PNG; they come back as images Claude looks at |
| `done` | Ends the loop with a summary |

Limits: 25 tool calls, 2 fix rounds after the first full check, and 12
minutes. It also stops when the monthly budget would be exceeded. When it
ends with errors still showing, the run fails cleanly with the reason. It never
renders a video that fails `check`.

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
  - there is a time limit per render;
  - the browser and the folder are removed afterwards.
- The cover frame is chosen from the storyboard's strongest settled moment
  and extracted with ffmpeg, as `/brag` does.

### 3.6 Storage

Railway has no disk, so everything is kept in Postgres, as Page Watch does.

| Table | Holds |
|---|---|
| `video_projects` | Owner email, client, site, choices, status |
| `video_versions` | The plan (JSON), the composition files, the MP4 and cover, the change asked for, Claude's cost, and timings |
| `video_assets` | Screenshots, crops and the logo from the reading |
| `video_jobs` | The queue: leases and heartbeats, as Page Watch's claim and lease |

An MP4 of 20 seconds at 1080p is about 3–8 MB. Each project keeps its last 5
versions, and versions older than 90 days lose their MP4 but keep the plan
(Make again re-renders them). All reads are scoped to the signed-in user's
email in SQL, as elsewhere.

### 3.7 Cost

These are estimates; Phase 3 measures the real figures.

| Step | Sonnet 5.5 (default) |
|---|---|
| Plan | about $0.03–0.08 |
| Build and check (tool loop with frame images) | about $0.30–0.90 |
| A "Make changes" round | about $0.10–0.40 |
| **One video** | **about $0.40–1.00** |

Spending is recorded per call, and there is a monthly cap
(`VIDEO_CLAUDE_MONTHLY_USD`, separate from Page Watch's $5) with the same
behaviour. Past the cap, new plans wait until the 1st, and work in progress is
allowed to finish. Opus can be chosen with `VIDEO_CLAUDE_MODEL` for better
first drafts at about twice the cost. Railway's render time is billed
separately; it is a few minutes of one CPU per video.

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
- One hand-written test composition (title + screenshot + call to action),
  rendered end to end to an MP4 and a cover frame, then stored.
- **Done when:**
  - the worker on Railway renders the test video, and a staff-only page
    downloads it;
  - a composition that tries to load an outside address renders without it,
    and the attempt is logged;
  - a hung render is stopped at its time limit;
  - the full test suite passes.

### Phase 2: Reading the site and the plan

- Multi-page reading on the Page Watch reader: page choice, desktop and phone
  screenshots, text with positions, and crops.
- Brand extraction: logo, colours from CSS, and fonts mapped to a bundled set
  of about 20 fonts.
- The plan call: structured output, a cached system prompt built from
  `/brag`'s rubric and tones, and the server-side checks (seconds, crops,
  limits, no invented facts) with one retry.
- **Done when:** a set of 12 real sites (SaaS, agencies, local businesses,
  e-commerce, two that block robots) gives:
  - a plan for every readable site;
  - a plain-words refusal and the upload option for the two blocked ones;
  - no plan containing a number or claim that is not on the site.

  Every plan is reviewed against the rubric, and the plans and screenshots are
  kept as test fixtures.

### Phase 3: Building the video with Claude

- The scene library: the 8 templates in section 3.3. Each one is tested in
  all 3 shapes with long and short words, light and dark brands, and passes
  `check` on its own.
- The tool loop (`write_file`, `check`, `snapshot`, `done`) with its limits,
  the cost record, and clean failure.
- "Make changes": a change edits the plan or the composition and re-renders.
  Text-only changes skip the full loop.
- **Done when:** the 10 readable sites from Phase 2 each produce a video that
  passes `check`.
  - Every one is watched and scored against `/brag`'s delivery checklist:
    readable, on-brand, specific to the product, no cut-off text, a strong
    first 3 seconds.
  - At least 8 of 10 must be good enough to post as they are.
  - The cost and time of each are recorded and replace the estimates in
    section 3.7.

### Phase 4: The experience

- The pages:
  - the start page;
  - live reading steps;
  - the plan editor (scene cards, editable words, swapping a crop,
    reordering, adding a scene, live total seconds);
  - live making steps with frames;
  - the result: player, Download, Copy share text, Make changes, versions;
  - the library.
- The same design language as Page Watch (paper ground, bento blocks,
  Fraunces headings), and working at phone width with no sideways scrolling.
- The directory card (Signals, badge "building") and the hub counts, with
  their tests updated.
- **Done when:**
  - the whole journey is driven in a real browser at 1440 and 390 wide, with
    no script errors;
  - a staff member makes a video from a fresh site without help;
  - the page holds no internal details (model names, worker commands), as
    agreed for Page Watch.

### Phase 5: Hardening and launch

- Failures:
  - a worker restart mid-render (the job is handed back and runs again);
  - a site that never answers;
  - Claude unavailable (the plan step says so, nothing is half-made);
  - the monthly cap reached (a clear message; finishing work is allowed);
  - a render that fails (the reason is shown, and Try again works).
- Load: 3 videos queued at once while Page Watch is checking. Measure memory
  and decide whether the renderer needs its own service.
- Keeping: version limits, 90-day MP4 clean-up, and per-user limits (for
  example 20 videos a day).
- Security review of the sandbox and of uploads (image types only, size
  limits, re-encoded before use).
- Optional Slack message when a video is ready, to the channel chosen for the
  client.
- A launch checklist in this document (variables, Railway memory), then the
  badge goes from "building" to "live".
- **Done when:**
  - every failure above has a test and a live drill;
  - the load run stays under the worker's memory limit;
  - the checklist has been followed on Railway;
  - the first real client video has been made.

---

## 5. Known limits (first version)

- **No music.** The tracks bundled with `/brag` (ende.app "Happy Beats")
  have no stated licence; its own README says to check the terms before
  publishing. A later phase can add a music library you have licensed, or
  allow uploading a track you own.
- **No narration.** `/brag`'s voice uses a local speech model (Kokoro) that is
  too heavy for the worker. It can be added later as its own job.
- **Websites only.** Logged-in apps and sites that block robots need uploaded
  screenshots. The agent cannot click through a product the way `/brag` reads
  a codebase.
- **Short videos only:** 15–25 seconds in this version, up to 45 seconds
  later.
- **Less polish than working by hand.** Claude checks frames and fixes up to
  two rounds; a person in Claude Code can iterate without limit. "Make
  changes" closes most of the gap.

---

## 6. Decisions for you before Phase 1

1. **Name.** "Launch Video" is a working name.
2. **Monthly Claude budget.** Suggested `VIDEO_CLAUDE_MONTHLY_USD = 10`,
   which is about 10–25 videos a month on Sonnet 5.5.
3. **Who can use it.** Staff only, like the other agents, or also client
   logins later.
4. **Music.** Leave it out (the default), or license a library first.
