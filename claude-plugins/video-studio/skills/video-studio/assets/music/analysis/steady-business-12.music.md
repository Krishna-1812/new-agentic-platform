# Music map: steady-business-12

- File: `steady-business-12.mp3`
- Length: 1:57.36 · tempo 110.0 BPM · beat 0.545s · bar 2.180s (4/4)
- Loudness: -16.4 LUFS integrated, -3.7 dBTP peak, LRA 5.7 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 1:53.48, silence by 1:55.79 (rings 2.31s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:08.72 | 4 | ●○○○○ | intro | +0.0 dB |
| 2 | 0:08.72 | 0:34.91 | 12 | ●●●●● | high **LIFT** | +5.8 dB |
| 3 | 0:34.91 | 0:43.63 | 4 | ●●●○○ | mid | -2.8 dB |
| 4 | 0:43.63 | 0:52.36 | 4 | ●●●●○ | high | +2.4 dB |
| 5 | 0:52.36 | 1:05.45 | 6 | ●●●●● | high | +1.3 dB |
| 6 | 1:05.45 | 1:44.72 | 18 | ●●●●● | high | +0.7 dB |
| 7 | 1:44.72 | 1:55.79 | 5 | ●○○○○ | outro | -8.0 dB |

## Lifts (land reveals here)

8.72s

## Phrase starts (natural edit points, every 4 bars)

0.00, 8.72, 17.45, 26.18, 34.91, 43.63, 52.36, 61.09, 65.45, 74.18, 82.91, 91.63, 100.36, 104.72, 113.46

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 100.36s | — | 13.12s | cuts in on a bar line; the last 0.78s of the ring is faded; final hit at 13.12s: land the logo on it |
| 15.0s | button | 0.00s | 8.72s | 13.09s | stops on the downbeat at 13.09s (1.91s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 96.00s | — | 17.48s | cuts in on a bar line; silent for the last 0.16s; final hit at 17.48s: land the logo on it |
| 20.0s | button | 0.00s | 8.72s | 19.64s | stops on the downbeat at 19.64s (0.36s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 85.09s | — | 28.39s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 28.39s: land the logo on it |
| 30.0s | button | 0.00s | 8.72s | 28.36s | stops on the downbeat at 28.36s (1.64s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 69.81s | — | 43.67s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 43.67s: land the logo on it |
| 45.0s | button | 0.00s | 8.72s | 43.63s | stops on the downbeat at 43.63s (1.37s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 56.72s | — | 56.76s | cuts in on a bar line; silent for the last 0.88s; final hit at 56.76s: land the logo on it |
| 60.0s | button | 0.00s | 8.72s | 58.91s | stops on the downbeat at 58.91s (1.09s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
