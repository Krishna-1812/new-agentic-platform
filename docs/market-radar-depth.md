# Market Radar: depth across kinds of business

How Market Radar reads a company that is not a clinic, and what it adds up. Everything here is free and
public: no model, no key, no credit. (The report writer and the move reader still use Claude, capped and
confirmed on the page as before.)

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
