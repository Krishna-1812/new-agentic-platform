"""SEO & AEO tool runs, kept by the platform (docs/account-memory-plan.md, phase 3).

SEO Studio has no durable record of most runs. When a tool finishes, it tells the page around it
(seo-apps/client/src/lib/agentRunSignal.js, "agent-run-finished"), and that page (templates/embed.html)
hands the result to POST /api/seo-runs. Each run is saved to its space (tracker/workspace.py): the
client account's, which the whole team sees, or the person's own General work.

summarize(tool, payload) -> {"title", "facts": [[label, value]], "highlights": [text]} is what History,
the run's page and (phase 4) the AI's brief show: a few readable facts, never the whole result.
Every reader is defensive: a tool that changes its result's shape gives fewer facts, not an error.
"""

from __future__ import annotations

import json

TOOLS = {
    "seo-geo-audit": "SEO & GEO Audit", "seo-geo-snapshot": "SEO & GEO Snapshot",
    "on-page-audit": "On-Page SEO Audit", "agent-readiness-audit": "Agent Readiness Audit",
    "image-alt-audit": "Image Alt Tag Audit", "keyword-research": "Keyword Research",
    "content-research": "Content Research", "content-architect": "Content Architect",
    "market-potential": "Market Potential", "article-recommendation": "Article Recommendation",
    "article-enhancement": "Article Enhancement",
}
MAX_OUTPUT = 2_000_000          # characters of JSON kept in full; a larger result keeps its summary only
MAX_FACTS = 6


def _get(d, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def _n(v):
    return len(v) if isinstance(v, (list, tuple, dict)) else None


def _label(item):
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for k in ("keyword", "term", "name", "title", "label", "url"):
            if isinstance(item.get(k), str) and item[k].strip():
                return item[k]
    return None


def _facts(*pairs):
    return [[k, v] for k, v in pairs if v not in (None, "", [])][:MAX_FACTS]


def _first(*vals):
    return next((v for v in vals if isinstance(v, str) and v.strip()), "")


def summarize(tool, payload):
    p = payload if isinstance(payload, dict) else {}
    inp = p.get("input") if isinstance(p.get("input"), dict) else {}
    title, facts, highlights = "", [], []
    try:
        if tool in ("seo-geo-audit", "seo-geo-snapshot"):
            f = p.get("findings") or {}
            title = _first(inp.get("url"))
            facts = _facts(("Overall score", _get(f, "scores", "overall")), ("Band", _get(f, "scores", "band", "label")),
                           ("Critical", _get(f, "meta", "critical")), ("Warnings", _get(f, "meta", "warnings")),
                           ("Passed", _get(f, "meta", "passed")))
            highlights = [_label(x) for x in (_get(p, "ai", "priorities") or _get(p, "ai", "recommendations") or [])][:3]
        elif tool == "agent-readiness-audit":
            title = _first(inp.get("url"), _get(p, "site", "full"), _get(p, "site", "url"))
            facts = _facts(("Score", _get(p, "site", "score")), ("Level", _get(p, "site", "level")),
                           ("On-page score", _get(p, "site", "onPageScore")), ("Categories", _n(p.get("cats"))))
        elif tool == "on-page-audit":
            sections = p.get("sections") or []
            title = _first(inp.get("url"), p.get("url"))
            facts = _facts(("Sections passed", sum(1 for s in sections if isinstance(s, dict) and s.get("status") == "pass")),
                           ("Sections failed", sum(1 for s in sections if isinstance(s, dict) and s.get("status") == "fail")),
                           ("Page type", p.get("pageType")), ("Keywords", ", ".join(inp.get("primaryKeywords") or [])))
        elif tool == "image-alt-audit":
            pages = [x for x in p.get("pages") or [] if isinstance(x, dict)]
            title = "%d page%s" % (len(pages), "" if len(pages) == 1 else "s")
            facts = _facts(("Pages read", sum(1 for x in pages if x.get("ok"))), ("Pages", len(pages)),
                           ("Images with content", sum(int(x.get("contentCount") or 0) for x in pages)),
                           ("Decorative images", sum(int(x.get("decorativeCount") or 0) for x in pages)))
        elif tool == "keyword-research":
            title = _first(inp.get("keyword"), p.get("keyword"))
            facts = _facts(("Primary keywords", _n(p.get("primary"))), ("Secondary keywords", _n(p.get("secondary"))),
                           ("Intent", p.get("intent")))
            highlights = [x for x in (_label(k) for k in (p.get("primary") or [])[:5]) if x]
        elif tool == "content-research":
            title = _first(inp.get("keyword"))
            facts = _facts(("Pages compared", _n(p.get("serp"))))
            highlights = [x for x in (_label(s) for s in (p.get("serp") or [])[:3]) if x]
        elif tool == "content-architect":
            title = _first(inp.get("domain"))
            clusters = p.get("clusters") or []
            facts = _facts(("Clusters", _n(clusters)), ("Gap hubs", _n(p.get("gapHubs"))),
                           ("Orphan pages", _n(p.get("orphans"))))
            highlights = [x for x in (_label(c) for c in clusters[:3]) if x]
        elif tool == "market-potential":
            rows = p.get("rows") or []
            title = _first(inp.get("service"))
            facts = _facts(("Markets compared", _n(rows)), ("Top market", _label(rows[0]) if rows else None))
        else:
            title = _first(inp.get("url"), inp.get("keyword"), p.get("keyword"), p.get("url"))
    except Exception:          # a reshaped result gives fewer facts, never a failed save
        facts = facts or []
    return {"title": (title or TOOLS.get(tool, "SEO run"))[:200],
            "facts": [[str(k), v if isinstance(v, (int, float)) else str(v)[:120]] for k, v in facts],
            "highlights": [str(h)[:160] for h in highlights if h][:5]}


def prepare(tool, payload):
    """What is stored: (title, summary, input, output or None when too large to keep whole)."""
    s = summarize(tool, payload)
    inp = payload.get("input") if isinstance(payload, dict) and isinstance(payload.get("input"), dict) else {}
    text = json.dumps(payload, default=str)
    out = payload if len(text) <= MAX_OUTPUT else None
    if out is None:
        s["truncated"] = True
    return s["title"], s, inp, out
