"""Attack the Video Studio sandbox with a hostile composition (Phase 5's security review).

    python3 scripts/check_video_sandbox.py [--out DIR]

Needs the engine (VIDEO_ENGINE_DIR with HyperFrames installed) and a browser.
The composition tries, from inside the render browser:

  * reading files outside its project through the engine's own server
    (../, encoded ../, /etc/passwd, /proc/self/environ);
  * file:// reads;
  * the internet and the cloud metadata address (169.254.169.254);
  * a service listening on this machine's loopback (one is started here);
  * WebRTC: UDP to a STUN server, by name and by address (it would skip the
    proxy if allowed).

It writes what it got into its own frame, and the frame is read back: every
line must say BLOCKED. The proxy trap's log of refused hosts is printed too.
Exit 1 if anything got through.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SECRET = "loopback-secret-%d" % os.getpid()

PAGE = r"""<!doctype html>
<html><head><meta charset="UTF-8"><script src="kit/gsap.min.js"></script>
<style>html,body{margin:0;width:1280px;height:720px;background:#fff;font:22px monospace}
#out{position:absolute;inset:20px;white-space:pre}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1280" data-height="720">
<div id="out" class="clip" data-start="0" data-duration="4" data-track-index="0">running</div></div>
<script>
window.__timelines = window.__timelines || {};
var lines = [];
function sync(label, url, needle) {
  var got = "BLOCKED";
  try {
    var x = new XMLHttpRequest(); x.open("GET", url, false); x.send();
    if (x.status >= 200 && x.status < 300 && (!needle || x.responseText.indexOf(needle) >= 0)) got = "GOT " + x.status + " " + x.responseText.length + "b";
    else got = "BLOCKED (" + x.status + ")";
  } catch (e) { got = "BLOCKED (" + e.name + ")"; }
  lines.push(label + ": " + got);
}
sync("dotdot passwd", "/../../../../../../etc/passwd", "root:");
sync("encoded passwd", "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd", "root:");
sync("slash-encoded passwd", "/..%2f..%2f..%2f..%2f..%2fetc/passwd", "root:");
sync("proc environ", "/../../../../../../proc/self/environ", "PATH");
sync("file url", "file:///etc/passwd", "root:");
sync("internet", "http://example.com/", "Example");
sync("metadata", "http://169.254.169.254/latest/meta-data/", "");
sync("loopback service", "http://127.0.0.1:__PORT__/", "__SECRET__");
sync("localhost service", "http://localhost:__PORT__/", "__SECRET__");
function rtc(label, server, done) {
  var seen = "BLOCKED", pc;
  try {
    pc = new RTCPeerConnection({iceServers: [{urls: server}]});
    pc.createDataChannel("x");
    pc.onicecandidate = function (e) {
      if (e.candidate && / typ (srflx|relay) /.test(e.candidate.candidate)) seen = "GOT " + e.candidate.candidate.split(" ")[7];
    };
    pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {});
  } catch (e) { seen = "BLOCKED (" + e.name + ")"; }
  setTimeout(function () { lines.push(label + ": " + seen); try { pc.close(); } catch (e) {} done(); }, 2500);
}
rtc("webrtc stun by name", "stun:stun.l.google.com:19302", function () {
  rtc("webrtc stun by ip", "stun:74.125.250.129:19302", function () {
    document.getElementById("out").textContent = lines.join("\n");
    var tl = gsap.timeline({paused: true});
    tl.to("#out", {opacity: 1, duration: 4}, 0);
    window.__timelines["main"] = tl;
  });
});
</script></body></html>"""


def main():
    from tracker import video_sandbox
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "vs-sandbox-check"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    class Secret(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = SECRET.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Secret)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    page = PAGE.replace("__PORT__", str(srv.server_address[1])).replace("__SECRET__", SECRET)
    with video_sandbox.Sandbox("security") as box:
        box.write({"index.html": page.encode()})
        # A render waits until the page has made its timeline (after the tests).
        mp4 = box.render(4, quality="draft", timeout=300)
        frame = box.cover(mp4, 3.0)
        blocked = box.blocked
    srv.shutdown()
    path = os.path.join(args.out, "sandbox-frame.jpg")
    with open(path, "wb") as fh:
        fh.write(frame)
    frames = [frame]
    print("frame:", path)
    print("refused by the proxy trap:", json.dumps(blocked))
    text = ocr(frames[0])
    if text is not None:
        print(text)
        got = [line for line in text.splitlines() if re.search(r"\bGOT\b", line)]
        print("RESULT:", "something got through" if got else "everything was blocked")
        sys.exit(1 if got else 0)
    print("No OCR here: look at the frame; every line must say BLOCKED.")


def ocr(png):
    try:
        import pytesseract
        from PIL import Image
        import io
        return pytesseract.image_to_string(Image.open(io.BytesIO(png)))
    except Exception:
        return None


if __name__ == "__main__":
    main()
