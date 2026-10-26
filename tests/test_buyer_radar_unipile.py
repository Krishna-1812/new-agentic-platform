"""Lead Finder's search through Unipile (tracker/buyer_radar_unipile.py): a Unipile post read as the same
post Apify would give, page by page up to each search's count, never past the day's limit, stopping at
LinkedIn's first refusal, and the request it sends (tracker/unipile_client.search_posts_filtered)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import buyer_radar_unipile as uni  # noqa: E402
from tracker import unipile_client  # noqa: E402


def post(n, **over):
    """A LinkedIn post as Unipile's Post object has it (postscontroller_getpost)."""
    p = {"provider": "LINKEDIN", "id": "7%018d" % n, "social_id": "urn:li:activity:7%018d" % n,
         "share_url": "https://www.linkedin.com/posts/someone_call-audit-activity-7%018d-abcd?utm_source=x" % n,
         "text": "Looking for an AI solution for call auditing. Vendors welcome.", "date": "2w",
         "parsed_datetime": "2026-09-29T06:32:15.011Z", "reaction_counter": 12, "comment_counter": 4,
         "author": {"public_identifier": "spinder-%d" % n, "id": "ACo%d" % n, "name": "Spinder %d" % n,
                    "is_company": False, "headline": "Head of Sales Ops"}}
    p.update(over)
    return p


class Client:
    """unipile_client as collect uses it: pages of `per_page` posts, each query its own run of numbers."""

    def __init__(self, pages=3, per_page=2, fail_on=None):
        self.calls, self.pages, self.per_page, self.fail_on = [], pages, per_page, fail_on

    def linkedin_account_id(self):
        return "acc1", None

    def describe_error(self, err):
        return err["detail"]

    def search_posts_filtered(self, account_id, keywords, date_posted, sort_by, cursor, limit):
        self.calls.append((keywords, date_posted, sort_by, cursor, limit))
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            return None, {"detail": "HTTP 429"}
        page = int(cursor or 0)
        base = 1000 * (len({c[0] for c in self.calls})) + page * self.per_page
        items = [post(base + i) for i in range(min(self.per_page, limit))]
        nxt = str(page + 1) if page + 1 < self.pages else None
        return {"object": "LinkedinSearch", "items": items, "cursor": nxt}, None


def test_a_unipile_post_reads_as_the_same_post_apify_gives():
    got = uni.collect(["q"], per_query=1, client=Client(), sleep=lambda s: None)
    [p] = got["posts"]
    assert p["key"] == "7000000000000001000", "the activity number, as Apify's id, so one post is one lead"
    assert p["url"] == "https://www.linkedin.com/posts/someone_call-audit-activity-7000000000000001000-abcd"
    assert p["author"] == {"name": "Spinder 1000", "headline": "Head of Sales Ops", "url": "https://www.linkedin.com/in/spinder-1000/",
                           "key": "in/spinder-1000", "company": False}
    assert (p["posted_at"], p["reactions"], p["comments"], p["query"]) == ("2026-09-29T06:32:15.011Z", 12, 4, "q")
    company = uni.as_actor_item(post(5, author={"public_identifier": "acme", "name": "Acme", "is_company": True}), "q")
    assert company["author"]["linkedinUrl"] == "https://www.linkedin.com/company/acme/" and company["author"]["type"] == "company"
    assert uni.as_actor_item({"text": "x", "author": None}, "q")["author"]["linkedinUrl"] == ""


def test_each_search_reads_pages_until_its_count_newest_first_and_spaced_out():
    c, slept = Client(pages=5, per_page=2), []
    got = uni.collect(["a", "b"], posted="week", per_query=5, client=c, sleep=slept.append)
    assert [x[0] for x in c.calls] == ["a", "a", "a", "b", "b", "b"]
    assert [x[4] for x in c.calls[:3]] == [5, 3, 1], "never asks for more than the search still needs"
    assert all(x[1] == "past_week" and x[2] == "date" for x in c.calls)
    assert got["results"] == 10 and len(got["posts"]) == 10 and got["usd"] == 0 and got["error"] is None
    assert len(slept) == 5 and all(uni.PAUSE_S[0] <= s <= uni.PAUSE_S[1] for s in slept)
    assert got["notes"] == []


def test_three_months_reads_the_last_month_and_says_so():
    c = Client(pages=1)
    got = uni.collect(["a"], posted="3months", per_query=2, client=c, sleep=lambda s: None)
    assert c.calls[0][1] == "past_month" and "a month at most" in got["notes"][0]
    assert {k: uni.DATE_POSTED[k] for k in ("24h", "week", "month")} == {"24h": "past_day", "week": "past_week", "month": "past_month"}


def test_the_days_limit_is_kept_across_searches():
    c = Client(pages=10, per_page=2)
    got = uni.collect(["a", "b", "c"], per_query=10, room=5, client=c, sleep=lambda s: None)
    assert got["results"] == 5 and [x[4] for x in c.calls][-1] == 1
    assert {x[0] for x in c.calls} == {"a"} and "today's Unipile limit" in got["notes"][-1]


def test_a_refusal_stops_the_rest_and_keeps_what_was_found():
    c = Client(pages=3, per_page=2, fail_on=3)
    got = uni.collect(["a", "b"], per_query=10, client=c, sleep=lambda s: None)
    assert got["error"] == "Unipile: HTTP 429" and len(c.calls) == 3 and len(got["posts"]) == 4


def test_no_linkedin_account_is_an_error_not_a_crash():
    class NoAccount(Client):
        def linkedin_account_id(self):
            return None, {"detail": "No working LinkedIn account is connected to Unipile."}
    got = uni.collect(["a"], client=NoAccount(), sleep=lambda s: None)
    assert got["posts"] == [] and "No working LinkedIn account" in got["error"]


def test_the_request_is_linkedins_post_search_with_its_filters(monkeypatch):
    sent = []
    monkeypatch.setattr(unipile_client, "_request", lambda method, path, json_body=None, params=None: sent.append(
        (method, path, json_body, params)) or ({}, None))
    unipile_client.search_posts_filtered("acc1", '"call audit"', date_posted="past_week", sort_by="date", cursor="c2", limit=80)
    unipile_client.search_posts_filtered("acc1", "x", date_posted="past_year", sort_by="newest")
    assert sent[0] == ("POST", "/api/v1/linkedin/search",
                       {"api": "classic", "category": "posts", "keywords": '"call audit"', "date_posted": "past_week", "sort_by": "date"},
                       {"account_id": "acc1", "limit": 49, "cursor": "c2"})
    assert sent[1][2] == {"api": "classic", "category": "posts", "keywords": "x"}, "values Unipile does not take are left out"
