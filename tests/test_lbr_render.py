"""Local Business Radar: reading a website in a real browser (crawl4ai).

Which pages are read again in a browser, what the audit takes from them, and
the safety of letting a browser load pages anyone can link from a Google
profile. The last tests start real headless Chromium and are skipped where
none is installed."""

import datetime
import http.server
import os
import ssl
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_http, lbr_render, lbr_score, lbr_website  # noqa: E402
from lbr_fakes import FakeResponse  # noqa: E402
from test_lbr_website import web  # noqa: E402,F401

SHELL = """<!doctype html><html><head><title></title><script src="/static/js/main.4f2a.js"></script></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div></body></html>"""

RENDERED = """<!doctype html><html><head><title>Smile Studio | Dentist in Austin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Gentle family dentistry.">
<script src="https://connect.facebook.net/en_US/fbevents.js"></script></head>
<body><div id="root"><h1>Smile Studio</h1><a href="tel:+15125550100">Call</a>
<form><textarea></textarea></form><p>Family dentistry in Austin. Copyright 2026</p></div></body></html>"""

GTM_PAGE = """<!doctype html><html><head><title>Joe's Plumbing</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script></head>
<body><h1>Joe's Plumbing</h1><p>%s</p><a href="tel:+15125550100">Call</a></body></html>""" % ("Plumbing repairs. " * 60)


class Renders:
    def __init__(self, result):
        self.result, self.urls = result, []

    def __call__(self, url, user_agent=None):
        self.urls.append(url)
        return self.result


# ── Which pages need a browser ───────────────────────────────────────────────

def _page(html="", status=200, error=None):
    return {"url": "https://x.example/", "status": status, "html": html, "error": error}


def test_a_javascript_shell_is_read_in_a_browser():
    assert lbr_render.reason(_page(SHELL), {"tags": []}) == "script_app"


def test_a_page_that_refuses_scripts_is_tried_in_a_browser():
    assert lbr_render.reason(_page("Forbidden", 403), None) == "refused"
    assert lbr_render.reason(_page("Too many", 429), None) == "refused"


def test_tag_manager_without_a_visible_ads_tag_is_read_in_a_browser():
    page = _page(GTM_PAGE)
    assert lbr_render.reason(page, lbr_website.read_page(GTM_PAGE, page["url"])) == "tag_manager"
    assert lbr_render.reason(page, {"tags": ["google_tag_manager", "meta_pixel"]}) == ""


def test_an_ordinary_page_or_a_dead_one_is_not():
    ordinary = "<html><head><title>Joe</title></head><body><p>%s</p></body></html>" % ("Plumbing. " * 100)
    assert lbr_render.reason(_page(ordinary), {"tags": []}) == ""
    assert lbr_render.reason(_page(status=None, error="dns"), None) == ""
    assert lbr_render.reason(_page("Not found", 404), None) == ""


def test_rendering_is_off_when_switched_off(monkeypatch):
    monkeypatch.setenv("LBR_RENDER", "off")
    assert lbr_render.render("https://example.com/") is None
    assert lbr_render.selftest()[0] is None


def test_the_certificate_and_automation_flags_crawl4ai_adds_are_removed():
    args = ["--no-sandbox", "--ignore-certificate-errors", "--ignore-certificate-errors-spki-list",
            "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"]
    assert lbr_render.safe_args(args) == ["--no-sandbox", "--disable-dev-shm-usage"]


# ── What the audit takes from the browser ────────────────────────────────────

def test_a_javascript_site_is_audited_from_what_the_browser_shows(web, monkeypatch):
    web.on("smilestudio.example", FakeResponse(200, text=SHELL))
    shown = Renders({"url": "https://smilestudio.example/", "status": 200, "html": RENDERED, "error": None,
                     "requests": ["https://connect.facebook.net/en_US/fbevents.js"]})
    monkeypatch.setattr(lbr_render, "render", shown)
    out = lbr_website.audit({"website": "https://smilestudio.example"}, lbr_http.Ledger())
    assert shown.urls == ["https://smilestudio.example"]
    assert out["kind"] == "ok" and out["rendered"] == "script_app"
    assert out["checks"]["click_to_call"] and out["checks"]["title"] and out["checks"]["contact_form"]
    assert "meta_pixel" in out["tags"] and out["runs_ads"]


def test_a_pixel_loaded_by_tag_manager_is_found_from_the_browsers_requests(web, monkeypatch):
    web.on("joesplumbing.example", FakeResponse(200, text=GTM_PAGE))
    monkeypatch.setattr(lbr_render, "render", Renders({
        "url": "https://joesplumbing.example/", "status": 200, "html": GTM_PAGE, "error": None,
        "requests": ["https://www.googletagmanager.com/gtm.js?id=GTM-ABC123",
                     "https://www.facebook.com/tr/?id=123&ev=PageView",
                     "https://www.googletagmanager.com/gtag/js?id=AW-987654321"]}))
    out = lbr_website.audit({"website": "https://joesplumbing.example"}, lbr_http.Ledger())
    assert out["rendered"] == "tag_manager"
    assert {"google_tag_manager", "meta_pixel", "google_ads"} <= set(out["tags"]) and out["runs_ads"]


def test_without_a_browser_the_plain_reading_stands(web, monkeypatch):
    web.on("smilestudio.example", FakeResponse(200, text=SHELL))
    monkeypatch.setattr(lbr_render, "render", Renders(None))
    out = lbr_website.audit({"website": "https://smilestudio.example"}, lbr_http.Ledger())
    assert out["kind"] == "ok" and "rendered" not in out and not out["checks"]["click_to_call"]


def test_a_site_that_refuses_the_check_is_not_called_broken(web, monkeypatch):
    web.on("smilestudio.example", FakeResponse(403, text="Forbidden"))
    monkeypatch.setattr(lbr_render, "render", Renders(None))
    out = lbr_website.audit({"website": "https://smilestudio.example"}, lbr_http.Ledger())
    assert out["kind"] == "blocked" and not out["needs_site"]
    assert lbr_score.need_website(out) is None
    facts = lbr_score.evidence({"name": "Smile Studio"}, None, out, None, None, None, "dentist")
    assert not any(f["service"] == "website" for f in facts), "\"could not be checked\" is never pitched"


def test_a_site_that_refuses_scripts_but_serves_a_browser_is_audited(web, monkeypatch):
    web.on("smilestudio.example", FakeResponse(403, text="Forbidden"))
    monkeypatch.setattr(lbr_render, "render", Renders({"url": "https://smilestudio.example/", "status": 200,
                                                       "html": RENDERED, "error": None, "requests": []}))
    out = lbr_website.audit({"website": "https://smilestudio.example"}, lbr_http.Ledger())
    assert out["kind"] == "ok" and out["rendered"] == "refused" and out["checks"]["click_to_call"]


def test_the_report_says_when_a_site_was_read_in_a_browser():
    from tracker import lbr_report
    slim = lbr_report._slim_business("p1", 1, {"discovery": {"selected": True},
                                               "website": {"kind": "ok", "rendered": "script_app"}})
    assert slim["web"]["rendered"] == "script_app"
    with open(os.path.join(ROOT, "static", "js", "lbr-report.js"), encoding="utf-8") as fh:
        assert "Read in a browser" in fh.read()


# ── A real browser ───────────────────────────────────────────────────────────

APP = """<!doctype html><html><head><title></title></head><body><div id="root"></div><script>
document.title = "Bright Smile Dental";
var a = document.createElement('a'); a.href = 'tel:+15125550100'; a.textContent = 'Call us';
document.getElementById('root').appendChild(a);
var s = document.createElement('script'); s.src = 'https://connect.facebook.net/en_US/fbevents.js';
document.head.appendChild(s);
fetch('INNER/from-fetch').catch(function () {});
try { new WebSocket('INNER_WS/from-socket'); } catch (e) {}
var i = new Image(); i.src = 'OUTER/picture.png';
</script></body></html>"""


@pytest.fixture(scope="module")
def browser():
    old = os.environ.get("LBR_RENDER")
    os.environ["LBR_RENDER"] = "on"
    try:
        if not lbr_render.installed() or lbr_render.selftest()[0] is not True:
            pytest.skip("no headless Chromium here")
        yield
    finally:
        if old is None:
            os.environ.pop("LBR_RENDER", None)
        else:
            os.environ["LBR_RENDER"] = old


@pytest.fixture
def servers(monkeypatch):
    """A public site on 127.0.0.1 and a private one on 127.0.0.2 that must never be reached."""
    hits = {"outer": [], "inner": []}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            who = "outer" if self.server.server_address[0] == "127.0.0.1" else "inner"
            hits[who].append(self.path)
            if self.path == "/app":
                body = (APP.replace("INNER_WS", "ws://127.0.0.2:%d" % inner[1])
                        .replace("INNER", "http://127.0.0.2:%d" % inner[1])
                        .replace("OUTER", "http://127.0.0.1:%d" % outer[1])).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(body)
            elif self.path == "/hop":
                self.send_response(301)
                self.send_header("Location", "/app")
                self.end_headers()
            elif self.path == "/inside":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.2:%d/from-redirect" % inner[1])
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<p>private</p>")

    made = []
    for host in ("127.0.0.1", "127.0.0.2"):
        s = http.server.ThreadingHTTPServer((host, 0), Handler)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        made.append(s)
    outer, inner = made[0].server_address, made[1].server_address
    # Stand-in for lbr_website.check_public: 127.0.0.1 plays a public host, 127.0.0.2 a private one.
    monkeypatch.setattr(lbr_render, "_allowed", lambda u: u.startswith(("http://127.0.0.1:", "https://127.0.0.1:")))
    yield "http://127.0.0.1:%d" % outer[1], hits
    for s in made:
        s.shutdown()


def test_a_real_browser_reads_the_page_and_never_reaches_a_private_address(browser, servers):
    base, hits = servers
    shown = lbr_render.render(base + "/hop")
    assert shown and not shown["error"]
    assert "Bright Smile Dental" in shown["html"] and "tel:+15125550100" in shown["html"]
    assert base + "/app" in shown["requests"], "the redirect was followed through the check"
    assert "https://connect.facebook.net/en_US/fbevents.js" in shown["requests"]
    assert hits["inner"] == [], "fetch(), WebSocket and redirects never reached the private host"
    assert "/picture.png" not in hits["outer"], "images are not downloaded"


def test_a_redirect_into_the_private_network_is_refused_in_the_browser(browser, servers):
    base, hits = servers
    shown = lbr_render.render(base + "/inside")
    assert shown is None or shown["error"]
    assert hits["inner"] == []


def test_a_bad_certificate_is_not_ignored(browser, monkeypatch, tmp_path):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
    (tmp_path / "c.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (tmp_path / "k.pem").write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                                       serialization.PrivateFormat.PKCS8,
                                                       serialization.NoEncryption()))
    hits = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            hits.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<title>Self-signed</title>")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(tmp_path / "c.pem", tmp_path / "k.pem")
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(lbr_render, "_allowed", lambda u: u.startswith("https://127.0.0.1:"))
    try:
        shown = lbr_render.render("https://127.0.0.1:%d/" % srv.server_address[1])
    finally:
        srv.shutdown()
    assert shown is None or (shown["error"] and "Self-signed" not in shown["html"])
    assert hits == [], "the self-signed page was never served to the browser"
