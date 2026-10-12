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
