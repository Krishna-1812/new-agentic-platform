"""The Industries pages are live, linked, and lead with Healthcare, Real Estate and Education."""
import html as _html
import re

import pytest

import app as app_module
from tests.test_public_copy_rewrite import POSITION2_LINES

FOCUS = ["healthcare", "real-estate", "education"]
INDUSTRIES = app_module.INDUSTRIES


@pytest.fixture()
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _text(resp):
    html = resp.get_data(as_text=True)
    html = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", html)
    return _html.unescape(re.sub(r"<[^>]+>", " ", html))


def _all_paths():
    out = ["/industries"]
    for ind in INDUSTRIES:
        out.append("/industries/" + ind["slug"])
        out += ["/industries/%s/agents/%s" % (ind["slug"], a["slug"]) for a in ind["agents"] if a.get("slug")]
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


@pytest.mark.parametrize("path", ["/", "/agents", "/platform", "/signals", "/industries"])
def test_industries_is_linked_from_nav_menu_and_footer(client, path):
    html = client.get(path).get_data(as_text=True)
    assert 'class="nv-link' in html and 'href="/industries">Industries</a>' in html
    assert '<span class="idx">06</span>Industries</a>' in html
    for slug in FOCUS:
        assert 'href="/industries/%s"' % slug in html


def test_focus_pages_use_their_own_headings(client):
    re_body = _text(client.get("/industries/real-estate"))
    assert "Buyers tour forty homes online" in re_body
    assert "Why good property leads" in re_body and "to site visit." in re_body
    assert "Run it on your projects." in re_body
    ed = _text(client.get("/industries/education"))
    assert "Applicants decide" in ed and "to first day of term." in ed
    hc = _text(client.get("/industries/healthcare"))
    assert "Patients pick a clinic" in hc and "Why selling into" not in hc


def test_industry_agent_outcomes_render(client):
    body = _text(client.get("/industries/education/agents/applicant-intent-radar"))
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
