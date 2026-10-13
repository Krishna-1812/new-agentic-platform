# Why a page is slow, and what is done about it

A page is slow for one of four reasons: the distance between the browser and the server, the distance between the
server and its database, how many times the page connects to the database, or what it waits on elsewhere
(Google, a model). `tracker/request_timing.py` shows which; the rest of this page is what is already done.

## Where things run

The web service, the worker and the Postgres database should be in the **same Railway region**, and that region
should be near the people using the site. A web service in Singapore with its database in Virginia is slower
than both in Virginia, because every query crosses the Pacific. To check: Railway → each service (web, worker,
Postgres) → Settings → Region. The three should read the same.

`DATABASE_URL` should be the private address (`postgres.railway.internal`, what `${{Postgres.DATABASE_URL}}`
gives), not the public one (`...proxy.rlwy.net`, `DATABASE_PUBLIC_URL`), which goes out to the internet and back.

## Seeing where a page spends its time

Staff only: open the page, F12 → Network, click the page's own request, Timing tab, Server Timing:
`app` is the server's whole time, `db-connect` is the time spent opening database connections and how many.
Any request slower than `SLOW_REQUEST_S` seconds (default 1.5) is also logged (Railway → web → Logs, search
"slow request") with its path and those figures.

## What is cached

- **Database connections** (`tracker/db_pool.py`): a store's `close()` returns the connection to a small pool and
  the next query reuses it, instead of logging in again. A connection idle for 20 seconds is tested before it is
  reused, and a dead one is replaced. Stores that hold session state (advisory locks, autocommit,
  `statement_timeout`) do not use it. To turn it off at once, set `DB_POOL=off` in Railway → web → Variables.
- **Static files** (scripts, styles, images): cached by the browser for an hour, and past the hour shown at once
  while being checked in the background (`stale-while-revalidate`).
- **The account list**: kept in memory and refreshed in the background, so no page waits on Google for it.
- Responses are compressed (gzip).
