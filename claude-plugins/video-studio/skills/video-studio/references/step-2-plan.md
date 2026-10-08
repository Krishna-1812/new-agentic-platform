# Step 2: Plan, and cut the music first

`plan.md` is the creative contract. It says what the video must communicate, which real material
it uses, and when every beat happens on the music. It does not prescribe HyperFrames mechanics
(selectors, GSAP calls, HTML structure): HyperFrames decides those in Step 3.

## The order of work

1. Write the angle and the hook (from the rubric).
2. Choose kind, format(s), duration and tone ([formats.md](formats.md), [tones.md](tones.md)).
3. Choose the track and the ending, and **cut the bed now** ([music.md](music.md)):

   ```bash
   python3 <skill>/scripts/fit_music.py <skill>/assets/music/<id>.mp3 \
     --map <skill>/assets/music/analysis/<id>.music.json --duration 20 --mode natural \
     --out video-output/music/bed.wav
   ```

   It prints the bar lines, lifts, section changes and the final hit **in video time**, and writes
   `bed.timing.json` next to the bed.
4. Write the storyboard on that grid: every scene starts on a bar line; the reveal lands on a
   lift or a strong downbeat; the end card begins one or two bars before the final hit, so the logo
   lands on it. If a scene needs a length the grid does not give, move the cut to a beat, or cut
   the bed again with `--anchor` so a lift lands where the story needs it.
5. Count the seconds. They must add up exactly to the duration.

## plan.md

```markdown
# Video plan: [Name]

## What it is
[One sentence.]

## Goal and viewer
[What the video must achieve, for whom, and the one thing they should remember.]

## The angle
[The creative premise: the joke, the claim, the story. Why this video belongs to this product only.]

## Hook (0-2s)
[The exact first frame and first motion. The words, the picture, what moves by 0.5s.]

## The flow worth showing
[entry → key action → result, or "none: landing page only".]

## Key moments
- [Specific: "the altitude meter counting from 0 to 10,000 ft", not "feature callouts"]

## Payoff / end card
[The final line, the logo, the offer and the action (button text). What lands on the final hit.]

## Kind, tone, format
- Kind: [launch / ad / demo / ...]
- Tone: [preset]; direction: "[freeform phrase]"; interpretation: [pacing, type, motion, restraint]
- Formats: [vertical 1080x1920, landscape 1920x1080, ...]; platforms: [...]
- Duration: [N]s

## Visual identity
[Exact colours, fonts, corners, logo files, the strongest pictures, from Step 1.]

## Truth ledger
[Every fact the video may state, with its source. Copy that must appear verbatim.]

## Music
- Track: `[id]` "[title]" by Sascha Ende (CC BY 4.0), or the person's file and its licence
- Why: [mood, energy, tempo against the edit pace]
- Cut: mode [natural / button / fade], in at [s] of the track; tempo [BPM], bar [s]
- Bar map (video s): [0.00, 2.00, 4.00, ...]
- Lifts (video s): [...]; final hit / stop: [s]
- Endings and moves: [e.g. "final hit at 18.4s: logo lands; ring under the hold"; "dip the bed 6 dB
  for 0.5s before the reveal at 8.0s"]
- Audio-reactive: [none / subtle: what breathes with the music]

## Sound design
- Posture: [sparse / moderate / dense]; palette: [e.g. soft impacts + UI clicks, no casino sounds]
- Moments: [scene: what the sound does. Exact files are chosen in Step 3 against real motion.]

## Voice (only with --voice)
[The script, line by line, with the scene each line sits on.]

## Storyboard

### Scene 1: [name], [start]-[end]s ([N] bars)
On screen: [what is seen; exact words]
Real material: [which screen, photo, copy]
Motion: [the one hero motion; what appears in what order]
Sequential / interaction: [items one by one, a simulated tap/type/swipe, or none]
Reading time: [words → seconds needed vs seconds held]
Music: [what the music is doing here: breakdown, lift at 8.0s, ...]
Sound: [what the SFX does emotionally]
Transition out: [cut on the bar at Ns / whip / match / crossfade]

### Scene 2 ...

## Assumptions and gaps
[What you inferred; facts the brief wanted that the sources lack.]

## Share copy (draft)
[One to three sentences.]
```

## Scene counts and pacing by tone

| Tone | Scenes (20s) | Pacing |
|---|---|---|
| `default` | 4-5 | Comfortable. Each moment breathes. |
| `polished` | 3-4 | Fewer scenes, longer holds. |
| `yc-parody` | 4-5 | Structured. One claim per scene. |
| `chaotic` | 6-9 | Some scenes under 2s; never over 4s. |
| `deadpan` | 3-4 | Long holds. Empty space. |
| `cinematic` | 4-5 | Wide, big type, dramatic reveals. |
| `app-store` | 4-6 | Feature cards, clean reveals. |
| `documentary` | 3-5 | Unhurried; faces and places. |
| `luxury` | 3-4 | Slow push-ins, very few words. |
| `editorial` | 4-6 | Grid-driven; type as image. |

On the bar grid this usually means: at 120 BPM (bar 2.0s) scenes of 2 bars (4s) or 1 bar (2s); at
100 BPM (bar 2.4s) 1-2 bars; at 75-80 BPM (bar 3.0-3.2s) 1 bar, sometimes half a bar. A scene on a
fractional bar count is fine when the cut lands on a beat; never on nothing.

## Reading time is a hard floor

- A short label (1-3 words): about 0.8s fully settled.
- A headline or sentence: about 0.3s per word, minimum 1.2s. The hook gets the most.
- A number with a label: 1.0s after the count-up finishes.

Design two failures out now:

- **Too much text for the scene.** A 4s scene lands two or three short reads, not six. Cut copy or
  split the scene; never speed it up.
- **Sequential text snapped to a fast beat.** At 110+ BPM beats are about 0.5s apart: fine for
  dots, ticks and glows, too fast for lines a viewer must read. Reveal text on every other beat or
  every bar, or bring the items in quickly and hold the full set. Mark the intended hold.

## Choosing what to show, best first

1. **A working-app moment**, recreated from the real source: the upload screen, the result view,
   the dashboard with real-looking content. The product doing its thing.
2. **A real UI element**: the hero card, the swipe card, the progress meter, the pricing table.
3. **Real photographs**: the product, the people, the place, the result. Big, never thumbnails.
4. **The concept animated**, grounded in the product's idea ("taxis for taxis": one taxi carrying
   another).
5. **Type as the image**, when the product is its copy: huge display type, minimal chrome.

Never fill a scene with abstract patterns, colour washes, generic particles, stock-looking icons
or motion that could belong to any video. At most one stat-card or headline-block scene, used as a
frame around the flow, never instead of it.

## Make it alive: sequences and interaction

Ask: what in this product appears one by one, or can be done by a hand?

- **Sequential reveals**: cards, results, list items, matches, prices. Plan them one by one, on the
  grid, each with its sound.
- **Simulated interaction**: a cursor clicks the button, a finger swipes the card, text types into
  the field, a toggle flips. A demonstration, not a slide.

Commit to it in the scene ("3 hamper cards slide in on beats 1, 2 and 3 of bar 4, each with a card
sound; hold the set for a bar"). Leaving it vague leaves the video static.

## Handoff posture

- Good: "Recreate the swipe card with Thunder's profile and the hay tags."
- Good: "Use the site's amber-on-dark palette and its serif headline."
- Good: "The reveal lands on the lift at 8.00s."
- Avoid: "Use gsap.fromTo with this selector and power3.out." (HyperFrames decides.)
- Avoid: "Use this exact HTML."

**Gate:** plan.md complete, seconds add up, the bed and its timing file exist, every scene boundary
is on the grid or explained.
