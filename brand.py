"""Single source of truth for everything user-facing that names the product.

The platform is being stood up under a new brand. Rather than scatter the name
across 45 templates (which is exactly how the previous codebase ended up with
281 hard-coded occurrences of its own name), every user-visible string that
refers to the product lives here and reaches templates as `brand.*` via the
context processor in app.py.

Changing the company name is therefore a one-file edit. Route paths, URL
prefixes and Python identifiers are deliberately NOT part of this: they stay on
their existing values so the backend and its tests are untouched.
"""

BRAND = {
    # ── identity ────────────────────────────────────────────────────────────
    # Placeholder until the sister company's name is confirmed. Replace the
    # three values below and the whole product renames itself.
    "name": "Northaxis",
    "short": "Northaxis",
    "domain": "northaxis.com",

    # ── product vocabulary ──────────────────────────────────────────────────
    # Deliberately different words from the source platform's, so the two
    # products do not share terminology even where they share routes.
    #   old "Intelligence by Position²"  ->  product
    #   old "Intelligence Hub"           ->  hub
    #   old "Strategic Agents"           ->  agents_plural
    #   old "Platform Playbook"          ->  handbook
    #   old "VIMI"                       ->  assistant
    "product": "Northaxis Revenue Intelligence",
    "tagline": "Know which accounts are ready to buy.",
    "hub": "Workspace",
    "agents_plural": "Agents",
    "agent_singular": "Agent",
    "handbook": "Field Guide",
    "assistant": "Atlas",

    # ── auth ────────────────────────────────────────────────────────────────
    # Mirrors the server-side gate; shown to a user who is refused access.
    # Who to ask when a page refuses you. Named here rather than typed into
    # the 403 template, where it sat as a bare first name that meant nothing to
    # anyone who had not met them.
    "support": "your platform admin",
    "access_note": "Access is limited to @northaxis.com accounts.",
}


def brand_context():
    """Context-processor payload. Exposed to every template as `brand`."""
    return {"brand": BRAND}
