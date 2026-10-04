"""The Video Studio plan (docs/video-studio-plan.md) stays complete: five
phases, each with its "Done when"; the user defines the video (a free brief,
Custom as the default, starting points only as shortcuts); and the safety
rules the build relies on."""

import os
import re

PLAN = os.path.join(os.path.dirname(__file__), "..", "docs", "video-studio-plan.md")


def _plan():
    with open(PLAN, encoding="utf-8") as f:
        return f.read()


def test_the_plan_has_five_phases_each_with_a_finish_line():
    text = _plan()
    assert re.findall(r"^### Phase (\d):", text, re.M) == ["1", "2", "3", "4", "5"]
    for part in re.split(r"^### Phase \d:", text, flags=re.M)[1:]:
        assert "**Done when:**" in part.split("\n## ")[0]


def test_the_user_defines_the_video_not_a_fixed_kind():
    text = _plan()
    assert "**user defines the video**" in text and "What video do you want?" in text
    assert "**Custom** is the default" in text
    kinds = re.findall(r"^\| (Launch / announcement|Explainer|Product demo|Promotion / ad|Results / numbers|"
                       r"How-to / tips|Hiring|Custom) \|", text, re.M)
    assert len(kinds) == 8                                      # many kinds, launch is only one of them
    assert "Use my script exactly" in text and "6 to 60 seconds" in text


def test_the_plan_keeps_the_sandbox_cost_cap_and_honesty_rules():
    text = _plan()
    assert "no network" in text and "untrusted code" in text
    assert "VIDEO_CLAUDE_MONTHLY_USD" in text and "Nothing is rendered" in text
    assert "**nothing is invented**" in text and "No music" in text
