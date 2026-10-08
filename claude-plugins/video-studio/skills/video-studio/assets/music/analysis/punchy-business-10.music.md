# Music map: punchy-business-10

- File: `punchy-business-10.mp3`
- Length: 1:00.00 · tempo 110.0 BPM · beat 0.545s · bar 2.180s (4/4)
- Loudness: -16.4 LUFS integrated, -4.4 dBTP peak, LRA 2.2 LU
- Trust: beats and bar lines from a trained downbeat model (madmom)
- Sound starts 0:00.00; full energy arrives 0:00.00
- Ending: **hit**: last hit 0:58.93, silence by 0:59.28 (rings 0.35s)

## Sections

| # | Start | End | Bars | Energy | Label | Rise |
|---|---|---|---|---|---|---|
| 1 | 0:00.00 | 0:43.63 | 20 | ●●●●● | high | +0.0 dB |
| 2 | 0:43.63 | 0:59.28 | 7 | ●○○○○ | low | -0.2 dB |

## Lifts (land reveals here)

none (energy is flat; use phrase starts)

## Phrase starts (natural edit points, every 4 bars)

0.01, 8.72, 17.45, 26.18, 34.90, 43.63, 52.37

## Ready-made cuts (scripts/fit_music.py)

| Video length | Mode | Start in track | Lift lands at | Last downbeat | Notes |
|---|---|---|---|---|---|
| 15.0s | natural | 43.63s | — | 15.30s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 15.30s: land the logo on it |
| 15.0s | button | 26.18s | — | 13.09s | stops on the downbeat at 13.09s (1.91s before the end): impact SFX there, logo holds in its tail |
| 20.0s | natural | 39.27s | — | 19.66s | cuts in on a bar line; the last 0.36s of the ring is faded; final hit at 19.66s: land the logo on it |
| 20.0s | button | 0.01s | — | 19.62s | stops on the downbeat at 19.62s (0.38s before the end): impact SFX there, logo holds in its tail |
| 30.0s | natural | 28.36s | — | 30.57s | cuts in on a bar line; the last 1.00s of the ring is faded; final hit at 30.57s: land the logo on it |
| 30.0s | button | 8.72s | — | 28.36s | stops on the downbeat at 28.36s (1.64s before the end): impact SFX there, logo holds in its tail |
| 45.0s | natural | 15.26s | — | 43.67s | cuts in on a bar line; silent for the last 0.93s; final hit at 43.67s: land the logo on it |
| 45.0s | button | 8.72s | — | 43.65s | stops on the downbeat at 43.65s (1.35s before the end): impact SFX there, logo holds in its tail |
| 60.0s | button | 0.00s | — | 58.91s | runs into the track's own ending; stops on the downbeat at 58.91s (1.09s before the end): impact SFX there, logo holds in its tail |

## How to use

Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; readable text never changes faster than its reading time just to hit a beat.
