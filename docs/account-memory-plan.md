# Account memory: plan

Every piece of work is saved in a **space**. Each client account has its own space. Each person also has
their own private space, **General**.

- **Account space** (`acct:<id>`): everything run for one client. Every staff member can see it and carry
  it on. Each item shows who ran it and when. Nothing in one account's space can reach another's.
- **General** (`me:<email>`): work that is not for an account. It is private to the person who ran it. It
  is opened from the account picker's **General** choice, which used to be called "All accounts".

When the AI runs for an account, it is given that account's master-doc profile and, from phase 4, a short
brief of that account's earlier work. It is never given anything from another account or from anyone's
General space.

## The rules

1. **Where work goes.** Work started on an account's pages (`/<account>/...`) is saved to that account.
   Work started on the global pages is saved to the person's General space.
2. **Who sees it.**
   - Every staff member sees an account's work, with the name of whoever ran it.
   - Only its owner sees General work.
   - A client sees only what the account's sharing settings allow, never names, costs or General work.
3. **Who changes it.** Any staff member can carry account work on: edit a watch, approve a video, run it
   again. Only the person who ran it, or an admin, can delete it.
4. **Nothing in common.**
   - Account spaces never share rows. Every read names its space, and tests prove that one account's
     work cannot be listed, opened or briefed from another.
   - The master doc's shared tabs ("General", "All accounts", "Agency"...) are house rules for writing a
     review. They are not client facts and not anyone's work, so they stay as they are.
5. **Ids, not names.**
   - An account's space uses a stable id. Renaming the account, changing its URL, or adding Google Ads
     to it does not change the id.
   - Work is no longer matched by the client's name, so two clients with the same name can no longer see
     each other's work.
6. **Existing work.**
   - Earlier watches and videos whose client name matches an account move into that account's space
     automatically.
   - The rest becomes its owner's General work.
   - Nothing is deleted.

## Phases

| Phase | What it does |
|---|---|
| **1. Spaces, Page Watch, Video Studio, history** | Stable account ids and spaces. People's names are stored when they sign in. Page Watch and Video Studio save to spaces and are shared inside an account, with who made each item. Brands are saved per account. Existing work moves to its account. The account home gains **History**: every watch, change, video and AI review, newest first, with who and when. The picker's "All accounts" becomes **General**. |
| **2. The agents** | Local Business Radar, Social Media Intelligence, Event & Conference Intelligence and Contact Finder save each run to its space. Inside an account, an agent lists all of that account's runs with who ran them. On the global page, it lists only your General runs. The runs join the account's History. |
| **3. SEO & AEO tools** | SEO Studio saves each audit and research run to its space, in the same way, and they join the History. |
| **4. Memory for the AI** | Before each AI run for an account, the account's earlier work is put into a short brief: the last reviews' findings and actions, recent page changes, past agent results, and the videos made. The AI builds on it: what changed since last time, which advice was taken, what to do next. The brief is built only from that account's space, and the run page shows what the AI was given. |
| **5. Isolation audit and polish** | A test sweeps every route and every brief to check that no account's work reaches another and that General stays private. Also: clients' view of History (what they may see), a History filter by tool and person, and the docs. |

Each phase ends with the full suite green, CI green, a real-browser check at desktop and phone width,
and a merge.

## Progress

- **Phase 1: built.** Spaces, Page Watch, Video Studio, History and "General" in the picker, as
  below. Checked in Chromium at 1440 and 390 wide, with work by three people in one account and
  General work beside it: no script errors and no sideways scrolling. Fixed on the way: a video page
  inside an account rewrote its address to the global Video Studio once a version loaded.
- **Phase 2: built.** The five agents save every run to its space:
  - Local Business Radar (`lbr_runs.space`);
  - Social Media Intelligence (`sci_runs.space`);
  - Event & Conference Intelligence (`evi_runs.space`, set in `event_intel_jobs.start`);
  - Thought Leader Intelligence (`thought_leader_pr_runs.space`);
  - Contact Finder's saved searches, answers and enriched contacts (`cpi_search_history.space`).

  How it works:
  - **Which account.** An agent opened inside an account (`/<account>/agents/<agent>`) loads
    `static/js/account-context.js` first, in the head. Every call the page makes then carries
    `X-Account: <account>`, and `app.py` `_work_acct` turns that into the account's space. Only staff
    count.
  - **The lists.** On each agent's page they are the account's runs (the whole team's, each with who
    ran it), or on the agent's own page your General ones.
  - **Opening and carrying on.** Any staff member can open an account's run and carry it on. Only its
    maker deletes it (Contact Finder's drawer shows a delete button only on your own entries).
  - **History and the home.** The runs join the account's History under "Agents", and "Run for" on
    the account's home says when each agent last ran and who ran it.

  What stays as it was:
  - Agent runs from before stay their maker's General work. They hold no client name to match safely.
  - Event Intelligence's client profiles and outcome learning stay per person.

  Checks:
  - The CI Postgres job's 327 tests pass on a fresh database.
  - In Chromium, the radar inside an account sent the account with every call, showed two people's
    runs with their names, and General showed only the viewer's own.
- **Phase 3: built.** The SEO & AEO tools.
  - **The pass names the account.** SEO Studio is opened with a signed pass. Inside an account the
    pass carries the account's space (`s`, `app.py` `_studio_pass`), and the studio reads it into
    `req.user.space` (`seo-apps/server/routes/auth.js`). A pass can name only a real account space,
    never someone else's General work.
  - **The studio's own lists follow it** (`seo-apps/server/utils/space.js`): On-Page audits, Content
    Architect projects and Market Potential scenarios.
    - Inside an account, a list is that account's (the whole team's).
    - Elsewhere, a list is your own, plus On-Page audits and Content Architect projects from before
      spaces, which everyone saw before and still does.
    - Only the maker deletes.
  - **Every tool hands its finished run to the platform.** Each of the nine account tools posts
    `agent-run-finished` with its input and result. `templates/embed.html` sends it to `POST
    /api/seo-runs` (with `X-Account` inside an account) and says where it was saved.
  - **The platform keeps the run** (`tracker/seo_runs_store.py`, table `seo_runs`), with a few
    readable facts (`tracker/seo_runs.py`). A result over 2 MB keeps its facts only.
  - **Where runs show:**
    - Each run has a page (`/<account>/seo-aeo/runs/<id>`, or `/seo-aeo/runs/<id>` for General) with
      a download of the full result.
    - Runs join the account's History under "SEO & AEO".
    - "Run for" on the account home gives each tool's last run.
- **Phase 4: built.** The AI's memory of an account (`tracker/account_brief.py`).
  - **The brief.** `account_brief.build(space, ads_names)` puts the account's earlier work into a short
    text, newest first, with dates and who did it:
    - the last three finished AI reviews of its Google Ads accounts: verdict, headline, missed
      objectives and actions;
    - the page changes Page Watch saw (muted and noise left out);
    - SEO & AEO runs with their facts and highlights;
    - the agents' runs;
    - the videos made.

    It is capped at 12,000 characters (the oldest items go first). It reads only that account's space
    and its own Google Ads accounts' reviews. It refuses anything that is not an account's space, so
    General work can never reach it. A part that cannot be read is left out; the run goes ahead.
  - **The Google Ads AI review** is given it as `<earlier_work>`, after the data pack
    (`app.py` `_gads_ai_memory` finds the client account the Google Ads account belongs to; one owned
    by no account, or by two, gets none). The review is asked to go through the last review's actions
    and say which were done, partly done or not done, and to build on them. Its answer has a new
    `follow_up` part, shown as **Since the last review**. The review page also shows **What the AI was
    given about earlier work**. Clients see the follow-up, never what the AI was given (it names staff).
  - **Video Studio** is told the videos already made for the account (`video_planner._earlier`), as
    history it may not quote words or numbers from, so a new video does not repeat an earlier idea. The
    plan page says so and lists them. General videos get nothing.
  - **Not given the brief, by design:** the agents and the SEO & AEO tools. They gather data (places,
    posts, rankings, page audits) rather than judge the account, and their results feed the brief.
- **Phase 5: built.** Isolation audit and polish.
  - **The sweep** (`tests/test_account_isolation.py`).
    - What it seeds: every tool's work, in two accounts, in two people's General spaces and as older
      unassigned work, each with its own marker.
    - What it opens: every page and API an account has, for one account, as a staff member who made
      the other account's work. Each id route is opened with the account's own id and with every
      other one.
    - Nothing from elsewhere may show. The route list is read from the app itself, so a new account
      route fails the test until it is added to the sweep.
    - It also checks each account's AI brief, the agents' lists, General privacy and what a client
      sees.
    - Breaking one store's space check on purpose fails it.
  - **What clients see of History.** A new share, **Work history** (off by default), set in the
    account's Share dialog. When it is on, the client's home shows **What we have done**
    (`account_history.for_client`):
    - finished work only (no running, failed or removed items);
    - no names and no links into the agency's tools;
    - AI reviews only when the account also shares its AI review, linking to that page;
    - never Contact Finder's rows (people's names and contact details found for the agency's own
      outreach).

    The staff History says whether the client sees it.
  - **History filters.** Alongside the tool chips and the person picker:
    - a search box;
    - "Automatic" in the person picker, for what Page Watch found on its own;
    - up to 200 entries, 40 at a time, with **Show more**;
    - the chosen filter kept in the address (`?h_tool=`, `?h_by=`, `?h_q=`), so a filtered History
      can be linked to.

## How it works, in short

- **Where work is saved:** an account's pages save to the account (everyone at the agency sees it,
  with who did it); the global pages save to your General space (only you see it).
- **Who removes it:** only whoever made it (or an admin, for watches).
- **What the AI knows:** before the Google Ads AI review or a Video Studio plan for an account, the AI
  is given that account's earlier work (`tracker/account_brief.py`), and the run's page shows what it
  was given.
- **What a client sees:** only what the account shares: the Google Ads dashboard, the AI review, the
  profile and, if turned on, the finished work history without names.
- **What keeps accounts apart:** every read names its space; `tests/test_account_isolation.py` proves
  it across every account route.

## Phase 1 in detail

| Part | Where |
|---|---|
| A stable id for every account (survives renames and re-keying) | `tracker/client_accounts_store.py` (`client_accounts.id`) |
| Spaces: account and personal, who may see and change what | `tracker/workspace.py` |
| People's names, saved at sign-in, for "by Kris" | `tracker/people_store.py` |
| `space` on watches and video projects; brands per account; reads that allow a staff member into account work | `tracker/watch_store.py`, `tracker/video_store.py` |
| Existing work moved to its account | `workspace.claim_legacy`, run each time the account list is rebuilt |
| Page Watch and Video Studio inside an account: everyone's work for it, with names | `app.py` (account routes) |
| Global Page Watch and Video Studio: your General work only, with a line pointing to your account work | `app.py`, templates |
| History on the account home | `tracker/account_history.py`, `templates/account_home.html` |
| "General" in the picker | `templates/_bento.html`, `static/js/account-picker.js`, `templates/hub.html` |

## Clients using an account's tools

An admin opens an account's **Share** panel, invites the client and ticks the agents and tools they may
use, and sets **Runs a month**. Then:

- **What the client sees.** Their account home shows **Your tools**: a card for each ticked tool, with
  the runs left this month. Their History shows only those tools' finished work (and AI reviews when
  the AI review is shared), with no staff names, linking into their own account's pages.
- **What they can do.** Each ticked tool opens inside their account and runs as it does for staff. What
  they run is saved to the account, so the team sees it in the account's History, with the client's
  name. Every other tool, and the platform's own pages (tests, drills, admin), stays closed to them.
- **Only their account.** While a client's request is served, `tracker/workspace.py` holds their
  account's space as the scope: every store reads, lists and files that space alone, and nothing can be
  filed as General work. No id, header or address reaches another account or anyone's General work.
  `tests/test_client_tools.py` sweeps every tool route with every other account's ids.
- **The limit.** Each run they start counts (a new watch or a manual check, a new video or a plan
  change, a radar, social or event run, a Contact Finder search, a Thought Leader lookup, a finished
  SEO & AEO run). At the limit, starting another is refused with a note to ask the agency; looking at
  what is there is not. Staff are never limited.
- **No costs.** A client never sees what a run cost the agency or its Apollo credits: those figures are
  removed from every answer they receive and every page they open.
- **SEO & AEO.** The studio gets a "client" pass naming the account and the shared tools, and its server
  lets that pass reach only those tools' APIs.
- **Staying inside.** A client who takes the account's name off the address (or opens any of our other
  pages) is sent back to their account; with two accounts, to the first.
- **Client Usage.** Every shared account has a card in Admin → Client Usage, made the moment an admin
  shares it: who it is shared with, what, their visits and runs against the limit, and every change.
