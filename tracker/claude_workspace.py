"""Point every Claude call at one Anthropic workspace.

An Anthropic API key made at the organization level (not inside a workspace)
is refused on every request unless the request names a workspace in the
`anthropic-workspace-id` header: "This API key is not scoped to a workspace,
so this request must include the anthropic-workspace-id header". The app
builds its Anthropic clients in two dozen places, so instead of passing the
header in each, ANTHROPIC_WORKSPACE_ID (Railway → web and worker → Variables)
is turned into the header here, through ANTHROPIC_CUSTOM_HEADERS, which every
Anthropic client reads when it is built. tracker/__init__.py runs this before
any agent module is imported.

A workspace ID is not a secret (it names the workspace, it does not unlock it),
but it still lives in Railway rather than in the code, beside the key it goes with.
"""
import os
import re

HEADER = "anthropic-workspace-id"
ID = re.compile(r"^wrkspc_[A-Za-z0-9]+$")

UNSCOPED = "not scoped to a workspace"
STEPS = ("The Anthropic API key in Railway belongs to no workspace. Either set ANTHROPIC_WORKSPACE_ID "
         "(the workspace's ID, wrkspc_…, from console.anthropic.com → Settings → Workspaces) or replace "
         "ANTHROPIC_API_KEY with a key made inside a workspace, in Railway → web and worker → Variables.")


def apply(env=None):
    """Add the workspace header to ANTHROPIC_CUSTOM_HEADERS. Returns the ID used, or ""."""
    env = os.environ if env is None else env
    wid = (env.get("ANTHROPIC_WORKSPACE_ID") or "").strip()
    if not ID.match(wid):
        return ""
    lines = [l for l in (env.get("ANTHROPIC_CUSTOM_HEADERS") or "").split("\n")
             if l.strip() and l.split(":", 1)[0].strip().lower() != HEADER]
    env["ANTHROPIC_CUSTOM_HEADERS"] = "\n".join(lines + ["%s: %s" % (HEADER, wid)])
    return wid


def explain(msg):
    """The fix in plain words when an error is the unscoped-key refusal, else ""."""
    return STEPS if UNSCOPED in str(msg or "") else ""
