"""The app's own daily ceiling on Google Ads requests. On 2026-10-19 the Cloud project moved from Explorer access (2,880
operations a day; the app stopped at 2,400) to Basic access (15,000 a day; the app stopped at 12,000, then 14,000). Google
then turned down Standard access until the app regularly reaches 15,000, so the owner removed the ceiling: Google's own quota
error is the stop. GOOGLE_ADS_DAILY_LIMIT on Railway sets one again."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import paid_gads as g  # noqa: E402


class Store:
    def __init__(self, n):
        self.n = n

    def bump_gads_calls(self, day):
        self.n += 1
        return self.n


def test_there_is_no_ceiling_by_default(monkeypatch):
    monkeypatch.delenv("GOOGLE_ADS_DAILY_LIMIT", raising=False)
    assert g._daily_limit() is None


@pytest.mark.parametrize("raw,want", [("40000", 40000), (" 9000 ", 9000)])
def test_railway_can_set_one(monkeypatch, raw, want):
    monkeypatch.setenv("GOOGLE_ADS_DAILY_LIMIT", raw)
    assert g._daily_limit() == want


@pytest.mark.parametrize("raw", ["", "0", "-5", "lots", "1.5", "12,000"])
def test_a_value_that_is_not_a_positive_whole_number_is_ignored(monkeypatch, raw):
    monkeypatch.setenv("GOOGLE_ADS_DAILY_LIMIT", raw)
    assert g._daily_limit() is None


def test_without_a_ceiling_requests_go_past_googles_allowance_and_are_still_counted(monkeypatch):
    monkeypatch.setattr(g, "DAILY_LIMIT", None)
    s = Store(g.GOOGLE_DAILY_OPS + 500)
    g._count_call(s)
    assert s.n == g.GOOGLE_DAILY_OPS + 501


def test_a_ceiling_refuses_past_it_and_says_the_number(monkeypatch):
    monkeypatch.setattr(g, "DAILY_LIMIT", 14000)
    g._count_call(Store(13999))
    with pytest.raises(g.OverQuota) as e:
        g._count_call(Store(14000))
    assert "14000" in str(e.value)


def test_admins_are_warned_against_googles_allowance_without_a_ceiling():
    assert g.GOOGLE_DAILY_OPS == 15000
