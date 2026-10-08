# Kinds, platforms and formats

## Kinds of video

Each kind has a job, a shape and a typical length. Mix them when the brief does.

| Kind | Job | Shape | Length |
|---|---|---|---|
| `launch` | "Look what I made / what's new." Pride, curiosity. | Hook → reveal → 2-3 highlights from the working product → name + line | 15-25s |
| `ad` | Stop the scroll, make one offer, get one action. | Problem or desire (hook) → the product as the answer → proof → offer + button | 6, 15 or 30s |
| `demo` | Show it working, start to finish. | Entry → key action → result, simulated in real UI; then the outcome in words | 20-45s |
| `explainer` | Make an idea clear. | Question → the idea in one picture → how it works in 3 steps → what it means | 30-60s (often with `--voice`) |
| `story` | Make people feel something about a brand. | People, place, craft → what they make → why it matters → the brand | 20-45s |
| `testimonial` | Let a customer say it. | The result first → the person and their words (verbatim) → the brand | 15-30s |
| `event` | Get people to come, or show they did. | Date/place/promise → speakers or moments → how to join | 10-20s |
| `recruiting` | Make good people want in. | The mission → the team at work → what you'd do → apply | 20-40s |
| `announcement` | A single piece of news, cleanly. | The news (hook) → what changes → when / where → link | 10-20s |

A 6-second ad is one idea: hook, product, logo. Do not compress a 15s plan into it.

## Platforms

Specs move; these are safe working values. Render each shape as its own composition (see
"Several formats"), never as a crop of another.

| Platform | Best shape | Canvas | Length sweet spot | Notes |
|---|---|---|---|---|
| Instagram Reels, TikTok, YouTube Shorts | 9:16 | 1080x1920 | 7-30s | UI covers the bottom ~20% and the right edge: keep text in the safe zone below. Sound often on, but captions still needed. |
| Instagram / Facebook feed | 4:5 | 1080x1350 | 6-20s | 4:5 takes the most feed space. Autoplays muted. |
| LinkedIn feed | 1:1 or 4:5 (16:9 works) | 1080x1080 | 15-30s | Muted autoplay; words carry everything. Plain, specific copy. |
| X | 16:9 or 1:1 | 1920x1080 | 10-30s | Poster (frame 0) matters a lot: it is the preview. |
| YouTube (main) | 16:9 | 1920x1080 (or 3840x2160) | 30s-3min | Sound on. Custom thumbnail: upload `video.jpg`. |
| Website hero / product page | 16:9 (or 1:1) | 1920x1080 | 8-20s, often a loop | Plays muted and loops: the last frame should cut cleanly to the first. Small file (`export.py --for web`). |
| Slides / email | 16:9 | 1920x1080 | 10-30s | Export a GIF preview for email (`--gif`). |

Frame rate: 30 fps unless the source footage or platform needs otherwise (60 for very fast UI
motion, 24 for a filmic look). Keep one rate per project.

## Safe zones

Keep every word and the logo inside these margins (percent of the canvas):

| Canvas | Top | Bottom | Left | Right |
|---|---|---|---|---|
| 9:16 for Reels/TikTok/Shorts | 12% | 22% | 6% | 14% |
| 9:16 anywhere else | 8% | 10% | 6% | 6% |
| 4:5, 1:1 | 6% | 8% | 6% | 6% |
| 16:9 | 6% | 8% | 5% | 5% |

Backgrounds and photos may bleed to every edge; only type, logos, buttons and faces must respect
the zone. `/hyperframes-studio` covers where captions sit.

## Several formats

When the person wants more than one shape, plan once, compose per shape:

- One `plan.md`, one storyboard, one bed (the same music cut works for every shape of the same
  length).
- One composition folder per shape: `composition-landscape/`, `composition-vertical/`. Share the
  design tokens (colours, fonts, corners) and assets; re-lay each scene for its canvas.
- What changes per shape: vertical stacks (picture above, words below, or words over a scrim on a
  full-bleed photo); landscape splits (words left, picture right) or goes full-bleed; square is
  close to vertical with less height, so cut copy before shrinking type.
- Type sizes follow the canvas's short side (see visual-craft.md), so vertical type is not simply
  the landscape type.
- Render, review and export each one. Share copy may differ by platform (step-5-deliver.md).

## Captions and sound-off

Every key point is on screen as designed type. With `--voice`, burn in captions from the script's
exact words (`/hyperframes-studio` and `/media-use` captions), one caption track, inside the safe
zone, never covering the hero visual. A video with no voice needs no captions: its words are the
design.
