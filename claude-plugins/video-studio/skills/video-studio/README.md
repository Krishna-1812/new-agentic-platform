# video-studio: a Claude Code skill for studio-quality short videos

Type `/video-studio` in Claude Code and it makes a short, professional video (launch, ad, demo,
explainer, brand story, testimonial, event, recruiting, announcement) from your project, a website,
a brief, photos or a script. It plans a storyboard, cuts licensed music to the bar so the cuts land
on the beat and the video ends on the music's own ending, builds the video with HyperFrames, reviews
it frame by frame like an art director, masters the sound and exports a copy for each platform.

Built on /brag (github.com/latent-spaces/brag), with music-level editing added.

## Install

**The easy way (anyone, Windows/Mac/Linux):** get `video-studio-setup.zip`, unzip it, and:

- **Windows:** double-click `setup-video-studio.bat` (if Windows says "protected your PC", click
  *More info* → *Run anyway*).
- **Mac:** right-click `setup-video-studio.command` → *Open* (first time only).
- **Linux:** `bash setup-video-studio.sh`

It installs everything that is missing (Git, Node.js, FFmpeg, Python, Claude Code, the HyperFrames
video engine and its render browser), copies the skill into your Claude skills folder, and checks
it all. Takes 5-15 minutes the first time; safe to run again (it updates the skill). Then restart
Claude Code.

**If you work in the new-agentic-platform repo:** nothing to do. Open the repo in Claude Code and
accept the "trust this folder" prompt; the repo's `.claude/settings.json` turns the plugin on. On a
new laptop, run the installer once anyway (or type `/video-studio help me finish setup`) so the
video tools are installed.

**From GitHub, by hand:** in Claude Code, `/plugin marketplace add Krishna-1812/new-agentic-platform`
then `/plugin install video-studio@markify-tools`.

**It fixes its own setup.** Every run starts with a one-second check. If something is missing,
Claude says what in plain words and offers to install it.

## Use

```
/video-studio
/video-studio --kind ad --format vertical --duration 15
/video-studio --tone cinematic --platform instagram,youtube
/video-studio make a 20s launch video for this repo, landscape and vertical
/video-studio --source https://example.com --kind explainer --voice
```

You get `video-output/` with `video.mp4` (poster baked in), `video.jpg`, `exports/` per platform,
`share-copy.txt`, `credits.txt`, the plan and storyboard, and the editable HyperFrames project.
Claude shows you a Studio preview before the final render; say what to change in plain words.

## What's inside

- `SKILL.md`: the workflow (discover → plan and cut the music → compose → review → deliver).
- `references/`: formats and platforms, 10 tones, visual craft, music, sound design, voiceover,
  review, delivery.
- `assets/music/`: 13 full-length tracks (Sascha Ende, CC BY 4.0: ads allowed with a credit), all at
  the same loudness, each mapped (bars, sections, lifts, ending, ready-made cuts). See `LIBRARY.md`.
- `assets/sfx/`: 260 CC0 sound effects with an analysis of which are safe to repeat.
- `scripts/`: `fit_music.py` (cut a bed to the bar, with real endings), `analyze_music.py` (map your
  own track), `prepare_track.py`, `loudness.py` (measure and master), `review_frames.py`,
  `poster.py`, `export.py`, `fetch_fonts.py`, `doctor.py`.

Credits and licences: `CREDITS.md`. Code: MIT (`LICENSE`).
