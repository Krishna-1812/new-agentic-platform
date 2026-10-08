# Voiceover (only with `--voice` or an explicit request)

With no voice requested: write no script, generate no audio, add no voice track, no captions for
speech, and no carve. The video must work entirely without one.

## Write for the ear

- Narration complements the picture; it does not read the words on screen. Screen: "From ₹999".
  Voice: "Gifts for everyone on your list, starting under a thousand rupees."
- About 2.3-2.6 words per second at a natural pace (140-155 words a minute). A 20s video holds
  about 40 words of voice with room to breathe, not 60.
- Short sentences. One idea each. Concrete nouns, active verbs. Contractions.
- Write numbers as they are said ("twelve hampers"), and spell out names that a voice might
  mispronounce, phonetically, in the TTS text only.
- Same truth rule: every fact is from the ledger.
- Put the script in `plan.md` under "Voice", one line per scene, with the scene it sits on.

## Make it

Use the HyperFrames voice path through `/media-use` (it picks the best available provider: HeyGen
free-usage, Gemini, or local Kokoro):

```bash
npx hyperframes tts "<line text or path to script.txt>" --voice af_heart \
  --output video-output/composition/assets/vo/line-01.wav     # local Kokoro; --list for voices
```

or the shared audio engine in `/media-use` → `references/audio.md`, which returns word timestamps
(useful for captions). Generate one file per line or per scene, so lines can be moved.

Voice choice: match the tone. Warm and mid-paced for documentary and polished; brighter and
quicker for default and app-store; low and slow for cinematic; flat and dry for deadpan.

## Picture and voice

- The voice sets the pace. After generating, read each file's duration
  (`ffprobe -v error -show_entries format=duration -of csv=p=0 line-01.wav`) and adjust scene
  lengths to fit the lines plus breathing room; then re-cut the bed with `fit_music.py` to the new
  total length.
- Start lines on or just after a downbeat. Never start a line on a lift: the lift and the first
  word fight. Leave half a bar to a bar of no voice at big section changes so the music can carry
  the cut.
- On-screen words and spoken words should not race each other: show the key phrase as the voice
  says it, or after.

## Mix

- Group the voice clips (`data-audio-group="voiceover"`), and give the group a light chain if the
  voice needs it: the `voice-clean` preset in `/hyperframes-audio` (rumble cut, mud cut, level,
  clarity, peak ceiling).
- Carve the bed against the voice group (music.md section 8). Required whenever music plays under a
  voice.
- Voice at `data-volume` 1.0; everything else is set relative to it.

## Captions

With a voice, burn in captions from the script's exact words (not a re-transcription), one caption
track, inside the safe zone, never over the hero visual. Use the captions guidance in
`/hyperframes-studio` and `/media-use` (word timestamps from the audio engine make word-by-word
highlighting possible). Captions are part of the design: brand font, high contrast, 2 lines max.
