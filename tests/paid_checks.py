"""Shared checks for the Paid Marketing agents' page tests (docs/paid-marketing-plan.md).

The source platform's tests checked a route by finding its literal path in app.py and an agent's listing on
its own section page; here a route is a rule in the app's URL map, and an agent is listed in
tracker/paid_catalog.py, as a card on the Operational Agents page and in every client workspace.
"""
import app as appmod

PREFIX = "/strategic-agents/paid-marketing"


def rules():
    return {r.rule for r in appmod.app.url_map.iter_rules()}


def assert_routes(*paths):
    """Each path (after the prefix, e.g. "/api/gads/products") is a route the app serves."""
    have = rules()
    missing = [p for p in paths if PREFIX + p not in have]
    assert not missing, "routes the page script reads that the app does not serve: %s" % missing


def assert_listed(slug, name):
    """The agent is in the catalog, has its card in the Operational Agents page's Paid marketing group, and
    opens in every client workspace."""
    from tracker import paid_catalog
    assert paid_catalog.NAMES.get(slug) == name, slug
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "kris@markifydigital.com", "name": "K"}
    page = c.get("/seo-aeo").get_data(as_text=True)
    assert 'href="%s/%s" id="t-%s" class="sa-card"' % (PREFIX, slug, slug) in page, slug
    assert (slug, paid_catalog.BY_SLUG[slug]["endpoint"], PREFIX + "/" + slug) in [a[:3] for a in appmod.ACCT_AGENTS], slug
