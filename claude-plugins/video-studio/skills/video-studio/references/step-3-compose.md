# Step 3: Compose with HyperFrames

This skill owns: the story, the words, the selection of moments, the visual identity, the music,
its cut and its bar map, the sound posture, and delivery. HyperFrames owns: the composition
structure, the exact animation mechanics, runtimes, lint rules and the render. Load the domain
skills and follow them; they are newer than anything written here.

| Need | Skill |
|---|---|
| Composition contract, `data-*` timing, tracks, sub-compositions, media | `/hyperframes-core` (read first) |
| Motion rules, scene blueprints, transitions, text effects | `/hyperframes-animation` |
| Push-ins, punch-ins, camera, masks, seek-safe keyframes | `/hyperframes-keyframes` |
| Design spec, typography, beats, audio-reactive | `/hyperframes-creative` |
| Fades, automation, carve, effects on placed audio | `/hyperframes-audio` |
| Images, icons, logos, voice, captions, treatments | `/media-use` |
| Named looks and effects, ready-made blocks | `/hyperframes-registry` |
| init, lint, check, snapshot, preview, render | `/hyperframes-cli` |
| Track layout that reads well in Studio, safe zones | `/hyperframes-studio` |

**Do not** run the `hyperframes` entry-point intent interview, write its `BRIEF.md`, or route into
its `/product-launch-video` or `/general-video` workflow. This skill already did that work.

## 1. Write brief.md

```markdown
# Composition brief: [Name]

## Objective
[One line: the video, its kind, its job.]

## Output
- Composition: video-output/composition/ (and composition-<shape>/ per extra shape)
- Canvas: [1080x1920 @ 30fps], duration [N]s (root data-duration)
- Render: video-output/video.mp4

## Source material
- Project root / URLs: [...]
- Files read: [...]
- Real UI / visuals to recreate: [specific components, screens, photos with file names]
- Copy that must appear verbatim: [...]
- Truth ledger: see plan.md; nothing else may be stated.

## Creative direction
- Kind / tone / direction: [...]
- Angle: [...]
- Hook (0-2s): [exact]
- Payoff / end card: [exact; what lands on the final hit]
- Avoid: generic SaaS language, abstract filler, redesigning the brand, em dashes.

## Visual identity
[Exact colours, fonts (local files), corners, logo files and which version on which ground.]

## Timeline (from the bar map)
| Scene | Start | End | Bars | On screen | Hero motion | Music here | Sound |
|---|---|---|---|---|---|---|---|
| 1 Hook | 0.00 | 4.00 | 2 | ... | words rise over photo, push-in | breakdown, quiet | none |
| 2 Reveal | 4.00 | 8.00 | 2 | ... | product card lands on 8.00 lift | LIFT at 8.00 | soft impact at 7.98 |

## Music
- Bed: assets/music/bed.wav (cut by fit_music.py, [mode], from `[id]` at [s]); full length, data-start 0
- Timing: assets/music/bed.timing.json (bars, beats, lifts, lastDownbeat in video time)
- Bed level: data-volume [0.9]; mix moves: [drop-out before 8.00; swell into 18.40]
- Locks: [reveal → lift 8.00; logo → final hit 18.40]
- Audio-reactive: [none / what breathes]

## Sound design
- Palette: [families]; density: [n]
- Moments: [scene → intent]; exact files and times chosen against the built motion, from
  <skill>/assets/sfx (read sfx-analysis.md; prefer low HF risk for repeated sounds)

## Voice (only with --voice)
[Files, lines, scenes; carve required.]

## Requirements
- Show real UI, copy or photos from the source in the centrepiece scenes.
- All text readable (visual-craft.md sizes; reading-time floor; check's contrast and layout pass).
- Scene changes on bar lines from bed.timing.json; mark locks in code comments.
- `npx hyperframes check` passes with zero errors.
```

## 2. Set up the project

```bash
cd video-output
npx hyperframes init composition --non-interactive    # centred blank; see /hyperframes-cli
mkdir -p composition/assets/{music,sfx,img,fonts}
```

Copy the bed and its timing file in (`cp video-output/music/bed.* composition/assets/music/`),
then fonts, logos and photos. For Google Fonts:
`python3 <skill>/scripts/fetch_fonts.py "EB Garamond:ital,wght@0,500;1,500" --out composition/assets/fonts`
prints the `@font-face` rules to paste. Copy GSAP (or any runtime) in as a local file too:
`curl -o composition/assets/js/gsap.min.js https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`. Everything the composition uses must be inside its folder and
referenced by relative path (`assets/img/hero.jpg`), never absolute paths and never network URLs
(the render browser runs offline). Copy only the SFX files you use.

## 3. Build order

Build in passes, each one checked before the next. This is how studios work, and it keeps the
expensive decisions early.

1. **Skeleton on the grid.** Root composition at the final size and duration; one scene per
   storyboard row as a sub-composition (or a clearly separated block) with `data-start` /
   `data-duration` straight from the bar map; the bed placed:

   ```html
   <audio id="music" data-timeline-role="music" data-audio-group="music" data-start="0"
     data-duration="20" data-track-index="10" data-volume="0.9" src="assets/music/bed.wav"></audio>
   ```

   Run `npx hyperframes lint`.
2. **Hero frames.** Build each scene's settled state first (the frame you'd pause on): layout,
   type sizes, photos, colours. `npx hyperframes snapshot --at <each scene's 80% point>` and look.
   Fix layout before animating anything.
3. **Motion.** Entrances, the hero motion, camera, transitions, sequences on beats. Search the
   registry before hand-building effects. Mark sync points:
   `// bar-locked`, `// lift-locked`, `// beat-grid`.
4. **Sound pass** (picture locked): place SFX against the real motion; mix moves on the bed;
   carve under a voice; audio-reactive if planned.
5. **Gate:** `npx hyperframes check` with zero errors. Fix contrast with the suggested colours or a
   scrim; fix overflow by cutting copy or re-laying, not by shrinking type under the minimums.

Use `npx hyperframes timeline --json` to see what is where instead of re-reading files.

## Troubleshooting

- **`npx hyperframes ...` fails with npm `E404` on a `.tgz`:** a new HyperFrames release is listed but
  not downloadable yet. Use the version the project pins: `npm run check` / `npm run render`, or
  `npx hyperframes@<version from package.json> ...`. Try the newest again later.
- **"Chrome Headless Shell is required":** `npx hyperframes browser ensure`, or point at an installed
  Chromium/Chrome with `HYPERFRAMES_BROWSER_PATH`.
- **check says `0/0 text checks`:** a lint error switched the audits off; fix lint first.
- **`clip_media_fit` warnings:** set each SFX's `data-duration` to its file length (ffprobe).
- **Masked words flagged as overflow/overlap:** mark the moving inner span `data-layout-allow-overlap`
  (and `data-layout-allow-overflow` when it starts outside its mask); keep every other block checked.
- **Cards sliding in from off-canvas flagged:** `data-layout-allow-overflow` on the moving element only.

## 4. Several shapes

Build the primary shape completely and get it approved first. Then copy the composition folder per
extra shape and re-lay each scene for its canvas (formats.md). Same bed, same timing, same words.

## Self-check before review

- [ ] brief.md exists and matches plan.md.
- [ ] Composition uses current HyperFrames conventions (not snippets copied from this skill).
- [ ] Bed in place at data-start 0 for the full duration; level and moves as planned.
- [ ] Every scene boundary on the bar map; reveal and payoff locked and commented.
- [ ] Real material from the source in the centrepiece.
- [ ] check passes with zero errors.
