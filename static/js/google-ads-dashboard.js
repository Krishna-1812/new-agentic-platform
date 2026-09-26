/* ════════════════════════════════════════════════════════════════════════
   GOOGLE ADS PERFORMANCE — the page engine.

   The route embeds every row of the Ads → Sheets export once
   (#gad-data); everything here -- filtering, the previous-period
   comparison, aggregation, and every chart -- runs in the browser against
   that set, so each filter answers instantly.

   Charts are plain SVG drawn at their container's real pixel width (and
   redrawn on resize), so type and circles never stretch. No build step and
   no chart library, the same constraint as bento-motion.js.

   Colour rules (validated with the dataviz checker):
     - campaign types take a FIXED slot from the brand-led categorical order,
       assigned once from total spend across ALL rows, so a filter never
       repaints the survivors; past six types a type folds into grey "Other";
     - single-series charts use one hue (orange); magnitude uses one orange
       ramp, light to dark; good/bad deltas always carry an arrow and a sign.

   Motion follows the public site (press-play.js): blocks settle, the marker
   draws, digits roll, labels decode, pills flood from the pointer, and every
   chart draws itself the first time it is on screen. prefers-reduced-motion
   switches all of it off, not down.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var dataEl = document.getElementById("gad-data");
  if (!dataEl) return;

  var doc = document, root = doc.documentElement;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!REDUCED) root.classList.add("gad-play");

  var ALL_ROWS = [];
  try { ALL_ROWS = JSON.parse(dataEl.textContent || "[]"); } catch (e) { ALL_ROWS = []; }
  var CURRENCY = doc.body.getAttribute("data-currency-symbol") || "";
  var SVGNS = "http://www.w3.org/2000/svg";

  var SERIES = ["#FF6022", "#1D65A6", "#E0A100", "#0E9F6E", "#8C4FD9", "#E34970"];
  var OTHER = "#A8A39C";
  var ACC = "#FF6022";
  var RAMP = ["#FFE4D8", "#FFC2A6", "#FF9A70", "#FF6022", "#C94513"];
  var FUNNEL = ["#FFD2BF", "#FF8B5D", "#FF6022"];
  var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function $(id) { return doc.getElementById(id); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function svgEl(tag, attrs, parent) {
    var el = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ── Dates (ISO yyyy-mm-dd strings, handled in UTC) ─────────────────── */
  function toDate(iso) { var p = iso.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toIso(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function weekday(iso) { return (toDate(iso).getUTCDay() + 6) % 7; }   // Mon = 0
  function weekStart(iso) { return addDays(iso, -weekday(iso)); }
  function fmtDay(iso, withYear) {
    var d = toDate(iso);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + (withYear ? " " + d.getUTCFullYear() : "");
  }
  function isoRange(a, b) { var out = []; for (var d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }

  /* ── Formatting ─────────────────────────────────────────────────────── */
  function fmtInt(n) { return Math.round(n).toLocaleString("en-IN"); }
  function fmtMoney(n) { return CURRENCY + Math.round(n).toLocaleString("en-IN"); }
  function fmtMoney2(n) { return CURRENCY + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPct(n) { return n.toFixed(2) + "%"; }
  function fmtCompact(n, money) {
    var a = Math.abs(n), s;
    if (a >= 1e7) s = (n / 1e7).toFixed(a >= 1e8 ? 0 : 1) + "Cr";
    else if (a >= 1e5) s = (n / 1e5).toFixed(a >= 1e6 ? 0 : 1) + "L";
    else if (a >= 1e3) s = (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
    else s = a < 10 && a % 1 ? n.toFixed(1) : String(Math.round(n));
    s = s.replace(".0", "");
    return (money ? CURRENCY : "") + s;
  }

  /* ── Metrics: every one is a function of the same five sums ─────────── */
  function zero() { return { cost: 0, clicks: 0, impressions: 0, conversions: 0, view_through: 0, topW: 0, absW: 0 }; }
  function addInto(s, r) {
    s.cost += r.cost || 0; s.clicks += r.clicks || 0; s.impressions += r.impressions || 0;
    s.conversions += r.conversions || 0; s.view_through += r.view_through || 0;
    s.topW += (r.top_pct || 0) * (r.impressions || 0); s.absW += (r.abs_top_pct || 0) * (r.impressions || 0);
  }
  function div(a, b) { return b ? a / b : null; }

  // good: +1 up is better, -1 down is better, 0 neutral (spend).
  var METRICS = {
    cost:         { label: "Spend",        v: function (s) { return s.cost; },                              fmt: fmtMoney,  short: function (n) { return fmtCompact(n, true); },  good: 0,  add: true },
    clicks:       { label: "Clicks",       v: function (s) { return s.clicks; },                            fmt: fmtInt,    short: function (n) { return fmtCompact(n); },        good: 1,  add: true },
    impressions:  { label: "Impressions",  v: function (s) { return s.impressions; },                       fmt: fmtInt,    short: function (n) { return fmtCompact(n); },        good: 1,  add: true },
    conversions:  { label: "Conversions",  v: function (s) { return s.conversions; },                       fmt: function (n) { return n % 1 ? n.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : fmtInt(n); }, short: function (n) { return fmtCompact(n); }, good: 1, add: true },
    ctr:          { label: "CTR",          v: function (s) { var x = div(s.clicks, s.impressions); return x == null ? null : x * 100; }, fmt: fmtPct, short: function (n) { return n.toFixed(1) + "%"; }, good: 1 },
    cpc:          { label: "Avg. CPC",     v: function (s) { return div(s.cost, s.clicks); },               fmt: fmtMoney2, short: function (n) { return fmtCompact(n, true); },  good: -1 },
    cpa:          { label: "Cost / conv.", v: function (s) { return div(s.cost, s.conversions); },          fmt: fmtMoney2, short: function (n) { return fmtCompact(n, true); },  good: -1 },
    cvr:          { label: "Conv. rate",   v: function (s) { var x = div(s.conversions, s.clicks); return x == null ? null : x * 100; }, fmt: fmtPct, short: function (n) { return n.toFixed(1) + "%"; }, good: 1 },
    view_through: { label: "View-through conv.", v: function (s) { return s.view_through; },               fmt: fmtInt,    short: function (n) { return fmtCompact(n); },        good: 1,  add: true }
  };

  /* ── Static facts about the full row set ────────────────────────────── */
  var DAYS, MIN_DAY, MAX_DAY, ACCOUNTS, TYPE_COLOR;
  function derive() {
    var dset = {}, accSpend = {}, typeSpend = {};
    ALL_ROWS.forEach(function (r) {
      if (r.day) dset[r.day] = 1;
      accSpend[r.account] = (accSpend[r.account] || 0) + (r.cost || 0);
      typeSpend[r.type || "Other"] = (typeSpend[r.type || "Other"] || 0) + (r.cost || 0);
    });
    DAYS = Object.keys(dset).sort();
    MIN_DAY = DAYS[0] || toIso(new Date());
    MAX_DAY = DAYS[DAYS.length - 1] || MIN_DAY;
    ACCOUNTS = Object.keys(accSpend).filter(Boolean).sort(function (a, b) { return a.localeCompare(b); });
    TYPE_COLOR = {};
    Object.keys(typeSpend).sort(function (a, b) { return typeSpend[b] - typeSpend[a]; })
      .forEach(function (t, i) { TYPE_COLOR[t] = i < SERIES.length ? SERIES[i] : OTHER; });
  }
  function typeColor(t) { return TYPE_COLOR[t || "Other"] || OTHER; }

  /* ── State ──────────────────────────────────────────────────────────── */
  var state = {
    account: "__all__", type: "__all__", status: "__all__", search: "", focus: null,
    preset: "all", from: null, to: null, compare: true,
    metric: "cost", grain: "day", sortKey: "cost", sortDir: -1, shown: 15
  };

  function applyPreset(p) {
    state.preset = p;
    if (p === "all") { state.from = MIN_DAY; state.to = MAX_DAY; }
    else { var n = parseInt(p, 10); state.to = MAX_DAY; state.from = addDays(MAX_DAY, -(n - 1)); if (state.from < MIN_DAY) state.from = MIN_DAY; }
  }
  function periodLen() { return daysBetween(state.from, state.to) + 1; }
  function prevRange() {
    var n = periodLen(), to = addDays(state.from, -1), from = addDays(state.from, -n);
    return from >= MIN_DAY ? { from: from, to: to } : null;
  }

  function matches(r, ignoreAccount) {
    if (!ignoreAccount && state.account !== "__all__" && r.account !== state.account) return false;
    if (state.type !== "__all__" && r.type !== state.type) return false;
    if (state.status !== "__all__" && r.state !== state.status) return false;
    if (state.focus && (r.account + "\u0001" + r.campaign) !== state.focus) return false;
    if (state.search) {
      var q = state.search;
      if ((r.campaign || "").toLowerCase().indexOf(q) === -1 && (r.account || "").toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }
  function rowsIn(from, to, ignoreAccount) {
    return ALL_ROWS.filter(function (r) { return r.day >= from && r.day <= to && matches(r, ignoreAccount); });
  }

  function aggregate(rows) {
    var a = { totals: zero(), daily: {}, camps: {}, types: {}, accounts: {}, weekday: [], asOf: "" };
    for (var w = 0; w < 7; w++) a.weekday.push(zero());
    rows.forEach(function (r) {
      addInto(a.totals, r);
      (a.daily[r.day] = a.daily[r.day] || zero()); addInto(a.daily[r.day], r);
      addInto(a.weekday[weekday(r.day)], r);
      var key = r.account + "\u0001" + r.campaign;
      var c = a.camps[key];
      if (!c) c = a.camps[key] = { key: key, account: r.account, campaign: r.campaign, type: r.type, state: r.state, s: zero(), days: {}, last: "" };
      addInto(c.s, r); c.days[r.day] = (c.days[r.day] || 0) + (r.cost || 0);
      if (r.day >= c.last) { c.last = r.day; c.state = r.state; }
      var t = r.type || "Other";
      (a.types[t] = a.types[t] || zero()); addInto(a.types[t], r);
      (a.accounts[r.account] = a.accounts[r.account] || { name: r.account, s: zero(), camps: {} });
      addInto(a.accounts[r.account].s, r); a.accounts[r.account].camps[r.campaign] = 1;
      if (r.day > a.asOf) a.asOf = r.day;
    });
    a.campList = Object.keys(a.camps).map(function (k) { return a.camps[k]; });
    a.accList = Object.keys(a.accounts).map(function (k) { return a.accounts[k]; });
    return a;
  }

  /* ── Shared tooltip ─────────────────────────────────────────────────── */
  var tip = doc.createElement("div");
  tip.className = "gad-tip"; tip.setAttribute("role", "tooltip");
  doc.body.appendChild(tip);
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.add("is-on");
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth;
    var left = Math.min(Math.max(8, x - w / 2), vw - w - 8);
    var top = y - h - 16; if (top < 8) top = y + 20;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function hideTip() { tip.classList.remove("is-on"); }
  function tipRow(label, val, color) {
    return '<div class="gad-tip-r"><span>' + (color ? '<i style="background:' + color + '"></i>' : "") + esc(label) + "</span><b>" + esc(val) + "</b></div>";
  }

  /* ── Chart arrival: draw the first time a panel is on screen ────────── */
  var seen = {};
  function panelOf(el) { var p = el.closest("[data-panel]"); return p ? p.getAttribute("data-panel") : ""; }
  function animate(container) {
    // Called after a chart has been (re)drawn into container.
    if (REDUCED) return;
    var id = panelOf(container);
    container.classList.add("gad-anim");
    container.classList.remove("is-drawn");
    if (!seen[id]) return;                       // drawn later by the watcher
    void container.offsetWidth;
    requestAnimationFrame(function () { container.classList.add("is-drawn"); });
  }
  function watchPanels() {
    if (REDUCED) return;
    var panels = $$("[data-panel]");
    function check() {
      var vh = window.innerHeight;
      panels.forEach(function (p) {
        var id = p.getAttribute("data-panel");
        if (seen[id]) return;
        var r = p.getBoundingClientRect();
        if (r.top < vh * 0.88 && r.bottom > 0) {
          seen[id] = true;
          $$(".gad-anim", p).forEach(function (c) {
            void c.offsetWidth;
            requestAnimationFrame(function () { c.classList.add("is-drawn"); });
          });
          var lbl = p.querySelector("[data-gad-decode]");
          if (lbl) decode(lbl);
        }
      });
    }
    var pending = false;
    window.addEventListener("scroll", function () { if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; check(); }); } }, { passive: true });
    window.addEventListener("resize", check);
    check();
  }

  /* Labels decode from scrambled glyphs, as on the public site. */
  function decode(el) {
    if (REDUCED || el.__decoded) return;
    el.__decoded = true;
    var final = el.textContent, glyphs = "#%&*+=<>/\\|ABCDEFGHKMNPRSTXZ0123456789";
    var start = performance.now(), dur = 700;
    (function step(t) {
      var p = Math.min(1, (t - start) / dur), n = Math.floor(final.length * p), out = "";
      for (var i = 0; i < final.length; i++) {
        var ch = final.charAt(i);
        out += i < n || ch === " " || ch === "·" ? ch : glyphs.charAt(Math.floor(Math.random() * glyphs.length));
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step); else el.textContent = final;
    })(start);
  }

  /* ── The odometer ───────────────────────────────────────────────────── */
  function odo(el, text) {
    var prev = el.getAttribute("data-text") || "";
    if (prev === text) return;
    el.setAttribute("data-text", text);
    el.setAttribute("aria-label", text);
    if (REDUCED) { el.textContent = text; return; }
    var wrap = doc.createElement("span"); wrap.className = "gad-odo"; wrap.setAttribute("aria-hidden", "true");
    var strips = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (/\d/.test(ch)) {
        var col = doc.createElement("span"); col.className = "gad-odo-c";
        var strip = doc.createElement("span"); strip.className = "gad-odo-s";
        for (var d = 0; d <= 9; d++) { var s = doc.createElement("span"); s.textContent = d; strip.appendChild(s); }
        col.appendChild(strip); wrap.appendChild(col);
        // Start from the digit in the same place counted from the right.
        var j = prev.length - (text.length - i), from = j >= 0 && /\d/.test(prev.charAt(j)) ? +prev.charAt(j) : 0;
        strip.style.transition = "none";
        strip.style.transform = "translateY(" + (-from) + "em)";
        strips.push([strip, +ch]);
      } else {
        var t = doc.createElement("span"); t.textContent = ch; wrap.appendChild(t);
      }
    }
    el.textContent = ""; el.appendChild(wrap);
    void wrap.offsetWidth;
    requestAnimationFrame(function () {
      strips.forEach(function (p) { p[0].style.transition = ""; p[0].style.transform = "translateY(" + (-p[1]) + "em)"; });
    });
    // The rolling columns are equal-width by construction; once they land,
    // the figure goes back to plain text so its digits sit proportionally.
    clearTimeout(el.__odoT);
    el.__odoT = setTimeout(function () { if (el.getAttribute("data-text") === text) el.textContent = text; }, 1250);
  }

  /* ── Delta chip ─────────────────────────────────────────────────────── */
  function deltaHtml(key, cur, prev) {
    if (cur == null || prev == null || !state.compare) return "";
    var m = METRICS[key];
    if (prev === 0) return cur === 0 ? '<span aria-hidden="true">&rarr;</span> 0%' : "new";
    var ch = (cur - prev) / Math.abs(prev) * 100;
    var arrow = ch > 0.05 ? "&uarr;" : ch < -0.05 ? "&darr;" : "&rarr;";
    return '<span aria-hidden="true">' + arrow + "</span>" + (ch > 0 ? "+" : "") + ch.toFixed(1) + "% <small>vs prev.</small>";
  }
  function deltaClass(key, cur, prev) {
    if (cur == null || prev == null || !prev || !state.compare) return "";
    var g = METRICS[key].good, ch = cur - prev;
    if (!g || Math.abs(ch / prev) < 0.005) return "";
    return (ch > 0) === (g > 0) ? "is-good" : "is-bad";
  }

  /* ── KPI blocks and tiles ───────────────────────────────────────────── */
  function renderKpis(cur, prev) {
    $$("[data-kpi]").forEach(function (el) {
      var key = el.getAttribute("data-kpi"), m = METRICS[key];
      var v = m.v(cur.totals), pv = prev ? m.v(prev.totals) : null;
      odo(el.querySelector("[data-v]"), v == null ? "—" : m.fmt(v));
      var d = el.querySelector("[data-d]");
      d.className = "gad-delta " + deltaClass(key, v, pv);
      d.innerHTML = prev ? deltaHtml(key, v, pv) : "";
      var sp = el.querySelector("[data-spark]");
      if (sp) drawSpark(sp, key, cur);
    });
  }
  function drawSpark(svg, key, agg) {
    var w = svg.clientWidth || 280, h = svg.clientHeight || 64, m = METRICS[key];
    var days = isoRange(state.from, state.to), vals = days.map(function (d) { return agg.daily[d] ? (m.v(agg.daily[d]) || 0) : 0; });
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    if (vals.length < 2) return;
    var max = Math.max.apply(null, vals) || 1, pad = 6;
    var pts = vals.map(function (v, i) { return [i / (vals.length - 1) * w, h - pad - (v / max) * (h - pad * 2 - 4)]; });
    var d = smooth(pts);
    svgEl("path", { "class": "a gad-area", d: d + " L" + w + "," + h + " L0," + h + " Z" }, svg);
    var line = svgEl("path", { "class": "l gad-line", d: d }, svg);
    setLen(line);
    if (!REDUCED) {
      svg.classList.add("gad-anim"); svg.classList.remove("is-drawn");
      void svg.getBoundingClientRect();
      requestAnimationFrame(function () { requestAnimationFrame(function () { svg.classList.add("is-drawn"); }); });
    }
  }
  function setLen(path) {
    try { var L = Math.ceil(path.getTotalLength()) + 2; path.style.setProperty("--len", L); } catch (e) { /* not rendered yet */ }
  }
  // Monotone-ish smoothing: a gentle curve that never overshoots badly.
  function smooth(pts) {
    if (!pts.length) return "";
    var d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1], p1 = pts[i], cx = (p0[0] + p1[0]) / 2;
      d += " C" + cx.toFixed(1) + "," + p0[1].toFixed(1) + " " + cx.toFixed(1) + "," + p1[1].toFixed(1) + " " + p1[0].toFixed(1) + "," + p1[1].toFixed(1);
    }
    return d;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  /* ── Hero, ticker ───────────────────────────────────────────────────── */
  var lastTitle = null;
  function renderHero(cur) {
    var name = state.account === "__all__" ? "All accounts" : state.account;
    var h1 = $("gad-account-title"), ln = h1.querySelector(".gad-ln");
    if (lastTitle !== name) {
      var first = lastTitle === null;
      lastTitle = name;
      var put = function () { ln.innerHTML = '<span><span class="gad-mk">' + esc(name) + "</span></span>"; };
      if (first || REDUCED) put();
      else {
        ln.classList.add("is-out");
        setTimeout(function () {
          put(); ln.classList.remove("is-out"); ln.classList.add("is-below");
          var mk = ln.querySelector(".gad-mk"); mk.style.backgroundSize = "0% 100%";
          void ln.offsetWidth;
          requestAnimationFrame(function () {
            ln.classList.remove("is-below");
            mk.style.transition = "background-size 800ms cubic-bezier(.22,1,.36,1) 180ms"; mk.style.backgroundSize = "100% 100%";
          });
        }, 260);
      }
    }
    var nAcc = cur.accList.length, nCamp = cur.campList.length;
    $("gad-hero-sub").innerHTML =
      "<b>" + fmtDay(state.from) + " – " + fmtDay(state.to, true) + "</b> &middot; " +
      periodLen() + (periodLen() === 1 ? " day" : " days") + " &middot; " +
      (state.account === "__all__" ? nAcc + (nAcc === 1 ? " account" : " accounts") + " &middot; " : "") +
      nCamp + (nCamp === 1 ? " campaign" : " campaigns") +
      " &middot; data through " + fmtDay(MAX_DAY, true);
  }

  function renderTicker() {
    var track = $("gad-tick-track");
    var agg = aggregate(rowsIn(state.from, state.to, true));
    var list = agg.accList.sort(function (a, b) { return b.s.cost - a.s.cost; });
    if (!list.length) { track.innerHTML = ""; return; }
    var html = list.map(function (a) {
      return '<button type="button" class="gad-tick-i' + (a.name === state.account ? " is-on" : "") + '" data-acc="' + esc(a.name) + '">' +
        "<b>" + esc(a.name) + "</b>" + fmtMoney(a.s.cost) + " &middot; " + METRICS.conversions.fmt(a.s.conversions) + " conv.</button>";
    }).join("");
    // Twice, so the loop is seamless.
    track.innerHTML = html + html.replace(/class="gad-tick-i/g, 'tabindex="-1" aria-hidden="true" class="gad-tick-i');
    track.style.setProperty("--tick-dur", Math.max(30, list.length * 6) + "s");
  }

  /* ── Trend ──────────────────────────────────────────────────────────── */
  function buckets(agg, from, to) {
    var days = isoRange(from, to), out = [];
    if (state.grain === "week") {
      var map = {};
      days.forEach(function (d) {
        var k = weekStart(d);
        if (!map[k]) { map[k] = { key: k, label: "w/c " + fmtDay(k), s: zero(), n: 0 }; out.push(map[k]); }
        var s = agg.daily[d]; if (s) for (var f in s) map[k].s[f] += s[f];
        map[k].n++;
      });
    } else {
      days.forEach(function (d) { out.push({ key: d, label: WEEKDAYS[weekday(d)] + " " + fmtDay(d, true), s: agg.daily[d] || zero(), n: 1 }); });
    }
    return out;
  }

  function renderTrend(cur, prevAgg, prev) {
    var box = $("gad-trend"), m = METRICS[state.metric];
    var pts = buckets(cur, state.from, state.to);
    var ppts = prev ? buckets(prevAgg, prev.from, prev.to) : null;
    var legend = $("gad-trend-legend");
    legend.innerHTML = '<span class="gad-key"><i></i>' + esc(m.label) + " &middot; <b>" + esc(fmtDay(state.from) + " – " + fmtDay(state.to)) + "</b></span>" +
      (ppts ? '<span class="gad-key"><i class="is-prev"></i>Previous period &middot; <b>' + esc(fmtDay(prev.from) + " – " + fmtDay(prev.to)) + "</b></span>" : "");

    box.innerHTML = "";
    if (pts.length < 2) {
      box.innerHTML = '<div class="gad-empty-chart">Pick a range of at least two ' + (state.grain === "week" ? "weeks" : "days") + " to see a trend.</div>";
      return;
    }
    var W = box.clientWidth || 800, H = W < 560 ? 240 : 300, pl = 56, pr = 14, pt = 14, pb = 30;
    var iw = W - pl - pr, ih = H - pt - pb;
    var vals = pts.map(function (p) { return m.v(p.s); });
    var pvals = ppts ? ppts.map(function (p) { return m.v(p.s); }) : [];
    var max = niceMax(Math.max.apply(null, vals.concat(pvals).map(function (v) { return v || 0; })));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": m.label + " trend" }, box);
    var x = function (i) { return pl + (pts.length === 1 ? iw / 2 : i / (pts.length - 1) * iw); };
    var y = function (v) { return pt + ih - (v || 0) / max * ih; };

    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = y(gv);
      svgEl("line", { x1: pl, x2: W - pr, y1: gy, y2: gy, "class": g ? "gad-grid-l" : "gad-base-l" }, svg);
      svgEl("text", { x: pl - 10, y: gy + 4, "text-anchor": "end", "class": "gad-ax" }, svg).textContent = m.short(gv);
    }
    var every = Math.max(1, Math.ceil(pts.length / (W < 560 ? 4 : 8)));
    pts.forEach(function (p, i) {
      if (i % every && i !== pts.length - 1) return;
      if (i !== pts.length - 1 && pts.length - 1 - i < every * 0.6) return;
      svgEl("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle", "class": "gad-ax" }, svg)
        .textContent = state.grain === "week" ? fmtDay(p.key) : fmtDay(p.key);
    });

    var line = pts.map(function (p, i) { return [x(i), y(vals[i])]; });
    if (ppts && ppts.length > 1) {
      var pl2 = ppts.slice(0, pts.length).map(function (p, i) { return [x(i), y(pvals[i])]; });
      var pp = svgEl("path", { d: smooth(pl2), fill: "none", stroke: "#B9B4AC", "stroke-width": 1.75, "class": "gad-line", "stroke-linecap": "round" }, svg);
      setLen(pp);
    }
    var base = pt + ih;
    svgEl("path", { d: smooth(line) + " L" + x(pts.length - 1) + "," + base + " L" + x(0) + "," + base + " Z", fill: ACC, "fill-opacity": 0.12, "class": "gad-area" }, svg);
    var main = svgEl("path", { d: smooth(line), fill: "none", stroke: ACC, "stroke-width": 2.5, "stroke-linecap": "round", "class": "gad-line" }, svg);
    setLen(main);

    // Direct label on the peak only -- never a number on every point.
    var pk = 0; vals.forEach(function (v, i) { if ((v || 0) > (vals[pk] || 0)) pk = i; });
    if (vals[pk]) {
      svgEl("circle", { cx: x(pk), cy: y(vals[pk]), r: 5, fill: ACC, stroke: "#fff", "stroke-width": 2, "class": "gad-dot" }, svg);
      var lx = Math.min(Math.max(x(pk), pl + 40), W - pr - 40);
      svgEl("text", { x: lx, y: Math.max(12, y(vals[pk]) - 12), "text-anchor": "middle", "class": "gad-ax", style: "fill:#121213;font-weight:600" }, svg)
        .textContent = "Peak " + m.short(vals[pk]);
    }

    var cross = svgEl("line", { y1: pt, y2: base, "class": "gad-cross" }, svg);
    var hot = svgEl("circle", { r: 6, fill: ACC, stroke: "#fff", "stroke-width": 2.5, opacity: 0 }, svg);
    var hit = svgEl("rect", { x: pl, y: pt, width: iw, height: ih + pb, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", function (e) {
      var r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width);
      var i = Math.round((mx - pl) / iw * (pts.length - 1)); i = Math.max(0, Math.min(pts.length - 1, i));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.opacity = 0.25;
      hot.setAttribute("cx", x(i)); hot.setAttribute("cy", y(vals[i])); hot.setAttribute("opacity", 1);
      var s = pts[i].s, html = '<div class="gad-tip-t">' + esc(pts[i].label) + "</div>" +
        tipRow(m.label, vals[i] == null ? "—" : m.fmt(vals[i]), ACC);
      if (ppts && ppts[i]) html += tipRow("Previous", pvals[i] == null ? "—" : m.fmt(pvals[i]), "#B9B4AC");
      html += '<div style="height:6px"></div>';
      ["cost", "clicks", "conversions"].forEach(function (k) { if (k !== state.metric) html += tipRow(METRICS[k].label, METRICS[k].fmt(METRICS[k].v(s))); });
      showTip(html, e.clientX, r.top + (y(vals[i]) / H) * r.height);
    });
    hit.addEventListener("mouseleave", function () { hideTip(); cross.style.opacity = 0; hot.setAttribute("opacity", 0); });
    animate(box);
  }

  /* ── Funnel ─────────────────────────────────────────────────────────── */
  function renderFunnel(cur) {
    var s = cur.totals, box = $("gad-funnel");
    var ctr = METRICS.ctr.v(s), cvr = METRICS.cvr.v(s), cpa = METRICS.cpa.v(s);
    var arrow = '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>';
    box.innerHTML =
      '<div class="gad-fstep" style="width:100%;background:' + FUNNEL[0] + '"><span>Impressions</span><b>' + fmtInt(s.impressions) + "</b></div>" +
      '<div class="gad-frate">' + arrow + "CTR <b>" + (ctr == null ? "—" : fmtPct(ctr)) + "</b></div>" +
      '<div class="gad-fstep" style="width:82%;background:' + FUNNEL[1] + '"><span>Clicks</span><b>' + fmtInt(s.clicks) + "</b></div>" +
      '<div class="gad-frate">' + arrow + "Conv. rate <b>" + (cvr == null ? "—" : fmtPct(cvr)) + "</b></div>" +
      '<div class="gad-fstep" style="width:64%;background:' + FUNNEL[2] + '"><span>Conversions</span><b>' + METRICS.conversions.fmt(s.conversions) + "</b></div>" +
      '<div class="gad-frate">Cost per conversion <b>' + (cpa == null ? "—" : fmtMoney2(cpa)) + "</b></div>";
    animate(box);
  }

  /* ── Donut ──────────────────────────────────────────────────────────── */
  function renderDonut(cur) {
    var box = $("gad-donut"), leg = $("gad-donut-legend");
    var total = cur.totals.cost;
    var list = Object.keys(cur.types).map(function (t) { return { t: t, s: cur.types[t] }; })
      .sort(function (a, b) { return b.s.cost - a.s.cost; });
    box.innerHTML = ""; leg.innerHTML = "";
    var S = 176, R = 66, C = 2 * Math.PI * R;
    var svg = svgEl("svg", { viewBox: "0 0 " + S + " " + S, role: "img", "aria-label": "Spend by campaign type" }, box);
    svgEl("circle", { cx: S / 2, cy: S / 2, r: R, fill: "none", stroke: "#EBE9E5", "stroke-width": 22 }, svg);
    var acc = 0, gap = list.length > 1 ? 2.5 : 0;
    list.forEach(function (it) {
      var frac = total ? it.s.cost / total : 0, len = Math.max(0, frac * C - gap);
      var arc = svgEl("circle", {
        cx: S / 2, cy: S / 2, r: R, fill: "none", stroke: typeColor(it.t), "stroke-width": 22,
        "stroke-dasharray": len + " " + (C - len), "class": "gad-seg-arc gad-arc",
        transform: "rotate(" + (-90 + acc / C * 360) + " " + S / 2 + " " + S / 2 + ")"
      }, svg);
      arc.style.setProperty("--da", len + "px " + (C - len) + "px");
      arc.style.setProperty("--da0", "0px " + C + "px");
      acc += frac * C;
      it.arc = arc;
    });
    var ct = svgEl("text", { x: S / 2, y: S / 2 - 2, "text-anchor": "middle", style: "font-size:20px;font-weight:700;fill:#121213;letter-spacing:-.03em" }, svg);
    ct.textContent = fmtCompact(total, true);
    svgEl("text", { x: S / 2, y: S / 2 + 18, "text-anchor": "middle", "class": "gad-ax" }, svg).textContent = list.length + (list.length === 1 ? " type" : " types");

    list.forEach(function (it) {
      var li = doc.createElement("li");
      if (state.type === it.t) li.className = "is-on";
      var share = total ? it.s.cost / total * 100 : 0;
      li.innerHTML = '<i style="background:' + typeColor(it.t) + '"></i><span>' + esc(it.t) + "<small>" + share.toFixed(1) + "% of spend</small></span>" +
        '<span class="gad-legend-v">' + fmtMoney(it.s.cost) + "<small>" + METRICS.conversions.fmt(it.s.conversions) + " conv.</small></span>";
      li.tabIndex = 0; li.setAttribute("role", "button");
      li.setAttribute("aria-pressed", state.type === it.t ? "true" : "false");
      var on = function () { box.classList.add("is-dim"); it.arc.classList.add("is-hot"); li.classList.add("is-hot"); };
      var off = function () { box.classList.remove("is-dim"); it.arc.classList.remove("is-hot"); li.classList.remove("is-hot"); hideTip(); };
      var pick = function () { setType(state.type === it.t ? "__all__" : it.t); };
      li.addEventListener("mouseenter", on); li.addEventListener("mouseleave", off);
      li.addEventListener("click", pick);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      it.arc.addEventListener("mouseenter", on);
      it.arc.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + esc(it.t) + "</div>" + tipRow("Spend", fmtMoney(it.s.cost), typeColor(it.t)) +
          tipRow("Share", share.toFixed(1) + "%") + tipRow("Clicks", fmtInt(it.s.clicks)) + tipRow("Conversions", METRICS.conversions.fmt(it.s.conversions)), e.clientX, e.clientY);
      });
      it.arc.addEventListener("mouseleave", off);
      it.arc.addEventListener("click", pick);
      leg.appendChild(li);
    });
    if (!list.length) leg.innerHTML = '<li class="gad-muted">No spend in this range.</li>';
    animate(box);
  }

  /* ── Ad position gauges ─────────────────────────────────────────────── */
  function renderGauges(cur) {
    var s = cur.totals, box = $("gad-gauges");
    var top = s.impressions ? s.topW / s.impressions : null, abs = s.impressions ? s.absW / s.impressions : null;
    box.innerHTML = "";
    [["Top of page", top, "#1D65A6"], ["Absolute top", abs, ACC]].forEach(function (g) {
      var wrap = doc.createElement("div"); wrap.className = "gad-gauge";
      var S = 150, R = 58, C = 2 * Math.PI * R, v = g[1] == null ? 0 : Math.min(100, g[1]);
      var svg = svgEl("svg", { viewBox: "0 0 " + S + " " + S, role: "img", "aria-label": g[0] + " " + (g[1] == null ? "no data" : v.toFixed(1) + "%") }, wrap);
      svgEl("circle", { cx: S / 2, cy: S / 2, r: R, fill: "none", stroke: "#EBE9E5", "stroke-width": 14 }, svg);
      var ring = svgEl("circle", {
        cx: S / 2, cy: S / 2, r: R, fill: "none", stroke: g[2], "stroke-width": 14, "stroke-linecap": "round",
        "stroke-dasharray": C, transform: "rotate(-90 " + S / 2 + " " + S / 2 + ")", "class": "gad-ring"
      }, svg);
      var off = C * (1 - v / 100);
      ring.style.setProperty("--len", C); ring.style.setProperty("--off", off); ring.style.strokeDashoffset = off;
      svgEl("text", { x: S / 2, y: S / 2 + 9, "text-anchor": "middle", "class": "gad-gauge-v" }, svg).textContent = g[1] == null ? "—" : v.toFixed(1) + "%";
      var l = doc.createElement("span"); l.className = "gad-gauge-l"; l.textContent = g[0];
      wrap.appendChild(l); box.appendChild(wrap);
    });
    animate(box);
  }

  /* ── Leaderboard ────────────────────────────────────────────────────── */
  function renderBoard(cur) {
    var box = $("gad-board"), all = state.account === "__all__" && !state.focus;
    $("gad-board-title").textContent = all ? "Spend by account" : "Top campaigns by spend";
    var items = all
      ? cur.accList.map(function (a) { return { id: a.name, name: a.name, sub: Object.keys(a.camps).length + " campaigns", s: a.s }; })
      : cur.campList.map(function (c) { return { id: c.key, name: c.campaign, sub: c.type, s: c.s, color: typeColor(c.type) }; });
    items.sort(function (a, b) { return b.s.cost - a.s.cost; });
    var top = items.slice(0, 10), max = top.length ? top[0].s.cost || 1 : 1;
    $("gad-board-d").textContent = items.length ? "top " + top.length + " of " + items.length : "";
    box.innerHTML = top.map(function (it, i) {
      var cpa = METRICS.cpa.v(it.s);
      return '<button type="button" class="gad-brow" data-id="' + esc(it.id) + '">' +
        '<span class="gad-brank">' + (i + 1) + "</span>" +
        '<span class="gad-bname">' + esc(it.name) + "<small>" + esc(it.sub || "") + "</small></span>" +
        '<span class="gad-btrack"><i class="gad-hbar" style="width:' + (it.s.cost / max * 100).toFixed(1) + "%" + '"></i></span>' +
        '<span class="gad-bval">' + fmtMoney(it.s.cost) + "<small>" + METRICS.conversions.fmt(it.s.conversions) + " conv. &middot; " + (cpa == null ? "—" : fmtCompact(cpa, true) + "/conv.") + "</small></span></button>";
    }).join("") + (items.length > top.length ? '<div class="gad-bmore">+ ' + (items.length - top.length) + " more in the table below</div>" : "") +
      (items.length ? "" : '<div class="gad-empty-chart">Nothing in this range.</div>');
    $$(".gad-brow", box).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        if (all) setAccount(id); else setFocus(state.focus === id ? null : id);
      });
    });
    animate(box);
  }

  /* ── Scatter ────────────────────────────────────────────────────────── */
  function renderScatter(cur) {
    var box = $("gad-scatter"), camps = cur.campList.filter(function (c) { return c.s.cost > 0; });
    box.innerHTML = "";
    if (camps.length < 2) { box.innerHTML = '<div class="gad-empty-chart">Needs at least two campaigns with spend.</div>'; return; }
    var W = box.clientWidth || 600, H = 320, pl = 52, pr = 16, pt = 16, pb = 34, iw = W - pl - pr, ih = H - pt - pb;
    var mx = niceMax(Math.max.apply(null, camps.map(function (c) { return c.s.cost; })));
    var my = niceMax(Math.max.apply(null, camps.map(function (c) { return c.s.conversions; })) || 1);
    var mc = Math.max.apply(null, camps.map(function (c) { return c.s.clicks; })) || 1;
    // Square-root scales: spend and conversions both run over orders of
    // magnitude, and a linear axis piles every small campaign into a corner.
    var x = function (v) { return pl + Math.sqrt(v / mx) * iw; };
    var y = function (v) { return pt + ih - Math.sqrt(v / my) * ih; };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": "Spend against conversions by campaign" }, box);
    [0, 0.25, 0.5, 1].forEach(function (f) {
      var vy = my * f, vx = mx * f;
      svgEl("line", { x1: pl, x2: W - pr, y1: y(vy), y2: y(vy), "class": f ? "gad-grid-l" : "gad-base-l" }, svg);
      svgEl("text", { x: pl - 8, y: y(vy) + 4, "text-anchor": "end", "class": "gad-ax" }, svg).textContent = fmtCompact(vy);
      svgEl("text", { x: x(vx), y: H - 12, "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle", "class": "gad-ax" }, svg).textContent = fmtCompact(vx, true);
    });
    svgEl("text", { x: W - pr, y: H + 2, "text-anchor": "end", "class": "gad-ax" }, svg).textContent = "spend → (√ scale)";
    // Medians split the plane into four readable quadrants.
    function median(a) { a = a.slice().sort(function (p, q) { return p - q; }); var h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; }
    var medX = median(camps.map(function (c) { return c.s.cost; })), medY = median(camps.map(function (c) { return c.s.conversions; }));
    svgEl("line", { x1: x(medX), x2: x(medX), y1: pt, y2: pt + ih, "class": "gad-qline" }, svg);
    svgEl("line", { x1: pl, x2: W - pr, y1: y(medY), y2: y(medY), "class": "gad-qline" }, svg);
    svgEl("text", { x: pl + 8, y: pt + 12, "class": "gad-q" }, svg).textContent = "Efficient";
    svgEl("text", { x: W - pr - 4, y: pt + 12, "text-anchor": "end", "class": "gad-q" }, svg).textContent = "Scaling winners";
    svgEl("text", { x: W - pr - 4, y: pt + ih - 8, "text-anchor": "end", "class": "gad-q" }, svg).textContent = "Watch spend";

    camps.sort(function (a, b) { return b.s.clicks - a.s.clicks; });
    camps.forEach(function (c) {
      var r = 5 + Math.sqrt(c.s.clicks / mc) * 16;
      var b = svgEl("circle", { cx: x(c.s.cost), cy: y(c.s.conversions), r: r, fill: ACC, "fill-opacity": 0.78, "class": "gad-bub gad-dot" }, svg);
      if (state.focus === c.key) { b.setAttribute("fill", "#121213"); b.setAttribute("fill-opacity", 1); }
      var cpa = METRICS.cpa.v(c.s);
      b.addEventListener("mouseenter", function () { box.classList.add("is-hover"); b.classList.add("is-hot"); });
      b.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + esc(c.campaign) + '</div><div class="gad-tip-r" style="margin:-4px 0 6px"><span>' + esc(c.account) + "</span></div>" +
          tipRow("Spend", fmtMoney(c.s.cost)) + tipRow("Conversions", METRICS.conversions.fmt(c.s.conversions)) +
          tipRow("Clicks", fmtInt(c.s.clicks)) + tipRow("Cost / conv.", cpa == null ? "—" : fmtMoney2(cpa)), e.clientX, e.clientY);
      });
      b.addEventListener("mouseleave", function () { box.classList.remove("is-hover"); b.classList.remove("is-hot"); hideTip(); });
      b.addEventListener("click", function () { setFocus(state.focus === c.key ? null : c.key); });
    });
    animate(box);
  }

  /* ── Weekday ────────────────────────────────────────────────────────── */
  function renderWeekday(cur) {
    var box = $("gad-weekday"), m = METRICS[state.metric];
    var counts = [0, 0, 0, 0, 0, 0, 0];
    isoRange(state.from, state.to).forEach(function (d) { counts[weekday(d)]++; });
    // Additive metrics are averaged per calendar day; rates are the rate.
    var vals = cur.weekday.map(function (s, i) { var v = m.v(s); return v == null ? null : m.add ? (counts[i] ? v / counts[i] : null) : v; });
    $("gad-weekday-d").textContent = m.label + (m.add ? " · average per day" : "");
    box.innerHTML = "";
    var W = box.clientWidth || 500, H = 240, pl = 8, pr = 8, pt = 26, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var max = Math.max.apply(null, vals.map(function (v) { return v || 0; })) || 1;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": m.label + " by day of week" }, box);
    var slot = iw / 7, bw = Math.min(56, slot - 12);
    var best = 0; vals.forEach(function (v, i) { if ((v || 0) > (vals[best] || 0)) best = i; });
    svgEl("line", { x1: pl, x2: W - pr, y1: pt + ih, y2: pt + ih, "class": "gad-base-l" }, svg);
    vals.forEach(function (v, i) {
      var h = (v || 0) / max * ih, bx = pl + i * slot + (slot - bw) / 2, by = pt + ih - h;
      var bar = svgEl("path", { d: roundTop(bx, by, bw, h, 6), fill: i === best ? ACC : "#FFC2A6", "class": "gad-bar" }, svg);
      svgEl("text", { x: bx + bw / 2, y: H - 8, "text-anchor": "middle", "class": "gad-ax", style: i === best ? "fill:#121213;font-weight:600" : "" }, svg).textContent = WEEKDAYS[i];
      if (i === best && v) svgEl("text", { x: bx + bw / 2, y: by - 8, "text-anchor": "middle", "class": "gad-ax", style: "fill:#121213;font-weight:600" }, svg).textContent = m.short(v);
      var hit = svgEl("rect", { x: pl + i * slot, y: pt, width: slot, height: ih, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + WEEKDAYS[i] + "</div>" + tipRow(m.label + (m.add ? " / day" : ""), v == null ? "—" : m.fmt(v), i === best ? ACC : "#FFC2A6") +
          tipRow("Days in range", String(counts[i])), e.clientX, e.clientY);
        bar.setAttribute("fill", i === best ? "#C94513" : "#FF9A70");
      });
      hit.addEventListener("mouseleave", function () { hideTip(); bar.setAttribute("fill", i === best ? ACC : "#FFC2A6"); });
    });
    animate(box);
  }
  function roundTop(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return "M" + x + "," + (y + h) + " V" + (y + r) + " Q" + x + "," + y + " " + (x + r) + "," + y +
      " H" + (x + w - r) + " Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + " V" + (y + h) + " Z";
  }

  /* ── Calendar heatmap ───────────────────────────────────────────────── */
  function renderCalendar(cur) {
    var box = $("gad-cal"), m = METRICS[state.metric];
    var days = isoRange(state.from, state.to);
    $("gad-cal-d").textContent = m.label;
    box.innerHTML = "";
    var start = weekStart(days[0]), weeks = Math.ceil((daysBetween(start, days[days.length - 1]) + 1) / 7);
    var W = box.clientWidth || 500, lab = 34;
    var cell = Math.max(12, Math.min(40, Math.floor((W - lab) / Math.max(weeks, 1)) - 4)), gap = 4;
    var H = 7 * (cell + gap) + 22;
    var vals = days.map(function (d) { return cur.daily[d] ? m.v(cur.daily[d]) : null; });
    var present = vals.filter(function (v) { return v != null; });
    var lo = present.length ? Math.min.apply(null, present) : 0, hi = present.length ? Math.max.apply(null, present) : 1;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": m.label + " calendar" }, box);
    [0, 2, 4, 6].forEach(function (i) {
      svgEl("text", { x: 0, y: 20 + i * (cell + gap) + cell / 2 + 4, "class": "gad-ax" }, svg).textContent = WEEKDAYS[i];
    });
    var lastMonth = -1;
    days.forEach(function (d, k) {
      var wk = Math.floor(daysBetween(start, d) / 7), wd = weekday(d);
      var cx = lab + wk * (cell + gap), cy = 20 + wd * (cell + gap), v = vals[k];
      var mo = toDate(d).getUTCMonth();
      if (mo !== lastMonth && wd <= 3) { lastMonth = mo; svgEl("text", { x: cx, y: 10, "class": "gad-ax" }, svg).textContent = MONTHS[mo]; }
      var step = v == null ? -1 : hi === lo ? 3 : Math.min(4, Math.floor((v - lo) / (hi - lo) * 5));
      var rect = svgEl("rect", { x: cx, y: cy, width: cell, height: cell, rx: Math.min(6, cell / 4), fill: step < 0 ? "#F1EFED" : RAMP[step], "class": "gad-cal-cell gad-cell" }, svg);
      rect.addEventListener("mousemove", function (e) {
        var s = cur.daily[d];
        showTip('<div class="gad-tip-t">' + WEEKDAYS[wd] + " " + fmtDay(d, true) + "</div>" + tipRow(m.label, v == null ? "No data" : m.fmt(v), step < 0 ? null : RAMP[step]) +
          (s ? tipRow("Spend", fmtMoney(s.cost)) + tipRow("Conversions", METRICS.conversions.fmt(s.conversions)) : ""), e.clientX, e.clientY);
      });
      rect.addEventListener("mouseleave", hideTip);
    });
    var sc = doc.createElement("div"); sc.className = "gad-scale";
    sc.innerHTML = "Less " + RAMP.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") + " More";
    box.appendChild(sc);
    animate(box);
  }

  /* ── Movers ─────────────────────────────────────────────────────────── */
  function renderMovers(cur, prevAgg, prev) {
    var box = $("gad-movers"), key = METRICS[state.metric].add ? state.metric : "cost", m = METRICS[key];
    if (!prev || !state.compare) {
      $("gad-movers-d").textContent = "";
      box.innerHTML = '<div class="gad-mempty">' + (state.compare
        ? "There is no earlier data of the same length to compare with. Pick 7D or 14D to see who moved."
        : "Turn on “vs previous period” to see who moved.") + "</div>";
      return;
    }
    $("gad-movers-d").textContent = m.label + " · vs " + fmtDay(prev.from) + " – " + fmtDay(prev.to);
    var keys = {}; cur.campList.forEach(function (c) { keys[c.key] = 1; }); prevAgg.campList.forEach(function (c) { keys[c.key] = 1; });
    var list = Object.keys(keys).map(function (k) {
      var c = cur.camps[k], p = prevAgg.camps[k], ref = c || p;
      var a = c ? m.v(c.s) : 0, b = p ? m.v(p.s) : 0;
      return { key: k, name: ref.campaign, account: ref.account, cur: a, prev: b, d: a - b };
    }).filter(function (x) { return x.d !== 0; });
    var up = list.filter(function (x) { return x.d > 0; }).sort(function (a, b) { return b.d - a.d; }).slice(0, 5);
    var down = list.filter(function (x) { return x.d < 0; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
    var maxAbs = Math.max.apply(null, up.concat(down).map(function (x) { return Math.abs(x.d); }).concat([1]));
    function col(items, cls, title, icon) {
      return '<div class="gad-mcol ' + cls + '"><h3><i aria-hidden="true">' + icon + "</i>" + title + "</h3>" +
        (items.length ? items.map(function (x) {
          return '<div class="gad-mrow" data-key="' + esc(x.key) + '"><span class="gad-mname"><b>' + esc(x.name) + "</b><small>" + esc(x.account) + "</small></span>" +
            '<span class="gad-mbar"><i class="gad-hbar" style="width:' + (Math.abs(x.d) / maxAbs * 100).toFixed(1) + '%"></i></span>' +
            '<span class="gad-mval">' + (x.d > 0 ? "+" : "−") + m.fmt(Math.abs(x.d)) + "<small>" + m.fmt(x.prev) + " → " + m.fmt(x.cur) + "</small></span></div>";
        }).join("") : '<div class="gad-mempty">Nothing moved this way.</div>') + "</div>";
    }
    box.innerHTML = col(up, "gad-mcol--up", "Rising", "&uarr;") + col(down, "gad-mcol--down", "Falling", "&darr;");
    $$(".gad-mrow", box).forEach(function (r) { r.addEventListener("click", function () { setFocus(r.getAttribute("data-key")); }); });
    animate(box);
  }

  /* ── Table ──────────────────────────────────────────────────────────── */
  function renderTable(cur) {
    var body = $("gad-table-body"), total = cur.totals.cost || 1;
    var rows = cur.campList.slice(), k = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var va, vb;
      if (k === "campaign") { va = a.campaign.toLowerCase(); vb = b.campaign.toLowerCase(); return va < vb ? -dir : va > vb ? dir : 0; }
      va = METRICS[k].v(a.s); vb = METRICS[k].v(b.s);
      if (va == null) va = dir > 0 ? Infinity : -Infinity; if (vb == null) vb = dir > 0 ? Infinity : -Infinity;
      return (va - vb) * dir;
    });
    $$(".gad-table th[data-sort-key]").forEach(function (th) {
      var on = th.getAttribute("data-sort-key") === k;
      th.classList.toggle("is-sorted", on); th.classList.toggle("is-asc", on && dir > 0);
      th.setAttribute("aria-sort", on ? (dir > 0 ? "ascending" : "descending") : "none");
    });
    $("gad-table-d").textContent = rows.length + (rows.length === 1 ? " campaign" : " campaigns") + " · click a row to focus it";
    $("gad-table-empty").hidden = rows.length > 0;
    var days = isoRange(state.from, state.to), shown = rows.slice(0, state.shown);
    body.innerHTML = shown.map(function (c) {
      var s = c.s, ctr = METRICS.ctr.v(s), cpc = METRICS.cpc.v(s), cvr = METRICS.cvr.v(s), cpa = METRICS.cpa.v(s);
      var st = (c.state || "").toLowerCase();
      return '<tr data-key="' + esc(c.key) + '"' + (state.focus === c.key ? ' class="is-focus"' : "") + ">" +
        '<td><div class="gad-cname"><i style="background:' + typeColor(c.type) + '" aria-hidden="true"></i><span><b title="' + esc(c.campaign) + '">' + esc(c.campaign) + "</b>" +
        "<small>" + esc(c.account) + ' &middot; ' + esc(c.type || "") + ' &middot; <span class="gad-state' + (st === "paused" ? " is-paused" : st === "removed" ? " is-removed" : "") + '">' + esc(c.state || "") + "</span></small></span></div></td>" +
        '<td class="is-num"><b>' + fmtMoney(s.cost) + '</b><span class="gad-share" title="' + (s.cost / total * 100).toFixed(1) + '% of spend"><i style="width:' + (s.cost / total * 100).toFixed(1) + '%"></i></span></td>' +
        '<td class="is-num">' + fmtInt(s.clicks) + "</td>" +
        '<td class="is-num">' + fmtInt(s.impressions) + "</td>" +
        '<td class="is-num">' + (ctr == null ? '<span class="gad-muted">—</span>' : fmtPct(ctr)) + "</td>" +
        '<td class="is-num">' + (cpc == null ? '<span class="gad-muted">—</span>' : fmtMoney2(cpc)) + "</td>" +
        '<td class="is-num">' + METRICS.conversions.fmt(s.conversions) + "</td>" +
        '<td class="is-num">' + (cvr == null ? '<span class="gad-muted">—</span>' : fmtPct(cvr)) + "</td>" +
        '<td class="is-num">' + (cpa == null ? '<span class="gad-muted">—</span>' : fmtMoney2(cpa)) + "</td>" +
        "<td>" + tableSpark(c, days) + "</td></tr>";
    }).join("");
    $$("tr", body).forEach(function (tr) {
      tr.addEventListener("click", function () { var key = tr.getAttribute("data-key"); setFocus(state.focus === key ? null : key); });
    });
    var more = $("gad-more");
    more.hidden = rows.length <= state.shown;
    more.textContent = "Show " + Math.min(15, rows.length - state.shown) + " more of " + (rows.length - state.shown);
  }
  function tableSpark(c, days) {
    if (days.length < 2) return "";
    var vals = days.map(function (d) { return c.days[d] || 0; }), max = Math.max.apply(null, vals) || 1, w = 110, h = 28;
    var pts = vals.map(function (v, i) { return [i / (vals.length - 1) * w, h - 3 - v / max * (h - 6)]; });
    var last = pts[pts.length - 1];
    return '<svg class="gad-tspark" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true"><path d="' +
      pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") +
      '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.5"/></svg>';
  }

  /* ── Render everything ──────────────────────────────────────────────── */
  var lastCur = null;
  function renderAll() {
    var curRows = rowsIn(state.from, state.to);
    var cur = aggregate(curRows);
    var prev = state.compare ? prevRange() : null;
    var prevAgg = prev ? aggregate(rowsIn(prev.from, prev.to)) : null;
    lastCur = cur;
    renderHero(cur);
    renderKpis(cur, prevAgg);
    renderTrend(cur, prevAgg, prev);
    renderFunnel(cur);
    renderDonut(cur);
    renderGauges(cur);
    renderBoard(cur);
    renderScatter(cur);
    renderWeekday(cur);
    renderCalendar(cur);
    renderMovers(cur, prevAgg, prev);
    renderTable(cur);
    syncControls();
  }

  /* ── Controls ───────────────────────────────────────────────────────── */
  function syncControls() {
    $$("[data-range]").forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-range") === state.preset); });
    $("gad-from").value = state.from; $("gad-to").value = state.to;
    var cmp = $("gad-compare"), avail = !!prevRange();
    cmp.setAttribute("aria-pressed", state.compare ? "true" : "false");
    cmp.title = avail ? "" : "No earlier data of the same length in the sheet";
    $("gad-type-select").value = state.type;
    $("gad-type-select").classList.toggle("is-set", state.type !== "__all__");
    $("gad-state-select").value = state.status;
    $("gad-state-select").classList.toggle("is-set", state.status !== "__all__");
    $("gad-account-select").value = state.account;
    var f = $("gad-focus");
    if (state.focus) {
      var parts = state.focus.split("\u0001");
      f.hidden = false;
      f.innerHTML = "<span>Focus: " + esc(parts[1]) + '</span><button type="button" aria-label="Clear campaign focus">&times;</button>';
      f.querySelector("button").onclick = function () { setFocus(null); };
    } else { f.hidden = true; f.innerHTML = ""; }
    var dirty = state.account !== "__all__" || state.type !== "__all__" || state.status !== "__all__" || state.search || state.focus || state.preset !== "all";
    $("gad-reset").hidden = !dirty;
    $$(".gad-tick-i").forEach(function (t) { t.classList.toggle("is-on", t.getAttribute("data-acc") === state.account); });
  }

  function setAccount(a) { state.account = a; state.focus = null; state.shown = 15; renderAll(); renderTicker(); }
  function setType(t) { state.type = t; state.shown = 15; renderAll(); }
  function setFocus(k) {
    state.focus = k; state.shown = 15;
    if (k && state.account !== "__all__" && k.split("\u0001")[0] !== state.account) state.account = k.split("\u0001")[0];
    renderAll();
  }

  function populate(sel, values, allLabel) {
    sel.innerHTML = "";
    var o = doc.createElement("option"); o.value = "__all__"; o.textContent = allLabel; sel.appendChild(o);
    values.forEach(function (v) { var x = doc.createElement("option"); x.value = v; x.textContent = v; sel.appendChild(x); });
  }
  function uniq(key) {
    var m = {}; ALL_ROWS.forEach(function (r) { if (r[key]) m[r[key]] = 1; });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b); });
  }

  function exportCsv() {
    if (!lastCur) return;
    var head = ["Account", "Campaign", "Type", "Status", "Spend", "Clicks", "Impressions", "CTR %", "Avg CPC", "Conversions", "Conv rate %", "Cost per conv", "View-through conv"];
    var lines = [head];
    lastCur.campList.sort(function (a, b) { return b.s.cost - a.s.cost; }).forEach(function (c) {
      var s = c.s, r = function (v, d) { return v == null ? "" : v.toFixed(d); };
      lines.push([c.account, c.campaign, c.type, c.state, s.cost.toFixed(2), s.clicks, s.impressions,
        r(METRICS.ctr.v(s), 2), r(METRICS.cpc.v(s), 2), s.conversions, r(METRICS.cvr.v(s), 2), r(METRICS.cpa.v(s), 2), s.view_through]);
    });
    var csv = lines.map(function (l) { return l.map(function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    var a = doc.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "google-ads-" + (state.account === "__all__" ? "all-accounts" : state.account.replace(/[^\w]+/g, "-").toLowerCase()) + "-" + state.from + "-to-" + state.to + ".csv";
    doc.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function initControls() {
    var accSel = $("gad-account-select");
    populate(accSel, ACCOUNTS, "All accounts");
    accSel.addEventListener("change", function () { setAccount(accSel.value); });

    var typeSel = $("gad-type-select");
    populate(typeSel, uniq("type"), "All campaign types");
    typeSel.addEventListener("change", function () { setType(typeSel.value); });

    var stSel = $("gad-state-select");
    populate(stSel, uniq("state"), "Any status");
    stSel.addEventListener("change", function () { state.status = stSel.value; state.shown = 15; renderAll(); });

    var search = $("gad-search"), t = null;
    search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.search = search.value.trim().toLowerCase(); state.shown = 15; renderAll(); }, 180);
    });

    $$("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-range")); state.shown = 15; renderAll(); renderTicker(); });
    });
    var from = $("gad-from"), to = $("gad-to");
    [from, to].forEach(function (inp) { inp.min = MIN_DAY; inp.max = MAX_DAY; });
    function onDate() {
      var f = from.value || MIN_DAY, tt = to.value || MAX_DAY;
      if (f < MIN_DAY) f = MIN_DAY; if (tt > MAX_DAY) tt = MAX_DAY;
      if (f > tt) { var x = f; f = tt; tt = x; }
      state.from = f; state.to = tt; state.preset = "custom"; state.shown = 15;
      renderAll(); renderTicker();
    }
    from.addEventListener("change", onDate); to.addEventListener("change", onDate);

    $("gad-compare").addEventListener("click", function () { state.compare = !state.compare; renderAll(); });

    $$("[data-metric]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.metric = b.getAttribute("data-metric");
        $$("[data-metric]").forEach(function (x) { x.classList.toggle("is-on", x === b); });
        var prev = state.compare ? prevRange() : null, cur = lastCur, prevAgg = prev ? aggregate(rowsIn(prev.from, prev.to)) : null;
        renderTrend(cur, prevAgg, prev); renderWeekday(cur); renderCalendar(cur); renderMovers(cur, prevAgg, prev);
      });
    });
    $$("[data-grain]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.grain = b.getAttribute("data-grain");
        $$("[data-grain]").forEach(function (x) { x.classList.toggle("is-on", x === b); });
        var prev = state.compare ? prevRange() : null;
        renderTrend(lastCur, prev ? aggregate(rowsIn(prev.from, prev.to)) : null, prev);
      });
    });

    $$(".gad-table th[data-sort-key]").forEach(function (th) {
      th.tabIndex = 0;
      var go = function () {
        var k = th.getAttribute("data-sort-key");
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = k === "campaign" || k === "cpc" || k === "cpa" ? 1 : -1; }
        renderTable(lastCur);
      };
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $("gad-more").addEventListener("click", function () { state.shown += 15; renderTable(lastCur); });

    $("gad-reset").addEventListener("click", function () {
      state.account = "__all__"; state.type = "__all__"; state.status = "__all__"; state.search = ""; state.focus = null; state.shown = 15;
      search.value = ""; applyPreset("all"); renderAll(); renderTicker();
    });

    $("gad-tick-track").addEventListener("click", function (e) {
      var b = e.target.closest(".gad-tick-i"); if (!b) return;
      var a = b.getAttribute("data-acc");
      setAccount(state.account === a ? "__all__" : a);
    });

    doc.querySelector("[data-gad-export]").addEventListener("click", exportCsv);

    var refresh = doc.querySelector("[data-gad-refresh]");
    refresh.addEventListener("click", function () {
      var label = refresh.querySelector("span");
      refresh.disabled = true; refresh.classList.add("is-busy"); label.textContent = "Refreshing";
      fetch("/api/dashboards/google-ads/refresh", { method: "POST", headers: { "X-Requested-With": "fetch" } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.rows && d.rows.length) {
            ALL_ROWS = d.rows; CURRENCY = d.currency_symbol || CURRENCY;
            derive(); populate(accSel, ACCOUNTS, "All accounts"); populate(typeSel, uniq("type"), "All campaign types"); populate(stSel, uniq("state"), "Any status");
            if (ACCOUNTS.indexOf(state.account) < 0) state.account = "__all__";
            if (state.preset !== "custom") applyPreset(state.preset);
            // Every value re-rolls from its current digits.
            renderAll(); renderTicker();
            label.textContent = "Updated";
          } else { label.textContent = "No new data"; }
        })
        .catch(function () { label.textContent = "Try again"; })
        .then(function () {
          refresh.disabled = false; refresh.classList.remove("is-busy");
          setTimeout(function () { label.textContent = "Refresh"; }, 2200);
        });
    });

    // Pills and buttons flood from the point the pointer came in; white
    // tiles flood from where the pointer entered them.
    doc.addEventListener("pointerover", function (e) {
      var b = e.target.closest && e.target.closest(".gad-btn, .gad-pill, .gad-metric, .gad-reset, .gad-tile");
      if (!b || b.contains(e.relatedTarget)) return;
      var r = b.getBoundingClientRect();
      b.style.setProperty("--x", (e.clientX - r.left) + "px");
      b.style.setProperty("--y", (e.clientY - r.top) + "px");
    });

    var filters = $("gad-filters");
    window.addEventListener("scroll", function () {
      filters.classList.toggle("is-stuck", filters.getBoundingClientRect().top <= 70 && window.scrollY > 200);
    }, { passive: true });

    var rt = null, lastW = window.innerWidth;
    window.addEventListener("resize", function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rt); rt = setTimeout(renderAll, 160);
    });
  }

  /* ── Arrival ────────────────────────────────────────────────────────── */
  function arrive() {
    var hero = doc.querySelector(".gad-hero"), kpis = doc.querySelector(".gad-kpis[data-gad-settle]");
    if (REDUCED) return;
    [hero, kpis].forEach(function (el) { if (el) el.classList.add("is-armed"); });
    void doc.body.offsetWidth;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        [hero, kpis].forEach(function (el) { if (el) el.classList.add("is-settled"); });
        // Once settled, hand the blocks back their own quicker hover.
        setTimeout(function () { [hero, kpis].forEach(function (el) { if (el) el.classList.remove("is-armed", "is-settled"); }); }, 1300);
        var lbl = hero && hero.querySelector("[data-gad-decode]");
        if (lbl) decode(lbl);
      });
    });
  }

  derive();
  applyPreset("all");
  initControls();
  arrive();
  renderAll();
  renderTicker();
  watchPanels();
})();
