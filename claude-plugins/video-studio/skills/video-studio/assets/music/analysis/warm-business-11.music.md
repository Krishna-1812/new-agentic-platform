# Music map: warm-business-11

- File: `warm-business-11.mp3`
- Length: 1:27.60 · tempo 114.0 BPM · beat 0.526s · bar 2.100s (4/4)
- Loudness: -16.4 LUFS integrated, -5.1 dBTP peak, LRA 3.1 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 1:26.23, silence by 1:26.52 (rings 0.29s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:48.42 | 23 | ●●●●● | high | +0.0 dB |
| 2 | 0:48.42 | 1:24.21 | 17 | ●●●●● | high | -0.2 dB |
| 3 | 1:24.21 | 1:26.52 | 1 | ●○○○○ | outro | -2.5 dB |

## Lifts (land reveals here)

none (energy is flat; use phrase starts)

## Phrase starts (natural edit points, every 4 bars)

0.01, 8.42, 16.84, 25.26, 33.69, 42.11, 48.42, 56.84, 65.26, 73.68, 82.10, 84.21

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 71.58s | — | 14.65s | final hit at 14.65s: land the logo on it |
| 15.0s | button | 33.69s | — | 12.63s | stops on the downbeat at 12.63s (2.37s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 67.37s | — | 18.86s | cuts in on a bar line; silent for the last 0.80s; final hit at 18.86s: land the logo on it |
| 20.0s | button | 8.42s | — | 18.95s | stops on the downbeat at 18.95s (1.05s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 56.84s | — | 29.39s | cuts in on a bar line; silent for the last 0.27s; final hit at 29.39s: land the logo on it |
| 30.0s | button | 0.01s | — | 29.46s | stops on the downbeat at 29.46s (0.54s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 42.11s | — | 44.12s | cuts in on a bar line; silent for the last 0.54s; final hit at 44.12s: land the logo on it |
| 45.0s | button | 0.01s | — | 44.20s | stops on the downbeat at 44.20s (0.80s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 27.37s | — | 58.86s | cuts in on a bar line; silent for the last 0.80s; final hit at 58.86s: land the logo on it |
| 60.0s | button | 8.42s | — | 58.95s | stops on the downbeat at 58.95s (1.05s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
