# Sound design

Sound effects make motion feel physical: a card that lands with a soft thud has weight; a
cursor click that you hear is a demonstration, not an animation. Used well they are felt more than
noticed. Used badly they turn a film into a slot machine.

Choose SFX in Step 3, **after the motion exists**, so every sound matches a real movement and
its real timing. The plan only says what each moment's sound should do.

## The library

All under `<skill>/assets/sfx/`. All CC0 (Kenney; keyboard pack by unicae_games). Read
`sfx-analysis.md` before choosing: it rates every file's brightness and high-frequency risk.
Prefer low/medium-risk files for anything repeated or anything in a polished tone; keep high-risk
(bright, clicky, glassy) files for single, quiet, isolated accents or chaotic tones.

| Folder | Character | Best for |
|---|---|---|
| `impact/impactSoft_medium_000-004` | Warm soft thud, low HF risk | **The safest family.** Reveals, hard cuts, scene changes. |
| `impact/impactSoft_heavy_000-004` | Heavier thud | Weight, comic bonk, the button-ending stop. |
| `impact/impactBell_heavy_000, _003, _004` | Deep resonant bell | Logo payoff, success, cinematic reveal. One per video. |
| `impact/impactWood_*` | Wood knocks | Warm, organic taps (documentary, craft). |
| `impact/impactPunch_*`, `impactPlate_*`, `impactMetal_*` | Punches, plates, metal | Aggressive beats (chaotic only). |
| `impact/impactGlass_light_*` | Glass clink | Sparkle, a delicate achievement. Quiet. |
| `interface/click_001-005`, `ui/click1-5`, `ui/mouseclick1` | Clicks | Simulated taps and button presses. |
| `interface/drop_001-003` | Soft drop | Elements landing, gentle pop-ins. |
| `interface/switch_*`, `ui/switch*` | Toggles | A switch or mode changing. |
| `interface/select_008`, `ui/rollover*` | Select, hover | Focus moving, a soft hover. |
| `interface/bong_001` | Soft bell | A polished accent, sparingly. |
| `interface/glitch_002/004`, `error_005/006` | Glitch, buzz | Tech moments, a comic fail. |
| `casino/card-slide-*`, `card-place-*`, `card-fan-*` | Cards | Swipes, cards and panels sliding in, page turns. |
| `casino/chips-stack-*`, `chips-collide-*` | Chips | Counters stacking, a celebratory payoff. |
| `casino/dice-*`, `cards-pack-open-*` | Dice, pack | Anticipation, a pack-opening reveal. |
| `keyboard/keypress-001-032.wav` | Single keystrokes | Typing animations: a different file per character, randomised. |

Copy only the files you use into `composition/assets/sfx/<family>/` and reference them by relative
path. Never reference the skill folder from the composition: the renderer serves only the project.

## A sonic palette

Pick 2-3 families for the whole video and stay in them, for example "soft impacts + UI clicks +
one bell", or "cards + chips" for a deal-flow product. A coherent palette sounds designed; a grab
bag of cute sounds sounds like a template.

## Density by tone

| Tone | SFX per 20s | Approach |
|---|---|---|
| `default` | 3-5 | Drops for pop-ins, soft impact on the reveal, bell on the payoff. |
| `polished` | 2-3 | Very soft: one drop, one bong. Nothing aggressive. |
| `yc-parody` | 2-3 | Dry: a soft impact on the reveal, a UI accent, a logo hit. |
| `chaotic` | 8-15 | On beats, sometimes stacked: punches, glitches, dice, metal. |
| `deadpan` | 0-2 | One dry cue, maybe. |
| `cinematic` | 2-3 big | Bell on the hero moment, soft impact on the reveal, bell on the outro. |
| `app-store` | one per card | A consistent drop or click per feature card at 0.3-0.4, bell on the outro. |
| `documentary` | 0-2 | A wood knock on the end card, at most. |
| `luxury` | 0-1 | One glass or bell accent, or none. |
| `editorial` | 2-4 | Card slides for page moves, one soft impact. |

## Moment → sound

| Moment | Sound | Timing |
|---|---|---|
| An element pops or lands | `drop_*`, `impactSoft_medium_*` | 0-1 frame **before** its first visible frame |
| A card or panel slides in | `card-slide-*` | At motion start |
| A card lands / is placed | `card-place-*` | At the landing frame |
| A cursor click, a tap | `click_*`, `mouseclick1` | On the frame the button depresses |
| Typing | `keyboard/keypress-*` (randomised) | On each character's frame; thin out above ~12 chars/s |
| A toggle | `switch_*` | On the flip |
| A counter running | `chips-stack-*` (start + end only) | First tick and the settle |
| The big reveal | `impactSoft_medium_*` or a bell | On the reveal frame, on the music's lift |
| Scene change, hard cut | `impactSoft_medium_*` | On the cut (= the bar line) |
| Success, approval, a match | `impactBell_heavy_000`, `chips-collide-*` | When the result is fully visible |
| Button-ending stop | `impactSoft_heavy_*` or `impactBell_heavy_*` | Exactly on the bed's `lastDownbeat` |
| Comic fail | `error_005/006` | On the fail |

For a sequence of many items, sound the first, the last and any rhythmically important one, unless
the rhythm of sounding every item is the point (app-store cards, chaotic beats).

## Timing and layering

- Sound starts with the motion, not after it. A whoosh or slide starts with the movement; an impact
  lands on the contact frame; a click is on the press.
- Snap SFX to the same beat or bar time as the visual it belongs to (from `bed.timing.json`), so
  sound, picture and music land together.
- Leave a gap: two SFX less than ~0.15s apart blur into one. Thin out.
- Let the music's own hits do the work: if the bed has a big hit on the reveal, a quiet SFX on top
  is enough, or none.
- A logo payoff can stack two sounds: a soft impact (body) plus a bell (tail). Never three.

## Wiring

Each `<audio>` needs an `id`, `data-start`, `data-duration` and its own `data-track-index` when it
overlaps another (music at 10, SFX from 11 up). Group them (`data-audio-group="sfx"`) so one fader
can trim them all (`<hf-audio-group id="sfx" data-volume="0.9">`, see `/hyperframes-audio`).

```html
<audio id="sfx-reveal" data-audio-group="sfx" data-start="7.98" data-duration="0.6"
  data-track-index="11" data-volume="0.45" src="assets/sfx/impact/impactSoft_medium_001.ogg"></audio>
```

Levels: hero hits 0.45-0.6, UI and cards 0.3-0.45, typing 0.2-0.3 over a bed at 0.85-1.0 (music.md section 7).
Set `data-duration` to the file's length (`ffprobe`), or check warns `clip_media_fit`.

## Don'ts

- No sound on every element. No sound under a line the viewer is reading unless it is that line's.
- No bright, high-risk files repeated (they fatigue fast).
- No whoosh on every transition.
- No SFX that disagrees with the visual (a glass clink on a heavy object).
- No SFX louder than the voice.
