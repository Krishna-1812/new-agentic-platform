# What is bundled with every Video Studio composition

Every job folder gets a copy of this kit, so a composition never loads
anything from the internet (the render browser has no network).

| File | What | Licence |
|---|---|---|
| `gsap.min.js` | GSAP 3.14.2, the animation library HyperFrames compositions use | GreenSock Standard "No Charge" licence: free, including commercial use (gsap.com/standard-license) |
| `fonts/*.woff2`, listed in `fonts.json` | 21 font families from Google Fonts, latin and latin-ext: Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, Work Sans, DM Sans, Manrope, Plus Jakarta Sans, Source Sans 3, IBM Plex Sans, Space Grotesk, Playfair Display, Merriweather, Lora, Fraunces, DM Serif Display, JetBrains Mono | SIL Open Font License 1.1 |

The fonts are fetched by `scripts/fetch_video_fonts.py`, which also writes
`fonts.json`. A brand font that is not in the set is mapped to the nearest
one in it (`tracker/video_fonts.py`), and the plan says so.
