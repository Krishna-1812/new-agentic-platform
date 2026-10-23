"""Shared test fixtures for the whole tests/ directory.

Only one thing lives here on purpose: resetting Contact Finder's per-user
rate-limit state between tests. That state is real, in-process, and persists
for the life of the app module -- exactly like it would in a running server.
Many test files reuse the same fake session email across a full-suite run in
one pytest process, so without a reset, tests later in that run start
tripping the very limit meant for a real abusive external caller, not a test
suite. Scoped to just this one dict, not any other in-memory cache: several
others (company-name resolution, employer firmographics) are deliberately
exercised for cross-call persistence WITHIN a single test, and must not be
cleared out from under it.
"""

import os
import sys

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
# Local Business Radar never starts a real browser in tests unless a test
# switches it on (tests/test_lbr_render.py).
os.environ.setdefault("LBR_RENDER", "off")
# ...and prices Apify at the list prices unless a test asks Apify for them
# (tests/test_lbr_apify_pricing.py).
os.environ.setdefault("LBR_APIFY_PRICING", "list")
# Page Watch never calls Claude in tests unless a test switches the judge on
# with a fake client (tests/test_watch_judge.py).
os.environ.setdefault("WATCH_JUDGE", "off")
# ...and never posts to Slack unless a test switches alerts on with a fake
# Slack (tests/test_watch_alerts.py).
os.environ.setdefault("WATCH_ALERTS", "off")
# The Page Watch worker starts no Video Studio renderer (which would install
# HyperFrames with npm) unless a test switches it on (tests/test_video_*.py).
os.environ.setdefault("VIDEO_STUDIO", "off")
# Market Radar reads Wikidata and Wikipedia for a company its own site cannot describe; never in tests
# unless a test passes its own reader (tests/test_market_radar_outside.py).
os.environ.setdefault("MR_OUTSIDE", "off")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import app as appmod


@pytest.fixture(autouse=True)
def _no_house_workspaces(monkeypatch):
    """The account lists the tests build are their own: the agency's always-listed workspace
    (client_accounts.HOUSE) is left out, except in tests/test_house_workspace.py, which puts it back."""
    from tracker import client_accounts
    monkeypatch.setattr(client_accounts, "HOUSE", ())


@pytest.fixture(autouse=True)
def _reset_cpi_rate_limits():
    appmod._CPI_RATE_STATE.clear()
    yield
    appmod._CPI_RATE_STATE.clear()


@pytest.fixture(autouse=True)
def _sign_in_open(request, monkeypatch):
    """Production signs in staff only (app.STAFF_ONLY). The client portals, the accounts shared with clients and
    the public /app area are still in the code for the day sign-in opens again, so their tests run with it open;
    tests/test_staff_only_signin.py checks the switch itself, with it on."""
    if request.module.__name__.rsplit(".", 1)[-1] != "test_staff_only_signin":
        monkeypatch.setattr(appmod, "STAFF_ONLY", False)
