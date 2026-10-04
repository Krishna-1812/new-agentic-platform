/* Video Studio engine page (templates/video_studio_engine.html).
   Draws the engine status and the test runs from JSON, queues tests, and
   refreshes every few seconds while a run is waiting or rendering. */
(function () {
  "use strict";
  var BASE = "/strategic-agents/video-studio";
  var data = JSON.parse(document.getElementById("ve-data").textContent);
  var timer = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "cls") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function ago(iso) {
    if (!iso) return "";
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " minutes ago";
    if (s < 129600) return Math.round(s / 3600) + " hours ago";
    return Math.round(s / 86400) + " days ago";
  }

  function stat(label, value, good) {
    return el("div", { cls: "ve-stat" }, [
      el("span", { text: label }),
      el("b", { text: value, cls: good === true ? "ve-ok" : good === false ? "ve-bad" : "" })
    ]);
  }

  function drawEngine() {
    var box = document.getElementById("ve-engine");
    var when = document.getElementById("ve-engine-when");
    var e = data.engine;
    box.textContent = "";
    if (!e) {
      when.textContent = "No worker has reported yet. Once the worker service is deployed with this version, it reports here within a minute.";
    } else {
      when.textContent = "Reported by the worker " + ago(e.at) + (e.jobs ? ", after " + e.jobs + " job(s)." : ".");
      box.appendChild(stat("Rendering", e.switched_on ? "On" : "Off (VIDEO_STUDIO)", !!e.switched_on));
      box.appendChild(stat("Node", e.node ? "Installed" : "Missing", !!e.node));
      box.appendChild(stat("ffmpeg", e.ffmpeg ? "Installed" : "Missing", !!e.ffmpeg));
      box.appendChild(stat("Browser", e.browser ? "Found" : "Missing", !!e.browser));
      var hf = e.hyperframes ? e.hyperframes : "Installs on first render";
      box.appendChild(stat("HyperFrames", hf + (e.hyperframes && e.hyperframes !== window.VE_PINNED ? " (pinned " + window.VE_PINNED + ")" : ""),
        e.hyperframes ? e.hyperframes === window.VE_PINNED : undefined));
    }
    var q = data.queue || {};
    box.appendChild(stat("Waiting", String(q.queued || 0)));
    box.appendChild(stat("Rendering now", String(q.running || 0)));
    if (q.stalled) box.appendChild(stat("Interrupted, to retry", String(q.stalled), false));
  }

  var LABEL = { queued: "Waiting for the worker", making: "Rendering", ready: "Ready", failed: "Failed", draft: "Draft" };

  function drawRuns() {
    var box = document.getElementById("ve-runs");
    box.textContent = "";
    if (!data.runs.length) {
      box.appendChild(el("p", { cls: "ve-sub", text: "No test runs yet." }));
      return;
    }
    data.runs.forEach(function (r) {
      var thumb = r.has_cover
        ? el("img", { cls: "ve-thumb", src: BASE + "/media/" + r.id + ".jpg", alt: "Cover frame of " + r.title, loading: "lazy" })
        : el("div", { cls: "ve-thumb", "aria-hidden": "true" });
      var cls = r.status === "ready" ? "ve-ok" : r.status === "failed" ? "ve-bad" : "ve-wait";
      var bits = [r.seconds + " s", r.shape];
      if (r.mb) bits.push(r.mb + " MB");
      if (r.timings && r.timings.render_s) bits.push("rendered in " + Math.round(r.timings.render_s) + " s");
      if (r.timings && r.timings.check_s) bits.push("checked in " + Math.round(r.timings.check_s) + " s");
      bits.push(ago(r.finished_at || r.created_at));
      var log = el("ul", { cls: "ve-log" });
      r.log.forEach(function (l) {
        log.appendChild(el("li", {}, [el("b", { text: l.step + ": " }), document.createTextNode(l.detail || "")]));
      });
      var links = el("div", { cls: "ve-links" });
      if (r.status === "ready") {
        links.appendChild(el("a", { href: BASE + "/media/" + r.id + ".mp4", target: "_blank", rel: "noopener", text: "Watch" }));
        links.appendChild(el("a", { href: BASE + "/media/" + r.id + ".mp4?download=1", text: "Download MP4" }));
      }
      box.appendChild(el("article", { cls: "ve-run" }, [thumb, el("div", {}, [
        el("h3", { text: r.title }),
        el("p", { cls: "ve-meta" }, [el("b", { cls: cls, text: LABEL[r.status] || r.status }), document.createTextNode(" · " + bits.join(" · "))]),
        r.error ? el("p", { cls: "ve-meta ve-bad", text: r.error }) : null,
        links, log
      ])]));
    });
  }

  function draw() {
    drawEngine();
    drawRuns();
    clearTimeout(timer);
    if (data.busy) timer = setTimeout(refresh, 5000);
  }

  function refresh() {
    fetch(BASE + "/api/engine-tests", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) { data = j.page; draw(); } })
      .catch(function () { timer = setTimeout(refresh, 15000); });
  }

  document.querySelectorAll("[data-test]").forEach(function (b) {
    b.addEventListener("click", function () {
      var msg = document.getElementById("ve-msg");
      b.disabled = true;
      msg.textContent = "Queuing…";
      fetch(BASE + "/api/engine-tests", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: b.getAttribute("data-test") })
      }).then(function (r) { return r.json(); }).then(function (j) {
        b.disabled = false;
        if (!j.ok) { msg.textContent = j.error || "That did not work."; return; }
        msg.textContent = "Queued. The worker takes it within a few seconds.";
        data = j.page;
        draw();
      }).catch(function () { b.disabled = false; msg.textContent = "The server could not be reached. Try again."; });
    });
  });

  draw();
})();
