"""A stand-in for Claude's plan call (tests never call Claude).

FakeClaude reads the request the real code builds, the way Claude would see
it, and answers with a plan that follows the rules: seconds that add up, only
pictures and columns the sources list, the script word for word when there
is one, and no figures at all unless they are in the request. `mistakes`
makes its first answers break chosen rules, to test the checks and the retry.
"""

import json
import re
from types import SimpleNamespace


def _text(content):
    return "\n".join(b.get("text", "") for b in content if b.get("type") == "text")


class FakeClaude:
    def __init__(self, mistakes=(), stop_reason="end_turn", fail=None):
        self.mistakes = list(mistakes)       # one per call, e.g. ["invent", None]
        self.stop_reason = stop_reason
        self.fail = fail
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise self.fail
        first = kw["messages"][0]["content"]
        plan = plan_from_request(_text(first))
        mistake = self.mistakes.pop(0) if self.mistakes else None
        if mistake == "invent":
            plan["scenes"][0]["headline"] = "Trusted by 9,999 teams"
        elif mistake == "seconds":
            plan["scenes"][0]["seconds"] += 7
        elif mistake == "asset":
            plan["scenes"][0]["asset_ids"] = [987654]
        elif mistake == "script":
            plan["scenes"][0]["headline"] += " today"
        usage = SimpleNamespace(input_tokens=6000, output_tokens=1500, cache_read_input_tokens=0,
                                cache_creation_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(plan))], usage=usage,
                               stop_reason=self.stop_reason, model=kw["model"])


def _empty_chart():
    return {"asset_id": 0, "label_column": "", "value_column": "", "kind": "none"}


def scene(kind, seconds, headline="", subline="", items=(), asset_ids=(), number="", attribution="", chart=None):
    return {"type": kind, "seconds": seconds, "purpose": "test", "headline": headline, "subline": subline,
            "items": [{"label": a, "detail": b} for a, b in items], "number": number, "attribution": attribution,
            "asset_ids": list(asset_ids), "chart": chart or _empty_chart(), "motion": "fade"}


def plan_from_request(text):
    seconds = float(re.search(r"Length: exactly ([\d.]+) seconds", text).group(1))
    script = None
    m = re.search(r"USE THIS SCRIPT EXACTLY.*?:\n(.*?)\n\nBrand:", text, re.S)
    if m:
        script = m.group(1).strip()
    pictures = [(int(i), kind) for i, kind in re.findall(r"^- id (\d+): (\w+)", text, re.M)]
    tables = re.findall(r"Numbers source id (\d+) \([^)]*\); columns: ([^;]*); numeric columns: (.*)$", text, re.M)
    scenes = []
    if script:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script) if s.strip()]
        n = max(3, min(12, len(sentences)))
        groups = [[] for _ in range(n)]
        for i, s in enumerate(sentences):
            groups[min(i * n // len(sentences), n - 1)].append(s)
        groups = [g for g in groups if g] or [[script]]
        while len(groups) < 3:                       # split the longest into two
            g = max(groups, key=lambda g: len(" ".join(g).split()))
            words = " ".join(g).split()
            i = groups.index(g)
            groups[i:i + 1] = [[" ".join(words[:len(words) // 2])], [" ".join(words[len(words) // 2:])]]
        for g in groups:
            scenes.append(scene("words", 0, headline=" ".join(g)))
    else:
        scenes.append(scene("title", 0, headline="Made for you"))
        pics = [i for i, k in pictures if k in ("image", "crop", "screenshot")]
        if pics:
            scenes.append(scene("image", 0, headline="See it in action", asset_ids=[pics[0]]))
        if tables:
            tid, cols, numeric = tables[0]
            cols = [c.strip() for c in cols.split(",")]
            numeric = [c.strip() for c in numeric.split(",") if c.strip()]
            label = next(c for c in cols if c not in numeric) if any(c not in numeric for c in cols) else cols[0]
            scenes.append(scene("chart", 0, headline="The trend", chart={
                "asset_id": int(tid), "label_column": label, "value_column": numeric[0], "kind": "bar"}))
        scenes.append(scene("words", 0, headline="Simple and clear"))
        scenes.append(scene("end_card", 0, headline="Find out more"))
    each = round(seconds / len(scenes), 2)
    for s in scenes:
        s["seconds"] = each
    scenes[-1]["seconds"] = round(seconds - each * (len(scenes) - 1), 2)
    return {"idea": "A clear short video", "audience": "buyers", "hook": scenes[0]["headline"], "scenes": scenes,
            "ending": "The action", "cover_scene": 0,
            "share_copy": {"linkedin": "A short video for you.", "x": "Watch this.", "instagram": ""},
            "notes": []}
