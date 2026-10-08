# Music map: cinematic-brave

- File: `cinematic-brave.mp3`
- Length: 2:29.39 · tempo 75.0 BPM · beat 0.800s · bar 3.200s (4/4)
- Loudness: -16.4 LUFS integrated, -1.6 dBTP peak, LRA 5.8 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.28; full energy arrives 0:00.80
- Ending: **hit**: last hit 2:26.08, silence by 2:28.88 (rings 2.80s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:21.66 | 7 | ●●●●● | high | +0.0 dB |
| 2 | 0:21.66 | 1:19.25 | 18 | ●●●●● | high | +1.3 dB |
| 3 | 1:19.25 | 1:25.65 | 2 | ●○○○○ | low | -11.8 dB |
| 4 | 1:25.65 | 1:35.25 | 3 | ●○○○○ | low **LIFT** | +3.7 dB |
| 5 | 1:35.25 | 2:28.88 | 17 | ●●●●● | high **LIFT** | +7.2 dB |

## Lifts (land reveals here)

85.65s, 95.25s

## Phrase starts (natural edit points, every 4 bars)

12.06, 21.66, 34.44, 47.25, 60.04, 72.84, 79.25, 85.65, 95.25, 108.04, 120.84, 133.64, 146.44

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 133.64s | — | 12.44s | cuts in on a bar line; the last 0.58s of the ring is faded; final hit at 12.44s: land the logo on it |
| 15.0s | button | 88.85s | 6.40s | 14.40s | stops on the half-bar at 14.40s (0.60s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 130.45s | — | 15.63s | cuts in on a bar line; silent for the last 1.52s; final hit at 15.63s: land the logo on it |
| 20.0s | button | 79.25s | 6.40s, 16.00s | 19.21s | stops on the downbeat at 19.21s (0.79s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 117.65s | — | 28.43s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 28.43s: land the logo on it |
| 30.0s | button | 72.84s | 12.81s, 22.41s | 28.80s | stops on the downbeat at 28.80s (1.20s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 104.86s | — | 41.22s | cuts in on a bar line; silent for the last 0.93s; final hit at 41.22s: land the logo on it |
| 45.0s | button | 60.04s | 25.61s, 35.21s | 43.21s | stops on the half-bar at 43.21s (1.79s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 88.85s | 6.40s | 57.23s | cuts in on a bar line; the last 0.38s of the ring is faded; final hit at 57.23s: land the logo on it |
| 60.0s | button | 79.25s | 6.40s, 16.00s | 59.20s | stops on the half-bar at 59.20s (0.80s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
