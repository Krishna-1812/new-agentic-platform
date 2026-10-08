---
name: video-studio
description: Make a professional, studio-quality short video (launch video, paid social ad, product demo, explainer, brand story, testimonial, event promo, recruiting or announcement video) with HyperFrames, scored to music the way a real editor would. Use when someone says "/video-studio", "make a video", "launch video", "promo", "ad video", "reel", "turn this into a video", "brag about this", or wants a video from a project, a website, a brief, photos or a script. Prefer this over the generic hyperframes entry workflow for any launch, ad, promo, demo, explainer, story or social video. Also "/video-studio help me finish setup" to install what it needs. Reads the project or sources directly, plans a storyboard, cuts a licensed music bed to the bar, builds, reviews like an art director, masters the sound and exports for each platform.
---

# /video-studio

A short video that looks like a good studio made it: a hook that stops the scroll, the real
product on screen, type that reads at a glance on a phone, and music cut to picture, so the cuts
land on the bar and the video ends on the music's own ending instead of a fade-out that sounds
like it ran out of time.

This skill builds on `/brag` (github.com/latent-spaces/brag, MIT) and keeps its method: read the
real thing, commit to one angle, plan the hook first, show the product, keep it short. It adds:
video kinds beyond launches, platform formats, an art-director review loop, a truth rule for
client work, and a full music workflow (a mapped library, bar-accurate cuts, real endings, mix
levels, loudness mastering).

**`<skill>`** below means this skill's folder. Claude Code prints it as "Base directory for this
skill" when the skill loads. Run Python as `python3` (on Windows, `py -3` or `python`).

## 0. Parse the invocation (first)

```
/video-studio
/video-studio --kind ad --format vertical --duration 15
/video-studio --tone cinematic --music cinematic-brave
/video-studio make a 20s launch video for this repo, landscape and vertical
/video-studio --voice --kind explainer --source https://example.com
```

| Option | Values | Default |
|---|---|---|
| `--kind` | `launch`, `ad`, `demo`, `explainer`, `story`, `testimonial`, `event`, `recruiting`, `announcement` | inferred |
| `--tone` | a preset (§ Tones) or freeform direction | inferred |
| `--format` | `landscape` 16:9, `vertical` 9:16, `square` 1:1, `portrait` 4:5; comma list for several | from the platform, else `landscape` |
| `--platform` | `x`, `linkedin`, `instagram`, `tiktok`, `youtube`, `shorts`, `web` | none |
| `--duration` | seconds | by kind (15-30s) |
| `--source` | path(s), URL(s) | the current project |
| `--music` | a library id, a mood, a file path, or `none` | chosen in the plan |
| `--ending` | `natural`, `button`, `fade` | chosen from the music |
| `--no-sfx` | flag | SFX on |
| `--voice` | flag: narration | off |
| `--captions` | flag: burned-in captions of the narration | on when `--voice` |
| `--script` | text or file: words to use exactly | none |
| `--title` | string | inferred |

Voice is opt-in. Never add narration, a voice script or a voice track unless `--voice` is given
or the person asks for narration in words.

If the request names no subject and there is no project in the current folder, ask what the
video is about. Ask nothing else up front: infer, state your assumptions in the plan, and let
the person correct the plan.

## 0b. Make sure this computer is ready (every run, takes a second)

Run the setup check before anything else:

```bash
python3 <skill>/scripts/doctor.py --quick --json      # Windows: py -3 ... (or python ...)
```

- **`"ready": true`**: say nothing about setup and carry on. (`--quick` trusts a full check from
  the last 14 days, so this costs nothing on a ready machine.)
- **Not ready**: tell the person, in plain words and one line per item, what is missing (the
  `name` of each item with `"ok": false` and `"required": true`), and offer to install it now:
  "I can set this up for you, it takes about 5-10 minutes. Go ahead?" With a yes, run each
  item's `fix` command in this order: node, ffmpeg, hyperframes, skills, browser. Then run
  `doctor.py --json` again (without `--quick`).
  - A fix that installs a program (Node.js, FFmpeg) often is not visible until Claude Code is
    restarted, because the program's folder is added to PATH for new windows only. If the re-check
    still misses it, say: "Installed. Please close and reopen Claude Code, then type /video-studio
    again", and stop there.
  - A fix that needs a password (sudo, Homebrew) or fails: say what happened in one line and offer
    the one-click installer instead (`installer` in the JSON; it ships in the setup zip next to the
    skill).
  - If Python itself is missing, the check cannot run: tell the person to double-click the
    installer (`setup-video-studio.bat` on Windows, `setup-video-studio.command` on Mac), or, on
    Windows, offer to run `winget install -e --id Python.Python.3.12`.
- If the person asks for help with setup ("help me finish setup", "it doesn't work"), run the full
  check (`doctor.py --json`) and fix as above, even if `--quick` says ready.

Never make the person read an error log: translate each problem into one sentence and one choice.

## Output

Write everything to `video-output/` (or `video-output-YYYY-MM-DD-HHmmss/` if that already exists
or the person wants a fresh run). Use one timestamp for the whole run.

```
video-output/
  plan.md                the plan and storyboard: the creative contract
  brief.md               the HyperFrames composition brief
  composition/           the HyperFrames project (one per format: composition-vertical/ ...)
  review/                contact sheets and frames from the review passes
  video.mp4              the master render, poster baked in as frame 0
  video.jpg              the poster
  exports/               platform copies (video-social.mp4, video-web.mp4, ...)
  share-copy.txt         one caption, ready to post
  credits.txt            the music credit line(s)
```

## The workflow

Each step has a gate. Do not start a step until the gate before it is met.

### Step 1: Discover

**Read:** [references/step-1-discover.md](references/step-1-discover.md)

Read the source (project code, site, brief, photos, script). Extract the product's real words,
real UI, colours, fonts, logo and pictures. Build the truth ledger: every fact the video may say.

**Gate:** you can answer all 10 questions of the discovery rubric.

### Step 2: Plan, and choose and cut the music

**Read:** [references/step-2-plan.md](references/step-2-plan.md), [references/formats.md](references/formats.md),
[references/tones.md](references/tones.md), [references/music.md](references/music.md)

Commit to one angle and write the hook first. Pick the music from
`<skill>/assets/music/LIBRARY.md`, then cut the bed with `scripts/fit_music.py` before timing a
single scene, so the storyboard is written on the music's bar grid: scenes change on bar lines,
the reveal lands on a lift or a downbeat, and the end card sits on the final hit.

**Gate:** `plan.md` holds the full storyboard; scene lengths add up to the duration; every scene
boundary is on the bed's bar map (or the plan says why not); the bed and its `.timing.json` exist.

### Step 3: Compose with HyperFrames

**Read:** [references/step-3-compose.md](references/step-3-compose.md),
[references/visual-craft.md](references/visual-craft.md), [references/sound-design.md](references/sound-design.md),
and with `--voice`, [references/voiceover.md](references/voiceover.md)

Write `brief.md`, then build the composition with the HyperFrames domain skills
(`hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`,
`hyperframes-audio`, `hyperframes-cli`, `media-use` and `hyperframes-registry` as needed). This
skill is its own workflow: **do not run the `hyperframes` entry-point intent interview or route
into its generic launch-video workflow.** This skill owns the story, the words, the music and its
cut, and the delivery; HyperFrames owns the composition mechanics.

**Gate:** `npx hyperframes check` passes with zero errors in each composition folder.

### Step 4: Review like an art director

**Read:** [references/review.md](references/review.md)

Snapshot every scene at its settled moment, look at the frames, score them against the quality
bar, fix, and repeat (up to three rounds). Then preview: give the person the Studio URL and wait
for approval before the final render.

**Gate:** every line of the quality bar scores 4 or 5, and the person approved the preview (or
asked you to go straight to render).

### Step 5: Render, master, deliver

**Read:** [references/step-5-deliver.md](references/step-5-deliver.md)

Render at `--quality delivery`, pick and bake the poster, master the loudness, make the platform
exports, write the share copy and the music credit.

**Gate:** `video.mp4`, `video.jpg`, `share-copy.txt` and `credits.txt` exist;
`scripts/loudness.py` passes on every export.

## Creative laws

These hold for every video, whatever its kind or tone.

1. **The hook is everything.** The first 2 seconds decide whether anyone watches the rest. Plan
   the hook before anything else. Never open on a logo alone, a blank frame or "Introducing".
   Something meaningful is on screen and moving by 0.5s.
2. **Show the real thing.** At least one scene shows the actual product, UI, copy, photo or
   result. The product *doing* its thing beats the product *describing* its thing.
3. **Specific beats generic.** Real names, real numbers, real screens. "Streamline your workflow",
   "elevate", "supercharge", "unlock" and every phrase like them are banned.
4. **Nothing invented.** Every number, price, claim, quote, name and date on screen or in the
   share copy is in the truth ledger. If the sources don't have a figure, the video has none.
5. **Readable.** Fast in, then hold: a short label holds about 0.8s once settled; a sentence about
   0.3s per word, at least 1.2s. Pace comes from motion and cuts, never from text leaving before it
   is read. Type is big enough to read on a phone at arm's length (sizes in visual-craft.md).
6. **Works with the sound off.** Most feeds autoplay muted. Every key point is in words on screen.
7. **Works with the sound on.** Music is cut to picture, not laid under it. Cuts land on the bar,
   the payoff lands on a lift or a hit, and the music ends with the video, on purpose.
8. **One idea per scene, one hero motion per scene.** Everything else supports it or stays still.
9. **Short.** 15-30 seconds unless the kind needs more. Not one second more without a reason.
10. **Every frame is postable.** Pause anywhere: it should look designed, not mid-accident.
11. **Funny earns its place.** Humour comes from the product's own absurdity, not from trying.
12. **Plain words.** No em dashes in on-screen copy or share copy. Sentence case unless the tone
    says otherwise.

Starting shape (adapt it; not every video needs three highlights):

```
Hook (2-3s) → Reveal (2-4s) → 2-3 sharp highlights (5-15s) → Payoff / end card (2-4s)
```

## Tones

Ten presets. They change pacing, typography, motion, transitions, music and SFX density.
A freeform direction ("fake Series A launch from 2016", "museum exhibit") maps to the nearest
preset for structure and is kept, word for word, in the plan and brief. Full definitions, with
music picks for each: [references/tones.md](references/tones.md).

| Tone | Energy | One-liner |
|---|---|---|
| `default` | Playful, clean, postable | The good-vibes default |
| `polished` | Serious, elegant | Restraint as the creative choice |
| `yc-parody` | Deadpan startup | Fake seriousness, played straight |
| `chaotic` | Fast, loud | The video is the joke |
| `deadpan` | Calm, dry | Nothing registers as unusual |
| `cinematic` | Trailer-scale | Big type, bigger claims |
| `app-store` | Feature-card clean | Corporate, not boring |
| `documentary` | Human, warm | Real people, real places |
| `luxury` | Slow, minimal, rich | Every frame a print ad |
| `editorial` | Magazine typography | Grids, type and photographs |

## Music, in one paragraph

Music is planned in Step 2, not added at the end. Choose a track from the mapped library (13
full-length CC BY 4.0 tracks, all at the same loudness, each with a map of its bars, sections,
lifts and ending), or map the person's own licensed track with `scripts/analyze_music.py`. Cut the
bed to the exact video length with `scripts/fit_music.py` in `natural` mode (the track's real
ending lands on the last frame), `button` mode (it stops on a downbeat about a second before the
end, an impact SFX lands there, the logo holds in its tail) or `fade` mode (last resort). Time the
storyboard to the bar map it prints. Balance the mix in the composition; master the loudness at
the end with `scripts/loudness.py`. Credit the track. Everything else:
[references/music.md](references/music.md).

## Requirements

Node.js 22+, FFmpeg/ffprobe on PATH, the HyperFrames CLI (`npx hyperframes`), the HyperFrames
skills (`npx hyperframes skills`), and a headless Chrome for rendering
(`npx hyperframes browser ensure`, or `HYPERFRAMES_BROWSER_PATH` pointing at an installed one). Python 3.10+ for the scripts (standard library only, except
`analyze_music.py`, which runs under `uv`). Check everything with:

```bash
python3 <skill>/scripts/doctor.py
```

If something is missing, tell the person exactly what and how to install it (doctor prints the
fix), then continue with what does work: a plan and storyboard are still worth delivering.
