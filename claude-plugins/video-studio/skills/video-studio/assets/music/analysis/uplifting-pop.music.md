# Music map: uplifting-pop

- File: `uplifting-pop.mp3`
- Length: 2:49.40 · tempo 120.1 BPM · beat 0.499s · bar 2.000s (4/4)
- Loudness: -16.4 LUFS integrated, -2.5 dBTP peak, LRA 5.1 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **fade**: last hit 2:42.97, silence by 2:48.66 (rings 5.69s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:08.00 | 4 | ●○○○○ | intro | +0.0 dB |
| 2 | 0:08.00 | 0:47.99 | 20 | ●●●●○ | high **LIFT** | +5.3 dB |
| 3 | 0:47.99 | 0:55.98 | 4 | ●●●○○ | mid | -0.5 dB |
| 4 | 0:55.98 | 1:45.97 | 25 | ●●●●● | high **LIFT** | +2.8 dB |
| 5 | 1:45.97 | 2:03.95 | 9 | ●●●●● | high | +0.9 dB |
| 6 | 2:03.95 | 2:11.96 | 4 | ●●○○○ | low | -6.6 dB |
| 7 | 2:11.96 | 2:39.70 | 14 | ●●●●● | high **LIFT** | +5.9 dB |
| 8 | 2:39.70 | 2:48.66 | 4 | ●○○○○ | outro | -14.3 dB |

## Lifts (land reveals here)

8.00s, 55.98s, 131.96s

## Phrase starts (natural edit points, every 4 bars)

0.00, 8.00, 16.00, 23.99, 31.99, 39.99, 47.99, 55.98, 63.98, 71.98, 79.97, 87.97, 95.97, 103.97, 105.97, 113.97, 121.96, 123.95, 131.96, 139.96, 147.95, 155.95, 159.70, 167.54

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 153.95s | — | 9.02s | cuts in on a bar line; silent for the last 0.24s; the track's own fade-out ends the video |
| 15.0s | button | 121.96s | 10.00s | 14.00s | stops on the downbeat at 14.00s (1.00s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 147.95s | — | 15.02s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 20.0s | button | 123.95s | 8.01s | 18.01s | stops on the downbeat at 18.01s (1.99s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 137.96s | — | 25.01s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 30.0s | button | 123.95s | 8.01s | 28.00s | stops on the downbeat at 28.00s (2.00s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 123.95s | 8.01s | 39.02s | cuts in on a bar line; silent for the last 0.24s; the track's own fade-out ends the video |
| 45.0s | button | 0.00s | 8.00s | 43.99s | stops on the downbeat at 43.99s (1.01s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 107.96s | 24.00s | 55.01s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 60.0s | button | 16.00s | 39.98s | 57.98s | stops on the downbeat at 57.98s (2.02s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
