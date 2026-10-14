# Working in this repo

## Every new agent goes into every client account

When you build a new agent (a card on `templates/b2b_agents.html`), make it open inside every client
account, for the whole team and for the clients an account shares it with. The steps are in
`docs/account-memory-plan.md`, under "Every agent in every account":

- Add it to `ACCT_AGENTS` in `app.py`.
- Save its runs to the account's space.
- Add its client routes and run routes.
- Give it a History reader.

`tests/test_account_agents_all.py` fails until this is done. Use `ACCT_AGENTS_EXEMPT` only for an agent
that genuinely is not about one client, and give the reason.

## Every agent that spends money goes into the admin panel

The admin panel (`/admin`) shows what each agent costs, by workspace, agent and person. It reads each
agent's own cost ledger in `tracker/admin_spend.py`. When you build an agent that pays for anything
(model calls, Apify, maps, an API), record its cost in a table that has who ran it and its space, and add
one entry to `SOURCES` there. `tests/test_admin_spend.py` seeds every ledger through its own store, so a
renamed column fails it.

