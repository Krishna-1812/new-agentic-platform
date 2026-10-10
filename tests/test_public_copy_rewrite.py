"""The public site's copy is Northaxis's own.

Until this rewrite most of the pre-login site read word for word like
intelligence.position2.com, the platform it was imported from. These tests pin
the new wording in place and fail loudly if any of Position2's distinctive
lines come back, on any public page.
"""
import html as _html
import re

import pytest

import app as app_module

PUBLIC_PAGES = ["/", "/agents", "/agents/signal-tracker", "/platform", "/signals", "/solutions",
                "/why-intelligence", "/integrations", "/resources", "/industries", "/login",
                "/login-preview"]

# Lines that were copied from intelligence.position2.com. None may reappear.
POSITION2_LINES = [
    "raise a hand",
    "Meet the agents",
    "never sleep",
    "intelligence layer",
    "Watch a signal become",
    "Fresh capital, fresh budget",
    "A new leader, a new agenda",
    "own the number",
    "move pipeline",
    "Get sharper on",
    "Works inside the stack",
    "We do not just",
    "Better together",
    "Recovers 95%",
    "Always-on monitoring for your target-account universe",
    "Turn silent website traffic into named accounts",
    "Agents that work as",
    "A team of agents",
]


@pytest.fixture()
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _text(resp):
    html = resp.get_data(as_text=True)
    html = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)\{#.*?#\}", " ", html)
    return _html.unescape(re.sub(r"<[^>]+>", " ", html))


@pytest.mark.parametrize("path", PUBLIC_PAGES)
def test_no_position2_copy_on_public_pages(client, path):
    resp = client.get(path)
    assert resp.status_code == 200, path
    body = _text(resp)
    for line in POSITION2_LINES:
        assert line.lower() not in body.lower(), f"{path} still says {line!r}"


def test_home_leads_with_the_new_headline(client):
    body = _text(client.get("/"))
    assert "Every deal starts" in body and "weeks before" in body
    assert "the first email." in body
    assert "Buyers leave" not in body
    assert "One of those is a rumour. Three in a fortnight is a bearing." in body


def test_platform_formula_is_readable(client):
    html = client.get("/platform").get_data(as_text=True)
    # The formula line used to be garbled ("type type × severity ... intent</span>times; ...").
    assert "type &times; severity &times; recency<br>+ stacking = <span class=\"mk\">intent</span>" in html
    assert "</span>times;" not in html


def test_every_signal_has_its_own_words():
    sigs = app_module.SIGNALS
    assert len(sigs) == 26
    assert len({s["tagline"] for s in sigs}) == 26
    assert len({s["blurb"] for s in sigs}) == 26
    assert all(s["blurb"].endswith(".") for s in sigs)


def test_agent_copy_is_complete_and_distinct():
    agents = app_module.AGENTS
    for field in ("summary", "benefit", "how", "who", "role", "metric"):
        values = [a[field] for a in agents]
        assert all(v.strip() for v in values), field
        assert len(set(values)) == len(values), f"duplicate {field}"
    # The unverified "95%+ of lost visitors" claim is gone from the agent copy.
    assert not any("95%" in a[f] for a in agents for f in ("summary", "benefit", "metric"))


def test_login_pages_use_the_new_voice(client):
    assert "Same button. We’ll set you up automatically." in _text(client.get("/login"))
    preview = _text(client.get("/login-preview"))
    assert "Timing beats" in preview
    assert "Three is a bearing." in preview


def test_brand_tagline_is_new():
    assert app_module.BRAND["tagline"] == "Find the accounts already moving."
