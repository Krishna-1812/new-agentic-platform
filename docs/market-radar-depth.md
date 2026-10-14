# Market Radar: depth across kinds of business

How Market Radar reads a company that is not a clinic, and what it adds up. Everything here is free and
public: no model, no key, no credit. (The report writer and the move reader still use Claude, capped and
confirmed on the page as before.)

## 0. How exactly a company is placed: niche, buyer, ICP

`tracker/market_radar_niche.py`, `tracker/market_radar_profile.py`. A company profiled as "men's innerwear"
whose whole site says Pima cotton, modal and bamboo, zero polyester, is not wrong but it is too broad: its
buyer, its rivals and its report all change with the niche. The profile now carries a **positioning**: the
niche (4 to 14 words: product, the attribute the site makes its point of difference, the customer),
the broad category and its path, the defining attributes (each with a verbatim quote and page), what sets it
apart, the neighbouring categories it is NOT in, who it sells to (gender, age, market, needs, buying
triggers), one to three ideal customer segments, and the searches a buyer would type.

How it stays accurate:

1. **A program counts what the site keeps saying** (free): its title, description, headings, menu, product
   and collection addresses and text, weighted by where a word sits, the materials and audiences it names,
   what it says it is free of ("zero polyester"), and the prices it shows. The model is given these counts
   as facts (`what_the_site_stresses`), so "Pima cotton" in the title outweighs a product listed once.
2. **A program checks the niche against the site**: vaguer than the site (a material or audience the site
   stresses that the niche leaves out), a word no page says, or too few meaningful words. The town a business
   is in and a product range listed among many are not counted as missing.
3. **If the check fails, one small second model call** rewrites the positioning with the problems listed.
   It costs a few cents and runs only when the check fails. If it fails or does not fully fix it, the first
   reading is kept and the remaining flags are shown on the profile ("Niche and buyer" tab), never hidden.
4. **Staff can correct it.** Niche, who they sell to, what sets them apart, not-in categories and buyer
   searches are editable on the profile; a correction reaches the competitor search, the judging and the
   report on the next run.

How the niche is used: the competitor search plan builds its queries from the niche's attributes and the
buyer's market, not the broad category, and never searches a "not in" category; each candidate is judged
`same_niche` (yes, adjacent, no); a same-category brand without the niche is held at "indirect" and below 70,
and a different category is left out; the report writer is told the niche and the buyer; the profile page
leads with the niche. A profile stored before this existed is read again once on its next run (corrections
kept).

## 0b. Which competitors are researched

`tracker/market_radar_tracking.py` holds the one rule. The agent suggests competitors; you Confirm the ones
that matter and Remove the rest. Once at least one is confirmed, **only the confirmed ones** are researched:
the moves collection, the reading and scoring of what it found, the rival cards, the moves page and the
written report. Suggestions you have neither confirmed nor removed are listed (marked "Not researched until
you confirm it") but left alone. Before anything is confirmed nothing has been chosen, so every suggestion
that was not removed is researched, and the page says so ("No competitor is confirmed yet, so all N suggestions
are being researched"). A removed competitor is never researched. The same sentence is shown on the
Competitors list, the Moves page and in the report's "what was and was not checked".

The "new businesses nearby" and "new brands" scans still know every suggested competitor, so a suggestion is
never reported back to you as a new entrant.

## 1. When a website cannot be read

`tracker/market_radar_outside.py`. If a site refuses the reader or says very little, the profile also reads
Wikidata (the record whose official website IS this domain) and Wikipedia's opening paragraph. Apollo's paid
record is used only when these have nothing. Every profile carries a read-quality grade (read in full, in part,
thin, website not read) with the reason, shown at the top of the Profile section.

What it does not do: get past a site that has refused us. A refusal is recorded as a refusal. The browser
fallback (a real browser through Apify, `tracker/market_radar_browser.py`) opens only the homepage and a few
pages while its allowance lasts; the other readers then say "the website could not be read".

## 2. Kinds of business and playbooks

`tracker/market_radar_playbooks.py` is the one table. Sixteen kinds: local business, chain, online shop, business
services, business software, manufacturer, marketplace, professional services, hotels and travel, education,
hospital or health system, real estate, banking and fintech, nonprofit, creator or personal brand, other. For
each: how the profile recognises it, what its rivals' moves look like, how its rivals are found, which optional
readers run, whether awards and rankings count as moves, whether to scan for new entrants.

To add a kind: add it to the table, add its label to `static/js/market_radar.js` and `market_radar_report.js`.
`tests/test_market_radar_playbooks.py` fails until every place agrees.

## 3. The readers

Each rival is read by the detectors in `tracker/market_radar_collect.py`. The new ones
(`tracker/market_radar_more.py`): new pages in the sitemap, App Store apps, Hacker News, Wikidata facts, tools on
the homepage. Which run for which kind of business is the playbook's `specialists`.

## 4. What the readings add up to

`tracker/market_radar_insight.py`, arithmetic on stored readings: momentum per rival (its scored moves this
fortnight against the one before), a card of everything known about each rival with where each fact came from,
what several rivals are doing at once, and whether the whole field is heating up. Shown as the "Rival cards"
section (`GET .../api/clients/<id>/rivals`). The written report's evidence pack carries the same patterns and
facts, so the writer can cite them and the citation check can check them.

## 5. The benchmark

`python3 scripts/market_radar_benchmark.py` runs the free reading over 49 public websites across the kinds of
business and prints a scorecard. Baseline, 2026-10-12, from a data-centre address (like the server's), without
the paid browser:

| | |
|---|---|
| A profile is possible | 48 of 49 sites (98%) |
| Site read directly | 37 |
| Refused the reader but rescued by Wikidata/Wikipedia | 11 |
| Not readable at all | 1 (a small association with no Wikidata record) |
| New pages reader answered | 73% (the rest: the site refused) |
| Apps / Hacker News / company facts answered | 100% / 100% / 100% (a "none" is an answer) |
| Tools reader answered | 76% (the rest: the site refused) |

Before this work, the 12 sites that refused the reader had no profile at all.

## 6. The map

The Overview's radar dial was replaced by a real map: the client's own sites and every rival pinned where it is
(`static/js/market_radar_map.js`, Leaflet over OpenStreetMap; data from `GET .../api/clients/<id>/map`,
`tracker/market_radar_map.py`).

How a rival is placed, most precise first:

- **Map listing.** A rival the map data lists (a nearby clinic, a branch) is pinned at its listing's coordinates,
  stored when the competitor search found it (`lat` and `lon` in the competitor's details).
- **Stated location.** A rival found from its website is pinned at the town or address its homepage was judged to
  give, looked up in OpenStreetMap's Nominatim. Each lookup is cached for good and spaced a second apart, and one
  call makes at most six, so a client with twenty rivals fills in over a few loads (`pending` says how many are
  left; the page asks again). A pin from a stated town is a town, not a street, and the map says so.
- **Not placed.** A rival with no stated base ("online only", "worldwide") is listed under the map as not placed.
  It is never put somewhere to fill the picture.

A business that competes by neighbourhood opens on its neighbourhood (rivals within twice its search radius, at
least 10 km); "Show all" widens to every pin, which is what an online brand opens on. Pins that would overlap
become one counted pin; the client's own pin is always on top and a rival at the same spot is drawn beside it.
New places the radar found near the client's sites are small green marks (opened) or blue ones (coming soon).

Map tiles come from OpenStreetMap's public servers by default, loaded by the viewer's browser, so OpenStreetMap
sees the viewer's address and which tiles were asked for. Its policy suits an internal tool; for heavy use, set
`MR_MAP_TILES` (an `https://` address with `{z}/{x}/{y}`) and `MR_MAP_ATTRIBUTION` in Railway → web → Variables
to a paid tile provider. Leaflet itself is vendored in `static/vendor/leaflet/` (BSD licence), so no script is
loaded from anyone else's server.
