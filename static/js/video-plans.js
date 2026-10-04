/* Video Studio plan tests (templates/video_studio_plans.html). Draws each
   test plan with its checks, runs the tests, records reviews, and refreshes
   while plans are being made. */
(function () {
  "use strict";
  var BASE = "/strategic-agents/video-studio";
  var data = JSON.parse(document.getElementById("vp-data").textContent);
  var open = {};
  var timer = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "cls") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function stat(label, value, good) {
    return el("div", { cls: "ve-stat" }, [el("span", { text: label }),
      el("b", { text: String(value), cls: good === true ? "ve-ok" : good === false ? "ve-bad" : "" })]);
  }

  function drawTotals() {
    var t = data.totals, c = data.claude || {};
    var claude = document.getElementById("vp-claude");
    claude.textContent = c.state === "no_key" ? "Claude is not set up on the server (ANTHROPIC_API_KEY), so plans will fail."
      : c.state === "capped" ? "This month's Video Studio budget is used up ($" + c.cap_usd + ")."
      : "This month: $" + (c.spent_usd || 0).toFixed(2) + " of $" + c.cap_usd + " used.";
    var box = document.getElementById("vp-totals");
    box.textContent = "";
    box.appendChild(stat("Briefs run", t.run + " of " + t.briefs));
    box.appendChild(stat("Valid plans", t.valid, t.done ? t.valid === t.run : undefined));
    box.appendChild(stat("Plans with problems", t.with_problems, t.with_problems ? false : undefined));
    box.appendChild(stat("Failed", t.failed, t.failed ? false : undefined));
    box.appendChild(stat("Match the brief (reviewed)", t.matches + " of " + t.run));
    box.appendChild(stat("Claude cost", "$" + t.cost_usd.toFixed(3)));
  }

  var STATUS = { queued: "Waiting for the worker", planning: "Planning", planned: "Planned", failed: "Failed" };

  function sceneRow(s, i, pictures, cover) {
    var words = [s.headline, s.subline, s.number].filter(Boolean).join(" / ");
    (s.items || []).forEach(function (it) { words += (words ? " · " : "") + it.label + (it.detail ? ": " + it.detail : ""); });
    if (s.attribution) words += " (" + s.attribution + ")";
    var shows = (s.asset_ids || []).map(function (id) {
      var p = pictures[id];
      return el("a", { href: BASE + "/asset/" + id + ".img", target: "_blank", rel: "noopener" },
        [el("img", { src: BASE + "/asset/" + id + ".img", alt: p ? p.name : "picture " + id, loading: "lazy",
                     style: "width:72px;height:48px;object-fit:cover;border-radius:6px;margin-right:4px" })]);
    });
    if (s.chart && s.chart.kind && s.chart.kind !== "none") shows.push(el("span", { text: s.chart.kind + " chart: " + s.chart.label_column + " / " + s.chart.value_column }));
    return el("tr", {}, [
      el("td", { text: String(i + 1) + (i === cover ? " ★" : "") }),
      el("td", { text: s.type }), el("td", { text: String(s.seconds) + " s" }),
      el("td", {}, [el("div", { text: words }), el("div", { cls: "ve-meta", text: s.purpose + (s.motion ? " · " + s.motion : "") })]),
      el("td", {}, shows)
    ]);
  }

  function review(r, verdict) {
    var note = verdict === "misses" ? (window.prompt("What does it miss?") || "") : "";
    fetch(BASE + "/api/plan-tests/" + r.version + "/review", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: verdict, note: note })
    }).then(function (x) { return x.json(); }).then(function (j) { if (j.ok) { data = j.page; draw(); } });
  }

  function drawRun(r) {
    var cls = r.status === "planned" ? (r.problems.length ? "ve-wait" : "ve-ok") : r.status === "failed" ? "ve-bad" : "ve-wait";
    var label = STATUS[r.status] || r.status;
    if (r.status === "planned") label = r.problems.length ? "Planned, " + r.problems.length + " problem(s)" : "Valid plan";
    var src = Object.keys(r.sources).map(function (k) { return r.sources[k] + " " + k; }).join(", ") || "brief only";
    var bits = [r.choices.kind, r.choices.shape, r.choices.seconds + " s", "sources: " + src];
    if (r.cost_usd) bits.push("$" + r.cost_usd.toFixed(3));
    if (r.attempts) bits.push(r.attempts + " attempt(s)");
    if (r.seconds_taken) bits.push(Math.round(r.seconds_taken) + " s to plan");
    var body = [el("p", { cls: "ve-meta", text: r.brief })];
    if (r.error) body.push(el("p", { cls: "ve-meta ve-bad", text: r.error }));
    if (r.idea) {
      body.push(el("p", {}, [el("b", { text: "Idea: " }), r.idea]));
      body.push(el("p", {}, [el("b", { text: "Hook: " }), r.hook || ""]));
      var tbody = el("tbody");
      r.scenes.forEach(function (s, i) { tbody.appendChild(sceneRow(s, i, r.pictures, r.cover_scene)); });
      body.push(el("div", { style: "overflow-x:auto" }, [el("table", { cls: "vp-scenes" }, [
        el("thead", {}, [el("tr", {}, ["#", "Scene", "Time", "Words on screen", "Shows"].map(function (h) { return el("th", { text: h }); }))]),
        tbody])]));
      if (r.problems.length) body.push(el("div", {}, [el("b", { cls: "ve-bad", text: "Checks that still fail:" }),
        el("ul", { cls: "ve-log" }, r.problems.map(function (p) { return el("li", { text: p }); }))]));
      if (r.notes.length) body.push(el("div", {}, [el("b", { text: "Notes for the person:" }),
        el("ul", { cls: "ve-log" }, r.notes.map(function (p) { return el("li", { text: p }); }))]));
      var sc = r.share_copy || {};
      ["linkedin", "x", "instagram"].forEach(function (k) {
        if (sc[k]) body.push(el("p", { cls: "ve-meta" }, [el("b", { text: k + ": " }), sc[k]]));
      });
      if (r.brand) body.push(el("p", { cls: "ve-meta", text: "Brand (" + r.brand.source.colors + "): " +
        r.brand.colors.background + " / " + r.brand.colors.text + " / " + r.brand.colors.accent + " · " +
        r.brand.fonts.heading + ", " + r.brand.fonts.body }));
      var rv = r.review || {};
      body.push(el("div", { cls: "ve-actions" }, [
        el("span", { cls: "ve-meta", text: rv.verdict ? "Reviewed: " + (rv.verdict === "matches" ? "does what the brief asked" : "misses: " + (rv.note || "")) : "Does it do what the brief asked?" }),
        (function () { var b = el("button", { type: "button", cls: "sa-btn sa-btn--line", text: "Yes, it matches" }); b.onclick = function () { review(r, "matches"); }; return b; })(),
        (function () { var b = el("button", { type: "button", cls: "sa-btn sa-btn--line", text: "No, it misses" }); b.onclick = function () { review(r, "misses"); }; return b; })()
      ]));
    }
    body.push(el("ul", { cls: "ve-log" }, r.log.map(function (l) { return el("li", {}, [el("b", { text: l.step + ": " }), l.detail || ""]); })));
    var d = el("details", { cls: "ve-run vp-run" }, [
      el("summary", {}, [el("b", { text: r.label }), " ", el("span", { cls: cls, text: label }),
        el("div", { cls: "ve-meta", text: bits.join(" · ") })]),
      el("div", {}, body)]);
    if (open[r.version]) d.open = true;
    d.addEventListener("toggle", function () { open[r.version] = d.open; });
    return d;
  }

  function draw() {
    drawTotals();
    var box = document.getElementById("vp-runs");
    box.textContent = "";
    if (!data.runs.length) box.appendChild(el("p", { cls: "ve-sub", text: "Not run yet." }));
    data.runs.forEach(function (r) { box.appendChild(drawRun(r)); });
    clearTimeout(timer);
    if (data.busy) timer = setTimeout(refresh, 6000);
  }

  function refresh() {
    fetch(BASE + "/api/plan-tests", { credentials: "same-origin" }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) { data = j.page; draw(); } })
      .catch(function () { timer = setTimeout(refresh, 15000); });
  }

  document.getElementById("vp-run").addEventListener("click", function () {
    var b = this, msg = document.getElementById("vp-msg");
    if (!window.confirm("Run all 15 briefs with Claude? This costs about $1 to $3 of this month's Video Studio budget.")) return;
    b.disabled = true;
    msg.textContent = "Queuing…";
    fetch(BASE + "/api/plan-tests", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); }).then(function (j) {
        b.disabled = false;
        if (!j.ok) { msg.textContent = j.error || "That did not work."; return; }
        msg.textContent = "Queued. The worker plans them one at a time; this page fills in as they finish (about 15 to 25 minutes in all).";
        data = j.page; draw();
      }).catch(function () { b.disabled = false; msg.textContent = "The server could not be reached. Try again."; });
  });

  draw();
})();
