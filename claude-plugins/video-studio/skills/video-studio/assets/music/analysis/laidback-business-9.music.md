# Music map: laidback-business-9

- File: `laidback-business-9.mp3`
- Length: 1:53.64 · tempo 114.0 BPM · beat 0.526s · bar 2.110s (4/4)
- Loudness: -16.4 LUFS integrated, -4.6 dBTP peak, LRA 4.7 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 1:49.66, silence by 1:51.71 (rings 2.05s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:50.53 | 24 | ●●●●○ | high | +0.0 dB |
| 2 | 0:50.53 | 1:07.37 | 8 | ●○○○○ | low | -5.5 dB |
| 3 | 1:07.37 | 1:24.21 | 8 | ●●●●● | high **LIFT** | +6.5 dB |
| 4 | 1:24.21 | 1:41.06 | 8 | ●●●●● | high | +0.3 dB |
| 5 | 1:41.06 | 1:51.71 | 5 | ●○○○○ | outro | -7.7 dB |

## Lifts (land reveals here)

67.37s

## Phrase starts (natural edit points, every 4 bars)

0.01, 8.42, 16.84, 25.26, 33.68, 42.10, 50.53, 58.94, 67.37, 75.79, 84.21, 92.63, 101.06, 109.48

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 96.84s | — | 12.82s | cuts in on a bar line; silent for the last 0.08s; final hit at 12.82s: land the logo on it |
| 15.0s | button | 61.05s | 6.32s | 12.63s | stops on the downbeat at 12.63s (2.37s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 92.63s | — | 17.03s | cuts in on a bar line; silent for the last 0.87s; final hit at 17.03s: land the logo on it |
| 20.0s | button | 56.84s | 10.53s | 18.95s | stops on the downbeat at 18.95s (1.05s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 82.10s | — | 27.56s | cuts in on a bar line; silent for the last 0.34s; final hit at 27.56s: land the logo on it |
| 30.0s | button | 50.53s | 16.84s | 29.47s | stops on the downbeat at 29.47s (0.53s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 67.37s | 0.00s | 42.29s | cuts in on a bar line; silent for the last 0.61s; final hit at 42.29s: land the logo on it |
| 45.0s | button | 50.53s | 16.84s | 44.21s | stops on the downbeat at 44.21s (0.79s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 52.63s | 14.74s | 57.03s | cuts in on a bar line; silent for the last 0.87s; final hit at 57.03s: land the logo on it; quiet first 2s |
| 60.0s | button | 33.68s | 33.69s | 58.95s | stops on the downbeat at 58.95s (1.05s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
