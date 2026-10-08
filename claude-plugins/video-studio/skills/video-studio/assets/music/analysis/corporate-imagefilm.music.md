# Music map: corporate-imagefilm

- File: `corporate-imagefilm.mp3`
- Length: 3:29.22 · tempo 100.0 BPM · beat 0.600s · bar 2.400s (4/4)
- Loudness: -16.4 LUFS integrated, -4.7 dBTP peak, LRA 8.6 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.44; full energy arrives 0:01.60
- Ending: **hit**: last hit 3:26.72, silence by 3:28.04 (rings 1.32s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:40.78 | 17 | ●●●●● | high | +0.0 dB |
| 2 | 0:40.78 | 1:21.58 | 17 | ●●●●● | high | +0.0 dB |
| 3 | 1:21.58 | 1:28.79 | 3 | ●●○○○ | low | -6.6 dB |
| 4 | 1:28.79 | 1:33.59 | 2 | ●○○○○ | low | -2.3 dB |
| 5 | 1:33.59 | 1:52.78 | 8 | ●●●●● | high **LIFT** | +11.5 dB |
| 6 | 1:52.78 | 1:57.58 | 2 | ●○○○○ | low | -13.3 dB |
| 7 | 1:57.58 | 2:02.39 | 2 | ●●●○○ | mid **LIFT** | +7.3 dB |
| 8 | 2:02.39 | 2:16.78 | 6 | ●●●●○ | high | +2.3 dB |
| 9 | 2:16.78 | 2:21.58 | 2 | ●○○○○ | low | -8.6 dB |
| 10 | 2:21.58 | 3:04.78 | 18 | ●●●●● | high **LIFT** | +11.2 dB |
| 11 | 3:04.78 | 3:28.04 | 10 | ●○○○○ | outro | -10.2 dB |

## Lifts (land reveals here)

93.59s, 117.58s, 141.58s

## Phrase starts (natural edit points, every 4 bars)

9.59, 19.18, 28.78, 38.39, 40.78, 50.39, 59.99, 69.59, 79.18, 81.58, 88.79, 93.59, 103.19, 112.78, 117.58, 122.39, 131.99, 136.78, 141.58, 151.19, 160.79, 170.39, 179.99, 184.78, 194.38, 203.98

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 191.98s | — | 14.74s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 14.74s: land the logo on it; quiet first 2s |
| 15.0s | button | 131.99s | 9.59s | 14.40s | stops on the downbeat at 14.40s (0.60s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 187.18s | — | 19.54s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 19.54s: land the logo on it; quiet first 2s |
| 20.0s | button | 88.79s | 4.80s | 19.20s | stops on the downbeat at 19.20s (0.80s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 177.59s | — | 29.13s | cuts in on a bar line; the last 0.80s of the ring is faded; final hit at 29.13s: land the logo on it |
| 30.0s | button | 79.18s | 14.41s | 28.81s | stops on the downbeat at 28.81s (1.19s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 163.19s | — | 43.53s | cuts in on a bar line; silent for the last 0.10s; final hit at 43.53s: land the logo on it |
| 45.0s | button | 79.18s | 14.41s, 38.40s | 43.21s | stops on the downbeat at 43.21s (1.79s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 148.79s | — | 57.93s | cuts in on a bar line; silent for the last 0.70s; final hit at 57.93s: land the logo on it |
| 60.0s | button | 117.58s | 0.00s, 24.00s | 57.61s | stops on the downbeat at 57.61s (2.39s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
