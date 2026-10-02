"""Page Watch: the real browser capture, against a page served on this machine.

Skipped where Chromium cannot start (the CI image installs Playwright but not
its browser). Locally and on the worker it runs: the page has an endless
animation, a cookie notice, a chat bubble, a lazy section, a button and a
price, so every stabilising step is exercised for real.

The capture refuses private addresses, so this test allows 127.0.0.1 for its
own server only, and checks that a request to any other private address is
still refused.
"""

import http.server
import socketserver
import threading
from urllib.parse import urlsplit

import pytest

from tracker import watch_capture, watch_detect, watch_safety, watch_visual

PAGE = """<!doctype html><html><head><title>Plans</title><style>
body{font:16px Arial,sans-serif;margin:0;padding:24px}
.spin{width:40px;height:40px;background:#e11d48;animation:spin 0.3s linear infinite}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.cookie{position:fixed;bottom:0;left:0;right:0;background:#111;color:#fff;padding:20px}
#intercom-container{position:fixed;right:20px;bottom:20px;width:60px;height:60px;background:#2563eb}
.btn{display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none}
.tall{height:2400px}
</style></head><body>
<h1>Plans for every team</h1>
<div class="spin"></div>
<p>Pro gives your team more usage and support.</p>
<a class="btn" href="/signup">Sign Up</a>
<p class="price">$20 per month</p>
<img src="http://10.1.2.3/secret.png" alt="">
<div class="tall"></div>
<p id="lazy"></p>
<div class="cookie">We use cookies to improve your experience. <button>Accept</button></div>
<div id="intercom-container"></div>
<div class="help" style="position:fixed;right:16px;bottom:16px;width:220px;height:90px;background:#fff;border:1px solid #ccc">13 sales reps available <button>Chat now</button></div>
<script>
addEventListener('scroll', () => {
  if (scrollY > 1500) document.getElementById('lazy').textContent = 'Loaded when scrolled';
  // A consent manager that arrives late, after the first hiding pass.
  if (scrollY > 1500 && !document.getElementById('onetrust-banner-sdk')) {
    const ot = document.createElement('div');
    ot.id = 'onetrust-banner-sdk';
    ot.textContent = 'This site employs technologies to record your visit. Accept all?';
    ot.setAttribute('style', 'position:absolute;top:0;left:0;right:0;padding:30px;background:#333;color:#fff');
    document.body.appendChild(ot);
  }
});
</script>
</body></html>"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def server():
    srv = socketserver.TCPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield "http://127.0.0.1:%d/plans" % srv.server_address[1]
    srv.shutdown()


@pytest.fixture
def local_only(monkeypatch):
    """Allow this test's own server; every other private address stays refused."""
    from tracker import lbr_website

    def allowed(url):
        if urlsplit(url).hostname == "127.0.0.1":
            return True
        try:
            lbr_website.check_public(url)
            return True
        except Exception:
            return False

    def check(url):
        if not allowed(url):
            raise watch_safety.BadURL("refused")
    monkeypatch.setattr(watch_safety, "allowed", allowed)
    monkeypatch.setattr(watch_safety, "check", check)


@pytest.fixture(scope="module")
def browser_ok():
    if not watch_capture.browser_available():
        pytest.skip("Playwright is not installed")
    import asyncio
    from playwright.async_api import async_playwright

    async def probe():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(headless=True)
            await b.close()
    try:
        asyncio.run(probe())
    except Exception as exc:
        pytest.skip("Chromium cannot start here: %s" % str(exc)[:80])


def test_a_real_capture_is_stable_and_complete(server, local_only, browser_ok):
    cap = watch_capture.capture(server)
    assert cap.engine == "browser" and cap.ok, (cap.error, cap.error_detail)
    assert cap.title == "Plans" and cap.status == 200
    texts = [b["text"] for b in cap.blocks]
    assert "Plans for every team" in texts and "Sign Up" in texts and "$20 per month" in texts
    # The lazy paragraph appears because the page was scrolled through.
    assert "Loaded when scrolled" in texts
    # The cookie notice and the chat bubble were hidden before reading.
    assert not any("We use cookies" in t for t in texts)
    assert "cookie notice" in cap.hidden and "#intercom-container" in cap.hidden
    # A help box floating in a corner, and a consent banner that arrived late.
    assert not any("sales reps" in t or "employs technologies" in t for t in texts)
    assert "corner widget" in cap.hidden
    # Every block has a position; the button is named as a link.
    sign = next(b for b in cap.blocks if b["text"] == "Sign Up")
    assert sign["tag"] == "a" and sign["box"][2] > 20 and sign["box"][3] > 10
    # The endless animation is frozen: the control shot matches the screenshot.
    assert cap.screenshot and cap.control
    assert not watch_visual.noise_cells(cap.screenshot, cap.control).any()


def test_two_captures_of_an_unchanged_page_are_the_same(server, local_only, browser_ok):
    a = watch_capture.capture(server)
    prev = watch_detect.snapshot_from(a, watch_visual.pack_grid(watch_visual.noise_cells(a.screenshot, a.control)))
    report, _ = watch_detect.compare(prev, watch_capture.capture(server))
    assert report["outcome"] == "same", report["headline"]


def test_a_real_edit_is_found_and_named(server, local_only, browser_ok):
    a = watch_capture.capture(server)
    prev = watch_detect.snapshot_from(a, watch_visual.pack_grid(watch_visual.noise_cells(a.screenshot, a.control)))
    edit = ("(() => { document.querySelector('.price').textContent = '$25 per month';"
            " document.querySelector('.btn').style.background = '#2563eb'; return {ok: true}; })()")
    b = watch_capture.capture(server, mutate=edit)
    assert b.mutation == {"ok": True}
    report, _ = watch_detect.compare(prev, b)
    assert report["outcome"] == "changed" and report["level"] == "major"
    assert report["headline"] == "Price changed: $20 → $25."
    labels = [lab for x in report["areas"] for lab in x["labels"]]
    assert "the link “Sign Up”" in labels and "the text “$25 per month”" in labels


def test_a_private_address_is_refused_even_for_the_browser(local_only, browser_ok):
    with pytest.raises(watch_safety.BadURL):
        watch_capture.capture("http://10.1.2.3/")
