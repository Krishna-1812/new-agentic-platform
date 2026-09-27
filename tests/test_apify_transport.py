"""Tests for tracker/apify_transport.py: uses mocked HTTP responses. No live
network calls, no real Apify token."""

import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import apify_transport  # noqa: E402


def _resp(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status.return_value = None
    return mock


@patch("tracker.apify_transport.requests.get")
@patch("tracker.apify_transport.requests.post")
def test_run_actor_and_wait_returns_dataset_items_on_success(mock_post, mock_get):
    mock_post.return_value = _resp({"data": {"id": "run1"}})
    mock_get.side_effect = [
        _resp({"data": {"status": "SUCCEEDED", "defaultDatasetId": "ds1"}}),
        _resp([{"id": "post1"}, {"id": "post2"}]),
    ]
    items = apify_transport.run_actor_and_wait("some/actor", {"foo": "bar"}, "tok",
                                               poll_interval=0)
    assert items == [{"id": "post1"}, {"id": "post2"}]


@patch("tracker.apify_transport.requests.get")
@patch("tracker.apify_transport.requests.post")
def test_run_actor_and_wait_polls_until_finished(mock_post, mock_get):
    mock_post.return_value = _resp({"data": {"id": "run1"}})
    mock_get.side_effect = [
        _resp({"data": {"status": "RUNNING"}}),
        _resp({"data": {"status": "RUNNING"}}),
        _resp({"data": {"status": "SUCCEEDED", "defaultDatasetId": "ds1"}}),
        _resp([{"id": "post1"}]),
    ]
    items = apify_transport.run_actor_and_wait("some/actor", {}, "tok", poll_interval=0)
    assert items == [{"id": "post1"}]
    assert mock_get.call_count == 4


@patch("tracker.apify_transport.requests.get")
@patch("tracker.apify_transport.requests.post")
def test_run_actor_and_wait_swallows_failure_to_empty_list_by_default(mock_post, mock_get):
    mock_post.side_effect = Exception("network exploded")
    items = apify_transport.run_actor_and_wait("some/actor", {}, "tok")
    assert items == []


@patch("tracker.apify_transport.requests.get")
@patch("tracker.apify_transport.requests.post")
def test_run_actor_and_wait_raises_when_strict(mock_post, mock_get):
    mock_post.return_value = _resp({"data": {"id": "run1"}})
    mock_get.return_value = _resp({"data": {"status": "FAILED"}})
    try:
        apify_transport.run_actor_and_wait("some/actor", {}, "tok", strict=True, poll_interval=0)
        assert False, "expected ApifyTransportError"
    except apify_transport.ApifyTransportError:
        pass


@patch("tracker.apify_transport.requests.get")
@patch("tracker.apify_transport.requests.post")
def test_run_actor_and_wait_raises_on_timeout_when_strict(mock_post, mock_get):
    mock_post.return_value = _resp({"data": {"id": "run1"}})
    mock_get.return_value = _resp({"data": {"status": "RUNNING"}})
    try:
        apify_transport.run_actor_and_wait("some/actor", {}, "tok", strict=True,
                                           timeout=0, poll_interval=0)
        assert False, "expected ApifyTransportError"
    except apify_transport.ApifyTransportError:
        pass


# ── run_actor: a run that keeps what it produced ─────────────────────────────

class _World:
    """requests.get/post stand-ins for one Actor run: statuses in turn, then a dataset."""

    def __init__(self, statuses, items=(), page=None):
        self.statuses = list(statuses)
        self.items = list(items)
        self.page = page
        self.posts = []
        self.gets = []

    def post(self, url, json=None, headers=None, params=None, timeout=None):
        self.posts.append({"url": url, "params": params})
        if url.endswith("/abort"):
            self.statuses = ["ABORTED"]
            return _resp({"data": {"status": "ABORTING"}})
        return _resp({"data": {"id": "run1", "status": "READY", "defaultDatasetId": "ds1"}})

    def get(self, url, headers=None, params=None, timeout=None):
        self.gets.append({"url": url, "params": params})
        if "/datasets/" in url:
            off, lim = params["offset"], params["limit"]
            return _resp(self.items[off:off + lim])
        st = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return _resp({"data": {"id": "run1", "status": st, "defaultDatasetId": "ds1",
                               "chargedEventCounts": {"place-scraped": len(self.items)}}})


def _patch(monkeypatch, world):
    monkeypatch.setattr(apify_transport.requests, "post", world.post)
    monkeypatch.setattr(apify_transport.requests, "get", world.get)
    monkeypatch.setattr(apify_transport.time, "sleep", lambda s: None)


def test_run_actor_tells_apify_the_timeout_and_the_charge_cap(monkeypatch):
    w = _World(["RUNNING", "SUCCEEDED"], items=[{"a": 1}])
    _patch(monkeypatch, w)
    polls = []
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=600, max_charge_usd=3.2, on_poll=polls.append)
    assert items == [{"a": 1}] and run["status"] == "SUCCEEDED"
    assert w.posts[0]["params"] == {"timeout": 600, "maxTotalChargeUsd": "3.20"}
    assert [p["status"] for p in polls] == ["RUNNING", "SUCCEEDED"]


def test_a_cancelled_run_is_aborted_and_keeps_what_it_found(monkeypatch):
    w = _World(["RUNNING"], items=[{"a": 1}, {"a": 2}])
    _patch(monkeypatch, w)
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=600, should_abort=lambda: True)
    assert any(p["url"].endswith("/runs/run1/abort") or p["url"].endswith("/actor-runs/run1/abort") for p in w.posts)
    assert run["status"] == "ABORTED" and len(items) == 2


def test_a_run_past_its_deadline_is_aborted(monkeypatch):
    w = _World(["RUNNING"], items=[{"a": 1}])
    _patch(monkeypatch, w)
    clock = iter(range(0, 10 ** 6, 400))
    monkeypatch.setattr(apify_transport.time, "monotonic", lambda: next(clock))
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=300)
    assert w.posts[-1]["url"].endswith("/abort") and items == [{"a": 1}]


def test_a_failed_run_with_nothing_is_an_error_but_a_timed_out_one_is_not(monkeypatch):
    _patch(monkeypatch, _World(["FAILED"]))
    import pytest
    with pytest.raises(apify_transport.ApifyTransportError):
        apify_transport.run_actor("o/a", {}, "tok", timeout=60)
    _patch(monkeypatch, _World(["TIMED-OUT"], items=[{"a": 1}]))
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=60)
    assert run["status"] == "TIMED-OUT" and items == [{"a": 1}]


def test_a_big_dataset_is_read_a_page_at_a_time(monkeypatch):
    w = _World(["SUCCEEDED"], items=[{"n": i} for i in range(2500)])
    _patch(monkeypatch, w)
    items, _ = apify_transport.run_actor("o/a", {}, "tok", timeout=60)
    assert len(items) == 2500 and [g["params"]["offset"] for g in w.gets if "/datasets/" in g["url"]] == [0, 1000, 2000]


def test_run_actor_reattaches_instead_of_starting_again(monkeypatch):
    w = _World(["SUCCEEDED"], items=[{"a": 1}])
    _patch(monkeypatch, w)
    started = []
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=60, resume_run_id="run1",
                                           on_start=started.append)
    assert items == [{"a": 1}] and w.posts == [] and started == []
    items, run = apify_transport.run_actor("o/a", {}, "tok", timeout=60, on_start=started.append)
    assert started == ["run1"] and len(w.posts) == 1
