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
- **Phases 4 and 5:** not started.

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
