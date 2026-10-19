"""Every paid marketing agent is tagged Live, 2026-10-19 (the owner, once Google Ads was connected).

The cards on /operational-agents and the pill on each agent's own page said Building; they say Live now.
The SEO tools on the same page are still Building, and the page's hero counts the two apart.
"""
import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tracker import paid_catalog  # noqa: E402


@pytest.fixture
def client():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    return c


def _cards(body, group):
    return [c for c in re.findall(r'<a href="/operational-agents/[^"]+" id="t-[^"]+" class="sa-card".*?</a>', body, re.S)
            if ('data-group="paid-marketing"' in c) == (group == "paid")]


def test_every_paid_card_is_live_and_every_seo_tool_still_building(client):
    body = client.get("/operational-agents").get_data(as_text=True)
    paid, seo = _cards(body, "paid"), _cards(body, "seo")
    assert len(paid) == len(paid_catalog.AGENTS) and seo
    for card in paid:
        assert 'data-badge="live"' in card and '<span class="sa-state sa-state--live"><i></i>Live</span>' in card
        assert "Building" not in card and "sa-state--build" not in card
    for card in seo:
        assert 'data-badge="building"' in card and ">Building<" in card


def test_the_hero_counts_live_and_in_build_apart(client):
    body = client.get("/operational-agents").get_data(as_text=True)
    top = body.split('class="sa-hero-top"', 1)[1].split("</div>", 1)[0]
    assert '<span class="sa-live"><i></i>%d live</span>' % len(paid_catalog.AGENTS) in top
    assert '<span class="sa-live sa-live--build"><i></i>%d in build</span>' % len(appmod._seo_tools()) in top


@pytest.mark.parametrize("slug", [a["slug"] for a in paid_catalog.AGENTS])
def test_every_paid_agent_page_says_live(client, slug):
    body = client.get(paid_catalog.path(slug)).get_data(as_text=True)
    hero = body.split('class="sa-hero-top"', 1)[1].split("</div>", 1)[0]
    assert '<span class="pmx-pill pmx-pill--live"><i></i>Live</span>' in hero and "Building" not in hero


def test_the_live_pill_has_its_style_and_the_stylesheet_url_changed():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    css = open(os.path.join(root, "static/css/paid_marketing.css")).read()
    assert ".pmx-pill--live{" in css and ".pmx-pill--live i{" in css
    assert "paid_marketing.css?v=7" in open(os.path.join(root, "templates/_paid_base.html")).read()
