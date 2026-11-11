# The Warmly engine: the daily routine's runbook

A scheduled Claude Code task runs this once a day, at 06:47 India time, in a fresh cloud session of this
repository with the **Warmly** connector. It reads Warmly through that connector and sends what it finds to
Lead Finder. Lead Finder's next daily run (an hour before its Slack time, 09:00 India time by default) reads
each row like a post:

1. Claude scores the row against the offers the workspace has on: Markify Digital, Outcomes Digital,
   Partners: agencies and Partners: consultants.
2. Claude writes the message.
3. The lead goes to the Google Sheet and to Slack.

The team then does the outreach from Lead Finder.

Follow these steps in order. Do not commit, push or open anything on GitHub. Do not edit files in the
repository. Write the one data file to the scratchpad directory.

## 1. Read today's budget

```
python3 scripts/warmly_push.py budget
```

It answers:

- `budget`: the month's Warmly credits for this engine (1,000 unless the service says otherwise).
- `used`: what the engine has spent this month.
- `today`: what it may spend today. This is the budget left, shared over the days left in the month.

If it answers 404 or a `hint`, stop. Reply with the hint: the environment's network secret is missing or
wrong, and nothing can be sent.

Then call the Warmly tool `get_credits_remaining` and note `creditsRemaining`.

## 2. Read who visited (free)

Call each with `timeWindow: "past_week"` and `take: 200`:

- `list_warm_visitors`
- `list_warm_accounts`

Keep only rows whose `lastSeen` is in the last 48 hours. Older ones were sent before, and the site counts
them as repeats. Copy the kept rows exactly as Warmly gave them, every field: never shorten, merge or
invent one.

Warmly lists the team too (markifydigital.com and the like). Send them anyway: the site drops its own
people.

## 3. Read buying signals (costs credits; only if the tool exists)

Look at your tools.

- **If there is no Warmly tool named `list_third_party_signals`**, skip this step. Say so in the reply
  ("buying signals: the connector does not offer list_third_party_signals").
- **If there is one**, run the plays below in order, while today's allowance lasts. Each play:
  1. Call it with `"preview": true` first. This is free, and its answer has `total`.
  2. If `total` is 0, or the preview errors (for example an unknown subtype), skip the play and note why.
  3. Otherwise call it again without `preview`, with `take` = the smaller of the play's `take` and half the
     allowance left (each row can cost 2 credits: 1 for a new company, 1 for a new contact).
  4. Add the answer's `creditsConsumed` to your running total. Stop the plays when the total reaches
     today's allowance.

Every play uses `mode: "by_signal"` and `detectedSince` = three days before today (re-reading a row the
same month costs nothing).

| # | Play | signalType | signalSubtype | take | Who it is for |
|---|------|------------|---------------|------|---------------|
| 1 | Job changes | `workmilestone` | `jobChange` | 12 | People who just went independent (consultant partners), new marketing heads (Markify, Outcomes), new heads of paid media at agencies (agency partners) |
| 2 | LinkedIn posts | `linkedin-post-contact` | `linkedinPost` | 10 | People asking for an agency, a white-label partner or a freelancer |
| 3 | Promotions | `workmilestone` | `promotion` | 6 | Newly promoted marketing and growth heads |
| 4 | Company news | `news` | *(none)* | 8 | Funding, launches and expansions at brands, schools and developers |
| 5 | Agencies hiring | `hiring-trends` | `hiringMarketingRoles` | 6 | Agencies short of paid media people (agency partners). The script drops brands that are hiring, because the team wants no "hiring for it" leads |

Warmly's signal tool has no industry, country or size filter. Every row is paid for, and Lead Finder's
judge drops the ones that fit no offer. Keep the takes small.

## 4. Send them

Write one JSON file to the scratchpad directory, `warmly-found.json`:

```json
{"visitors": [ ...rows... ], "accounts": [ ...rows... ], "signals": [ ...rows... ]}
```

Each list holds the rows exactly as Warmly gave them. An empty list is fine. Then run:

```
python3 scripts/warmly_push.py push <scratchpad>/warmly-found.json --credits <total creditsConsumed>
```

`--credits` is the sum of `creditsConsumed` from step 3, or 0. The site books it against the month's
budget, and it shows in the admin panel as "Lead Finder (Warmly)".

## 5. Reply

End with one short summary:

- rows read by kind;
- rows kept by the site, and repeats;
- credits spent today, and the month's total against the budget;
- Warmly's `creditsRemaining`;
- each play skipped, and why.

Never include a person's email address in the reply.

## Why it is built this way

- **The connector lives in Claude, not on the server.** Warmly's MCP server is connected to the team's
  Claude account, and there is no Warmly API key on the service. So a scheduled Claude session does the
  reading, and the site does the rest.
- **The token is never written down.** The site knows the workspace by its Warmly token. That token is a
  network secret on the cloud environment ("new-agentic-platform"): the session's proxy adds it to every
  request to the site as `X-Warmly-Push-Token`, so it is never in this file, the task's prompt, a log or
  the repository.
- **Visitors only come from pages that run Warmly's script.** On this platform that means the pages in
  `WARMLY_PIXEL_PATHS` (default `/partners`), once `WARMLY_CLIENT_ID` is set in Railway. On
  markifydigital.com and outcomes.digital it means the script in each site's header. Each identified
  visitor costs Warmly up to 2 credits a month, taken by Warmly itself.
- **The plays are a starting point.** They follow Warmly's published signal catalogue, but this
  organisation's connector did not offer `list_third_party_signals` when the engine was built (2026-11-11).
  When the tool appears, the first runs should be checked: which plays bring leads Lead Finder keeps, and
  what each costs. Then change the takes here.
