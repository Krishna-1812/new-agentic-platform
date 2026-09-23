# docs/

Two unrelated things share this folder, because GitHub Pages only offers the
repository root or `/docs` as a publishing source and there is no third choice.

## The published site (generated — do not hand-edit)

`index.html`, `agents/`, `platform/`, `signals/`, `solutions/`,
`why-intelligence/`, `integrations/`, `resources/`, `privacy/`, `terms/`,
`login/`, `login-preview/`, `industries/`, `static/`, `favicon.svg`,
`.nojekyll`

A static pre-render of the public marketing site, produced by

    python3 tools/build_static_site.py

Every file above is overwritten by that command. Change
`templates/agents.html`, `templates/login_preview.html` or
`static/css/press.css` and re-run it; nothing rebuilds on its own.

GitHub Pages serves files and runs nothing, so sign-up, the contact form and
Google sign-in are inert in the build. A banner at the foot of every page says
so, and the script that produces it lives in the builder, not in the
application's own templates — the app is not aware this build exists.

The site is served from a subdirectory (`/new-agentic-platform/`), which is
baked into every absolute path at build time. If it ever moves to a custom
domain, rebuild with `--prefix ''`.

## The planning documents (hand-written)

`CONTEXT_FOR_NEW_CHAT_V30.md`, `TRACKER_PROMPT.md`,
`event-intelligence-*.md`

These predate the site build, are not part of it, and share no URL with any
page it generates. They are readable at `/new-agentic-platform/<name>.md`,
which is no wider than they already are: this repository is public.
