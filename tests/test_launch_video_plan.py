"""The Launch Video plan (docs/launch-video-plan.md) stays complete: five
phases, each with its "Done when", and the safety rules the build relies on."""

import os
import re

PLAN = os.path.join(os.path.dirname(__file__), "..", "docs", "launch-video-plan.md")


def _plan():
    with open(PLAN, encoding="utf-8") as f:
        return f.read()


def test_the_plan_has_five_phases_each_with_a_finish_line():
    text = _plan()
    phases = re.findall(r"^### Phase (\d):", text, re.M)
    assert phases == ["1", "2", "3", "4", "5"]
    for part in re.split(r"^### Phase \d:", text, flags=re.M)[1:]:
        assert "**Done when:**" in part.split("\n## ")[0]


def test_the_plan_keeps_the_sandbox_cost_cap_and_music_rules():
    text = _plan()
    assert "no network" in text and "untrusted code" in text
    assert "VIDEO_CLAUDE_MONTHLY_USD" in text and "Nothing is rendered" in text
    assert "No music" in text
