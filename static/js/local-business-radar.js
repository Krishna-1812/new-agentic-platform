/* ════════════════════════════════════════════════════════════════════════
   LOCAL BUSINESS RADAR: ask, preview, run live, keep the history.

   Talks to the agent's routes under /strategic-agents/local-business-radar:
     POST /plan              resolve the inputs, return the plan and ceiling
     POST /run               start a run (reuses the preview's resolution)
     GET  /runs/<id>/status  progress, polled every 2 s while a run is live
     POST /runs/<id>/cancel  stop a run, keeping what it has
   Every value that reaches the page from the server is inserted as text,
   never as markup.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var BASE = "/strategic-agents/local-business-radar";
  var doc = document;
  var root = doc.getElementById("lbr");
  if (!root) return;
  var READY = root.getAttribute("data-ready") === "true";
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PROVIDER = {
    places: ["Google Places", "#1D65A6"], serpapi: ["SerpAPI", "#FF6022"], claude: ["Claude", "#8C4FD9"],
    apify: ["Apify", "#0E9F6E"], pagespeed: ["PageSpeed", "#E0A100"], hunter: ["Hunter", "#E34970"]
  };
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(v) {
    v = Number(v || 0);
    return "$" + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  }
  function showError(msg) {
    var e = $("lbr-error");
    e.textContent = msg || "";
    e.hidden = !msg;
  }
  function post(url, body) {
    return fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}), credentials: "same-origin"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ("Request failed (" + r.status + ")."));
        return d;
      });
    });
  }

  /* ── Inputs ──────────────────────────────────────────────────────────── */
  var focus = "all";
  Array.prototype.forEach.call(doc.querySelectorAll("[data-lbr-focus]"), function (b) {
    b.addEventListener("click", function () {
      focus = b.getAttribute("data-lbr-focus");
      Array.prototype.forEach.call(doc.querySelectorAll("[data-lbr-focus]"), function (o) {
        var on = o === b;
        o.classList.toggle("is-on", on);
        o.setAttribute("aria-checked", on ? "true" : "false");
      });
      if (lastPlan) preview();
    });
  });
  var cap = $("lbr-cap"), capOut = $("lbr-cap-out");
  cap.addEventListener("input", function () { capOut.textContent = cap.value; });
  cap.addEventListener("change", function () { if (lastPlan) preview(); });

  function inputs() {
    return { business_type: $("lbr-type").value.trim(), location: $("lbr-where").value.trim(),
             focus: focus, cap: Number(cap.value) };
  }

  /* ── Preview ─────────────────────────────────────────────────────────── */
  var lastPlan = null;
  var KIND = { city: "City and its metro", district: "Neighbourhood", postcode: "ZIP / postcode",
               county: "County", state: "State or region" };
  var NOTE = {
    none: "A city keeps its metro: suburbs across the line are the same market, and each result is tagged.",
    admin1: "A state's boundary box overlaps its neighbours, so every result is checked to be inside it.",
    admin2: "Every result is checked to be inside the county.",
    shape: "Google Maps is searched inside the area's real boundary, and every result is checked to be within it.",
    box: "Google Maps is searched inside the area's bounding box (its exact outline was not available), so a few results just outside the boundary may be included."
  };

  function renderPlan(p) {
    lastPlan = p;
    var box = $("lbr-plan");
    $("lbr-plan-what").textContent = p.business.label;
    $("lbr-plan-where").textContent = p.area.formatted;
    var tags = $("lbr-plan-tags");
    tags.textContent = "";
    var kind = p.area.filter === "shape" && p.area.kind === "city" ? "City, within its limits" : (KIND[p.area.kind] || p.area.kind);
    tags.appendChild(el("span", "lbr-tag lbr-tag--kind", kind));
    if (p.estimate && p.estimate.source === "apify") tags.appendChild(el("span", "lbr-tag", "Source: Google Maps via Apify"));
    // Apify searches Google Maps by phrase, so categories only apply to the Places API.
    if (!(p.estimate && p.estimate.source === "apify"))
      (p.business.types || []).forEach(function (t) { tags.appendChild(el("span", "lbr-tag", "Google category: " + t.replace(/_/g, " "))); });
    (p.business.queries || []).forEach(function (q) { tags.appendChild(el("span", "lbr-tag", "Searching “" + q + "”")); });
    if (p.business.service_area) tags.appendChild(el("span", "lbr-tag", "Includes businesses with no storefront"));
    tags.appendChild(el("span", "lbr-tag", "Selling: " + p.focus_label));
    $("lbr-plan-note").textContent = (NOTE[p.area.approximate ? "box" : p.area.filter] || "") + " Up to " + p.cap +
      " businesses are researched in depth; chains are set aside." +
      (p.area.attribution ? " " + p.area.attribution + "." : "");
    var est = p.estimate;
    $("lbr-ceiling").textContent = money(est.usd_max);
    if (est.basis) $("lbr-basis").textContent = est.basis;
    var bar = $("lbr-bar"), lines = $("lbr-lines");
    bar.textContent = ""; lines.textContent = "";
    var total = est.usd_max || 1;
    est.lines.forEach(function (l) {
      var meta = PROVIDER[l.provider] || [l.provider, "#A8A39C"];
      if (l.usd) {
        var seg = el("i");
        seg.style.background = meta[1];
        seg.style.width = Math.max(1.5, 100 * l.usd / total) + "%";
        seg.title = meta[0] + ": " + money(l.usd);
        bar.appendChild(seg);
      }
      var li = el("li");
      var sw = el("i"); sw.style.background = meta[1];
      li.appendChild(sw);
      li.appendChild(el("span", "", meta[0] + " · " + l.what));
      li.appendChild(el("b", "", l.usd == null ? "unpriced" : money(l.usd)));
      lines.appendChild(li);
    });
    bar.classList.remove("is-new"); void bar.offsetWidth; bar.classList.add("is-new");
    var first = box.hidden;
    box.hidden = false;
    if (first && !REDUCED) { box.classList.remove("is-in"); void box.offsetWidth; box.classList.add("is-in"); }
    if (first) box.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }

  function preview() {
    var v = inputs();
    if (!v.business_type || !v.location) { showError("Say what kind of business, and where."); return; }
    showError("");
    var btn = $("lbr-preview");
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = "Finding the area…";
    post(BASE + "/plan", v).then(renderPlan).catch(function (e) { showError(e.message); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }
  $("lbr-ask").addEventListener("submit", function (e) { e.preventDefault(); preview(); });

  /* ── Run ─────────────────────────────────────────────────────────────── */
  var polling = null, current = null;
  $("lbr-start").addEventListener("click", function () {
    if (!READY) { showError("Connect the required tools first (listed below)."); return; }
    var b = $("lbr-start");
    b.disabled = true;
    post(BASE + "/run", inputs()).then(function (d) {
      $("lbr-plan").hidden = true;
      attach(d.run_id);
    }).catch(function (e) { showError(e.message); b.disabled = false; });
  });

  function buildTrack(stages) {
    var ol = $("lbr-track");
    if (ol.children.length === stages.length) return;
    ol.textContent = "";
    stages.forEach(function (s, i) {
      var li = el("li", "lbr-step");
      li.setAttribute("data-stage", s.key);
      li.appendChild(el("i", "", String(i + 1)));
      li.appendChild(el("span", "", s.label));
      ol.appendChild(li);
    });
  }

  function render(s) {
    current = s;
    var run = $("lbr-run");
    run.hidden = false;
    $("lbr-run-title").textContent = s.label + " in " + s.area;
    var stateText = { running: "Searching", queued: "Starting", complete: "Finished", failed: "Stopped with an error",
                      cancelled: "Stopped" }[s.status] || s.status;
    $("lbr-run-state").textContent = s.cancelling && s.status === "running" ? "Stopping…" : stateText;
    buildTrack(s.stages);
    var done = 0;
    s.stages.forEach(function (st) {
      var li = doc.querySelector('.lbr-step[data-stage="' + st.key + '"]');
      li.className = "lbr-step lbr-step--" + st.state;
      if (st.state === "done") done++;
    });
    $("lbr-track").style.setProperty("--lbr-p", String(Math.min(1, done / (s.stages.length - 1))));
    var c = s.counts || {};
    $("lbr-m-found").textContent = String(c.found || 0);
    $("lbr-m-researched").textContent = String(c.researched || 0);
    var spent = (s.cost || {}).usd || 0;
    $("lbr-m-spend").textContent = money(spent);
    $("lbr-m-ceiling").textContent = money(s.ceiling || 0);
    $("lbr-m-spendbar").style.width = (s.ceiling ? Math.min(100, 100 * spent / s.ceiling) : 0) + "%";
    var d = s.detail || {};
    var detail = "";
    if (s.status === "failed") detail = s.error || "The run stopped with an error.";
    else if (d.apify) detail = "Apify is " + d.apify + (d.places ? ": " + d.places + " places" : "") +
      (d.reviews ? ", " + d.reviews + " reviews" : "") + (d.places || d.reviews ? " so far." : "…");
    else if (d.stage === "discover" && d.tiles_searched != null) detail = d.tiles_searched + " areas searched, " + (d.found || 0) + " businesses so far.";
    else if (d.stage === "discover") detail = (d.found || 0) + " businesses found so far.";
    else if (d.of) detail = s.stage_label + ": " + d.done + " of " + d.of + ".";
    else if (s.status === "running") detail = s.stage_label + "…";
    if (c.coverage === "partial") detail += (detail ? " " : "") + (c.places_limit
      ? "Coverage is partial: the search reached its limit of " + c.places_limit + " places."
      : "Coverage is partial: the densest areas hold more than the search budget reached.");
    $("lbr-run-detail").textContent = detail;
    $("lbr-cancel").hidden = !(s.status === "running" || s.status === "queued");
    if (s.status === "complete") {
      var t = (s.summary || {}).tiers || {};
      $("lbr-done-h").textContent = (t.A || 0) + " tier A, " + (t.B || 0) + " tier B leads from " +
        ((s.summary || {}).found || 0) + " businesses found.";
      $("lbr-done-link").href = BASE + "/runs/" + s.id + "/report";
      $("lbr-done").hidden = false;
    }
  }

  function poll(id) {
    fetch(BASE + "/runs/" + id + "/status", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then(function (s) {
        render(s);
        if (s.status === "running" || s.status === "queued") polling = setTimeout(function () { poll(id); }, 2000);
        else refreshHistory();
      })
      .catch(function () { polling = setTimeout(function () { poll(id); }, 5000); });
  }

  function attach(id) {
    clearTimeout(polling);
    $("lbr-done").hidden = true;
    $("lbr-run").hidden = false;
    $("lbr-run").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    poll(id);
  }

  $("lbr-cancel").addEventListener("click", function () {
    if (!current) return;
    post(BASE + "/runs/" + current.id + "/cancel", {}).then(function () { poll(current.id); })
      .catch(function (e) { showError(e.message); });
  });

  /* ── History ─────────────────────────────────────────────────────────── */
  function card(r) {
    var a = el("a", "lbr-runcard lbr-runcard--" + r.status);
    a.href = BASE + "/runs/" + r.id + "/report";
    a.setAttribute("data-run", r.id);
    a.setAttribute("data-status", r.status);
    var top = el("span", "lbr-rc-top");
    top.appendChild(el("span", "lbr-pill lbr-pill--" + r.status, r.status.charAt(0).toUpperCase() + r.status.slice(1)));
    top.appendChild(el("span", "lbr-rc-date", (r.created_at || "").slice(0, 10)));
    a.appendChild(top);
    a.appendChild(el("span", "lbr-rc-name", r.label));
    a.appendChild(el("span", "lbr-rc-where", r.area));
    var t = (r.summary || {}).tiers;
    if (t) {
      var tiers = el("span", "lbr-rc-tiers");
      [["A", "a"], ["B", "b"], ["C", "c"]].forEach(function (k) {
        var s = el("span", "lbr-t lbr-t--" + k[1]);
        s.appendChild(el("b", "", String(t[k[0]] || 0)));
        s.appendChild(doc.createTextNode(" " + k[0]));
        tiers.appendChild(s);
      });
      a.appendChild(tiers);
    }
    a.appendChild(el("span", "lbr-rc-foot", ((r.summary || {}).found || 0) + " found · " + money((r.cost || {}).usd) +
      (window.__acctContext && r.by ? " · by " + r.by : "")));
    return a;
  }
  function refreshHistory() {
    fetch(BASE + "/runs", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $("lbr-runs");
        box.textContent = "";
        if (!d.runs.length) { box.appendChild(el("p", "lbr-empty", "No searches yet. Your first one will appear here.")); return; }
        d.runs.slice(0, 12).forEach(function (r) { box.appendChild(card(r)); });
      }).catch(function () {});
  }
  // A live run in the history: open its progress instead of its (unfinished) report.
  $("lbr-runs").addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".lbr-runcard");
    if (!a) return;
    var st = a.getAttribute("data-status");
    if (st === "running" || st === "queued") { e.preventDefault(); attach(a.getAttribute("data-run")); }
  });
  doc.addEventListener("pointerover", function (e) {
    var c = e.target.closest && e.target.closest(".lbr-runcard");
    if (!c || c.contains(e.relatedTarget)) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty("--x", (e.clientX - r.left) + "px");
    c.style.setProperty("--y", (e.clientY - r.top) + "px");
  });

  // Reopening the page while a search runs picks it straight back up.
  var live = doc.querySelector('.lbr-runcard[data-status="running"], .lbr-runcard[data-status="queued"]');
  if (live) attach(live.getAttribute("data-run"));
})();
