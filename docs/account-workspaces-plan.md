# Client accounts: one space per client, at `/<account>`

Asked for on 2026-10-06: the same account dropdown the Google Ads dashboard has, on the homepage.
Picking an account sets up every dashboard and agent for it, and the address changes to
`/<account name>` so the client can later be given access to it. A master doc holds what the
platform should know about each account.

Decisions the owner made (2026-10-06):

- **The list** is the Google Ads accounts plus any account that has a tab in the master doc.
- **Client access** is part of the first version: invites by email or domain, and a client sees
  only their own account.
- **One doc for both.** The master doc is the AI review's context doc. Each account has a tab
  with a short profile at the top; the notes under it are what the AI review reads.
- **Scope:** Google Ads and the AI review, Video Studio and Page Watch, the SEO & AEO tools, and
  the other agents all follow the selected account.

## Phases (one PR each, merged when green)

| Phase | What | State |
|---|---|---|
| A | The list, URL names, the switch in every top bar and on the hub, each account's home, Google Ads and the AI review scoped to the account | built (PR #74) |
| B | Client access: invites, what a client sees, the client's chrome, sign-in landing | built (PR #75) |
| C | Video Studio and Page Watch inside an account | built (PR #76) |
| D | The SEO & AEO tools and the other agents, filled in from the profile | built |

## Phase A: how it works

### The list (`tracker/client_accounts.py`)

- **Google Ads:** every account in the campaign report, by 30-day spend.
- **The master doc** (`tracker/gads_ai_doc.py` reads it; it is linked on the AI review page or
  with `GOOGLE_ADS_CONTEXT_DOC`). A tab joins the Google Ads account it names:
  - by its title (the same rule as the AI review: the longest contained name, a customer ID, or a
    unique shortened title of at least 4 letters); or
  - by the `Google Ads ID:` line in its profile. One tab may give several IDs, for a client with
    more than one Google Ads account. A tab linked by ID alone is named by its title, so
    "Aster Aesthetics" can be the client behind the Google Ads account "AA_New".
- A tab that names no Google Ads account becomes an account of its own when its profile
  identifies one (a website, a URL name, an industry, a display name or a Google Ads ID). A tab of
  notes alone ("Meeting notes") does not.
- **Not accounts:** General / All accounts / Agency / Common / Overall / Global / All clients (shared
  notes), and tabs starting with Sample, Example, Template, How to, Readme, Instructions, Guide or
  Archive. A second tab about an account another tab already holds is ignored.
- **Order:** by spend; accounts with no Google Ads follow, by name. `Status: hidden` in a profile
  takes an account out of the lists; its address still works for staff.

### The profile (`tracker/client_profile.py`)

One fact per line at the top of the account's tab, or a two-column table. Field names are matched
loosely ("Brand colors" or "Colours", "KPIs" or "Goals / KPIs"; bold is fine). The profile stops at
a line or heading called Notes, Log, Updates or History, so a dated note further down never
overwrites it. The first time a fact is given wins.

```
PROFILE
Display name: Lumina Smiles Dental
URL name: lumina
Google Ads ID: 412-118-3390
Website: https://luminasmiles.in
Industry: Dental clinic chain
Locations: Pune, Mumbai, Nashik
Services: Dental implants, Invisalign, Smile makeovers
Competitors: smilecare.in, Clove Dental (clovedental.in)
Audience: Adults 28-55 considering implants or aligners
Goals / KPIs: 120 qualified leads a month under ₹600 each
Brand colours: #0B5FFF, #FFB800
Brand fonts: Poppins, Lora
Tone of voice: Warm, reassuring, never clinical
Instagram: @luminasmiles
Facebook: facebook.com/luminasmiles
LinkedIn:
YouTube:
Account manager: Priya Nair

NOTES (newest last)
2026-09-12  The client wants more weekday leads...
```

An account with no profile shows this block on its home, filled in with what is already known
(name, URL name, Google Ads ID), with a Copy button.

### URL names (`tracker/client_accounts_store.py`)

- The profile's `URL name`, else the account's name, made URL-safe ("AA_New" → `aa-new`).
- Each account has a key that survives renames: `cid:` and its lowest customer ID, else `doc:` and
  its tab's name. An account that gains Google Ads keeps its row (and so its URL).
- When an account's URL name changes, the old one is retired to it and redirects (301; 308 for a
  POST). **A slug is never given to a different client**, even after the first one is gone.
- An account can never take a first path segment the app uses (every route, the client portals,
  and words such as `api`, `admin`, `login`); such a name gets `-account` added. A name another
  account holds gets `-2`, `-3`... for a new account.
- Tables: `client_accounts` (key, slug, name) and `client_account_old_slugs` (slug → key), on
  Postgres; in memory without `DATABASE_URL`. Slugs are worked out under an advisory lock so two
  web workers can never give one slug twice.

### Routes (`app.py`, section "Client accounts")

| Path | What |
|---|---|
| `/<account>` | The account's home: the switch as its title, Google Ads in the last 30 days, its pages, its profile |
| `/<account>/google-ads` | The Google Ads dashboard with only this account's rows; the title switches account |
| `/<account>/google-ads/ai-review` | The AI review, on this account |
| `/<account>/api/google-ads/insights`, `/refresh` | The dashboard's data, scoped to the account |
| `/api/accounts` | The picker's list (staff) |

- `/<acct:slug>` is a converter that matches only a listed account's URL name (or an old one), so
  every other address is the same 404 it always was and no route is shadowed.
- An account's Google Ads rows are cut down in `app.py`; its insights are scoped in
  `google_ads_insights.view(only=...)`, which also drops the About rows that describe other
  accounts and the budget flags of other accounts' campaigns. The page cannot ask its way out:
  `account=` from the browser applies inside the scope only.
- The list is cached for 60 seconds; a stale list is served at once and rebuilt in the background,
  so no page waits on Google for it. Relinking the master doc rebuilds it.

### The switch

- **Every top bar** (`templates/_bento.html`): the account this page is for, or "All accounts". It
  replaces the "Workspace" crumb, and on phones it takes its own row.
- **The hub's headline** is the switch, as on the Google Ads dashboard ("Working on / All
  accounts"), and the hub lists every account as a card: spend, conversions, a 30-day line, and
  the week-on-week change.
- **The picker** (`static/js/account-picker.js`): search by name, website, industry or city;
  recent accounts first; the current account's own pages as chips; arrow keys, Enter, Esc. Picking
  an account from a page that has an account version (the Google Ads dashboard, the AI review)
  opens the same page for that account. The command palette (Ctrl+K) lists the accounts too.
- **Smooth:** rows are real links. Hovering one lets the browser prerender the account
  (speculation rules), so it opens at once. Between pages the top bar holds still and the account's
  name and mark travel from the row or card into the next page's title (cross-document view
  transitions; browsers without them just navigate). Everything respects reduced motion.

## Phase B: client access

### Inviting (`tracker/client_access.py`, `tracker/client_accounts_store.py`)

- On an account's home, **Share** (admins; other staff see the same panel read-only as "Who can
  see this") opens a dialog:
  - **invite** an email (`ana@lumina.in`) or a whole company domain (`@lumina.in`);
  - **remove** someone, effective on their next click;
  - choose **what they see**;
  - **copy the link**;
  - see the **history** (who invited, removed or changed a share, and when).
- Nothing is emailed: the admin sends the link. The client signs in with Google as the invited
  address.
- Refused:
  - a domain anyone can sign up to (gmail.com, outlook.com, yahoo.com and about 40 more), since
    inviting it would let anyone in;
  - the agency's own domain, whose people are staff already;
  - anything that is not an email or a domain.
- Every change is a POST that needs an admin and the page's own `X-Requested-With: fetch` header.
- Tables (Postgres; in memory without `DATABASE_URL`):
  - `client_account_access` (key, who);
  - `client_account_shares` (key, shares);
  - `client_account_audit`.
- Invites follow the account's key, so they survive a rename or the account gaining Google Ads.

### What a client sees

| Share | Default | Opens |
|---|---|---|
| Google Ads dashboard | on | the four blocks on the home, the campaign card, `/<account>/google-ads` and its insights |
| AI review | off | the latest **finished** review, read-only (`/<account>/google-ads/ai-review`): no brief, no doc, no run button, no cost, no names |
| Profile from the master doc | off | the profile on the home (website, goals, audience, competitors, brand); never the notes |

- The account's **home** is always open to an invited client. A page that is not shared leads back
  to it.
- **Only their own account.** Any other account's page is a 403 that names nothing about it and
  links to the accounts they do have. Its APIs answer 403. The all-accounts pages and the hub stay
  staff-only. The picker data and `/api/accounts` hold only their accounts. Insights are scoped on
  the server whatever the page asks for.
- **Nothing internal:**
  - The top bar has no "Jump to" (the command palette is not even loaded) and no internal menu
    (only Sign out). The brand leads to their account.
  - With one account, the switch is just its name. With several, the switch lists only theirs,
    with no "All accounts".
  - The home has no master doc link, no customer ID, no profile template, no Share button and no
    "Internal use only".
  - The dashboard has no Refresh (re-reading the sheet is staff only), no link to an unshared AI
    review, and no setup notes.
- **Landing:** after signing in, or opening `/`, an invited client goes to their first account. A
  shared link takes them straight to that page.
- `tests/test_account_clients.py` covers each of these: by URL, by API, through the picker data,
  through the insights filters, after removal, and by domain.

## Phase C: Page Watch and Video Studio inside an account (staff)

- **`/<account>/page-watch`** is Page Watch for the account:
  - It shows only the watches filed under it (their "client" is the account's name or one of its
    Google Ads names), and files new ones there.
  - It offers the account's own site and its competitors' sites from the master doc as one-tap
    watches. A site already watched is not offered again.
  - A watch and its changes open inside the account (`/<account>/page-watch/watches/<id>`,
    `/changes/<id>`). One filed under another client opens on the global page.
- **`/<account>/video-studio`** is Video Studio for the account:
  - The client is fixed to the account and the website is filled in from the profile.
  - The brand comes from the profile, until a brand is saved for the client:
    - the first brand colour is the accent;
    - the darkest colour that reads on white is the text;
    - the fonts are used when Video Studio bundles them.
  - The example brief is written from the profile's services, city and tone.
  - The library shows the account's videos, which open inside the account. Videos stay their
    maker's own, as everywhere in Video Studio.
- **The account's home** shows both tools as cards (pages watched, the last change; videos made and
  ready). They are staff only: an invited client never sees them, and their URLs lead a client back
  to the home.
- The picker knows both pages. On the global Page Watch or Video Studio, picking an account opens
  that account's.

## Phase D: the SEO & AEO tools and the agents, filled in from the profile (staff)

- **The account's home** has a "Run for <account>" section listing every tool and agent below, each
  with what it will be given (for example "dental implants pune" or "Dental clinic · Pune"). Nothing
  runs until the person presses the tool's own button.
- **`/<account>/seo-aeo/<tool>`** embeds the SEO Studio tool with the account's details in its address:

  | Tool | Given |
  |---|---|
  | SEO & GEO Audit, SEO & GEO Snapshot, On-Page SEO Audit, Agent Readiness Audit, Image Alt Tag Audit | `pf_url`: the website |
  | Keyword Research, Content Research | `pf_keyword`: the first service and the first city ("dental implants pune"), else the industry |
  | Content Architect | `pf_domain` |
  | Market Potential | `pf_service`, `pf_domain` |

  `seo-apps/client/src/lib/prefill.js` reads them once, when a form first draws, and the person can
  change them. The studio's pass handling removes only `st` from the address, so they survive.
  Every other tool opens inside the account without values. As the studio moves between tools,
  the address stays under `/<account>/seo-aeo`.
- **`/<account>/agents/<agent>`** renders the agent's own page, unchanged, with the account in the
  top bar. `static/js/account-prefill.js` then fills its empty fields from the profile (as if
  typed, so the page's own checks run) and says so:

  | Agent | Fields |
  |---|---|
  | Social Media Intelligence | company name, website |
  | Local Business Radar | business type (industry), place (first city) |
  | Event & Conference Intelligence | client name, website, verticals (industry), geography (cities) |
  | Contact Finder | company domain |
  | Thought Leader Intelligence | company |

  The profile's values reach the page as JSON with `</` escaped, so a value cannot close the script.
- **From a global tool or agent page**, picking an account opens the same tool or agent for it.
- **Not prefilled:** the dashboards that are not per client (ABM Signal Tracker, Job Change Alert,
  LinkedIn Intelligence, Anonymous Visitors, Slot Checker) and Competitor Ad Intelligence (its own
  React app). They still open from the switch and work across accounts as before.
