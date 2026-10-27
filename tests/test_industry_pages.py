"""The Industries pages are live, linked, and lead with Healthcare, Real Estate and Education.

Since the October 2026 rebuild these pages belong to the previous site, kept at /old-site; the new
site has its own industry pages at /industries (site_pages.INDUSTRIES)."""
import html as _html
import re

import pytest

import app as app_module
from tests.test_public_copy_rewrite import POSITION2_LINES

FOCUS = ["healthcare", "real-estate", "education"]
INDUSTRIES = app_module.INDUSTRIES
OLD = "/old-site"


@pytest.fixture()
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _text(resp):
    html = resp.get_data(as_text=True)
    html = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", html)
    return _html.unescape(re.sub(r"<[^>]+>", " ", html))


def _all_paths():
    out = [OLD + "/industries"]
    for ind in INDUSTRIES:
        out.append(OLD + "/industries/" + ind["slug"])
        out += [OLD + "/industries/%s/agents/%s" % (ind["slug"], a["slug"]) for a in ind["agents"] if a.get("slug")]
    return out


def test_focus_industries_lead_the_list():
    assert [i["slug"] for i in INDUSTRIES[:3]] == FOCUS
    assert [i["slug"] for i in INDUSTRIES if i["featured"]] == FOCUS


def test_every_focus_agent_has_a_full_detail_page():
    for slug in FOCUS:
        ind = app_module.INDUSTRIES_BY_SLUG[slug]
        assert len(ind["agents"]) >= 5
        for a in ind["agents"]:
            for f in ("slug", "name", "base", "role", "metric", "icon", "use", "summary",
                      "benefit", "how", "who", "connects", "out"):
                assert a.get(f), (slug, a.get("name"), f)
            assert all(o["t"] and o["s"] for o in a["out"])


@pytest.mark.parametrize("path", _all_paths())
def test_every_industry_page_is_live_and_in_its_own_words(client, path):
    resp = client.get(path)
    assert resp.status_code == 200, path
    body = _text(resp).lower()
    for line in POSITION2_LINES + ["95%"]:
        assert line.lower() not in body, f"{path} still says {line!r}"


@pytest.mark.parametrize("path", [OLD, OLD + "/agents", OLD + "/platform", OLD + "/signals", OLD + "/industries"])
def test_industries_is_linked_from_nav_menu_and_footer(client, path):
    html = client.get(path).get_data(as_text=True)
    assert 'class="nv-link' in html and 'href="/old-site/industries">Industries</a>' in html
    assert '<span class="idx">06</span>Industries</a>' in html
    for slug in FOCUS:
        assert 'href="/old-site/industries/%s"' % slug in html


def test_the_old_industry_addresses_still_reach_the_old_pages(client):
    """/industries and the industries the new site has open new pages (tests/test_new_site.py); an
    industry only the old site had, and every old per-industry agent page, open at /old-site."""
    for path in ("/industries/health-tech", "/industries/education/agents/applicant-intent-radar"):
        r = client.get(path)
        assert r.status_code == 302 and r.headers["Location"].endswith(OLD + path), path


def test_focus_pages_use_their_own_headings(client):
    re_body = _text(client.get(OLD + "/industries/real-estate"))
    assert "Buyers tour forty homes online" in re_body
    assert "Why good property leads" in re_body and "to site visit." in re_body
    assert "Run it on your projects." in re_body
    ed = _text(client.get(OLD + "/industries/education"))
    assert "Applicants decide" in ed and "to first day of term." in ed
    hc = _text(client.get(OLD + "/industries/healthcare"))
    assert "Patients pick a clinic" in hc and "Why selling into" not in hc


def test_industry_agent_outcomes_render(client):
    body = _text(client.get(OLD + "/industries/education/agents/applicant-intent-radar"))
    assert "Applicants ranked by intent" in body
    assert "Closest to applying at the top." in body


def test_agent_count_stat_matches_agents():
    for ind in INDUSTRIES:
        assert ind["stats"][-1]["v"] == str(len(ind["agents"]))


def test_robots_allows_industries(client):
    assert "Allow: /industries" in client.get("/robots.txt").get_data(as_text=True)


def test_static_build_includes_new_industries():
    import os
    root = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs", "industries")
    for slug in FOCUS:
        assert os.path.exists(os.path.join(root, slug, "index.html")), slug
