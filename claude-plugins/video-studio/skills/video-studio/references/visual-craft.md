# Visual craft: the bar for "looks like a paid ad from a good studio"

The most common failure is a video that looks like a slide deck: small words on flat colour,
photos as small squares under a caption, everything fading in the same way, a bare logo at the
end. Every rule here exists to avoid that. (These are the lessons from turning slide-like videos
into ads that clients approved.)

HyperFrames owns the mechanics. Before hand-building any named look (a glitch, a shimmer, a chart,
a phone frame, a cursor, a code window, confetti, film grain) search the registry first:
`npx hyperframes catalog --query "<the effect in plain English>"` (see `/hyperframes-registry`).

## Typography

**Size is the first lever.** On a phone, a video is about 6-7 cm wide. Minimum sizes, in canvas
pixels, measured on the cap height-ish font size:

| Canvas | Hook / headline | Supporting line | Label, chip, caption | Absolute minimum |
|---|---|---|---|---|
| 1080x1920 (9:16) | 96-160px | 52-72px | 40-48px | 36px |
| 1080x1350 (4:5), 1080x1080 | 88-140px | 48-64px | 36-44px | 32px |
| 1920x1080 (16:9) | 96-160px | 48-64px | 34-40px | 30px |

A headline should fill its space: if there is room to make it bigger, make it bigger. 3-8 words,
one thought. Break lines by meaning ("Every gift / from the forest / has three shares"), never
leaving one word alone on a line.

**Emphasis.** In each headline, the 1-3 words that carry the idea ("three shares", "from ₹999",
"42%") are set in the accent colour, in italics when the display face has a real italic. Never
emphasise a whole headline. Never use more than one emphasis colour.

**Words rise, they don't just fade.** The default entrance for display type is a masked rise:
each word (or line) sits in a mask (`overflow: hidden`) and its inner span moves up from below,
staggered 40-70ms per word, about 0.5-0.7s, with a strong ease-out. Words that move inside masks
may overlap their mask during travel, so mark the moving inner element
`data-layout-allow-overlap` for the layout check; keep every other text block checked. The
HyperFrames registry and `/hyperframes-animation` text effects cover many alternatives (typewriter
for UI, split-scale for chaotic, blur-in for luxury); one entrance style per video, maybe two.

**Faces.** Use the brand's fonts, shipped as local files (`@font-face` in the composition). Two
families at most: display and body. Tabular numerals for counters.

**Contrast.** Body text 4.5:1 against what is actually behind it, large type 3:1 (`hyperframes
check` enforces this; fix by its suggested colours or a scrim, never by `--no-contrast`). Text over
photos always gets a scrim: a gradient of the brand's dark colour (or black) at 40-75% behind the
words, not a box.

**No em dashes, no widows, no ALL CAPS paragraphs.** CAPS only for short labels or the chaotic and
cinematic tones.

## Photographs and product shots

- **Big.** Full-bleed, or a large rounded panel (at least 60% of the canvas width). Never a small
  thumbnail floating in empty space.
- **Moving.** Every still gets slow motion: a push-in from 1.00 to 1.06-1.10 across its scene, or a
  slow drift. Animate the inner image or a wrapper, not the timed clip (`/hyperframes-keyframes`).
- **Cropped with intent.** Set `object-position` so faces and products sit on the thirds, clear of
  the words. Check the crop on every shape.
- **Behind the hook.** The strongest photo goes behind the hook, with a brand-tinted scrim.
- **As proof.** Proof scenes (the product, the people, the result) get their photo.
- **Graded together.** Pictures from different sources should look like one film: similar warmth
  and contrast. If they do not, use a treatment from `/media-use` (media-treatments), never a CSS
  filter hack.
- **Placeholder-quality images** (tiny, blurry, upscaled, stock-looking) are replaced or dropped;
  `/media-use` resolves better ones when the person allows.

## UI and product recreation

When showing software, rebuild the real screen in HTML from the project's own components and copy,
with real-looking data (names, numbers, dates that make sense together), at a readable scale:
crop to the part that matters and scale it up (a 1440px screen shown whole is unreadable on a phone).
Put it in a device or window frame only when that helps (registry has frames). Simulate the
interaction: a cursor that moves on a curve and eases into the button, a press (scale 0.96), a
response. Type into fields character by character at 12-20 characters a second.

## Layout

- One grid per video: fixed outer margins (the safe zone), a consistent baseline, the same left edge
  for text across scenes unless the composition is deliberately centred.
- One focal point per frame. The eye should know where to go in 0.3s.
- Generous, not empty: if a frame looks empty, scale the hero up rather than adding things.
- Depth: background (colour or photo), midground (the product, the card), foreground (words, a
  cursor). Slight parallax between layers on camera moves sells depth.
- Colour: the brand's background and text colours carry 85-90% of the frame; the accent is for
  emphasis, buttons and one or two graphic moments. A deep brand surface (the accent darkened) makes
  a strong alternate background for the hook or the end card; lighten the accent until it reads on it.

## Motion grammar

- **Fast in, then hold.** Entrances 0.3-0.7s with a strong ease-out (expo or quart out). Then
  stillness long enough to read. Exits are faster than entrances (0.2-0.4s) or are simply the cut.
- **One hero motion per scene.** Everything else is subordinate or still.
- **Overlap.** Elements start before the previous one finishes (stagger 60-120ms); nothing waits
  in a queue.
- **Motion has a direction that means something:** progress moves left to right (or up), new
  things arrive from where the story is going.
- **Ease, never linear,** except constant drifts and push-ins (which use a gentle sine in-out).
- **The first frame is designed** and something meaningful moves by 0.5s.
- **Seek-safe only** (HyperFrames determinism rules): one paused timeline per composition, no
  timers, no `Math.random` without a seed, no CSS animations.
- Respect the reading floor before any exit.

## Transitions and cuts

- The default transition is **a cut on the bar line.** Cuts are invisible when they land on the
  music and when motion continues across them (cut on action: the card is moving left as we cut to
  the next scene where things move left).
- **Match cuts** (the same shape, colour or position carries across) and **whips** (fast directional
  blur into the next scene) are the premium moves; use registry primitives.
- Crossfades are for polished, documentary and luxury tones, 0.4-0.8s, still starting on a beat.
- Never use a different transition for every scene. Pick one primary and one accent.
- Shader transitions are available through HyperFrames; they force a layered render (put background
  fills on children, see `/hyperframes-core`).

## Camera

A slow push-in on a still, a gentle drift across a UI, a punch-in on the important number (a fast
scale from 1.0 to 1.15 on a beat, then hold): all through `/hyperframes-keyframes`. One camera move
per scene at most. Never shake, never rotate, never zoom so far that type softens.

## The end card

The video closes with, in this order of importance: the logo (big enough to read; a light logo on
a light ground is drawn through a mask in the text colour, a dark one on dark in the background
colour), the offer or the line, up to 3 short facts as chips, the action as a button
("Get a quote", "Try it free", the real URL), and optionally up to 3 product photos. The logo or
the offer lands on the music's final hit. Hold it at least 2 seconds. On a short canvas, drop the
photos first, then shrink the logo, before crowding the words.

## Avoid

Gradient-mesh blobs, glowing "AI" orbs, abstract particle fields, isometric clip-art, emoji as
icons (resolve real icons through `/media-use`), drop shadows on text, every element fading in
the same way, centred-everything with no hierarchy, tiny type, a logo-only first frame, stock-photo
handshakes, and anything that could be in any company's video.
