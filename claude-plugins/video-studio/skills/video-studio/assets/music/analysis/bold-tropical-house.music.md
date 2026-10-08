# Music map: bold-tropical-house

- File: `bold-tropical-house.mp3`
- Length: 2:27.80 · tempo 100.0 BPM · beat 0.600s · bar 2.400s (4/4)
- Loudness: -16.4 LUFS integrated, -3.0 dBTP peak, LRA 4.0 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 2:26.69, silence by 2:27.13 (rings 0.44s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:35.99 | 15 | ●○○○○ | low | +0.0 dB |
| 2 | 0:35.99 | 1:33.59 | 24 | ●●●●● | high **LIFT** | +3.7 dB |
| 3 | 1:33.59 | 1:55.20 | 9 | ●○○○○ | low | -4.0 dB |
| 4 | 1:55.20 | 2:12.03 | 7 | ●●●●● | high **LIFT** | +5.0 dB |
| 5 | 2:12.03 | 2:24.20 | 5 | ●●●●● | high | -0.7 dB |
| 6 | 2:24.20 | 2:27.13 | 1 | ●○○○○ | outro | -15.4 dB |

## Lifts (land reveals here)

35.99s, 115.20s

## Phrase starts (natural edit points, every 4 bars)

0.00, 9.59, 19.19, 28.80, 35.99, 45.59, 55.19, 64.79, 74.39, 83.99, 93.59, 103.19, 112.79, 115.20, 124.81, 132.03, 141.72, 144.20

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 132.03s | — | 14.66s | cuts in on a bar line; the last 0.45s of the ring is faded; final hit at 14.66s: land the logo on it |
| 15.0s | button | 28.80s | 7.19s | 14.39s | stops on the downbeat at 14.39s (0.61s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 127.21s | — | 19.48s | cuts in on a bar line; silent for the last 0.03s; final hit at 19.48s: land the logo on it |
| 20.0s | button | 28.80s | 7.19s | 19.19s | stops on the downbeat at 19.19s (0.81s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 117.60s | — | 29.09s | cuts in on a bar line; silent for the last 0.42s; final hit at 29.09s: land the logo on it |
| 30.0s | button | 103.19s | 12.01s | 28.84s | stops on the downbeat at 28.84s (1.16s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 103.19s | 12.01s | 43.50s | cuts in on a bar line; silent for the last 1.01s; final hit at 43.50s: land the logo on it |
| 45.0s | button | 93.59s | 21.61s | 43.27s | stops on the downbeat at 43.27s (1.73s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 86.39s | 28.81s | 60.30s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 60.30s: land the logo on it |
| 60.0s | button | 83.99s | 31.21s | 57.73s | stops on the downbeat at 57.73s (2.27s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
