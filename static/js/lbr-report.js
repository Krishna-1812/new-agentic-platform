/* ════════════════════════════════════════════════════════════════════════
   LOCAL BUSINESS RADAR: the report.

   Draws, from the payload embedded as #lbr-data:
     - the ticker of leads and the three-card shortlist;
     - the radar: every business found, placed by its coordinates inside
       the searched area, coloured by tier, with a sweeping beam;
     - what they need (bars), website reality (a waffle, one square per
       business), the reputation map (rating against review count, with
       the local medians), and the spread of opportunity scores;
     - the lead table, with tier / need / signal filters, search and sort;
     - the drawer: one business in full, with the pitch ready to copy.
   Every chart has a legend or direct labels and a hover tooltip; the table
   is the accessible view of all of it. Clicking a chart filters the table
   or opens the business.

   Everything from the payload is inserted as text (textContent) or as SVG
   attributes, never as HTML: names, reviews and pitches come from outside.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var doc = document, SVG = "http://www.w3.org/2000/svg";
  var holder = doc.getElementById("lbr-data");
  if (!holder) return;
  var P = JSON.parse(holder.textContent || "{}");
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ALL = P.businesses || [];
  var LEADS = ALL.filter(function (b) { return b.researched && b.score; });
  var FOUND_ONLY = ALL.filter(function (b) { return !b.researched; });
  var BY_ID = {};
  ALL.forEach(function (b) { BY_ID[b.id] = b; });

  var TIER = { A: "#FF6022", B: "#E0A100", C: "#A8A39C" };
  var SVC = { website: "#FF6022", seo: "#1D65A6", paid: "#E0A100", reputation: "#E34970", creatives: "#8C4FD9" };
  var SVC_SHORT = { website: "Website", seo: "Local SEO", paid: "Paid media", reputation: "Reputation", creatives: "Creatives" };
  var WEB = { none: "#E34970", social_only: "#8C4FD9", listing_only: "#1D65A6", google_site_retired: "#E0A100",
              dead: "#FF6022", broken: "#FF6022", parked: "#FF6022", ssl_error: "#FF6022", ok: "#0E9F6E", blocked: "#A8A39C" };
  var WEB_GROUP = { dead: "broken", broken: "broken", parked: "broken", ssl_error: "broken" };
  var WEB_GROUP_LABEL = { broken: "Down, broken or parked" };
  var PROVIDER = { places: ["Google Places", "#1D65A6"], serpapi: ["SerpAPI", "#FF6022"], claude: ["Claude", "#8C4FD9"],
                   apify: ["Apify", "#0E9F6E"], pagespeed: ["PageSpeed", "#E0A100"], hunter: ["Hunter", "#E34970"] };

  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function sv(tag, attrs, parent) {
    var n = doc.createElementNS(SVG, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null; }
  function money(v) { v = Number(v || 0); return "$" + (v >= 100 ? v.toFixed(0) : v.toFixed(2)); }
  function stars(r) { return r == null ? "No rating" : Number(r).toFixed(1) + "★"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function webKind(b) { return (b.web || {}).kind || null; }
  function webLabel(k) { return WEB_GROUP_LABEL[WEB_GROUP[k]] || (P.web_labels || {})[k] || k; }

  /* ── Tooltip ─────────────────────────────────────────────────────────── */
  var tip = $("lbrr-tip");
  function showTip(e, title, lines) {
    tip.textContent = "";
    tip.appendChild(el("b", "", title));
    (lines || []).forEach(function (l) { tip.appendChild(el("span", "", l)); tip.appendChild(el("br")); });
    tip.hidden = false;
    var x = Math.min(window.innerWidth - 300, e.clientX + 14), y = e.clientY + 14;
    if (y + tip.offsetHeight > window.innerHeight - 10) y = e.clientY - tip.offsetHeight - 10;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; }
  function bizLines(b) {
    var out = [b.category + (b.locality ? " · " + b.locality : ""), stars(b.rating) + " from " + plural(b.reviews || 0, "review")];
    if (b.score) out.unshift("Tier " + b.score.tier + " · opportunity " + b.score.total);
    else out.push(b.chain ? "Chain: set aside" : "Found, not researched");
    return out;
  }

  /* ── Reveal: panels settle in as one object each ─────────────────────── */
  function onView(nodes, fn) {
    if (!("IntersectionObserver" in window) || REDUCED) { nodes.forEach(fn); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } });
    }, { threshold: 0.12 });
    nodes.forEach(function (n) { io.observe(n); });
  }
  var panels = Array.prototype.slice.call(doc.querySelectorAll("[data-panel]"));
  if (!REDUCED) panels.forEach(function (p) { p.classList.add("is-armed"); });
  onView(panels, function (p) { requestAnimationFrame(function () { p.classList.add("is-in"); }); });

  /* ── Ticker ──────────────────────────────────────────────────────────── */
  (function ticker() {
    var track = $("lbrr-tick");
    var top = LEADS.filter(function (b) { return b.score.tier !== "C"; }).slice(0, 14);
    if (!top.length) top = LEADS.slice(0, 10);
    if (!top.length) { track.parentNode.hidden = true; return; }
    function add(b, hidden) {
      var a = el("a", "sa-tick-i sa-tick-i--" + ({ A: "a", B: "b" }[b.score.tier] || "c"), b.name);
      a.href = "#b-" + b.id;
      if (hidden) { a.setAttribute("aria-hidden", "true"); a.tabIndex = -1; }
      a.addEventListener("click", function (e) { e.preventDefault(); openDrawer(b.id); });
      track.appendChild(a);
    }
    top.forEach(function (b) { add(b, false); });
    if (!REDUCED) top.forEach(function (b) { add(b, true); });
  })();

  /* ── Score ring ──────────────────────────────────────────────────────── */
  function ring(value, size) {
    var s = sv("svg", { viewBox: "0 0 80 80", class: "lbrr-ring", width: size, height: size, "aria-hidden": "true" });
    var r = 33, c = 2 * Math.PI * r;
    sv("circle", { cx: 40, cy: 40, r: r, class: "bg" }, s);
    var fg = sv("circle", { cx: 40, cy: 40, r: r, class: "fg", transform: "rotate(-90 40 40)",
                            "stroke-dasharray": c.toFixed(1), "stroke-dashoffset": REDUCED ? (c * (1 - value / 100)).toFixed(1) : c.toFixed(1) }, s);
    var t = sv("text", { x: 40, y: 47, "text-anchor": "middle" }, s);
    t.textContent = value == null ? "–" : String(value);
    if (!REDUCED) setTimeout(function () { fg.setAttribute("stroke-dashoffset", (c * (1 - (value || 0) / 100)).toFixed(1)); }, 120);
    return s;
  }

  /* ── Shortlist ───────────────────────────────────────────────────────── */
  (function shortlist() {
    var box = $("lbrr-short");
    var top = LEADS.filter(function (b) { return b.score.tier !== "C"; }).slice(0, 3);
    if (!top.length) {
      box.appendChild(el("p", "lbrr-empty", LEADS.length ? "No tier A or B leads in this run: every business researched is in good shape or small."
                                                        : "No businesses were researched in this run."));
      return;
    }
    top.forEach(function (b, i) {
      var card = el("button", "lbrr-sc lbrr-sc--" + (i + 1));
      card.type = "button";
      var t = el("span", "lbrr-sc-top");
      t.appendChild(el("span", "lbrr-sc-n", "#" + b.rank));
      t.appendChild(ring(b.score.total, 76));
      card.appendChild(t);
      card.appendChild(el("span", "lbrr-sc-name", b.name));
      card.appendChild(el("span", "lbrr-sc-meta", [b.category, b.locality, stars(b.rating) + " · " + plural(b.reviews || 0, "review")].filter(Boolean).join(" · ")));
      card.appendChild(el("span", "lbrr-sc-head", (b.pitch || {}).headline || ""));
      var chips = el("span", "lbrr-sc-chips");
      (b.score.ranked || []).slice(0, 3).forEach(function (k) { chips.appendChild(el("span", "", SVC_SHORT[k] + " " + b.score.need[k])); });
      card.appendChild(chips);
      card.appendChild(el("span", "lbrr-sc-go", "Open the full picture"));
      card.addEventListener("click", function () { openDrawer(b.id); });
      box.appendChild(card);
    });
  })();

  /* ── The radar map ───────────────────────────────────────────────────── */
  function drawMap() {
    var host = $("lbrr-map");
    host.textContent = "";
    var vp = (P.area || {}).viewport;
    var pts = ALL.filter(function (b) { return b.lat != null && b.lng != null; });
    if (!pts.length) { host.appendChild(el("p", "lbrr-muted", "No coordinates to plot.")); return; }
    var W = Math.max(280, host.clientWidth), H = Math.max(360, host.clientHeight || 420);
    var lo = vp ? vp.low : null, hi = vp ? vp.high : null;
    if (!lo) {
      lo = { lat: Math.min.apply(null, pts.map(function (b) { return b.lat; })), lng: Math.min.apply(null, pts.map(function (b) { return b.lng; })) };
      hi = { lat: Math.max.apply(null, pts.map(function (b) { return b.lat; })), lng: Math.max.apply(null, pts.map(function (b) { return b.lng; })) };
    }
    // Equirectangular with the longitude shrunk by cos(latitude), fitted and centred.
    var k = Math.cos(((lo.lat + hi.lat) / 2) * Math.PI / 180);
    var gw = Math.max(1e-6, (hi.lng - lo.lng) * k), gh = Math.max(1e-6, hi.lat - lo.lat);
    var pad = 22, scale = Math.min((W - 2 * pad) / gw, (H - 2 * pad) / gh);
    var ox = (W - gw * scale) / 2, oy = (H - gh * scale) / 2;
    function px(b) { return [ox + (b.lng - lo.lng) * k * scale, oy + (hi.lat - b.lat) * scale]; }
    var s = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Map of every business found" });
    var cx = W / 2, cy = H / 2, R = Math.max(W, H) * 0.62;
    [0.2, 0.4, 0.6, 0.8, 1].forEach(function (f) { sv("circle", { cx: cx, cy: cy, r: R * f * 0.8, class: "ring" }, s); });
    sv("line", { x1: 0, y1: cy, x2: W, y2: cy, class: "axis" }, s);
    sv("line", { x1: cx, y1: 0, x2: cx, y2: H, class: "axis" }, s);
    var defs = sv("defs", {}, s);
    var grad = sv("linearGradient", { id: "lbrr-beam", x1: "0", y1: "0", x2: "1", y2: "0" }, defs);
    sv("stop", { offset: "0", "stop-color": "#3FD68C", "stop-opacity": ".55" }, grad);
    sv("stop", { offset: "1", "stop-color": "#3FD68C", "stop-opacity": "0" }, grad);
    var sweep = sv("g", { class: "sweep" }, s);
    sweep.style.setProperty("--cx", cx + "px"); sweep.style.setProperty("--cy", cy + "px");
    sv("path", { d: "M" + cx + "," + cy + " L" + (cx + R) + "," + cy + " A" + R + "," + R + " 0 0,0 " +
                    (cx + R * Math.cos(-0.5)) + "," + (cy + R * Math.sin(-0.5)) + " Z", fill: "url(#lbrr-beam)", opacity: ".35" }, sweep);
    sv("line", { x1: cx, y1: cy, x2: cx + R, y2: cy, stroke: "#3FD68C", "stroke-width": 1.5, "stroke-opacity": ".8" }, sweep);
    // Draw quiet dots first, leads last so they sit on top.
    var order = pts.slice().sort(function (a, b) { return (a.score ? a.score.total : -1) - (b.score ? b.score.total : -1); });
    order.forEach(function (b) {
      var p = px(b), cls, r, fill = null;
      if (b.score) { cls = "dot"; r = 4 + b.score.total / 16; fill = TIER[b.score.tier]; }
      else if (b.chain) { cls = "dot dot--chain"; r = 4; }
      else { cls = "dot dot--found"; r = 3; }
      var c = sv("circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: r.toFixed(1), class: cls, fill: fill }, s);
      c.style.animationDelay = REDUCED ? "0ms" : Math.round(Math.hypot(p[0] - cx, p[1] - cy) / R * 900) + "ms";
      c.addEventListener("mousemove", function (e) { showTip(e, b.name, bizLines(b)); });
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", function () { hideTip(); openDrawer(b.id); });
    });
    host.appendChild(s);
    host.classList.remove("is-drawn"); void host.offsetWidth; host.classList.add("is-drawn");
    var leg = $("lbrr-map-legend");
    leg.textContent = "";
    [["Tier A", TIER.A], ["Tier B", TIER.B], ["Tier C", TIER.C], ["Found, not researched", "#55524D"]].forEach(function (x) {
      var sp = el("span"); var i = el("i"); i.style.background = x[1]; sp.appendChild(i); sp.appendChild(doc.createTextNode(x[0])); leg.appendChild(sp);
    });
    var chainN = ALL.filter(function (b) { return b.chain; }).length;
    if (chainN) { var sp = el("span"); var i = el("i"); i.style.border = "1.5px dashed #7A766F"; sp.appendChild(i); sp.appendChild(doc.createTextNode("Chain (" + chainN + ")")); leg.appendChild(sp); }
    $("lbrr-map-sub").textContent = ALL.length + " found in " + ((P.area || {}).formatted || "the area");
  }

  /* ── What they need ──────────────────────────────────────────────────── */
  var filt = { tier: "all", need: null, flag: null, web: null, q: "", sort: "rank", asc: true, limit: 50, found: false };
  function drawGaps() {
    var box = $("lbrr-gaps");
    box.textContent = "";
    var n = LEADS.length || 1, max = 0, counts = {};
    Object.keys(SVC).forEach(function (k) {
      counts[k] = LEADS.filter(function (b) { return (b.score.need[k] || 0) >= 60; }).length;
      max = Math.max(max, counts[k]);
    });
    Object.keys(SVC).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (k) {
      var row = el("button", "lbrr-bar-row" + (filt.need === k ? " is-on" : ""));
      row.type = "button";
      row.appendChild(el("span", "", (P.services || {})[k] || k));
      row.appendChild(el("b", "", counts[k] + " · " + Math.round(100 * counts[k] / n) + "%"));
      var bar = el("i");
      bar.style.setProperty("--w", (max ? 100 * counts[k] / max : 0) + "%");
      bar.style.setProperty("--c", SVC[k]);
      if (!REDUCED) bar.style.setProperty("--g", "0");
      row.appendChild(bar);
      row.addEventListener("click", function () { setNeed(filt.need === k ? null : k); jumpToLeads(); });
      row.addEventListener("mousemove", function (e) { showTip(e, (P.services || {})[k], [counts[k] + " of " + LEADS.length + " researched score 60+ on this need.", "Click to list them."]); });
      row.addEventListener("mouseleave", hideTip);
      box.appendChild(row);
      if (!REDUCED) onView([box], function () { requestAnimationFrame(function () { bar.style.setProperty("--g", "1"); }); });
    });
  }

  /* ── Website reality: a waffle, one square per business ──────────────── */
  function drawWaffle() {
    var box = $("lbrr-waffle"), leg = $("lbrr-waffle-legend");
    box.textContent = ""; leg.textContent = "";
    var groups = {}, order = ["none", "social_only", "listing_only", "google_site_retired", "broken", "ok", "blocked"];
    LEADS.forEach(function (b) {
      var k = webKind(b) || "blocked";
      k = WEB_GROUP[k] || k;
      (groups[k] = groups[k] || []).push(b);
    });
    var cells = [];
    order.forEach(function (k) { (groups[k] || []).forEach(function (b) { cells.push([k, b]); }); });
    // One square per business up to 100; beyond that each square is a share.
    var per = Math.max(1, Math.ceil(cells.length / 100));
    for (var i = 0; i < cells.length; i += per) {
      var k = cells[i][0], b = cells[i][1];
      var sq = el("i");
      sq.style.background = WEB[k] || WEB[(b.web || {}).kind] || "#A8A39C";
      sq.setAttribute("data-kind", k);
      if (!REDUCED) sq.style.animationDelay = Math.round((i / per) * 6) + "ms";
      (function (kk, bb) {
        sq.addEventListener("mousemove", function (e) { showTip(e, per > 1 ? webLabel(kk) : bb.name, per > 1 ? [per + " businesses per square"] : [webLabel(kk)]); });
        sq.addEventListener("mouseleave", hideTip);
        sq.addEventListener("click", function () { hideTip(); if (per === 1) openDrawer(bb.id); else { setWeb(kk); jumpToLeads(); } });
      })(k, b);
      box.appendChild(sq);
    }
    order.forEach(function (k) {
      if (!groups[k]) return;
      var sp = el("span"); var sw = el("i"); sw.style.background = WEB[k] || "#A8A39C"; sw.style.borderRadius = "3px";
      sp.appendChild(sw); sp.appendChild(doc.createTextNode(webLabel(k)));
      sp.appendChild(el("b", "", String(groups[k].length)));
      sp.addEventListener("click", function () { setWeb(filt.web === k ? null : k); jumpToLeads(); });
      sp.addEventListener("mouseenter", function () { box.classList.add("is-dim"); Array.prototype.forEach.call(box.children, function (c) { c.classList.toggle("is-on", c.getAttribute("data-kind") === k); }); });
      sp.addEventListener("mouseleave", function () { box.classList.remove("is-dim"); });
      leg.appendChild(sp);
    });
    onView([box], function () { box.classList.add("is-drawn"); });
  }

  /* ── Reputation map: rating against review count ─────────────────────── */
  function drawScatter() {
    var host = $("lbrr-scatter");
    host.textContent = "";
    var pts = LEADS.filter(function (b) { return b.rating != null; });
    if (!pts.length) { host.appendChild(el("p", "lbrr-muted", "No ratings to plot.")); return; }
    var W = Math.max(320, host.clientWidth), H = 320, m = { l: 40, r: 16, t: 14, b: 34 };
    var maxRev = Math.max(10, Math.max.apply(null, pts.map(function (b) { return b.reviews || 0; })));
    var lx = function (v) { return m.l + (Math.log10(1 + v) / Math.log10(1 + maxRev)) * (W - m.l - m.r); };
    var minR = Math.min(3, Math.floor(Math.min.apply(null, pts.map(function (b) { return b.rating; }))));
    var ly = function (v) { return m.t + (5 - v) / (5 - minR) * (H - m.t - m.b); };
    var s = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Rating against number of reviews" });
    for (var r = minR; r <= 5; r += 0.5) {
      sv("line", { x1: m.l, x2: W - m.r, y1: ly(r), y2: ly(r), class: "grid" }, s);
      if (r % 1 === 0) { var t = sv("text", { x: m.l - 8, y: ly(r) + 4, "text-anchor": "end", class: "tick" }, s); t.textContent = r + "★"; }
    }
    [0, 10, 50, 100, 500, 1000, 5000].filter(function (v) { return v <= maxRev; }).forEach(function (v) {
      var t = sv("text", { x: lx(v), y: H - 12, "text-anchor": "middle", class: "tick" }, s); t.textContent = v >= 1000 ? (v / 1000) + "k" : String(v);
    });
    var tl = sv("text", { x: W - m.r, y: H - 1, "text-anchor": "end", class: "tick" }, s); tl.textContent = "reviews (log scale)";
    var mk = (P.run.summary || {}).market || {};
    if (mk.median_reviews != null) sv("line", { x1: lx(mk.median_reviews), x2: lx(mk.median_reviews), y1: m.t, y2: H - m.b, class: "med" }, s);
    if (mk.median_rating != null && mk.median_rating >= minR) sv("line", { x1: m.l, x2: W - m.r, y1: ly(mk.median_rating), y2: ly(mk.median_rating), class: "med" }, s);
    var narrow = W < 560;
    [[narrow ? "Loved" : "Loved, little known", m.l + 8, m.t + 14, "start"], [narrow ? "Leaders" : "Local leaders", W - m.r - 6, m.t + 14, "end"],
     [narrow ? "Struggling" : "Struggling quietly", m.l + 8, H - m.b - 8, "start"], [narrow ? "Bruised" : "Big and bruised", W - m.r - 6, H - m.b - 8, "end"]].forEach(function (q) {
      var t = sv("text", { x: q[1], y: q[2], "text-anchor": q[3], class: "quad" }, s); t.textContent = q[0];
    });
    pts.slice().sort(function (a, b) { return a.score.total - b.score.total; }).forEach(function (b, i) {
      var c = sv("circle", { cx: lx(b.reviews || 0).toFixed(1), cy: ly(b.rating).toFixed(1), r: (4 + b.score.total / 22).toFixed(1),
                             class: "pt", fill: TIER[b.score.tier] }, s);
      c.style.animationDelay = REDUCED ? "0ms" : Math.round(i * 4) + "ms";
      c.addEventListener("mousemove", function (e) { showTip(e, b.name, bizLines(b)); });
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", function () { hideTip(); openDrawer(b.id); });
    });
    host.appendChild(s);
    onView([host], function () { host.classList.add("is-drawn"); });
  }

  /* ── Opportunity scores ──────────────────────────────────────────────── */
  function drawHist() {
    var host = $("lbrr-hist");
    host.textContent = "";
    if (!LEADS.length) { host.appendChild(el("p", "lbrr-muted", "Nothing scored yet.")); return; }
    var bins = []; for (var i = 0; i < 10; i++) bins.push(0);
    LEADS.forEach(function (b) { bins[Math.min(9, Math.floor((b.score.total || 0) / 10))]++; });
    var W = Math.max(260, host.clientWidth), H = W > 700 ? 220 : 300, m = { l: 8, r: 8, t: 40, b: 28 };
    var max = Math.max.apply(null, bins) || 1, bw = (W - m.l - m.r) / 10;
    var s = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "How opportunity scores spread" });
    sv("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "grid" }, s);
    bins.forEach(function (n, i) {
      var h = (H - m.t - m.b) * n / max, x = m.l + i * bw + 2, y = H - m.b - h;
      var tier = i >= 7 ? "A" : i >= 5 ? "B" : "C";
      var r = sv("rect", { x: x.toFixed(1), y: y.toFixed(1), width: (bw - 4).toFixed(1), height: Math.max(0, h).toFixed(1), rx: 4, class: "bar", fill: TIER[tier] }, s);
      r.style.animationDelay = REDUCED ? "0ms" : (i * 40) + "ms";
      r.addEventListener("mousemove", function (e) { showTip(e, (i * 10) + "–" + (i * 10 + 9), [plural(n, "business", "businesses") + " · tier " + tier]); });
      r.addEventListener("mouseleave", hideTip);
      if (n) { var v = sv("text", { x: x + (bw - 4) / 2, y: y - 6, class: "val" }, s); v.textContent = String(n); }
      var t = sv("text", { x: m.l + i * bw, y: H - 10, "text-anchor": i ? "middle" : "start", class: "tick" }, s); t.textContent = String(i * 10);
    });
    var end = sv("text", { x: W - m.r, y: H - 10, "text-anchor": "end", class: "tick" }, s); end.textContent = "100";
    [[50, "B"], [70, "A"]].forEach(function (th) {
      var x = m.l + (th[0] / 10) * bw;
      sv("line", { x1: x, x2: x, y1: 20, y2: H - m.b, class: "thr" }, s);
      var t = sv("text", { x: x + 4, y: 14, class: "thr-l" }, s); t.textContent = "Tier " + th[1];
    });
    host.appendChild(s);
    onView([host], function () { host.classList.add("is-drawn"); });
  }

  /* ── The lead table ──────────────────────────────────────────────────── */
  var FLAGS = [["nosite", "No real website", function (b) { return b.web && b.web.needs_site; }],
               ["unclaimed", "Unclaimed", function (b) { return b.gbp && b.gbp.claimed === false; }],
               ["nopack", "Not in map pack", function (b) { return b.vis && b.vis.in_pack === false; }],
               ["noads", "No Google Ads", function (b) { return b.vis && b.vis.ads && !b.vis.ads.error && !b.vis.ads.active; }],
               ["unanswered", "Bad reviews unanswered", function (b) { return ((b.rev || {}).stats || {}).unanswered_negative > 0; }]];
  function chip(label, count, on, handler, dot) {
    var c = el("button", "sa-chip" + (on ? " is-on" : ""));
    c.type = "button";
    c.setAttribute("aria-pressed", on ? "true" : "false");
    if (dot) { var d = el("i", "sa-dot"); d.style.background = dot; c.appendChild(d); }
    c.appendChild(doc.createTextNode(label + " "));
    if (count != null) c.appendChild(el("b", "", String(count)));
    c.addEventListener("click", handler);
    return c;
  }
  function renderChips() {
    var t = $("lbrr-f-tier"); t.textContent = "";
    t.appendChild(chip("All", LEADS.length, filt.tier === "all", function () { filt.tier = "all"; refresh(); }));
    ["A", "B", "C"].forEach(function (k) {
      t.appendChild(chip("Tier " + k, LEADS.filter(function (b) { return b.score.tier === k; }).length, filt.tier === k,
        function () { filt.tier = filt.tier === k ? "all" : k; refresh(); }, TIER[k]));
    });
    var n = $("lbrr-f-need"); n.textContent = "";
    Object.keys(SVC).forEach(function (k) {
      n.appendChild(chip(SVC_SHORT[k], null, filt.need === k, function () { setNeed(filt.need === k ? null : k); }, SVC[k]));
    });
    var f = $("lbrr-f-flags"); f.textContent = "";
    FLAGS.forEach(function (fl) {
      var cnt = LEADS.filter(fl[2]).length;
      if (!cnt) return;
      f.appendChild(chip(fl[1], cnt, filt.flag === fl[0], function () { filt.flag = filt.flag === fl[0] ? null : fl[0]; refresh(); }));
    });
    if (filt.web) f.appendChild(chip(webLabel(filt.web) + " ×", null, true, function () { setWeb(null); }));
  }
  function setNeed(k) { filt.need = k; filt.limit = 50; refresh(); drawGaps(); }
  function setWeb(k) { filt.web = k; filt.limit = 50; refresh(); }
  function jumpToLeads() { $("leads").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); }

  function haystack(b) {
    if (b._hay) return b._hay;
    var parts = [b.name, b.category, b.address, b.locality, (b.web || {}).label, ((b.pitch || {}).headline) || ""];
    (b.facts || []).forEach(function (f) { parts.push(f.text); });
    b._hay = parts.join(" ").toLowerCase();
    return b._hay;
  }
  var SORTS = {
    rank: function (b) { return b.rank == null ? 1e9 : b.rank; },
    name: function (b) { return (b.name || "").toLowerCase(); },
    score: function (b) { return b.score ? -b.score.total : 1; },
    web: function (b) { return webLabel(webKind(b) || "zz"); },
    rating: function (b) { return b.rating == null ? 9 : b.rating; },
    maprank: function (b) { return b.vis && b.vis.rank ? b.vis.rank : 99; },
    gbp: function (b) { return b.gbp && b.gbp.score != null ? b.gbp.score : 101; }
  };
  function current() {
    var list = LEADS.filter(function (b) {
      if (filt.tier !== "all" && b.score.tier !== filt.tier) return false;
      if (filt.need && (b.score.need[filt.need] || 0) < 60) return false;
      if (filt.flag) { var fl = FLAGS.filter(function (x) { return x[0] === filt.flag; })[0]; if (fl && !fl[2](b)) return false; }
      if (filt.web && (WEB_GROUP[webKind(b)] || webKind(b)) !== filt.web) return false;
      if (filt.q && haystack(b).indexOf(filt.q) < 0) return false;
      return true;
    });
    if (filt.found) list = list.concat(FOUND_ONLY.filter(function (b) { return !filt.q || haystack(b).indexOf(filt.q) >= 0; }));
    var key = SORTS[filt.sort] || SORTS.rank;
    list.sort(function (a, b) {
      var x = key(a), y = key(b);
      var d = x < y ? -1 : x > y ? 1 : 0;
      return filt.asc ? d : -d;
    });
    return list;
  }
  function cell(tr, node) { var td = el("td"); if (typeof node === "string") td.textContent = node; else if (node) td.appendChild(node); tr.appendChild(td); return td; }
  function renderTable() {
    var body = $("lbrr-tbody");
    body.textContent = "";
    var list = current(), shown = list.slice(0, filt.limit);
    shown.forEach(function (b) {
      var tr = el("tr", b.researched ? "" : "lbrr-row-found");
      tr.tabIndex = 0;
      tr.id = "b-" + b.id;
      cell(tr, b.rank != null ? String(b.rank) : "–").className = "lbrr-rank";
      var biz = el("div", "lbrr-biz"); biz.appendChild(el("b", "", b.name));
      biz.appendChild(el("span", "", [b.category, b.address].filter(Boolean).join(" · ")));
      cell(tr, biz);
      if (b.score) {
        var sc = el("div", "lbrr-score");
        sc.appendChild(el("span", "lbrr-tier lbrr-tier--" + b.score.tier, b.score.tier));
        sc.appendChild(el("em", "", String(b.score.total)));
        var bar = el("i"); bar.style.setProperty("--w", b.score.total + "%"); bar.style.setProperty("--c", TIER[b.score.tier]);
        sc.appendChild(bar);
        cell(tr, sc);
      } else cell(tr, el("span", "lbrr-muted", b.chain ? "Chain" : "Not researched"));
      var k = webKind(b);
      if (k) { var w = el("span", "lbrr-web"); var sw = el("i"); sw.style.background = WEB[k] || "#A8A39C"; w.appendChild(sw); w.appendChild(doc.createTextNode(webLabel(k))); cell(tr, w); }
      else cell(tr, b.website ? "Linked" : "None");
      var st = el("span", "lbrr-stars", b.rating == null ? "–" : Number(b.rating).toFixed(1) + "★ ");
      st.appendChild(el("small", "", "(" + (b.reviews || 0) + ")"));
      cell(tr, st);
      cell(tr, b.vis ? (b.vis.rank ? "#" + b.vis.rank : (b.vis.in_pack === false ? "20+" : "–")) : "–");
      cell(tr, b.gbp && b.gbp.score != null ? String(b.gbp.score) : "–");
      if (b.score && b.score.top) {
        var s2 = el("span", "lbrr-svc"); var d = el("i"); d.style.background = SVC[b.score.top];
        s2.appendChild(d); s2.appendChild(doc.createTextNode(SVC_SHORT[b.score.top])); cell(tr, s2);
      } else cell(tr, "");
      tr.addEventListener("click", function () { openDrawer(b.id); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") openDrawer(b.id); });
      body.appendChild(tr);
    });
    $("lbrr-count").textContent = "Showing " + shown.length + " of " + list.length;
    var more = $("lbrr-more");
    more.hidden = list.length <= filt.limit;
    more.textContent = "Show " + Math.min(50, list.length - filt.limit) + " more";
    Array.prototype.forEach.call(doc.querySelectorAll("#lbrr-table th[data-sort]"), function (th) {
      var on = th.getAttribute("data-sort") === filt.sort;
      th.classList.toggle("is-sorted", on); th.classList.toggle("is-asc", on && filt.asc);
    });
  }
  function refresh() { renderChips(); renderTable(); }
  $("lbrr-more").addEventListener("click", function () { filt.limit += 50; renderTable(); });
  var qTimer = null;
  $("lbrr-q").addEventListener("input", function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { filt.q = e.target.value.trim().toLowerCase(); filt.limit = 50; renderTable(); }, 120);
  });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((doc.activeElement || {}).tagName || "") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); $("lbrr-q").focus();
    }
  });
  Array.prototype.forEach.call(doc.querySelectorAll("#lbrr-table th[data-sort]"), function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (filt.sort === k) filt.asc = !filt.asc; else { filt.sort = k; filt.asc = k !== "score" ? true : true; }
      renderTable();
    });
  });
  $("lbrr-found-n").textContent = String(FOUND_ONLY.length);
  $("lbrr-found").addEventListener("change", function (e) { filt.found = e.target.checked; renderTable(); });

  /* ── The drawer ──────────────────────────────────────────────────────── */
  var drawer = $("lbrr-drawer"), dbody = $("lbrr-drawer-body"), opener = null, openId = null;
  function card(title, cls) { var c = el("section", "lbrr-card" + (cls ? " " + cls : "")); c.appendChild(el("h3", "", title)); return c; }
  function copyBtn(text) {
    var b = el("button", "lbrr-copy", "Copy");
    b.type = "button";
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var done = function () { b.textContent = "Copied"; b.classList.add("is-done"); setTimeout(function () { b.textContent = "Copy"; b.classList.remove("is-done"); }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
    return b;
  }
  function copyRow(label, text) {
    var r = el("div", "lbrr-copyrow");
    r.appendChild(el("em", "", label)); r.appendChild(el("span", "", text)); r.appendChild(copyBtn(text));
    return r;
  }
  function checkIcon(status) { return el("span", "lbrr-st lbrr-st--" + status, { good: "✓", weak: "!", missing: "✕", unknown: "?" }[status] || "?"); }

  function renderDrawer(b) {
    dbody.textContent = "";
    $("lbrr-dr-kicker").textContent = b.rank != null ? "Lead #" + b.rank + " of " + LEADS.length : (b.chain ? "Chain, set aside" : "Found, not researched");
    var hero = el("div", "lbrr-d-hero");
    var left = el("div");
    var h = el("h2", "", b.name); h.id = "lbrr-dr-title"; left.appendChild(h);
    left.appendChild(el("p", "", [b.category, b.address].filter(Boolean).join(" · ")));
    left.appendChild(el("p", "", stars(b.rating) + " from " + plural(b.reviews || 0, "review") + (b.locations > 1 ? " · " + b.locations + " locations" : "")));
    var links = el("div", "lbrr-d-links");
    function link(href, text) { href = safeUrl(href); if (!href) return; var a = el("a", "", text); a.href = safeUrl(href); a.target = "_blank"; a.rel = "noopener noreferrer"; links.appendChild(a); }
    link(b.maps_url, "Google Maps ↗");
    link(b.website, "Website ↗");
    if (b.phone) { var tel = el("a", "", b.phone); tel.href = "tel:" + b.phone.replace(/[^+\d]/g, ""); links.appendChild(tel); }
    ((b.web || {}).emails || []).slice(0, 2).forEach(function (m) { var a = el("a", "", m); a.href = "mailto:" + m; links.appendChild(a); });
    left.appendChild(links);
    hero.appendChild(left);
    if (b.score) hero.appendChild(ring(b.score.total, 92));
    dbody.appendChild(hero);
    if (!b.researched) {
      var c0 = card("Why it was not researched");
      c0.appendChild(el("p", "", b.chain ? "A chain location (" + (b.chain_reason || "brand") + "): its marketing is bought centrally, so it is not pitched."
                                        : "It ranked below the run's cap of " + (P.run.cap || "") + " businesses for deep research."));
      dbody.appendChild(c0);
      return;
    }
    var pitch = b.pitch || {};
    var pc = card("The pitch" + (pitch.source === "claude" ? "" : " (assembled from the evidence)"), "lbrr-card--pitch");
    pc.appendChild(el("div", "lbrr-pitch-h", pitch.headline || ""));
    if (pitch.email_subject) pc.appendChild(copyRow("Email subject", pitch.email_subject));
    if (pitch.call_opener) pc.appendChild(copyRow("Call opener", pitch.call_opener));
    if (pitch.pitch) pc.appendChild(copyRow("Pitch", pitch.pitch));
    pc.appendChild(el("p", "lbrr-src", "Every number in this pitch was checked against the evidence below."));
    dbody.appendChild(pc);

    var ev = card("The evidence");
    var ul = el("ul", "lbrr-facts");
    (b.facts || []).forEach(function (f) { var li = el("li"); var d = el("i"); d.style.background = SVC[f.service] || "#A8A39C"; li.appendChild(d); li.appendChild(el("span", "", f.text)); ul.appendChild(li); });
    if (!(b.facts || []).length) ul.appendChild(el("li", "", "Nothing notable: this business is in good shape."));
    ev.appendChild(ul);
    dbody.appendChild(ev);

    var nd = card("What it needs, 0 to 100");
    var needs = el("div", "lbrr-needs");
    (b.score.ranked || []).concat(Object.keys(SVC).filter(function (k) { return b.score.need[k] == null; })).forEach(function (k) {
      var v = b.score.need[k];
      var row = el("div", "lbrr-need" + (v == null ? " lbrr-need--unknown" : ""));
      row.appendChild(el("span", "", (P.services || {})[k] || k));
      var bar = el("i"); bar.style.setProperty("--w", (v || 0) + "%"); bar.style.setProperty("--c", SVC[k]); row.appendChild(bar);
      row.appendChild(el("b", "", v == null ? "n/a" : String(v)));
      needs.appendChild(row);
    });
    nd.appendChild(needs);
    nd.appendChild(el("p", "lbrr-src", "Ability to pay: " + (b.score.ability == null ? "n/a" : b.score.ability) + "/100 (review volume, price level, ticket size, locations, existing ad spend)."));
    dbody.appendChild(nd);

    if (b.gbp) {
      var g = card("Google Business Profile" + (b.gbp.score != null ? " · " + b.gbp.score + "/100" : ""));
      var cl = el("ul", "lbrr-checks");
      (b.gbp.checks || []).forEach(function (c) { var li = el("li"); li.appendChild(checkIcon(c.status)); li.appendChild(el("span", "", c.label)); li.appendChild(el("span", "", c.detail)); cl.appendChild(li); });
      g.appendChild(cl);
      dbody.appendChild(g);
    }
    if (b.web) {
      var wc = card("Website · " + b.web.label + (b.web.score != null ? " · " + b.web.score + "/100" : ""));
      var wl = el("ul", "lbrr-checks");
      (b.web.issues || []).forEach(function (i) { var li = el("li"); li.appendChild(checkIcon(i.severity === "low" ? "weak" : "missing")); li.appendChild(el("span", "", i.severity + " priority")); li.appendChild(el("span", "", i.text)); wl.appendChild(li); });
      if (!(b.web.issues || []).length) { var ok = el("li"); ok.appendChild(checkIcon("good")); ok.appendChild(el("span", "", "No issues")); ok.appendChild(el("span", "", "The site covers the basics.")); wl.appendChild(ok); }
      wc.appendChild(wl);
      var sp = b.web.speed || {};
      if (sp.performance != null) {
        var kv = el("div", "lbrr-kv"); kv.style.marginTop = "16px";
        [["Mobile speed", sp.performance + "/100"], ["Largest paint", sp.lcp_ms != null ? (sp.lcp_ms / 1000).toFixed(1) + " s" : null],
         ["Layout shift", sp.cls != null ? String(sp.cls) : null], ["SEO basics", sp.seo != null ? sp.seo + "/100" : null]]
          .filter(function (x) { return x[1] != null; }).forEach(function (x) { var d = el("div"); d.appendChild(el("b", "", x[1])); d.appendChild(el("span", "", x[0])); kv.appendChild(d); });
        wc.appendChild(kv);
      }
      var tags = el("div", "lbrr-tags");
      if (b.web.builder) tags.appendChild(el("span", "", "Built with " + b.web.builder));
      (b.web.tags || []).forEach(function (t) { tags.appendChild(el("span", "", t.replace(/_/g, " "))); });
      Object.keys(b.web.socials || {}).forEach(function (s) { tags.appendChild(el("span", "", s)); });
      if (tags.children.length) wc.appendChild(tags);
      dbody.appendChild(wc);
    }
    if (b.rev) {
      var st = b.rev.stats || {};
      var rc = card("Reviews" + (st.sample ? " · newest " + st.sample + " read" : ""));
      var kv2 = el("div", "lbrr-kv");
      [["Positive", st.positive != null ? st.positive + "%" : "–"], ["Owner replies", st.reply_rate != null ? st.reply_rate + "%" : "–"],
       ["Last 90 days", st.recent_90d != null ? String(st.recent_90d) : "–"]].forEach(function (x) { var d = el("div"); d.appendChild(el("b", "", x[1])); d.appendChild(el("span", "", x[0])); kv2.appendChild(d); });
      rc.appendChild(kv2);
      if (st.sample) {
        var mix = el("div", "lbrr-mix"), cols = { "1": "#E34970", "2": "#E34970", "3": "#A8A39C", "4": "#0E9F6E", "5": "#0E9F6E" };
        ["5", "4", "3", "2", "1"].forEach(function (k) { var n = (st.mix || {})[k] || 0; if (!n) return; var i = el("i"); i.style.background = cols[k]; i.style.opacity = (k === "4" || k === "2") ? ".7" : "1"; i.style.width = (100 * n / st.sample) + "%"; i.title = k + "★: " + n; mix.appendChild(i); });
        rc.appendChild(mix);
        var ml = el("div", "lbrr-mixlab"); ml.appendChild(el("span", "", "5★ " + ((st.mix || {})["5"] || 0))); ml.appendChild(el("span", "", "1★ " + ((st.mix || {})["1"] || 0))); rc.appendChild(ml);
      }
      var th = b.rev.themes;
      if (th && !th.error) {
        if (th.summary) rc.appendChild(el("p", "", th.summary));
        [["What they praise", th.praise], ["What they complain about", th.complaints]].forEach(function (grp) {
          (grp[1] || []).forEach(function (t, i) {
            var box = el("div", "lbrr-theme");
            if (!i) box.appendChild(el("div", "sa-lbl", grp[0]));
            var tt = el("b", "", t.theme); box.appendChild(tt);
            box.appendChild(el("small", "", plural(t.mentions, "review")));
            box.appendChild(el("q", "", t.quote));
            rc.appendChild(box);
          });
        });
        (th.reply_drafts || []).forEach(function (d) {
          var box = el("div", "lbrr-theme");
          box.appendChild(el("div", "sa-lbl", "Draft reply to an unanswered " + d.stars + "★ review"));
          box.appendChild(el("q", "", d.review));
          var dr = el("div", "lbrr-draft", d.draft); box.appendChild(dr);
          box.appendChild(copyBtn(d.draft));
          rc.appendChild(box);
        });
        if ((th.review_plan || []).length) {
          var box2 = el("div", "lbrr-theme"); box2.appendChild(el("div", "sa-lbl", "Earning more reviews, within the rules"));
          var pl = el("ul"); th.review_plan.forEach(function (p) { pl.appendChild(el("li", "", p)); }); box2.appendChild(pl); rc.appendChild(box2);
        }
      } else if (b.rev.error) rc.appendChild(el("p", "lbrr-muted", "Reviews could not be read: " + b.rev.error));
      dbody.appendChild(rc);
    }
    if (b.vis) {
      var vc = card("Visibility");
      vc.appendChild(el("p", "", b.vis.note || "Map rank not checked."));
      if ((b.vis.competitors || []).length) {
        var comp = el("div", "lbrr-comp");
        comp.appendChild(el("div", "sa-lbl", "Showing above or around it"));
        b.vis.competitors.forEach(function (c) { var r = el("div", "lbrr-comp-row"); r.appendChild(el("b", "", "#" + (c.position || ""))); r.appendChild(el("span", "", c.title || "")); r.appendChild(el("span", "lbrr-muted", c.rating ? stars(c.rating) + " (" + (c.reviews || 0) + ")" : "")); comp.appendChild(r); });
        vc.appendChild(comp);
      }
      var ads = b.vis.ads;
      vc.appendChild(el("p", "", ads == null ? "Google Ads not checked (no working website of its own)." :
        ads.error ? "Google Ads could not be checked." :
        ads.active ? "Running Google Ads now (" + ads.creatives + " ads on record)." :
        ads.creatives ? "Has advertised on Google before (" + ads.creatives + " ads), not in the last 30 days." :
        "No Google Ads on record for its website."));
      dbody.appendChild(vc);
    }
  }
  function focusables() { return drawer.querySelectorAll("button, a[href], [tabindex='0']"); }
  function openDrawer(id) {
    var b = BY_ID[id];
    if (!b) return;
    if (drawer.hidden) opener = doc.activeElement;
    openId = id;
    renderDrawer(b);
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    drawer.classList.remove("is-open"); void drawer.offsetWidth; drawer.classList.add("is-open");
    doc.body.style.overflow = "hidden";
    dbody.scrollTop = 0;
    setTimeout(function () { var c = drawer.querySelector(".lbrr-dr-close"); if (c) c.focus(); }, 30);
  }
  function closeDrawer() {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    doc.body.style.overflow = "";
    if (opener && opener.focus) opener.focus();
  }
  function step(dir) {
    var list = current().filter(function (b) { return b.researched; });
    if (!list.length) list = LEADS;
    var i = list.map(function (b) { return b.id; }).indexOf(openId);
    var nxt = list[(i + dir + list.length) % list.length];
    if (nxt) openDrawer(nxt.id);
  }
  drawer.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) closeDrawer();
    var nav = e.target.closest("[data-nav]");
    if (nav) step(Number(nav.getAttribute("data-nav")));
  });
  doc.addEventListener("keydown", function (e) {
    if (drawer.hidden) return;
    if (e.key === "Escape") closeDrawer();
    else if (e.key === "ArrowRight" && !/INPUT|TEXTAREA/.test(doc.activeElement.tagName)) step(1);
    else if (e.key === "ArrowLeft" && !/INPUT|TEXTAREA/.test(doc.activeElement.tagName)) step(-1);
    else if (e.key === "Tab") {
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ── How this was made ───────────────────────────────────────────────── */
  (function runFacts() {
    var box = $("lbrr-runfacts"), run = P.run || {}, cost = run.cost || {}, sum = run.summary || {};
    var a = el("div", "lbrr-rf");
    a.appendChild(el("h4", "", "Spent"));
    a.appendChild(el("div", "lbrr-spend", money(cost.usd)));
    a.appendChild(el("p", "", "of a " + money((P.estimate || {}).usd_max) + " ceiling, across " + plural(cost.calls || 0, "request") +
                             (cost.unpriced ? " (" + cost.unpriced + " not priced)" : "") + ". List prices, before any free monthly usage."));
    var stack = el("div", "lbrr-stack"), prov = el("div", "lbrr-prov");
    var byp = cost.by_provider || {}, tot = cost.usd || 0;
    Object.keys(byp).sort(function (x, y) { return byp[y].usd - byp[x].usd; }).forEach(function (k) {
      var meta = PROVIDER[k] || [k, "#A8A39C"], v = byp[k];
      if (tot && v.usd) { var i = el("i"); i.style.background = meta[1]; i.style.width = (100 * v.usd / tot) + "%"; stack.appendChild(i); }
      var row = el("div"); var sw = el("i"); sw.style.background = meta[1]; row.appendChild(sw);
      row.appendChild(el("span", "", meta[0] + " · " + plural(v.calls, "call") + (v.failed ? ", " + v.failed + " failed" : "")));
      row.appendChild(el("b", "", money(v.usd)));
      prov.appendChild(row);
    });
    a.appendChild(stack); a.appendChild(prov);
    box.appendChild(a);

    var b = el("div", "lbrr-rf");
    b.appendChild(el("h4", "", "Coverage"));
    var st = sum.stats || {};
    var cov = { complete: "Complete: every part of the area was searched until no search came back full.",
                partial: "Partial: " + plural(st.tiles_still_full || 0, "dense area") + " still had more businesses than the search budget reached.",
                stopped: "Stopped early, when the run was cancelled." }[st.coverage] || "Not recorded.";
    b.appendChild(el("p", "", cov));
    var ul = el("ul");
    [[st.found, "found on Google"], [st.chains, "chain locations set aside"], [st.closed, "closed businesses dropped"],
     [st.outside_area, "outside the area dropped"], [st.selected, "researched in depth"]].forEach(function (x) {
      if (x[0] != null) ul.appendChild(el("li", "", x[0] + " " + x[1]));
    });
    b.appendChild(ul);
    if ((sum.unchecked_tools || []).length) b.appendChild(el("p", "", "Not connected for this run, so not checked: " + sum.unchecked_tools.join(", ") + "."));
    box.appendChild(b);

    var c = el("div", "lbrr-rf");
    c.appendChild(el("h4", "", "The rules it keeps"));
    var comp = sum.compliance || {};
    c.appendChild(el("p", "", comp.rule || ""));
    var cl = el("ul");
    (comp.sources || []).forEach(function (s) { var li = el("li"); var an = el(safeUrl(s.url) ? "a" : "span", "", s.name); if (safeUrl(s.url)) an.href = safeUrl(s.url); an.target = "_blank"; an.rel = "noopener noreferrer"; li.appendChild(an); cl.appendChild(li); });
    c.appendChild(cl);
    c.appendChild(el("p", "", "Reviewer names are never stored. Google profile details are kept for a limited time, as Google's terms require; scores and rankings stay."));
    box.appendChild(c);
  })();

  /* ── Go ──────────────────────────────────────────────────────────────── */
  drawGaps(); drawWaffle(); drawScatter(); drawHist(); refresh();
  onView([$("lbrr-map")], drawMap);
  var rt = null;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { drawMap(); drawScatter(); drawHist(); }, 200);
  });
  if (location.hash && location.hash.indexOf("#b-") === 0) openDrawer(location.hash.slice(3));
})();
