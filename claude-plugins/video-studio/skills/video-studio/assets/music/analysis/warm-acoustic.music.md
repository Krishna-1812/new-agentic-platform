# Music map: warm-acoustic

- File: `warm-acoustic.mp3`
- Length: 2:45.01 · tempo 78.5 BPM · beat 0.764s · bar 3.060s (4/4)
- Loudness: -16.4 LUFS integrated, -5.9 dBTP peak, LRA 5.1 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.51; full energy arrives 0:00.95
- Ending: **fade**: last hit 2:39.95, silence by 2:44.20 (rings 4.25s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:55.60 | 18 | ●●○○○ | low | +0.0 dB |
| 2 | 0:55.60 | 1:10.87 | 5 | ●●●●● | high **LIFT** | +3.8 dB |
| 3 | 1:10.87 | 1:20.05 | 3 | ●●●●● | high | +0.7 dB |
| 4 | 1:20.05 | 1:26.17 | 2 | ●●●●○ | high | -2.0 dB |
| 5 | 1:26.17 | 2:15.09 | 16 | ●●●●● | high | +1.6 dB |
| 6 | 2:15.09 | 2:33.44 | 6 | ●○○○○ | low | -4.9 dB |
| 7 | 2:33.44 | 2:44.20 | 4 | ●○○○○ | outro | -12.0 dB |

## Lifts (land reveals here)

55.60s

## Phrase starts (natural edit points, every 4 bars)

0.57, 12.76, 25.02, 37.23, 49.48, 55.60, 67.81, 70.87, 80.05, 86.17, 98.41, 110.63, 122.87, 135.09, 147.31, 153.44

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 150.38s | — | 9.57s | cuts in on a bar line; silent for the last 1.13s; the track's own fade-out ends the video |
| 15.0s | button | 49.48s | 6.12s | 13.76s | stops on the half-bar at 13.76s (1.24s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 144.26s | — | 15.69s | the track's own fade-out ends the video |
| 20.0s | button | 49.48s | 6.12s | 18.33s | stops on the downbeat at 18.33s (1.67s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 135.09s | — | 24.86s | cuts in on a bar line; silent for the last 0.84s; the track's own fade-out ends the video |
| 30.0s | button | 49.48s | 6.12s | 29.04s | stops on the half-bar at 29.04s (0.96s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 119.80s | — | 40.15s | cuts in on a bar line; silent for the last 0.55s; the track's own fade-out ends the video |
| 45.0s | button | 49.48s | 6.12s | 44.32s | stops on the half-bar at 44.32s (0.68s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 104.50s | — | 55.45s | cuts in on a bar line; silent for the last 0.25s; the track's own fade-out ends the video |
| 60.0s | button | 25.02s | 30.58s | 59.63s | stops on the half-bar at 59.63s (0.37s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
