#!/usr/bin/env python3
"""Pre-render the public marketing site to static HTML for GitHub Pages.

WHY THIS EXISTS. The product is a Flask application; GitHub Pages serves files
and runs nothing. But the public pages in templates/agents.html are rendered
from data that never changes per visitor -- the agent catalogue, the signal
list, the industry table -- so every one of them can be rendered once, here,
and served as a file.

WHAT YOU LOSE, and why the banner at the foot of every built page says so:
sign-up, the contact form and Google sign-in all need a server. The pages keep
their markup and their behaviour up to the point where they would call one.

The output is committed under docs/ because "Deploy from a branch" only offers
the repository root or /docs -- there is no third choice. The planning
documents already in docs/ are untouched and share no URL with any page here.

    python3 tools/build_static_site.py                # default prefix
    python3 tools/build_static_site.py --prefix ''    # for a custom domain

Re-run it after any change to the marketing templates; nothing regenerates on
its own.
"""

import argparse
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# GitHub Pages serves a project site from /<repo>/, so every absolute path in
# the rendered HTML has to carry that prefix. A custom domain serves from /,
# in which case pass --prefix ''.
DEFAULT_PREFIX = "/new-agentic-platform"
# og:image has to be an absolute URL that a link scraper can actually fetch.
# The templates build it from brand.domain, which is a placeholder that does
# not resolve, so a shared link would unfurl with no card at all.
DEFAULT_ORIGIN = "https://krishna-1812.github.io"

# Static assets the public pages reference. Everything else in static/ belongs
# to the signed-in product and is not copied.
ASSETS = [
    ("static/css/press.css", "static/css/press.css"),
    ("static/favicon.svg", "static/favicon.svg"),
    ("static/favicon.svg", "favicon.svg"),      # /favicon.svg is a route, not a file
    ("static/favicon.png", "static/favicon.png"),
    ("static/og-cover.png", "static/og-cover.png"),
]

BANNER_CSS = """
.pv-note{background:#14140F;color:#A8A499;width:100%;padding:20px 0;
  font-family:'Familjen Grotesk',system-ui,-apple-system,sans-serif;
  font-size:12.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
.pv-in{display:flex;gap:12px;align-items:flex-start;max-width:1340px;
  margin-inline:auto;padding-inline:clamp(20px,5.2vw,84px)}
.pv-note i{width:7px;height:7px;background:#C6F24E;flex:0 0 auto;
  margin-top:7px;display:block}
.pv-note p{margin:0;max-width:86ch}
.pv-note b{color:#F1EDE3;font-weight:600}
.pv-gbtn{font-family:'Familjen Grotesk',system-ui,sans-serif;font-size:12.5px;
  color:#6B6860;text-align:center;width:100%;display:block;padding:4px 0}
"""

BANNER_HTML = """
<div class="pv-note" role="note">
  <div class="pv-in">
    <i aria-hidden="true"></i>
    <p><b>Static design preview.</b> These pages are pre-rendered from a running
    application, so sign-up, the contact form and Google sign-in are not
    connected to a server here &mdash; everything else, including the agent
    directory's search and filters, works as it does live. The brand name is a
    placeholder.</p>
  </div>
</div>
"""

# Capture phase on document, so this runs before the page's own submit
# handler and can stop it reaching a /api endpoint that is not there.
#
# The stub matters more than it looks. The login page polls every 120ms for
# window.google and the GSI script has been stripped from the build, so
# without something to find it would poll for as long as the tab is open.
# The stub lets its init() run to completion against no-ops and stop.
BANNER_JS = """
(function(){
  window.google = window.google || {accounts:{id:{
    initialize:function(){}, renderButton:function(){},
    disableAutoSelect:function(){}, prompt:function(){}
  }}};
  function label(){
    document.querySelectorAll('.gbtn').forEach(function(g){
      g.textContent = '';
      var s = document.createElement('span');
      s.className = 'pv-gbtn';
      s.textContent = 'Sign-in is disabled in this preview';
      g.appendChild(s);
    });
  }
  label();
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', label);

  document.addEventListener('submit', function(e){
    if (!e.target || e.target.id !== 'leadForm') return;
    e.preventDefault(); e.stopImmediatePropagation();
    var body = document.getElementById('leadBody');
    var done = document.getElementById('leadDone');
    var msg  = document.getElementById('leadDoneMsg');
    // The heading says "You are on the list." on the live site. Leaving it
    // would have the preview claim a submission it never made.
    var head = done ? done.querySelector('h3') : null;
    if (head) head.textContent = 'Nothing was sent.';
    if (msg) msg.textContent = 'This is a static preview \\u2014 the form is not '
      + 'connected to a server here. On the live site this reaches the team.';
    if (body) body.style.display = 'none';
    if (done) done.classList.add('on');
  }, true);
})();
"""


def routes(app_mod):
    """(url, output directory) for every public page, derived from the app's
    own data rather than a list that has to be kept in step with it."""
    out = [
        ("/", ""),
        ("/agents", "agents"),
        ("/platform", "platform"),
        ("/signals", "signals"),
        ("/solutions", "solutions"),
        ("/why-intelligence", "why-intelligence"),
        ("/integrations", "integrations"),
        ("/resources", "resources"),
        ("/privacy", "privacy"),
        ("/terms", "terms"),
        ("/login", "login"),
        ("/login-preview", "login-preview"),
        ("/industries", "industries"),
    ]
    for a in app_mod.AGENTS:
        out.append(("/agents/%s" % a["slug"], "agents/%s" % a["slug"]))
    for ind in app_mod.INDUSTRIES:
        out.append(("/industries/%s" % ind["slug"], "industries/%s" % ind["slug"]))
        for ag in ind["agents"]:
            if ag.get("slug"):
                out.append(("/industries/%s/agents/%s" % (ind["slug"], ag["slug"]),
                            "industries/%s/agents/%s" % (ind["slug"], ag["slug"])))
    return out


def rewrite(html, prefix, origin, page_routes):
    """Absolute paths, made to work from a subdirectory.

    Page links become directory URLs with a trailing slash so the browser
    resolves them against <dir>/index.html. Routes are replaced longest-first
    so that /agents never matches inside /agents/signal-tracker."""
    # The first-party analytics script posts to the app; there is nothing to
    # post to, and a 404 in the console on every page is noise.
    html = re.sub(r'\s*<script src="/static/js/visitor_track\.js[^"]*"></script>', "", html)
    # Google Identity Services cannot complete a sign-in without a server, so
    # a preview that loads it only draws an empty box and makes a third-party
    # request on behalf of whoever opened the link.
    html = re.sub(r'\s*<script src="https://accounts\.google\.com/gsi/client"[^>]*></script>', "", html)

    for route in sorted(page_routes, key=len, reverse=True):
        if route == "/":
            continue
        html = html.replace('="%s"' % route, '="%s%s/"' % (prefix, route))
    html = html.replace('href="/"', 'href="%s/"' % prefix)

    for asset in ("/static/", "/favicon.svg", "/favicon.ico"):
        html = html.replace('="%s' % asset, '="%s%s' % (prefix, asset))

    # The social card, pointed somewhere that resolves.
    from brand import BRAND
    html = html.replace("https://%s/static/" % BRAND["domain"],
                        "%s%s/static/" % (origin, prefix))

    banner = ("<style>%s</style>\n%s<script>%s</script>\n"
              % (BANNER_CSS, BANNER_HTML, BANNER_JS))
    return html.replace("</body>", banner + "</body>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default=DEFAULT_PREFIX,
                    help="path the site is served from ('' for a custom domain)")
    ap.add_argument("--origin", default=DEFAULT_ORIGIN,
                    help="scheme and host the built site is served from")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs"))
    args = ap.parse_args()
    prefix = args.prefix.rstrip("/")

    # A real client id baked into a public file would render a Google button
    # that cannot complete a sign-in. Empty makes the page show its own
    # fallback link, which is the honest state for a static preview.
    os.environ["GOOGLE_CLIENT_ID"] = ""
    os.environ.setdefault("SECRET_KEY", "static-build-only")

    import app as app_mod
    app_mod.app.config["TESTING"] = True
    client = app_mod.app.test_client()

    pages = routes(app_mod)
    page_routes = [r for r, _ in pages]

    written, failed = 0, []
    for url, outdir in pages:
        rv = client.get(url)
        if rv.status_code != 200:
            failed.append((url, rv.status_code))
            continue
        html = rewrite(rv.get_data(as_text=True), prefix, args.origin.rstrip("/"), page_routes)
        target = os.path.join(args.out, outdir) if outdir else args.out
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(html)
        written += 1

    for src, dst in ASSETS:
        s = os.path.join(ROOT, src)
        if not os.path.exists(s):
            failed.append((src, "missing asset"))
            continue
        d = os.path.join(args.out, dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)

    # Without this, Pages runs the output through Jekyll, which chokes on the
    # Liquid-looking braces in the pages and drops anything underscore-prefixed.
    open(os.path.join(args.out, ".nojekyll"), "w").close()

    print("%d pages, %d assets -> %s" % (written, len(ASSETS), args.out))
    for f in failed:
        print("  FAILED %s %s" % f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
