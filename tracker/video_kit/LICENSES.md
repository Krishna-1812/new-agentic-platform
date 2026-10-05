# What is bundled with every Video Studio composition

Every job folder gets a copy of this kit, so a composition never loads
anything from the internet (the render browser has no network).

| File | What | Licence |
|---|---|---|
| `gsap.min.js` | GSAP 3.14.2, the animation library HyperFrames compositions use | GreenSock Standard "No Charge" licence: free, including commercial use (gsap.com/standard-license) |
| `music/*.mp3`, listed in `music.json` | 9 music beds, one per mood, by Sascha Ende (ende.app), each cut to 62 s and evened out to -16 LUFS | CC BY 4.0: free, including commercial use; the author makes the credit voluntary, and Video Studio shows it on the video page |
| `fonts/*.woff2`, listed in `fonts.json` | 21 font families from Google Fonts, latin and latin-ext: Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, Work Sans, DM Sans, Manrope, Plus Jakarta Sans, Source Sans 3, IBM Plex Sans, Space Grotesk, Playfair Display, Merriweather, Lora, Fraunces, DM Serif Display, JetBrains Mono | SIL Open Font License 1.1 |

The fonts are fetched by `scripts/fetch_video_fonts.py`, which also writes
`fonts.json`. A brand font that is not in the set is mapped to the nearest
one in it (`tracker/video_fonts.py`), and the plan says so.

The music is fetched, cut and levelled by `scripts/fetch_video_music.py`, which
also writes `music.json`. A track's credit line is in its manifest entry.
