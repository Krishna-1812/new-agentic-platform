# Music map: playful-sunny

- File: `playful-sunny.mp3`
- Length: 3:11.44 · tempo 120.0 BPM · beat 0.500s · bar 2.000s (4/4)
- Loudness: -16.4 LUFS integrated, -3.5 dBTP peak, LRA 4.6 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.34; full energy arrives 0:01.26
- Ending: **hit**: last hit 3:07.42, silence by 3:07.68 (rings 0.26s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:13.38 | 7 | ●○○○○ | low | +0.0 dB |
| 2 | 0:13.38 | 0:55.38 | 21 | ●●●●○ | high **LIFT** | +2.8 dB |
| 3 | 0:55.38 | 1:01.38 | 3 | ●●●○○ | mid | -0.8 dB |
| 4 | 1:01.38 | 1:21.38 | 10 | ●●●●○ | high | +0.8 dB |
| 5 | 1:21.38 | 1:53.38 | 16 | ●●●●● | high | +1.1 dB |
| 6 | 1:53.38 | 2:05.38 | 6 | ●●●●● | high | -0.8 dB |
| 7 | 2:05.38 | 2:59.38 | 27 | ●●●●● | high | +0.8 dB |
| 8 | 2:59.38 | 3:03.38 | 2 | ●○○○○ | low | -4.9 dB |
| 9 | 3:03.38 | 3:07.68 | 2 | ●○○○○ | low | +0.4 dB |

## Lifts (land reveals here)

13.38s

## Phrase starts (natural edit points, every 4 bars)

7.38, 13.38, 21.38, 29.38, 37.38, 45.38, 53.39, 55.38, 61.38, 69.38, 77.38, 81.38, 89.38, 97.38, 105.38, 113.38, 121.38, 125.38, 133.38, 141.38, 149.38, 157.38, 165.38, 173.38, 179.38, 183.38

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 173.38s | — | 14.04s | cuts in on a bar line; silent for the last 0.65s; final hit at 14.04s: land the logo on it |
| 15.0s | button | 7.38s | 6.00s | 14.00s | stops on the downbeat at 14.00s (1.00s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 167.38s | — | 20.04s | cuts in on a bar line; the last 0.65s of the ring is faded; final hit at 20.04s: land the logo on it |
| 20.0s | button | 7.38s | 6.00s | 18.00s | stops on the downbeat at 18.00s (2.00s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 157.38s | — | 30.04s | cuts in on a bar line; the last 0.65s of the ring is faded; final hit at 30.04s: land the logo on it |
| 30.0s | button | 7.38s | 6.00s | 28.00s | stops on the downbeat at 28.00s (2.00s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 143.38s | — | 44.04s | cuts in on a bar line; silent for the last 0.65s; final hit at 44.04s: land the logo on it |
| 45.0s | button | 7.38s | 6.00s | 44.00s | stops on the downbeat at 44.00s (1.00s before the end): impact SFX there, logo holds in its tail |
| 60.0s | natural | 127.38s | — | 60.04s | cuts in on a bar line; the last 0.65s of the ring is faded; final hit at 60.04s: land the logo on it |
| 60.0s | button | 1.38s | 12.00s | 58.00s | stops on the downbeat at 58.00s (2.00s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
