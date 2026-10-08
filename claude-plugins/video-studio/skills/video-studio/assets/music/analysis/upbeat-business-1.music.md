# Music map: upbeat-business-1

- File: `upbeat-business-1.mp3`
- Length: 2:43.96 · tempo 120.0 BPM · beat 0.500s · bar 2.000s (4/4)
- Loudness: -16.4 LUFS integrated, -3.6 dBTP peak, LRA 2.8 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **fade**: last hit 2:40.02, silence by 2:42.85 (rings 2.83s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:32.00 | 16 | ●●●●● | high | +0.0 dB |
| 2 | 0:32.00 | 0:40.00 | 4 | ●○○○○ | low | -3.4 dB |
| 3 | 0:40.00 | 0:46.00 | 3 | ●●●●○ | high **LIFT** | +2.6 dB |
| 4 | 0:46.00 | 1:20.00 | 17 | ●●●●● | high | +1.8 dB |
| 5 | 1:20.00 | 1:24.00 | 2 | ●○○○○ | low | -4.5 dB |
| 6 | 1:24.00 | 1:52.00 | 14 | ●●●●● | high **LIFT** | +3.1 dB |
| 7 | 1:52.00 | 2:00.00 | 4 | ●○○○○ | low | -4.8 dB |
| 8 | 2:00.00 | 2:05.99 | 3 | ●●●●● | high **LIFT** | +4.8 dB |
| 9 | 2:05.99 | 2:42.85 | 18 | ●●●●● | high | -0.0 dB |

## Lifts (land reveals here)

40.00s, 84.00s, 120.00s

## Phrase starts (natural edit points, every 4 bars)

0.01, 8.00, 16.00, 24.00, 32.00, 40.00, 46.00, 54.00, 62.00, 70.00, 78.00, 80.00, 84.00, 92.00, 100.00, 108.00, 112.00, 120.00, 125.99, 134.00, 142.00, 150.00, 158.00

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 148.00s | — | 12.02s | cuts in on a bar line; silent for the last 0.10s; the track's own fade-out ends the video |
| 15.0s | button | 32.00s | 8.00s | 14.00s | stops on the downbeat at 14.00s (1.00s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 142.00s | — | 18.02s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 20.0s | button | 32.00s | 8.00s | 18.00s | stops on the downbeat at 18.00s (2.00s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 132.00s | — | 28.02s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 30.0s | button | 24.00s | 16.00s | 28.00s | stops on the downbeat at 28.00s (2.00s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 118.00s | 2.00s | 42.02s | cuts in on a bar line; silent for the last 0.10s; the track's own fade-out ends the video; quiet first 2s |
| 45.0s | button | 16.00s | 24.00s | 44.00s | stops on the downbeat at 44.00s (1.00s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 102.00s | 18.00s | 58.02s | cuts in on a bar line; the last 1.00s of the ring is faded; the track's own fade-out ends the video |
| 60.0s | button | 8.00s | 32.00s | 58.00s | stops on the downbeat at 58.00s (2.00s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
