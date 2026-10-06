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
- **Phases 2 to 5:** not started.

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
