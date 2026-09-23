"""Every stylesheet and script a page asks for exists.

The cleanup pass deleted 21 files from static/ that nothing loaded. The failure
that invites is quiet: a page that still links a deleted sheet gets a 404 for
it, the browser drops the request, and the page renders with some of its
styling silently missing. No error on the page, and nothing in the suite would
notice -- the server returns 200 for the page itself.

So this reads every reference a page can make to a local asset and resolves it
the way the page would:

  - a literal /static/css/... or /static/js/... path, in markup or a script
  - url_for('static', filename='...')
  - a bare "name.css?v=N" handed to the _bento.html head() macro, which
    resolves it under static/css/ (and "name.js" under static/js/)

It checks existence only. Whether a sheet is the RIGHT one for a page is the
job of the per-page tests.
"""

import os
import re

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TPL = os.path.join(_ROOT, "templates")
_STATIC = os.path.join(_ROOT, "static")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _strip_comments(src):
    """HTML, Jinja and block comments: a note that says a file used to be
    loaded is not a reference to it."""
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    src = re.sub(r"\{#.*?#\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", src)


def _sources():
    for name in sorted(os.listdir(_TPL)):
        if name.endswith(".html"):
            yield "templates/" + name, _strip_comments(_read(os.path.join(_TPL, name)))
    js = os.path.join(_STATIC, "js")
    for name in sorted(os.listdir(js)):
        if name.endswith(".js"):
            yield "static/js/" + name, _strip_comments(_read(os.path.join(js, name)))
    yield "app.py", _strip_comments(_read(os.path.join(_ROOT, "app.py")))


def _references():
    refs = []
    for where, src in _sources():
        for m in re.finditer(r"""["'(]/static/((?:css|js)/[\w./-]+?\.(?:css|js))(?:\?[^"')]*)?["')]""", src):
            refs.append((where, m.group(1)))
        for m in re.finditer(r"""url_for\(\s*['"]static['"]\s*,\s*filename\s*=\s*['"]((?:css|js)/[\w./-]+\.(?:css|js))['"]""", src):
            refs.append((where, m.group(1)))
        # head("Title", ["hub.css?v=1", ...], ["x.js?v=2"]) in _bento.html's macro
        for call in re.finditer(r"\bhead\(\s*[^,()]+,\s*(\[[^\]]*\])(?:\s*,\s*(\[[^\]]*\]))?", src):
            for group, kind in ((call.group(1), "css"), (call.group(2) or "", "js")):
                for n in re.findall(r"""["']([\w.-]+\.%s)(?:\?[^"']*)?["']""" % kind, group):
                    refs.append((where, "%s/%s" % (kind, n)))
    return refs


def test_references_are_actually_found():
    """Guards the test below from passing vacuously if the patterns rot."""
    refs = _references()
    assert len(refs) > 50, "only %d asset references found; the scan is broken" % len(refs)
    assert any(r == "css/bento-tokens.css" for _, r in refs)
    assert any(w.startswith("templates/") and r.startswith("css/") and "bento" not in r
               for w, r in refs), "no head()-macro page sheet was picked up"


def test_every_referenced_static_asset_exists():
    missing = sorted({(w, r) for w, r in _references()
                      if not os.path.exists(os.path.join(_STATIC, r))})
    assert not missing, (
        "these pages ask for a file that is not in static/ -- the browser gets "
        "a 404 and the page silently renders without it:\n  %s"
        % "\n  ".join("%s -> /static/%s" % m for m in missing))
