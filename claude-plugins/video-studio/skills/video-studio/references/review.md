# Step 4: Review like an art director

You cannot watch the video the way a person does, so look at it the way a director looks at a cut:
frame by frame at the moments that matter, then as a strip, then by the numbers for sound.

## 1. Look at the settled frames

```bash
cd video-output/composition
npx hyperframes snapshot --at <scene1 80%>,<scene2 80%>,...,<end card 90%>
```

Open every snapshot and read it as a phone viewer would: is the one idea clear in half a second?
Then the transitions: snapshot the middle of each transition and the first 0.5s (0.0, 0.25, 0.5).

## 2. Look at the whole strip

After a draft render (`npx hyperframes render --quality draft --output ../draft.mp4`):

```bash
python3 <skill>/scripts/review_frames.py ../draft.mp4 --sheet ../review/sheet-1.jpg --count 16
python3 <skill>/scripts/review_frames.py ../draft.mp4 --sheet ../review/open.jpg --from 0 --to 2 --count 8
```

The sheet shows rhythm and consistency at a glance: margins that jump, a scene that looks unlike
the others, a colour that drifts, too many similar frames in a row.

## 3. Score against the bar

Score each line 1-5. Ship only when every line is 4 or 5.

| # | Line | 5 looks like |
|---|---|---|
| 1 | **Hook** | The first frame alone would stop a scroll; something meaningful moves by 0.5s. |
| 2 | **Real product** | The centrepiece shows the actual product / UI / photos, not a description. |
| 3 | **Type** | Headlines fill their space; nothing under the size minimums; key words in the accent. |
| 4 | **Readability** | Every line holds its reading time; nothing cut off, overlapping, or low-contrast. |
| 5 | **Pictures** | Big, sharp, moving slowly, cropped with intent, graded as one film. |
| 6 | **Layout** | One focal point per frame; the same margins throughout; inside the safe zone. |
| 7 | **Motion** | One hero motion per scene; fast in, hold; eased; no generic fade-everything. |
| 8 | **Music fit** | Mood right; cuts on bar lines; reveal on a lift; payoff on the final hit. |
| 9 | **Sound** | A coherent palette; every SFX matches a motion; nothing jumps out (loudness timeline). |
| 10 | **End card** | Logo, offer, action; lands on the music; holds 2s+. |
| 11 | **Truth and words** | Every fact is in the ledger; no banned phrases; no em dashes; no typos. |
| 12 | **Specific** | Could only be this product's video. Any frame is postable. |

For line 8, compare the composition's scene starts with `bed.timing.json` (bars within one frame)
and confirm the `// lift-locked` and final-hit moments. For line 9, run
`python3 <skill>/scripts/loudness.py ../draft.mp4 --timeline` and read the flags.

## 4. Fix, in this order

1. Anything `check` reports as an error.
2. Words cut off, overlapping, too small or low in contrast.
3. Off-grid cuts and missed locks.
4. Anything scoring 3 or below: a weak first frame, small type, small photos, flat scenes, a messy
   end card, an SFX that sticks out.

Then re-snapshot what changed. Up to three rounds; if something still scores 3 after three, tell the
person what and why, and offer a choice.

Never change the approved words, numbers, names or the order of scenes during review: fix how they
are shown, not what they say. If the words themselves are the problem, ask.

## 5. Preview and approval

```bash
npx hyperframes preview --background
```

Check the URL answers (HTTP 200), give it to the person with a two-line summary of the video and
what to look at (the hook, the reveal on the drop, the end card on the final hit), and wait. Render
the final only after approval, or if they asked you to go straight through.
