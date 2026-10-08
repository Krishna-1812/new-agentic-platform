# Music

Music decides how a video feels before a single word is read. A good editor does not lay a track
under finished picture and fade it out at the end; they choose the track for the story, cut it so
its phrases fit the video, time the picture to its bars, and make it end when the video ends.
That is the whole difference between "a video with music" and "a scored video". This file is how
to do that here.

Contents: 1 Choose · 2 Read the map · 3 Cut the bed · 4 Edit picture to music · 5 Endings ·
6 Dynamics and mix moves · 7 Levels · 8 Music under a voice · 9 Audio-reactive visuals ·
10 Loudness and delivery · 11 Your own track · 12 Licences and credits · 13 Checklist

---

## 1. Choose the track

Start from the plan, not from the library: what should the viewer feel at the hook, at the
reveal, at the end? Then match on four things, in this order.

1. **Mood.** The emotion of the story: cheerful, confident, warm, epic, calm, playful, bold.
   Wrong mood cannot be fixed by editing. `assets/music/LIBRARY.md` lists every track's moods,
   character and best uses; `library.json` has the same as data.
2. **Energy curve.** Does the story build (cinematic, launch), stay level (demo, explainer), or
   start strong and stay strong (ad)? Pick a track whose sections can give that curve inside the
   window you will use (see its map's Sections table).
3. **Tempo against the edit pace.** The bar length sets how often the picture can change on the
   music. Fast, cut-heavy edits want 110-130 BPM; calm, photo-led films 70-90 BPM.

   | BPM | Beat | Bar (4/4) | 2 bars | 4 bars (a phrase) |
   |---|---|---|---|---|
   | 75 | 0.80s | 3.20s | 6.40s | 12.80s |
   | 82 | 0.73s | 2.93s | 5.85s | 11.71s |
   | 100 | 0.60s | 2.40s | 4.80s | 9.60s |
   | 110 | 0.55s | 2.18s | 4.36s | 8.73s |
   | 114 | 0.53s | 2.11s | 4.21s | 8.42s |
   | 120 | 0.50s | 2.00s | 4.00s | 8.00s |
   | 130 | 0.46s | 1.85s | 3.69s | 7.38s |

   A 20s video at 120 BPM is exactly 10 bars: scenes of 1, 2 or 4 bars fit perfectly.
4. **Under a voice or not.** With narration, pick a track marked "under a voice: yes" (sparse in
   the 1-4 kHz speech band) and carve it (section 8). Busy, bright tracks fight speech.

Quick picks:

| Video | First choice | Also |
|---|---|---|
| Product launch, upbeat | `upbeat-business-1` | `uplifting-pop`, `punchy-business-10` |
| Paid social ad, 15s | `punchy-business-10` (its own ending at 0:59 makes back-timing easy) | `bold-tropical-house` from the drop |
| Premium / polished | `steady-business-12` | `corporate-imagefilm` |
| B2B, results, company | `corporate-imagefilm` | `warm-business-11` |
| Epic / trailer | `cinematic-brave` | `corporate-imagefilm` lifts |
| Brand story, craft, food, people | `warm-acoustic` | `documentary-hopeful` |
| Narrated explainer / tutorial | `minimal-morning-light` | `documentary-hopeful`, `steady-business-12` |
| Fun consumer app | `playful-sunny` | `uplifting-pop` |
| Startup parody | `warm-business-11` | `laidback-business-9` |
| Events, fashion, hype | `bold-tropical-house` | `punchy-business-10` |

`--music none` is valid, and so is silence chosen on purpose (a deadpan joke), but say so in the
plan. Silence by accident looks unfinished.

When the library has nothing that fits, use in this order: a track the person supplies and holds
a licence for (section 11); `/media-use` → `resolve --type bgm --intent "<mood, tempo, energy>"`
(HeyGen catalogue, needs the HeyGen CLI); generation through `/media-use` as a last resort. Never
use commercial songs the person has no licence for, however perfect they sound.

## 2. Read the map

Every library track has `assets/music/analysis/<id>.music.md` (read this) and `.music.json` (the
scripts read this). The map gives:

- **Tempo, beat and bar length.** Bar lines (`downbeats`) are the places a cut sounds intended.
- **Trust.** Library maps come from a trained downbeat model (madmom), so bar lines are reliable.
  Maps made without it say "bar lines are a guess": then cut on beats and section starts, and
  confirm a big reveal's bar line by looking at the waveform energy (the map's `energy` values)
  before locking to it.
- **Sections** with energy (●○), a label (intro, low, mid, high, outro) and **LIFT** where the
  music gets clearly louder (+2.5 dB or more): the drops and builds a reveal should land on.
- **Phrase starts**: every 4 bars from each section start. Starting the bed on one makes the cut-in
  sound like the music began there.
- **Ending**: `hit` (the track ends on a final chord or hit, then rings) or `fade` (it fades out),
  with the final hit's time and when it falls silent.
- **Ready-made cuts**: for 15/20/30/45/60s, where to cut in for a natural ending or a button
  ending, where the lift lands, and where the final hit or stop falls. Use them to choose quickly.
- **Strong cues** (`strongCues` in the JSON): the most accented moments, compatible with /brag's
  cue files.

## 3. Cut the bed

Do this in Step 2, before timing scenes.

```bash
python3 <skill>/scripts/fit_music.py <skill>/assets/music/<id>.mp3 \
  --map <skill>/assets/music/analysis/<id>.music.json \
  --duration <seconds> --mode natural|button|fade|auto \
  [--anchor <track-s>@<video-s>] [--start <track-s>] [--ring <s>] \
  --out video-output/music/bed.wav
```

It writes the bed (a WAV exactly as long as the video, fades baked in, sample-accurate) and
`bed.timing.json` with, in **video time**: `beats`, `bars`, `phrases`, `sections`, `lifts`,
`strongCues`, `lastDownbeat` (the final hit or the stop), `musicEnd`, and `notes`. Read the notes:
they say where to put the logo and the impact.

Options that matter:

- `--anchor 95.25@6.4`: make track time 95.25s (a lift) land at video time 6.4s (the reveal).
  This is how you make the drop hit the reveal exactly. Works with `button` and `fade`.
- `--start 32.0`: cut in at a phrase you chose by ear-free reasoning from the map (for example the
  start of a breakdown, so the drop arrives a few bars later).
- `--ring 1.2`: in `button` mode, how long the logo holds after the stop.

Cut it to `video-output/music/` (Step 3 copies it into the composition after `init`, which will not
scaffold into a folder that already exists). The bed is the final music file: do not trim or loop it
again inside the composition; place it at `data-start="0"` for the full duration.

## 4. Edit picture to music

The rules, from most to least important:

1. **Cut on bar lines.** Scene changes land on `bars` from the timing file, within one frame
   (0.033s at 30 fps). A cut half a beat off reads as a mistake to anyone, even without knowing why.
2. **The hook starts with the music.** Something moves on the first downbeat. If the bed starts
   in a quiet section, the hook can be quiet too, with the energy arriving on the first lift.
3. **Land the reveal on a lift or a strong downbeat.** The moment the product or the answer
   appears is the moment the music opens up. Use `--anchor` to make that happen. One to three such
   locks in a 15-30s video; more and nothing feels special.
4. **Highlights move on the beat; text holds.** Entrances and accents (a card landing, a number
   ticking, a glow) start on beats. Text that must be read obeys the reading-time floor and may
   span several beats; never pull text off early to hit a beat.
5. **Sequences on the grid.** Items arriving one by one go on consecutive beats when they are
   visuals, every other beat or every bar when they are lines to read.
6. **The payoff lands on the final hit.** The end card begins a bar or two before
   `lastDownbeat`; the logo or the offer lands exactly on it.
7. **Phrases shape the story.** A 4-bar phrase is a sentence. Starting a new story beat on a
   phrase start (not mid-phrase) makes the whole edit feel inevitable.
8. **Don't force it.** If honouring the grid would make a scene too short to read or break the
   story, keep the story and cut on the nearest beat instead. Readability and the product come first.

Mark sync points in the composition so a later edit keeps them:
`// bar-locked: scene 3 starts on bar 5 (8.00s)` · `// lift-locked: reveal at 8.00s` ·
`// beat-grid: cards at 12.00, 12.50, 13.00`.

## 5. Endings

How a video ends is most of how professional it sounds.

| Mode | What happens | Use when |
|---|---|---|
| `natural` | The bed is back-timed so the track's own ending (its final hit and ring, or its composed fade) lands on the video's last frame. Cut-in is snapped to a bar line within a second; the script fades the last of the ring or leaves under a second of silence if needed. | The default for anything 12s or longer when the track's ending suits the tone. It is what a film editor does. |
| `button` | The bed starts on a downbeat and stops on a downbeat (or half-bar for slow tracks) about 1s before the end, with a 0.25s release. You land an impact SFX on that downbeat, and the logo holds in its tail. | Punchy ads, chaotic and app-store tones, and any track whose own ending is wrong for the mood or too far away. |
| `fade` | Starts on a downbeat, fades over the last bar or so. | Last resort, or a deliberately soft, unresolved end (a loop, a teaser). |

A natural ending needs a long enough track before its ending: the window you use is the last
N seconds of the track. If that window is the wrong mood (for example a cinematic track's quiet
coda under an energetic ad), use `button` instead.

For a looping web hero, end on a bar line with no fade and make the last frame match the first;
the music then loops cleanly too.

## 6. Dynamics and mix moves

A bed at one level for 20 seconds sounds like a playlist. Move it, gently, with HyperFrames volume
automation (`/hyperframes-audio`), on the bed element:

```html
<audio id="music" data-timeline-role="music" data-audio-group="music"
  data-start="0" data-duration="20" data-track-index="10" data-volume="0.9"
  data-automation="{&quot;version&quot;:1,&quot;lanes&quot;:[{&quot;target&quot;:&quot;volume&quot;,&quot;points&quot;:[{&quot;t&quot;:0,&quot;v&quot;:1},{&quot;t&quot;:7.6,&quot;v&quot;:1},{&quot;t&quot;:7.75,&quot;v&quot;:0.5},{&quot;t&quot;:7.98,&quot;v&quot;:0.5},{&quot;t&quot;:8.0,&quot;v&quot;:1}]}]}"
  src="assets/music/bed.wav"></audio>
```

(This is the drop-out below: the bed dips 6 dB for the quarter-second before the reveal at 8.00s and
slams back on the downbeat. Write the JSON on one line, double-quoted with `&quot;`, as
`/hyperframes-audio` requires. Lane values multiply with `data-volume`; `t` is seconds from the
clip start. Check it with `npx hyperframes check`, then read the dip in `loudness.py --timeline`.)

Moves worth knowing:

- **The drop-out.** Dip the bed about 6 dB (×0.5) for the half-beat before a reveal, then back to
  full on the downbeat. The reveal feels bigger because of the space before it.
- **The breath.** Bring the bed down 3-4 dB under the hook line or a key sentence that needs
  attention, and back up when it has landed.
- **The swell.** Raise the bed 2-3 dB across the last bar into the final hit.
- **Silence as a hit.** In chaotic or deadpan tones, a full stop of the music for one beat before
  the punchline is the loudest thing you can do. Use it once.
- **The ring.** After a button stop, let the impact SFX and its tail carry the logo; do not restart
  the music.

Keep moves slow enough to sound musical (ramps of 0.1-0.5s; never sudden jumps mid-phrase, except
deliberate cuts on a beat).

## 7. Levels

All library tracks are prepared to about -16 LUFS, so these levels work for every track. They were
calibrated by rendering, measuring and mastering a real video with this skill. Set levels for
**balance** in the composition; set **loudness** at the end with `loudness.py`.

| Element | `data-volume` | About | Notes |
|---|---|---|---|
| Music bed, no voice | 0.85-1.0 | 0 to -1.5 dB | The soundtrack. |
| Music bed, deadpan / restrained | 0.35-0.5 | -9 to -6 dB | Present but polite. |
| Music bed under a voice | 0.9, then carve | | The carve ducks it (section 8). Without a carve: 0.25-0.35 under speech. |
| Voice | 1.0 | 0 dB | Everything else sits around it. |
| SFX, hero hit (logo, reveal) | 0.45-0.6 | -7 to -4.5 dB | Heard clearly, once or twice. |
| SFX, UI clicks, drops, cards | 0.3-0.45 | -10 to -7 dB | Felt more than heard. |
| SFX, typing, ticks, repeated | 0.2-0.3 | -14 to -10 dB | Quiet; repetition adds up. |

Linear ↔ dB: 1.0 = 0 dB · 0.7 = -3 dB · 0.5 = -6 dB · 0.35 = -9 dB · 0.25 = -12 dB · 0.18 = -15 dB · 0.12 = -18 dB.

Why SFX sit so far below the bed: the library's sound effects peak near 0 dBFS, while the bed's
peaks sit 10-15 dB above its average. An SFX at 0.8 over a bed at 0.5 measures as a 6+ LU jump and
forces the mastering limiter to work hard on every hit. A rendered mix should measure roughly -24
to -18 LUFS before mastering, with `loudness.py` flagging no jumps you did not intend; mastering then
lifts it to the target with little limiting.

Never push `data-volume` above 1.0 to make something louder; the master stage handles loudness.

## 8. Music under a voice

With `--voice` (see voiceover.md):

1. Pick a bed marked "under a voice: yes".
2. Put every narration clip in one audio group (`data-audio-group="voiceover"`), the bed in its own
   (`data-audio-group="music"`).
3. Carve the bed against the voice group. The carve cuts only the bands speech uses and ducks the
   bed dynamically, so the music keeps its low end and air:

   ```bash
   node <hyperframes-audio skill>/scripts/carve.mjs --comp video-output/composition/index.html
   ```

   (strength 0.8 by default; `--bed music --voice voiceover` if detection picks wrong; needs
   `npm i -D @hyperframes/core` in the composition folder). Full rules: `/hyperframes-audio`.
4. Let the music breathe between lines: leave half a bar to a bar without voice at section changes,
   so the bed can come up and carry the cut.
5. Start the voice on or just after a downbeat, never on top of a lift: the lift and the first word
   fight.

## 9. Audio-reactive visuals

With music and a tone that allows it, let one or two existing elements breathe with the music:
the hero glow, a photo's brightness, a card's shadow, a background's warmth. Use the extraction
and per-frame sampling in `/hyperframes-creative` → `audio-reactive.md` (it owns the helper; do
not hardcode its path). Keep it subtle. Never add waveforms, equaliser bars, musical-note graphics
or strobing, and never scale text with the music.

## 10. Loudness and delivery

After the final render:

```bash
python3 <skill>/scripts/loudness.py video-output/video.mp4 --timeline
```

It reports integrated loudness (LUFS), true peak (dBTP) and loudness range, flags any second where
something jumps 6+ LU above the mix (an SFX that's too loud) or drops near silence (a hole in the
bed), and with `--timeline` prints the loudness second by second. Fix balance problems in the
composition and re-render; do not fix them by mastering.

Targets (`--target`): `social` and `youtube` -14 LUFS / -1 dBTP; `web` and `podcast` -16 LUFS;
`broadcast` -23. Platforms turn loud videos down and leave quiet ones quiet, so a quiet video
loses; -14 is the safe social target. Mastering (`--master`, and every `export.py` copy) is plain
gain to the target followed by an oversampled peak limiter, so the mix's dynamics survive: a quiet
build stays quiet next to its drop. (ffmpeg's loudnorm is deliberately not used for this: when it
needs a lot of gain it switches itself to dynamic mode and flattens the music.) It leaves 0.5 dB of
headroom for the AAC encoder and adds a 25 ms lead-in so the encoder never overshoots on the first
sample. Compare the loudness range (LRA) before and after: a drop of more than ~1 LU means the
limiter is working too hard, so lower the SFX or raise the bed and re-render.

## 11. Your own track

The person's track must be one they hold a licence for. Then:

```bash
python3 <skill>/scripts/prepare_track.py song.mp3 video-output/music/song.mp3          # to -16 LUFS
uv run --project <skill>/scripts python <skill>/scripts/analyze_music.py \
  video-output/music/song.mp3 --output-json video-output/music/song.music.json \
  --output-md video-output/music/song.music.md
python3 <skill>/scripts/fit_music.py video-output/music/song.mp3 --map video-output/music/song.music.json ...
```

`uv` installs librosa and friends on first run (about a minute). For reliable bar lines, install
madmom into the same environment once (it needs a C compiler; skip it on Windows if it fails):

```bash
uv pip install --python <skill>/scripts/.venv cython numpy
uv pip install --python <skill>/scripts/.venv --no-build-isolation "git+https://github.com/CPJKU/madmom"
```

Without madmom the map says how far to trust its bar lines. Without `uv` or Python packages at
all, wire the track into the composition and run `npx hyperframes beats video-output/composition`
for a plain beat grid (no bars, sections or ending), and cut the music with your own judgement.

## 12. Licences and credits

- Library: 13 tracks by Sascha Ende (ende.app), **CC BY 4.0**. Commercial use, including paid ads,
  is allowed with a credit. Write the credit line from `library.json` (`credit`) into
  `credits.txt`, and add it to the video's description or post where the platform allows.
- YouTube Content ID sometimes claims these tracks. The licence covers the use: dispute the claim
  citing CC BY 4.0 and the track's ende.app page.
- SFX: Kenney (CC0) and the keyboard pack by unicae_games (CC0). No credit needed.
- Never ship a video with music of unknown origin.

## 13. Checklist

- [ ] Track chosen for mood, energy curve, tempo and voice; the reason is in the plan.
- [ ] Bed cut with `fit_music.py`; `bed.timing.json` exists; ending mode chosen deliberately.
- [ ] Scene changes on bar lines (or nearest beat, with a reason).
- [ ] The reveal lands on a lift or strong downbeat; the payoff lands on the final hit or stop.
- [ ] Text reading time never shortened to hit a beat.
- [ ] Bed at the right level for its role; one or two mix moves, not ten.
- [ ] With a voice: carved, grouped, and the voice never starts on a lift.
- [ ] `loudness.py` passes on every export; no 6 LU jumps it cannot explain.
- [ ] `credits.txt` written.
