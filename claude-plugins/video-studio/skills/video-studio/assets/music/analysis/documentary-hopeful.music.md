# Music map: documentary-hopeful

- File: `documentary-hopeful.mp3`
- Length: 3:34.60 · tempo 82.0 BPM · beat 0.732s · bar 2.930s (4/4)
- Loudness: -16.4 LUFS integrated, -4.3 dBTP peak, LRA 5.6 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.07; full energy arrives 0:00.00
- Ending: **fade**: last hit 3:28.19, silence by 3:33.40 (rings 5.21s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:29.38 | 10 | ●○○○○ | intro | +0.0 dB |
| 2 | 0:29.38 | 1:10.37 | 14 | ●○○○○ | low **LIFT** | +5.0 dB |
| 3 | 1:10.37 | 1:16.22 | 2 | ●●○○○ | low | +0.6 dB |
| 4 | 1:16.22 | 1:27.92 | 4 | ●●●●○ | high | +0.9 dB |
| 5 | 1:27.92 | 1:33.78 | 2 | ●●●●● | high | +0.9 dB |
| 6 | 1:33.78 | 2:14.75 | 14 | ●●●○○ | mid | -1.3 dB |
| 7 | 2:14.75 | 2:32.31 | 6 | ●●●●● | high | +1.1 dB |
| 8 | 2:32.31 | 2:49.88 | 6 | ●●●●○ | high | -0.3 dB |
| 9 | 2:49.88 | 2:55.73 | 2 | ●●●●● | high | +0.4 dB |
| 10 | 2:55.73 | 3:22.07 | 9 | ●○○○○ | low | -2.1 dB |
| 11 | 3:22.07 | 3:33.40 | 4 | ●○○○○ | outro | -9.6 dB |

## Lifts (land reveals here)

29.38s

## Phrase starts (natural edit points, every 4 bars)

0.11, 11.82, 23.53, 29.38, 41.09, 52.80, 64.51, 70.37, 76.22, 87.92, 93.78, 105.49, 117.19, 128.90, 134.75, 146.46, 152.31, 164.03, 169.88, 175.73, 187.44, 199.14, 202.07

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 199.14s | — | 9.05s | cuts in on a bar line; silent for the last 0.69s; the track's own fade-out ends the video |
| 15.0s | button | 23.53s | 5.85s | 14.63s | stops on the downbeat at 14.63s (0.37s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 193.29s | — | 14.90s | cuts in on a bar line; the last 0.46s of the ring is faded; the track's own fade-out ends the video |
| 20.0s | button | 23.53s | 5.85s | 19.02s | stops on the half-bar at 19.02s (0.98s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 184.51s | — | 23.68s | cuts in on a bar line; silent for the last 1.06s; the track's own fade-out ends the video; quiet first 2s |
| 30.0s | button | 23.53s | 5.85s | 29.27s | stops on the downbeat at 29.27s (0.73s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 169.88s | — | 38.31s | cuts in on a bar line; silent for the last 1.43s; the track's own fade-out ends the video |
| 45.0s | button | 11.82s | 17.56s | 43.91s | stops on the downbeat at 43.91s (1.09s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 152.31s | — | 55.88s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 60.0s | button | 17.67s | 11.71s | 58.55s | stops on the downbeat at 58.55s (1.45s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
