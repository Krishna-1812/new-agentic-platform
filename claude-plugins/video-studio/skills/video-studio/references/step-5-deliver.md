# Step 5: Render, master, deliver

## Render

```bash
cd video-output/composition
npx hyperframes render --quality delivery --output ../video.mp4
test -s ../video.mp4 && ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact ../video.mp4
```

Confirm the duration equals the root `data-duration` and the size is the canvas. Read the render
summary's second line (`beginframe` vs `screenshot`): `screenshot` with software GPU on Linux is
the slow path, not an error. For several shapes, render each composition folder to
`video-<shape>.mp4`.

If a render runs out of memory on a small machine (1080x1920 encodes use a lot), see
`/hyperframes-cli` → preview-render.md for worker and encoder settings, or render with
`--docker`.

## Poster

Pick the strongest **settled** moment: usually the hook once its words are in, the reveal, or the
end card. Not a transition, not a fade, not a half-typed line.

```bash
python3 <skill>/scripts/poster.py ../video.mp4 --at 2.4
```

It writes `video.jpg` and bakes it in as frame 0 (1/30 s, invisible on playback), because Slack, X,
Discord and LinkedIn previews take frame 0 as the thumbnail and ignore cover metadata. Look at the
jpg; if it caught motion, nudge the time and re-run. Upload `video.jpg` as the custom thumbnail
where platforms allow (YouTube, Instagram, TikTok, Facebook, the LinkedIn editor) and use it as
`poster=` on any website `<video>`.

## Master and export

```bash
python3 <skill>/scripts/loudness.py ../video.mp4 --timeline           # read it; fix the mix if flagged
python3 <skill>/scripts/export.py ../video.mp4 --for social,web [--gif]
for f in ../exports/*.mp4; do python3 <skill>/scripts/loudness.py "$f" --target social; done
```

(`--target web` for the web export.) Exports are H.264 High, yuv420p, AAC 48 kHz, fast-start,
mastered to the platform target (-14 LUFS social/YouTube, -16 web) with a true-peak ceiling of
-1 dBTP. `master` makes a high-bitrate hand-off copy. Then master the main file too, so the file
the person shares by hand is right as well:

```bash
python3 <skill>/scripts/loudness.py ../video.mp4 --master ../video.mastered.mp4 && mv ../video.mastered.mp4 ../video.mp4
```

## Share copy

`share-copy.txt`: one caption, one to three sentences, postable as is, specific to this product,
tone-matched, no "excited to share", at most 3 hashtags, no em dashes, every fact from the ledger.

| Tone | Shape |
|---|---|
| `default` | Made [Name]. It's [what it does, in its own terms]. [Best line from the product.] |
| `polished` | Introducing [Name]: [clean one-liner from the site]. |
| `yc-parody` | We built [Name] to solve [problem stated completely seriously]. [Deadpan stat.] |
| `chaotic` | [ALL CAPS CLAIM]. [Name] is [wildly overstated description]. Link below. |
| `deadpan` | I made [Name]. It [what it does]. |
| `cinematic` | [Name]. [Tagline, verbatim or lightly adapted.] |
| `app-store` | [Name] is now live. [Feature 1], [feature 2] and [feature 3], all in one place. |
| `documentary` | [The people / place], and what they make: [Name]. [One true detail.] |
| `luxury` | [Name]. [Three-word line.] |
| `editorial` | [Headline-style line.] [One sharp supporting sentence.] |

Platform variants (LinkedIn longer and plain; Instagram with line breaks; X short) go in
`share-copy-variants.md`, never in `share-copy.txt`.

## Credits

`credits.txt`: the music credit line from `assets/music/library.json` (`credit`), for example
`Music: "Journey Of The Brave" by Sascha Ende (ende.app), CC BY 4.0`. Remind the person to paste it
into the post or the video description where possible.

## Final folder

```
video-output/
  video.mp4  video.jpg  share-copy.txt  credits.txt
  exports/   video-social.mp4  video-web.mp4  [video-preview.gif]
  plan.md  brief.md  review/  composition/
```

## Tell the person

- Where the video, the poster and the exports are.
- One sentence on what the video does creatively, and one on the music ("cut to 'Journey Of The
  Brave', the reveal lands on its drop at 6.4s and the logo on its final hit").
- The loudness result.
- The share copy and the credit line, inline.
- Offer: re-roll a scene, try another tone or track, add a shape, or add narration.
