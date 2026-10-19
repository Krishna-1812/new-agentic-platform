"""The app's own daily ceiling on Google Ads requests, 2026-10-19: the Cloud project moved from Explorer access
(2,880 operations a day; the app stopped at 2,400) to Basic access (15,000 a day), so the app now stops at 12,000.
GOOGLE_ADS_DAILY_LIMIT on Railway overrides it (after a move to Standard access, say)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import paid_gads as g  # noqa: E402


def test_the_default_sits_below_basic_access(monkeypatch):
    monkeypatch.delenv("GOOGLE_ADS_DAILY_LIMIT", raising=False)
    assert g._daily_limit() == 12000 < 15000


@pytest.mark.parametrize("raw,want", [("40000", 40000), (" 9000 ", 9000)])
def test_railway_can_set_it(monkeypatch, raw, want):
    monkeypatch.setenv("GOOGLE_ADS_DAILY_LIMIT", raw)
    assert g._daily_limit() == want


@pytest.mark.parametrize("raw", ["", "0", "-5", "lots", "1.5", "12,000"])
def test_a_value_that_is_not_a_positive_whole_number_is_ignored(monkeypatch, raw):
    monkeypatch.setenv("GOOGLE_ADS_DAILY_LIMIT", raw)
    assert g._daily_limit() == 12000


def test_the_tally_refuses_past_the_limit_and_says_the_number():
    class Store:
        def bump_gads_calls(self, day):
            return g.DAILY_LIMIT + 1
    with pytest.raises(g.OverQuota) as e:
        g._count_call(Store())
    assert "{:d}".format(g.DAILY_LIMIT) in str(e.value)
