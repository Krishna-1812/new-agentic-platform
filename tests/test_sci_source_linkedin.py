"""tracker/sci_source_linkedin.py -- the default Apify actor, its kill switch (SCI_APIFY_LINKEDIN_ACTOR_ID=off
makes actor_id() None) and normalize() for harvestapi/linkedin-company-posts' output."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import sci_source_linkedin as src  # noqa: E402


def test_actor_id_defaults_to_the_company_posts_actor(monkeypatch):
    monkeypatch.delenv("SCI_APIFY_LINKEDIN_ACTOR_ID", raising=False)
    assert src.actor_id() == "harvestapi/linkedin-company-posts"


def test_actor_id_is_none_when_switched_off(monkeypatch):
    for value in ("off", "OFF", "none", "disabled", "0", "false"):
        monkeypatch.setenv("SCI_APIFY_LINKEDIN_ACTOR_ID", value)
        assert src.actor_id() is None, value


def test_actor_id_reads_the_env_var_when_set(monkeypatch):
    monkeypatch.setenv("SCI_APIFY_LINKEDIN_ACTOR_ID", "some/actor")
    assert src.actor_id() == "some/actor"


def test_normalize_maps_a_single_image_post():
    items = [{"postId": "1", "postUrl": "https://linkedin.com/p/1", "text": "hi",
             "postedAt": "2026-08-01T00:00:00.000Z", "images": [{"url": "https://cdn/1.jpg"}],
             "numLikes": 4, "numComments": 1, "numShares": 0}]
    out = src.normalize(items)
    assert len(out) == 1
    assert out[0]["post_type"] == "image"
    assert out[0]["media_urls"] == ["https://cdn/1.jpg"]


def test_normalize_flags_video_post():
    items = [{"postId": "2", "videoUrl": "https://cdn/v.mp4"}]
    out = src.normalize(items)
    assert out[0]["post_type"] == "video"
    assert out[0]["media_urls"] == ["https://cdn/v.mp4"]


def test_normalize_skips_items_with_no_id():
    assert src.normalize([{"text": "no id"}]) == []


@patch("tracker.sci_source_linkedin.apify_transport.run_actor_and_wait")
def test_collect_passes_strict_through_to_the_transport(mock_run):
    mock_run.return_value = []
    src.collect("acmeco", "tok", strict=True)
    assert mock_run.call_args.kwargs.get("strict") is True


def test_build_input_takes_a_company_page_url_and_asks_for_posts_only():
    one = src.build_input("acmeco", 12)
    assert one == {"targetUrls": ["https://www.linkedin.com/company/acmeco/"], "maxPosts": 12,
                   "scrapeReactions": False, "scrapeComments": False}
    url = "https://www.linkedin.com/company/acme-co/"
    assert src.build_input(url)["targetUrls"] == [url]


def test_normalize_reads_the_company_posts_actor_output():
    item = {"type": "post", "id": "7329", "linkedinUrl": "https://www.linkedin.com/posts/acme_x-7329",
            "content": "We shipped it", "postedAt": {"timestamp": 1747419119821, "date": "2025-05-16T18:11:59.821Z"},
            "postImages": [{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}],
            "engagement": {"likes": 29, "comments": 3, "shares": 1}}
    out = src.normalize([item])[0]
    assert out["platform_post_id"] == "7329"
    assert out["post_url"].endswith("acme_x-7329")
    assert out["caption"] == "We shipped it"
    assert out["posted_at"] == "2025-05-16T18:11:59.821Z"
    assert out["post_type"] == "carousel"
    assert out["media_urls"] == ["https://cdn/a.jpg", "https://cdn/b.jpg"]
    assert out["metrics"] == {"likes": 29, "comments": 3, "shares": 1}


def test_normalize_a_video_post_puts_the_video_first():
    item = {"type": "post", "id": "9", "content": "watch",
            "postVideo": {"videoUrl": "https://cdn/v.mp4", "thumbnailUrl": "https://cdn/t.jpg"},
            "postImages": [{"url": "https://cdn/i.jpg"}]}
    out = src.normalize([item])[0]
    assert out["post_type"] == "video"
    assert out["media_urls"][0] == "https://cdn/v.mp4"


def test_normalize_a_document_post_uses_its_cover_pages():
    item = {"type": "post", "id": "10", "content": "deck",
            "document": {"title": "Deck", "coverPages": [{"imageUrls": ["https://cdn/p1.jpg", "https://cdn/p2.jpg"]}]}}
    out = src.normalize([item])[0]
    assert out["post_type"] == "carousel"
    assert out["media_urls"] == ["https://cdn/p1.jpg", "https://cdn/p2.jpg"]


def test_normalize_drops_reaction_and_comment_items():
    items = [{"type": "reaction", "id": "r1"}, {"type": "comment", "id": "c1"}, {"type": "post", "id": "p1"}]
    assert [p["platform_post_id"] for p in src.normalize(items)] == ["p1"]
