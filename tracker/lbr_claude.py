"""Local Business Radar: one way to ask Claude for JSON.

Every model call in the agent asks for a JSON object and gets back either
that object or a ClaudeError; nothing downstream ever parses free text. Each
call is priced into the run's Ledger from the token usage Anthropic reports.

The SDK is imported inside the call so the rest of the agent (and its tests)
never needs it.
"""

import json
import re

from tracker import lbr_config


class ClaudeError(Exception):
    def __init__(self, message, kind="api", status=None):
        super().__init__(message)
        self.kind = kind
        self.status = status


def _extract(text):
    """The first JSON object in a reply, tolerating a ```json fence."""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object")
    obj, _ = json.JSONDecoder().raw_decode(text[start:])
    if not isinstance(obj, dict):
        raise ValueError("not an object")
    return obj


def _client():
    key = lbr_config.key_for("claude")
    if not key:
        raise ClaudeError("Claude is not configured (ANTHROPIC_API_KEY).", kind="config")
    from anthropic import Anthropic
    return Anthropic(api_key=key, timeout=90.0, max_retries=2)


# Models that take `output_config.effort` (the 4.6+ and 5 families). On Claude
# Sonnet 5 and Opus 5 thinking runs by default when `thinking` is omitted, and
# its tokens come out of max_tokens, so every request leaves room for it and
# asks for low effort: these are short extraction and writing tasks.
EFFORT_MODELS = ("claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-mythos-5",
                 "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6")
THINKING_ROOM = 8000


def request_options(model, max_tokens):
    """max_tokens (answer plus room for thinking) and effort, for one model."""
    opts = {"max_tokens": max(max_tokens * 4, THINKING_ROOM)}
    if str(model).startswith(EFFORT_MODELS):
        opts["output_config"] = {"effort": "low"}
    return opts


def ask_json(system, user, ledger, *, max_tokens=2000, purpose="", require=()):
    """Ask once, retrying once if the reply is cut off or unreadable.

    `max_tokens` is the size of the answer wanted; the request adds room for
    thinking (request_options). `require` names keys the object must have; a
    reply without them counts as unreadable. Returns the parsed object.
    """
    client = _client()
    model = lbr_config.model()
    opts = request_options(model, max_tokens)
    last = None
    for attempt in range(2):
        try:
            resp = client.messages.create(model=model, system=system,
                                          messages=[{"role": "user", "content": user}], **opts)
        except Exception as exc:  # the SDK's error classes, without importing them
            status = getattr(exc, "status_code", None)
            ledger.add_claude(model, {}, ok=False, detail="%s %s" % (purpose, type(exc).__name__))
            if status in (401, 403):
                raise ClaudeError("Claude refused the key (HTTP %s)." % status, status=status)
            raise ClaudeError("Claude could not be reached (%s)." % type(exc).__name__, status=status)
        usage = getattr(resp, "usage", None)
        usage = {k: getattr(usage, k, 0) or 0 for k in
                 ("input_tokens", "output_tokens", "cache_read_input_tokens",
                  "cache_creation_input_tokens")} if usage else {}
        ledger.add_claude(model, usage, ok=True, detail=purpose)
        # Only text blocks carry the answer; thinking blocks come first and are skipped.
        text = "".join(getattr(b, "text", "") or "" for b in (resp.content or [])
                       if getattr(b, "type", "text") == "text")
        stop = getattr(resp, "stop_reason", "")
        if stop == "refusal":
            raise ClaudeError("Claude declined this request.", kind="refusal")
        if stop == "max_tokens":
            last = ClaudeError("Claude's reply was cut off.", kind="truncated")
            opts["max_tokens"] = min(opts["max_tokens"] * 2, 16000)
            continue
        try:
            obj = _extract(text)
        except ValueError:
            last = ClaudeError("Claude's reply was not readable JSON.", kind="unparsable")
            continue
        missing = [k for k in require if k not in obj]
        if missing:
            last = ClaudeError("Claude's reply had no %s." % ", ".join(missing), kind="shape")
            continue
        return obj
    raise last
