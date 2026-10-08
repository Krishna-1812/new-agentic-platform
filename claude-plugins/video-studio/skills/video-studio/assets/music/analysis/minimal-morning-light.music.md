# Music map: minimal-morning-light

- File: `minimal-morning-light.mp3`
- Length: 2:53.64 · tempo 81.2 BPM · beat 0.738s · bar 3.200s (4/4)
- Loudness: -16.4 LUFS integrated, -3.2 dBTP peak, LRA 3.9 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 2:53.00, silence by 2:53.00 (rings 0.00s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:07.02 | 2 | ●●○○○ | low | +0.0 dB |
| 2 | 0:07.02 | 0:25.63 | 6 | ●○○○○ | low | -0.5 dB |
| 3 | 0:25.63 | 0:48.03 | 7 | ●●●●○ | high | +1.5 dB |
| 4 | 0:48.03 | 1:00.83 | 4 | ●●●●● | high | +1.1 dB |
| 5 | 1:00.83 | 1:55.23 | 17 | ●●●●● | high | -0.0 dB |
| 6 | 1:55.23 | 2:20.83 | 8 | ●○○○○ | low | -4.3 dB |
| 7 | 2:20.83 | 2:53.00 | 10 | ●●○○○ | low | +2.2 dB |

## Lifts (land reveals here)

none (energy is flat; use phrase starts)

## Phrase starts (natural edit points, every 4 bars)

0.62, 7.02, 18.24, 19.82, 25.63, 38.43, 48.03, 60.83, 73.63, 86.43, 99.24, 112.04, 115.23, 128.04, 140.83, 153.63, 166.43

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 156.83s | — | 16.17s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 16.17s: land the logo on it |
| 15.0s | button | 19.82s | — | 13.81s | stops on the half-bar at 13.81s (1.19s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 153.63s | — | 19.37s | cuts in on a bar line; silent for the last 0.58s; final hit at 19.37s: land the logo on it |
| 20.0s | button | 86.43s | — | 19.20s | stops on the downbeat at 19.20s (0.80s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 144.03s | — | 28.97s | cuts in on a bar line; silent for the last 0.98s; final hit at 28.97s: land the logo on it |
| 30.0s | button | 60.83s | — | 28.81s | stops on the downbeat at 28.81s (1.19s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 128.04s | — | 44.96s | final hit at 44.96s: land the logo on it |
| 45.0s | button | 18.24s | — | 44.19s | stops on the half-bar at 44.19s (0.81s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 112.04s | — | 60.96s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 60.96s: land the logo on it |
| 60.0s | button | 48.03s | — | 59.20s | stops on the half-bar at 59.20s (0.80s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
