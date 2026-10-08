# video-studio: a Claude Code skill for studio-quality short videos

Type `/video-studio` in Claude Code and it makes a short, professional video (launch, ad, demo,
explainer, brand story, testimonial, event, recruiting, announcement) from your project, a website,
a brief, photos or a script. It plans a storyboard, cuts licensed music to the bar so the cuts land
on the beat and the video ends on the music's own ending, builds the video with HyperFrames, reviews
it frame by frame like an art director, masters the sound and exports a copy for each platform.

Built on /brag (github.com/latent-spaces/brag), with music-level editing added.

## Install

You need, once per computer:

1. **Claude Code**.
2. **Node.js 22 or newer**: https://nodejs.org (LTS).
3. **FFmpeg**: Windows `winget install Gyan.FFmpeg` · macOS `brew install ffmpeg` · Linux `sudo apt install ffmpeg`.
4. **Python 3.10+** (Windows: from python.org, tick "Add to PATH").
5. **HyperFrames skills and a render browser**, in any terminal:
   ```
   npx hyperframes skills
   npx hyperframes browser ensure
   ```

Then install this skill, either way:

**A. From the team's GitHub repo (recommended, gets updates):** in Claude Code,
```
/plugin marketplace add Krishna-1812/new-agentic-platform
/plugin install video-studio@markify-tools
```

**B. From the zip:** unzip `video-studio-skill.zip` so the folder `video-studio` (with `SKILL.md`
directly inside it) sits in your personal skills folder:

- Windows: `C:\Users\<you>\.claude\skills\video-studio\`
- macOS / Linux: `~/.claude/skills/video-studio/`

Restart Claude Code. Check everything with:
```
python ~/.claude/skills/video-studio/scripts/doctor.py      (Windows: py %USERPROFILE%\.claude\skills\video-studio\scripts\doctor.py)
```

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
