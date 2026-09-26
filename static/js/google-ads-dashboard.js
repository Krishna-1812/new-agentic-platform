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
    view_through: { label: "View-through conv.", v: function (s) { return s.view_through; },               fmt: fmtInt,    short: function (n) { return fmtCompact(n); },        good: 1,  add: true },
    top_pct:      { label: "Top of page",  v: function (s) { return s.impressions ? s.topW / s.impressions : null; }, fmt: fmtPct, short: function (n) { return n.toFixed(0) + "%"; }, good: 1 },
    abs_top_pct:  { label: "Absolute top", v: function (s) { return s.impressions ? s.absW / s.impressions : null; }, fmt: fmtPct, short: function (n) { return n.toFixed(0) + "%"; }, good: 1 }
  };
  // How each figure is worked out, shown in its detail panel. Rates are
  // always recomputed from summed components (never an average of daily
  // rates), which is how Google Ads itself reports them.
  var DEFS = {
    cost: "Sum of cost in the converted currency across every campaign-day in scope.",
    clicks: "Sum of clicks across every campaign-day in scope.",
    impressions: "Sum of impressions across every campaign-day in scope.",
    conversions: "Sum of conversions as Google Ads reports them. Fractions come from data-driven attribution splitting one conversion across campaigns.",
    ctr: "Clicks \u00f7 impressions, from the summed totals.",
    cpc: "Spend \u00f7 clicks, from the summed totals.",
    cpa: "Spend \u00f7 conversions, from the summed totals. Blank when there are no conversions.",
    cvr: "Conversions \u00f7 clicks, from the summed totals.",
    view_through: "Conversions after an impression without a click (display and video), as reported by Google Ads.",
    top_pct: "Share of impressions shown anywhere above the organic results, weighted by each row's impressions.",
    abs_top_pct: "Share of impressions shown as the very first ad above the organic results, weighted by each row's impressions."
  };
  // The volume a campaign needs before its rate is ranked, so a campaign
  // with one click and one conversion is never crowned "best conversion rate".
  var MIN_VOL = { ctr: ["impressions", 100], cpc: ["clicks", 10], cvr: ["clicks", 20], cpa: ["conversions", 1], top_pct: ["impressions", 100], abs_top_pct: ["impressions", 100] };

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
    var inDrawer = container.closest && container.closest(".gad-drawer");
    if (!seen[id] && !inDrawer) return;          // drawn later by the watcher
    void container.offsetWidth;
    setTimeout(function () { requestAnimationFrame(function () { container.classList.add("is-drawn"); }); }, inDrawer ? 140 : 0);
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
      return '<button type="button" class="gad-tick-i' + (a.name === state.account ? " is-on" : "") + '" data-acc="' + esc(a.name) + '" data-go="account" data-id="' + esc(a.name) + '">' +
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
    $("gad-trend-legend").innerHTML = '<span class="gad-key"><i></i>' + esc(m.label) + " &middot; <b>" + esc(fmtDay(state.from) + " \u2013 " + fmtDay(state.to)) + "</b></span>" +
      (ppts ? '<span class="gad-key"><i class="is-prev"></i>Previous period &middot; <b>' + esc(fmtDay(prev.from) + " \u2013 " + fmtDay(prev.to)) + "</b></span>" : "") +
      '<span class="gad-key gad-key--hint">Click any point for that ' + (state.grain === "week" ? "week" : "day") + "</span>";
    lineChart(box, {
      m: m, pts: pts, pvals: ppts ? ppts.map(function (p) { return m.v(p.s); }) : null,
      empty: "Pick a range of at least two " + (state.grain === "week" ? "weeks" : "days") + " to see a trend.",
      pick: function (p) {
        var to = state.grain === "week" ? addDays(p.key, 6) : p.key;
        return { t: "range", from: p.key < state.from ? state.from : p.key, to: to > state.to ? state.to : to };
      }
    });
  }

  /* One line chart for the page and every detail panel: one metric on one
     axis, an optional previous-period line on the same scale, a crosshair
     tooltip, a labelled peak, and (with o.pick) a click on any point that
     opens that point's own detail. */
  function lineChart(box, o) {
    var m = o.m, pts = o.pts, pvals = o.pvals || null;
    box.innerHTML = "";
    if (pts.length < 2) { box.innerHTML = '<div class="gad-empty-chart">' + esc(o.empty || "Needs at least two days to draw a line.") + "</div>"; return; }
    var vals = pts.map(function (p) { return m.v(p.s); });
    var W = box.clientWidth || 800, H = o.H || (W < 560 ? 240 : 300), pl = 56, pr = 14, pt = 14, pb = 30;
    var iw = W - pl - pr, ih = H - pt - pb;
    var max = niceMax(Math.max.apply(null, vals.concat(pvals || []).map(function (v) { return v || 0; })));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": m.label + " trend" }, box);
    var x = function (i) { return pl + i / (pts.length - 1) * iw; };
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
      svgEl("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle", "class": "gad-ax" }, svg).textContent = fmtDay(p.key);
    });
    if (pvals && pvals.length > 1) {
      var pp = svgEl("path", { d: smooth(pvals.slice(0, pts.length).map(function (v, i) { return [x(i), y(v)]; })), fill: "none", stroke: "#B9B4AC", "stroke-width": 1.75, "class": "gad-line", "stroke-linecap": "round" }, svg);
      setLen(pp);
    }
    var line = vals.map(function (v, i) { return [x(i), y(v)]; }), base = pt + ih;
    svgEl("path", { d: smooth(line) + " L" + x(pts.length - 1) + "," + base + " L" + x(0) + "," + base + " Z", fill: ACC, "fill-opacity": 0.12, "class": "gad-area" }, svg);
    setLen(svgEl("path", { d: smooth(line), fill: "none", stroke: ACC, "stroke-width": 2.5, "stroke-linecap": "round", "class": "gad-line" }, svg));
    var pk = 0; vals.forEach(function (v, i) { if ((v || 0) > (vals[pk] || 0)) pk = i; });
    if (vals[pk]) {
      svgEl("circle", { cx: x(pk), cy: y(vals[pk]), r: 5, fill: ACC, stroke: "#fff", "stroke-width": 2, "class": "gad-dot" }, svg);
      svgEl("text", { x: Math.min(Math.max(x(pk), pl + 40), W - pr - 40), y: Math.max(12, y(vals[pk]) - 12), "text-anchor": "middle", "class": "gad-ax", style: "fill:#121213;font-weight:600" }, svg)
        .textContent = "Peak " + m.short(vals[pk]);
    }
    var cross = svgEl("line", { y1: pt, y2: base, "class": "gad-cross" }, svg);
    var hot = svgEl("circle", { r: 6, fill: ACC, stroke: "#fff", "stroke-width": 2.5, opacity: 0 }, svg);
    var hit = svgEl("rect", { x: pl, y: pt, width: iw, height: ih + pb, fill: "transparent" }, svg);
    if (o.pick) hit.style.cursor = "pointer";
    function at(e) {
      var r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width);
      return Math.max(0, Math.min(pts.length - 1, Math.round((mx - pl) / iw * (pts.length - 1))));
    }
    hit.addEventListener("mousemove", function (e) {
      var i = at(e), r = svg.getBoundingClientRect();
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.opacity = 0.25;
      hot.setAttribute("cx", x(i)); hot.setAttribute("cy", y(vals[i])); hot.setAttribute("opacity", 1);
      var s = pts[i].s, html = '<div class="gad-tip-t">' + esc(pts[i].label) + "</div>" + tipRow(m.label, vals[i] == null ? "\u2014" : m.fmt(vals[i]), ACC);
      if (pvals && pvals[i] !== undefined) html += tipRow("Previous", pvals[i] == null ? "\u2014" : m.fmt(pvals[i]), "#B9B4AC");
      html += '<div style="height:6px"></div>';
      ["cost", "clicks", "conversions"].forEach(function (k) { if (METRICS[k] !== m) html += tipRow(METRICS[k].label, METRICS[k].fmt(METRICS[k].v(s))); });
      if (o.pick) html += '<div class="gad-tip-h">Click for details &rarr;</div>';
      showTip(html, e.clientX, r.top + (y(vals[i]) / H) * r.height);
    });
    hit.addEventListener("mouseleave", function () { hideTip(); cross.style.opacity = 0; hot.setAttribute("opacity", 0); });
    if (o.pick) hit.addEventListener("click", function (e) { hideTip(); openDetail(o.pick(pts[at(e)]), hit); });
    animate(box);
  }

  /* ── Funnel ─────────────────────────────────────────────────────────── */
  function renderFunnel(cur) {
    var s = cur.totals, box = $("gad-funnel");
    var ctr = METRICS.ctr.v(s), cvr = METRICS.cvr.v(s), cpa = METRICS.cpa.v(s);
    var arrow = '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>';
    box.innerHTML =
      '<button type="button" class="gad-fstep" data-go="metric" data-id="impressions" style="width:100%;background:' + FUNNEL[0] + '"><span>Impressions</span><b>' + fmtInt(s.impressions) + "</b></button>" +
      '<button type="button" class="gad-frate" data-go="metric" data-id="ctr">' + arrow + "CTR <b>" + (ctr == null ? "\u2014" : fmtPct(ctr)) + "</b></button>" +
      '<button type="button" class="gad-fstep" data-go="metric" data-id="clicks" style="width:82%;background:' + FUNNEL[1] + '"><span>Clicks</span><b>' + fmtInt(s.clicks) + "</b></button>" +
      '<button type="button" class="gad-frate" data-go="metric" data-id="cvr">' + arrow + "Conv. rate <b>" + (cvr == null ? "\u2014" : fmtPct(cvr)) + "</b></button>" +
      '<button type="button" class="gad-fstep" data-go="metric" data-id="conversions" style="width:64%;background:' + FUNNEL[2] + '"><span>Conversions</span><b>' + METRICS.conversions.fmt(s.conversions) + "</b></button>" +
      '<button type="button" class="gad-frate" data-go="metric" data-id="cpa">Cost per conversion <b>' + (cpa == null ? "\u2014" : fmtMoney2(cpa)) + "</b></button>";
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
      li.setAttribute("data-go", "type"); li.setAttribute("data-id", it.t);
      it.arc.setAttribute("data-go", "type"); it.arc.setAttribute("data-id", it.t);
      var on = function () { box.classList.add("is-dim"); it.arc.classList.add("is-hot"); li.classList.add("is-hot"); };
      var off = function () { box.classList.remove("is-dim"); it.arc.classList.remove("is-hot"); li.classList.remove("is-hot"); hideTip(); };
      li.addEventListener("mouseenter", on); li.addEventListener("mouseleave", off);
      it.arc.addEventListener("mouseenter", on);
      it.arc.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + esc(it.t) + "</div>" + tipRow("Spend", fmtMoney(it.s.cost), typeColor(it.t)) +
          tipRow("Share", share.toFixed(1) + "%") + tipRow("Clicks", fmtInt(it.s.clicks)) + tipRow("Conversions", METRICS.conversions.fmt(it.s.conversions)) + '<div class="gad-tip-h">Click for details &rarr;</div>', e.clientX, e.clientY);
      });
      it.arc.addEventListener("mouseleave", off);
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
    [["Top of page", top, "#1D65A6", "top_pct"], ["Absolute top", abs, ACC, "abs_top_pct"]].forEach(function (g) {
      var wrap = doc.createElement("button"); wrap.type = "button"; wrap.className = "gad-gauge";
      wrap.setAttribute("data-go", "metric"); wrap.setAttribute("data-id", g[3]);
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
      return '<button type="button" class="gad-brow" data-go="' + (all ? "account" : "campaign") + '" data-id="' + esc(it.id) + '">' +
        '<span class="gad-brank">' + (i + 1) + "</span>" +
        '<span class="gad-bname">' + esc(it.name) + "<small>" + esc(it.sub || "") + "</small></span>" +
        '<span class="gad-btrack"><i class="gad-hbar" style="width:' + (it.s.cost / max * 100).toFixed(1) + "%" + '"></i></span>' +
        '<span class="gad-bval">' + fmtMoney(it.s.cost) + "<small>" + METRICS.conversions.fmt(it.s.conversions) + " conv. &middot; " + (cpa == null ? "—" : fmtCompact(cpa, true) + "/conv.") + "</small></span></button>";
    }).join("") + (items.length > top.length ? '<div class="gad-bmore">+ ' + (items.length - top.length) + " more in the table below</div>" : "") +
      (items.length ? "" : '<div class="gad-empty-chart">Nothing in this range.</div>');
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
      var b = svgEl("circle", { cx: x(c.s.cost), cy: y(c.s.conversions), r: r, fill: ACC, "fill-opacity": 0.78, "class": "gad-bub gad-dot",
        "data-go": "campaign", "data-id": c.key, tabindex: 0, role: "button", "aria-label": c.campaign + ", " + c.account }, svg);
      if (state.focus === c.key) { b.setAttribute("fill", "#121213"); b.setAttribute("fill-opacity", 1); }
      var cpa = METRICS.cpa.v(c.s);
      b.addEventListener("mouseenter", function () { box.classList.add("is-hover"); b.classList.add("is-hot"); });
      b.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + esc(c.campaign) + '</div><div class="gad-tip-r" style="margin:-4px 0 6px"><span>' + esc(c.account) + "</span></div>" +
          tipRow("Spend", fmtMoney(c.s.cost)) + tipRow("Conversions", METRICS.conversions.fmt(c.s.conversions)) +
          tipRow("Clicks", fmtInt(c.s.clicks)) + tipRow("Cost / conv.", cpa == null ? "\u2014" : fmtMoney2(cpa)) + '<div class="gad-tip-h">Click for details &rarr;</div>', e.clientX, e.clientY);
      });
      b.addEventListener("mouseleave", function () { box.classList.remove("is-hover"); b.classList.remove("is-hot"); hideTip(); });
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
      var hit = svgEl("rect", { x: pl + i * slot, y: pt, width: slot, height: ih, fill: "transparent", "data-go": "weekday", "data-id": i,
        tabindex: 0, role: "button", "aria-label": WEEKDAYS[i] + " detail", style: "cursor:pointer" }, svg);
      hit.addEventListener("mousemove", function (e) {
        showTip('<div class="gad-tip-t">' + WEEKDAYS[i] + "</div>" + tipRow(m.label + (m.add ? " / day" : ""), v == null ? "—" : m.fmt(v), i === best ? ACC : "#FFC2A6") +
          tipRow("Days in range", String(counts[i])) + '<div class="gad-tip-h">Click for details &rarr;</div>', e.clientX, e.clientY);
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
      var rect = svgEl("rect", { x: cx, y: cy, width: cell, height: cell, rx: Math.min(6, cell / 4), fill: step < 0 ? "#F1EFED" : RAMP[step], "class": "gad-cal-cell gad-cell",
        "data-go": "range", "data-id": d + "|" + d, tabindex: 0, role: "button", "aria-label": fmtDay(d, true) + " detail" }, svg);
      rect.addEventListener("mousemove", function (e) {
        var s = cur.daily[d];
        showTip('<div class="gad-tip-t">' + WEEKDAYS[wd] + " " + fmtDay(d, true) + "</div>" + tipRow(m.label, v == null ? "No data" : m.fmt(v), step < 0 ? null : RAMP[step]) +
          (s ? tipRow("Spend", fmtMoney(s.cost)) + tipRow("Conversions", METRICS.conversions.fmt(s.conversions)) : "") + '<div class="gad-tip-h">Click for details &rarr;</div>', e.clientX, e.clientY);
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
          return '<button type="button" class="gad-mrow" data-go="campaign" data-id="' + esc(x.key) + '"><span class="gad-mname"><b>' + esc(x.name) + "</b><small>" + esc(x.account) + "</small></span>" +
            '<span class="gad-mbar"><i class="gad-hbar" style="width:' + (Math.abs(x.d) / maxAbs * 100).toFixed(1) + '%"></i></span>' +
            '<span class="gad-mval">' + (x.d > 0 ? "+" : "−") + m.fmt(Math.abs(x.d)) + "<small>" + m.fmt(x.prev) + " \u2192 " + m.fmt(x.cur) + "</small></span></button>";
        }).join("") : '<div class="gad-mempty">Nothing moved this way.</div>') + "</div>";
    }
    box.innerHTML = col(up, "gad-mcol--up", "Rising", "&uarr;") + col(down, "gad-mcol--down", "Falling", "&darr;");
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
    $("gad-table-d").textContent = rows.length + (rows.length === 1 ? " campaign" : " campaigns") + " \u00b7 click a row for its full detail";
    $("gad-table-empty").hidden = rows.length > 0;
    var days = isoRange(state.from, state.to), shown = rows.slice(0, state.shown);
    body.innerHTML = shown.map(function (c) {
      var s = c.s, ctr = METRICS.ctr.v(s), cpc = METRICS.cpc.v(s), cvr = METRICS.cvr.v(s), cpa = METRICS.cpa.v(s);
      var st = (c.state || "").toLowerCase();
      return '<tr data-go="campaign" data-id="' + esc(c.key) + '" tabindex="0"' + (state.focus === c.key ? ' class="is-focus"' : "") + ">" +
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

  /* ════════════════════════════════════════════════════════════════════
     DETAIL PANELS
     Every figure, mark, row and legend item on the page carries
     data-go="<kind>" data-id="<id>", and one delegated handler opens the
     matching panel. Panels link to each other (an account lists its
     campaigns, a campaign lists its days, a day lists its accounts...), so
     a click inside a panel goes one level deeper and Back walks up again.

     Each panel works within the page's current date range and filters,
     except the dimension it is about: an account panel shows that account
     whatever the account filter says, a campaign panel shows the whole
     campaign whatever the search box says.
     ════════════════════════════════════════════════════════════════════ */
  var drawer = { el: null, body: null, stack: [], opener: null };

  function keyOf(r) { return r.account + "\u0001" + r.campaign; }
  function scoped(o) {
    var from = o.from || state.from, to = o.to || state.to;
    return ALL_ROWS.filter(function (r) {
      if (r.day < from || r.day > to) return false;
      if (o.campaign) return keyOf(r) === o.campaign;
      if (o.account != null) { if (r.account !== o.account) return false; }
      else if (state.account !== "__all__" && r.account !== state.account) return false;
      if (o.type != null) { if ((r.type || "Other") !== o.type) return false; }
      else if (state.type !== "__all__" && r.type !== state.type) return false;
      if (state.status !== "__all__" && r.state !== state.status) return false;
      if (!o.ignoreSearch && state.search &&
          (r.campaign || "").toLowerCase().indexOf(state.search) === -1 && (r.account || "").toLowerCase().indexOf(state.search) === -1) return false;
      if (!o.ignoreFocus && state.focus && keyOf(r) !== state.focus) return false;
      return true;
    });
  }
  function scopePair(o) {
    var cur = aggregate(scoped(o)), pr = state.compare ? prevRange() : null;
    var prev = pr && !o.from ? aggregate(scoped(Object.assign({}, o, { from: pr.from, to: pr.to }))) : null;
    return { cur: cur, prev: prev, pr: pr };
  }
  function rangeText() { return fmtDay(state.from) + " – " + fmtDay(state.to, true); }
  function filterNote(o) {
    var bits = [];
    if (o.account == null && state.account !== "__all__") bits.push(state.account);
    if (o.type == null && state.type !== "__all__") bits.push(state.type);
    if (state.status !== "__all__") bits.push(state.status + " only");
    if (!o.ignoreSearch && state.search) bits.push("“" + state.search + "”");
    return bits.length ? " · filtered: " + bits.map(esc).join(", ") : "";
  }

  /* ── Building blocks ─────────────────────────────────────────────── */
  function dHead(kicker, title, sub, color) {
    return '<header class="gad-dh"><span class="gad-lbl">' + (color ? '<i class="gad-dh-dot" style="background:' + color + '"></i>' : "") + esc(kicker) + "</span>" +
      '<h2 class="gad-dh-t" id="gad-dr-title"><span class="gad-mk">' + esc(title) + "</span></h2>" +
      (sub ? '<p class="gad-dh-s">' + sub + "</p>" : "") + "</header>";
  }
  function dSection(title, inner, note) {
    return '<section class="gad-ds"><div class="gad-ds-h"><h3>' + esc(title) + "</h3>" + (note ? "<span>" + note + "</span>" : "") + "</div>" + inner + "</section>";
  }
  // A grid of figures. Clicking one switches the panel's chart to it.
  function dKpis(cur, prev, keys, active, cmpLabel) {
    return '<div class="gad-dk">' + keys.map(function (k) {
      var m = METRICS[k], v = m.v(cur.totals), pv = prev ? m.v(prev.totals) : null;
      return '<button type="button" class="gad-dk-i' + (k === active ? " is-on" : "") + '" data-chart-metric="' + k + '">' +
        '<span class="gad-dk-l">' + esc(m.label) + "</span><b>" + (v == null ? "—" : esc(m.fmt(v))) + "</b>" +
        '<span class="gad-delta ' + deltaClass(k, v, pv) + '">' + (prev ? deltaHtml(k, v, pv).replace("vs prev.", cmpLabel || "vs prev.") : "") + "</span></button>";
    }).join("") + "</div>";
  }
  // Ranked rows that each open their own panel.
  function dList(items, o) {
    o = o || {};
    if (!items.length) return '<p class="gad-dempty">' + esc(o.empty || "Nothing in this range.") + "</p>";
    var shown = items.slice(0, o.limit || 10), max = Math.max.apply(null, shown.map(function (i) { return Math.abs(i.bar != null ? i.bar : i.v) || 0; })) || 1;
    return '<div class="gad-dl">' + shown.map(function (it) {
      var w = Math.abs(it.bar != null ? it.bar : it.v || 0) / max * 100;
      return '<button type="button" class="gad-dl-r" data-go="' + it.go + '" data-id="' + esc(it.id) + '">' +
        '<span class="gad-dl-n">' + (it.color ? '<i style="background:' + it.color + '"></i>' : "") + "<span><b>" + esc(it.name) + "</b>" + (it.sub ? "<small>" + it.sub + "</small>" : "") + "</span></span>" +
        '<span class="gad-dl-b"><i class="gad-hbar" style="width:' + w.toFixed(1) + "%" + (it.color ? ";background:" + it.color : "") + '"></i></span>' +
        '<span class="gad-dl-v">' + esc(it.label) + (it.sub2 ? "<small>" + it.sub2 + "</small>" : "") + '</span><span class="gad-dl-go" aria-hidden="true">&rsaquo;</span></button>';
    }).join("") + (items.length > shown.length ? '<p class="gad-dmore">+ ' + (items.length - shown.length) + " more</p>" : "") + "</div>";
  }
  function dFacts(list) {
    return '<dl class="gad-df">' + list.filter(Boolean).map(function (f) {
      var val = f.go ? '<button type="button" class="gad-df-link" data-go="' + f.go + '" data-id="' + esc(f.id) + '">' + esc(f.v) + " &rsaquo;</button>" : esc(f.v);
      return "<div><dt>" + esc(f.k) + "</dt><dd>" + val + (f.s ? "<small>" + esc(f.s) + "</small>" : "") + "</dd></div>";
    }).join("") + "</dl>";
  }
  function dActions(btns) {
    return '<div class="gad-da">' + btns.filter(Boolean).map(function (b) {
      return '<button type="button" class="gad-btn ' + (b.primary ? "gad-btn--dark" : "gad-btn--line") + '"' +
        (b.act ? ' data-act="' + b.act + '" data-id="' + esc(b.id || "") + '"' : ' data-go="' + b.go + '" data-id="' + esc(b.id) + '"') + ">" + esc(b.label) + "</button>";
    }).join("") + "</div>";
  }
  function dayPts(agg, from, to) {
    return isoRange(from, to).map(function (d) { return { key: d, label: WEEKDAYS[weekday(d)] + " " + fmtDay(d, true), s: agg.daily[d] || zero() }; });
  }
  function bestDay(agg, key) {
    var m = METRICS[key || "cost"], best = null;
    Object.keys(agg.daily).forEach(function (d) { var v = m.v(agg.daily[d]); if (v != null && (best === null || v > best.v)) best = { d: d, v: v }; });
    return best;
  }
  function sortFor(key) {
    var g = METRICS[key].good;
    return function (a, b) { return g < 0 ? a.v - b.v : b.v - a.v; };
  }
  function meets(key, s) { var mv = MIN_VOL[key]; return !mv || s[mv[0]] >= mv[1]; }
  function campItems(agg, key, filterVol) {
    var m = METRICS[key];
    return agg.campList.map(function (c) { return { c: c, v: m.v(c.s) }; })
      .filter(function (x) { return x.v != null && (!filterVol || meets(key, x.c.s)); })
      .map(function (x) {
        return { go: "campaign", id: x.c.key, name: x.c.campaign, sub: esc(x.c.account) + " &middot; " + esc(x.c.type || ""), color: typeColor(x.c.type),
          v: x.v, label: m.fmt(x.v), sub2: key === "cost" ? METRICS.conversions.fmt(x.c.s.conversions) + " conv." : fmtMoney(x.c.s.cost) };
      });
  }
  function accItems(agg, key, filterVol) {
    var m = METRICS[key];
    return agg.accList.map(function (a) { return { a: a, v: m.v(a.s) }; })
      .filter(function (x) { return x.v != null && (!filterVol || meets(key, x.a.s)); })
      .map(function (x) {
        return { go: "account", id: x.a.name, name: x.a.name, sub: Object.keys(x.a.camps).length + " campaigns",
          v: x.v, label: m.fmt(x.v), sub2: key === "cost" ? METRICS.conversions.fmt(x.a.s.conversions) + " conv." : fmtMoney(x.a.s.cost) };
      });
  }
  function typeItems(agg, key) {
    var m = METRICS[key];
    return Object.keys(agg.types).map(function (t) { return { t: t, v: m.v(agg.types[t]), s: agg.types[t] }; })
      .filter(function (x) { return x.v != null; })
      .map(function (x) { return { go: "type", id: x.t, name: x.t, color: typeColor(x.t), v: x.v, label: m.fmt(x.v), sub2: key === "cost" ? METRICS.conversions.fmt(x.s.conversions) + " conv." : fmtMoney(x.s.cost) }; });
  }
  function shareOf(part, whole) { return whole ? (part / whole * 100).toFixed(1) + "%" : "—"; }
  function typeStack(agg) {
    var total = agg.totals.cost || 1;
    var list = Object.keys(agg.types).sort(function (a, b) { return agg.types[b].cost - agg.types[a].cost; });
    return '<div class="gad-stack">' + list.map(function (t) {
      return '<button type="button" class="gad-stack-s" data-go="type" data-id="' + esc(t) + '" style="flex:' + (agg.types[t].cost / total).toFixed(4) + " 1 0;background:" + typeColor(t) + '" title="' + esc(t) + " · " + shareOf(agg.types[t].cost, total) + '"></button>';
    }).join("") + "</div>" + '<div class="gad-stack-k">' + list.map(function (t) {
      return '<span><i style="background:' + typeColor(t) + '"></i>' + esc(t) + " <b>" + shareOf(agg.types[t].cost, total) + "</b></span>";
    }).join("") + "</div>";
  }

  /* ── The views ───────────────────────────────────────────────────── */
  var VIEWS = {};

  VIEWS.metric = function (v) {
    var key = v.id, m = METRICS[key], p = scopePair({}), cur = p.cur, prev = p.prev;
    var val = m.v(cur.totals), pval = prev ? m.v(prev.totals) : null, rate = !m.add;
    var best = null, low = null;
    Object.keys(cur.daily).forEach(function (d) {
      var x = m.v(cur.daily[d]); if (x == null) return;
      if (!best || x > best.v) best = { d: d, v: x };
      if (!low || x < low.v) low = { d: d, v: x };
    });
    if (m.good < 0) { var t = best; best = low; low = t; }
    var camps = campItems(cur, key, rate).sort(sortFor(key));
    var html = dHead("Metric", m.label, esc(rangeText()) + filterNote({})) +
      '<div class="gad-dbig"><b data-odo>' + (val == null ? "—" : esc(m.fmt(val))) + '</b><span class="gad-delta ' + deltaClass(key, val, pval) + '">' + (prev ? deltaHtml(key, val, pval) : "") + "</span>" +
      (prev && pval != null ? '<span class="gad-dbig-p">Previous period ' + esc(m.fmt(pval)) + "</span>" : "") + "</div>" +
      '<p class="gad-ddef">' + esc(DEFS[key] || "") + "</p>" +
      dSection("Daily", '<div class="gad-dchart" data-line></div>', "click a day for its detail") +
      dFacts([
        best && { k: m.good < 0 ? "Best day (lowest)" : "Best day", v: fmtDay(best.d, true), s: m.fmt(best.v), go: "range", id: best.d + "|" + best.d },
        low && { k: m.good < 0 ? "Weakest day (highest)" : "Weakest day", v: fmtDay(low.d, true), s: m.fmt(low.v), go: "range", id: low.d + "|" + low.d },
        m.add && { k: "Average per day", v: m.fmt(val / periodLen()) },
        rate && MIN_VOL[key] && { k: "Ranked campaigns", v: String(camps.length), s: "with at least " + MIN_VOL[key][1] + " " + MIN_VOL[key][0] }
      ]) +
      dSection("By account", dList(accItems(cur, key, false).sort(sortFor(key)))) +
      dSection("By campaign type", dList(typeItems(cur, key).sort(sortFor(key)))) +
      (rate
        ? dSection("Best campaigns", dList(camps.slice(0, 6), { empty: "No campaign has enough volume to rank." })) +
          dSection("Weakest campaigns", dList(camps.slice().reverse().slice(0, 6), { empty: "No campaign has enough volume to rank." }))
        : dSection("Top campaigns", dList(camps, { limit: 12 }), m.add && val ? "share of total shown as bar" : "")) +
      dActions([{ act: "trend", id: key, label: "Show on the trend chart", primary: true }]);
    return { html: html, draw: function (body) {
      lineChart(body.querySelector("[data-line]"), { m: m, pts: dayPts(cur, state.from, state.to), H: 220,
        pvals: prev && p.pr ? dayPts(prev, p.pr.from, p.pr.to).map(function (x) { return m.v(x.s); }) : null,
        pick: function (pt) { return { t: "range", from: pt.key, to: pt.key }; } });
    } };
  };

  VIEWS.campaign = function (v) {
    var parts = v.id.split("\u0001"), accName = parts[0], name = parts[1];
    var p = scopePair({ campaign: v.id }), cur = p.cur, prev = p.prev, c = cur.camps[v.id];
    var metric = v.metric || "cost";
    if (!c) return { html: dHead("Campaign", name, esc(accName)) + '<p class="gad-dempty">No activity for this campaign in ' + esc(rangeText()) + ".</p>" };
    var any = ALL_ROWS.filter(function (r) { return keyOf(r) === v.id; })[0] || {};
    var accAgg = aggregate(scoped({ account: accName, ignoreSearch: true, ignoreFocus: true }));
    var ranked = accAgg.campList.slice().sort(function (a, b) { return b.s.cost - a.s.cost; });
    var rank = ranked.map(function (x) { return x.key; }).indexOf(v.id) + 1;
    var activeDays = Object.keys(c.days).filter(function (d) { return c.days[d] > 0; }).length;
    var bd = bestDay(cur, "conversions"), bs = bestDay(cur, "cost");
    var st = (c.state || "").toLowerCase();
    var sub = '<button type="button" class="gad-dh-link" data-go="account" data-id="' + esc(accName) + '">' + esc(accName) + " &rsaquo;</button>" +
      ' <button type="button" class="gad-dh-link" data-go="type" data-id="' + esc(c.type || "Other") + '"><i style="background:' + typeColor(c.type) + '"></i>' + esc(c.type || "Other") + " &rsaquo;</button>" +
      ' <span class="gad-state' + (st === "paused" ? " is-paused" : st === "removed" ? " is-removed" : "") + '">' + esc(c.state || "") + "</span>" +
      (any.customer_id ? ' <span class="gad-muted">ID ' + esc(any.customer_id) + "</span>" : "");
    var days = isoRange(state.from, state.to).filter(function (d) { return cur.daily[d]; }).reverse();
    var rows = days.map(function (d) {
      var s = cur.daily[d], ctr = METRICS.ctr.v(s), cpa = METRICS.cpa.v(s);
      return '<tr data-go="range" data-id="' + d + "|" + d + '" tabindex="0"><td>' + WEEKDAYS[weekday(d)] + " " + fmtDay(d) + '</td><td class="is-num">' + fmtMoney(s.cost) +
        '</td><td class="is-num">' + fmtInt(s.clicks) + '</td><td class="is-num">' + fmtInt(s.impressions) + '</td><td class="is-num">' + (ctr == null ? "—" : fmtPct(ctr)) +
        '</td><td class="is-num">' + METRICS.conversions.fmt(s.conversions) + '</td><td class="is-num">' + (cpa == null ? "—" : fmtMoney2(cpa)) + "</td></tr>";
    }).join("");
    var html = dHead("Campaign", name, sub, typeColor(c.type)) +
      '<p class="gad-dh-r">' + esc(rangeText()) + "</p>" +
      dKpis(cur, prev, ["cost", "clicks", "impressions", "conversions", "ctr", "cpc", "cpa", "cvr", "top_pct", "abs_top_pct", "view_through"], metric) +
      dSection(METRICS[metric].label + " by day", '<div class="gad-dchart" data-line></div>', "pick a figure above to switch") +
      dFacts([
        { k: "Share of account spend", v: shareOf(c.s.cost, accAgg.totals.cost), s: "of " + fmtMoney(accAgg.totals.cost) },
        { k: "Rank in account", v: rank ? "#" + rank + " of " + ranked.length : "—", s: "by spend" },
        { k: "Days with spend", v: activeDays + " of " + periodLen() },
        { k: "Average daily spend", v: fmtMoney(c.s.cost / periodLen()) },
        bs && { k: "Highest-spend day", v: fmtDay(bs.d, true), s: fmtMoney(bs.v), go: "range", id: bs.d + "|" + bs.d },
        bd && bd.v > 0 && { k: "Most conversions", v: fmtDay(bd.d, true), s: METRICS.conversions.fmt(bd.v) + " conv.", go: "range", id: bd.d + "|" + bd.d }
      ]) +
      dSection("Day by day", '<div class="gad-dt-wrap"><table class="gad-dt"><thead><tr><th>Day</th><th class="is-num">Spend</th><th class="is-num">Clicks</th><th class="is-num">Impr.</th><th class="is-num">CTR</th><th class="is-num">Conv.</th><th class="is-num">Cost / conv.</th></tr></thead><tbody>' + rows + "</tbody></table></div>", "click a day for everything that ran on it") +
      dActions([
        { act: "focus", id: v.id, label: state.focus === v.id ? "Stop focusing this campaign" : "Focus the page on this campaign", primary: true },
        { go: "account", id: accName, label: "Open " + accName }
      ]);
    return { html: html, draw: function (body) {
      var m = METRICS[metric];
      lineChart(body.querySelector("[data-line]"), { m: m, pts: dayPts(cur, state.from, state.to), H: 220,
        pvals: prev && p.pr ? dayPts(prev, p.pr.from, p.pr.to).map(function (x) { return m.v(x.s); }) : null,
        pick: function (pt) { return { t: "range", from: pt.key, to: pt.key }; } });
    } };
  };

  VIEWS.account = function (v) {
    var name = v.id, metric = v.metric || "cost";
    var o = { account: name, ignoreSearch: true, ignoreFocus: true };
    var p = scopePair(o), cur = p.cur, prev = p.prev;
    // Share of all accounts: the same scope without the account restriction.
    var everyone = aggregate(ALL_ROWS.filter(function (r) { return r.day >= state.from && r.day <= state.to && (state.type === "__all__" || r.type === state.type) && (state.status === "__all__" || r.state === state.status); }));
    var any = ALL_ROWS.filter(function (r) { return r.account === name; })[0] || {};
    var camps = campItems(cur, "cost").sort(sortFor("cost"));
    camps.forEach(function (x) { var c = cur.camps[x.id], cpa = METRICS.cpa.v(c.s); x.sub2 = METRICS.conversions.fmt(c.s.conversions) + " conv. &middot; " + (cpa == null ? "—" : fmtCompact(cpa, true) + "/conv."); x.sub = esc(c.type || "") + ' &middot; <span class="gad-state' + ((c.state || "").toLowerCase() === "paused" ? " is-paused" : "") + '">' + esc(c.state || "") + "</span>"; });
    var bs = bestDay(cur, "cost"), bc = bestDay(cur, "conversions");
    var html = dHead("Account", name, (any.customer_id ? "Customer ID " + esc(any.customer_id) + " &middot; " : "") + cur.campList.length + " campaigns &middot; " + esc(rangeText()) + filterNote(o)) +
      dKpis(cur, prev, ["cost", "clicks", "impressions", "conversions", "ctr", "cpc", "cpa", "cvr", "top_pct", "abs_top_pct", "view_through"], metric) +
      dSection(METRICS[metric].label + " by day", '<div class="gad-dchart" data-line></div>', "pick a figure above to switch") +
      dSection("Spend by campaign type", typeStack(cur)) +
      dFacts([
        { k: "Share of all spend", v: shareOf(cur.totals.cost, everyone.totals.cost), s: "of " + fmtMoney(everyone.totals.cost) + " across all accounts" },
        { k: "Share of all conversions", v: shareOf(cur.totals.conversions, everyone.totals.conversions) },
        { k: "Average daily spend", v: fmtMoney(cur.totals.cost / periodLen()) },
        bs && { k: "Highest-spend day", v: fmtDay(bs.d, true), s: fmtMoney(bs.v), go: "range", id: bs.d + "|" + bs.d },
        bc && bc.v > 0 && { k: "Most conversions", v: fmtDay(bc.d, true), s: METRICS.conversions.fmt(bc.v) + " conv.", go: "range", id: bc.d + "|" + bc.d }
      ]) +
      dSection("Campaigns", dList(camps, { limit: 50 }), "by spend") +
      dActions([{ act: "account", id: name, label: state.account === name ? "Show all accounts on the page" : "Show this account on the page", primary: true }]);
    return { html: html, draw: function (body) {
      var m = METRICS[metric];
      lineChart(body.querySelector("[data-line]"), { m: m, pts: dayPts(cur, state.from, state.to), H: 220,
        pvals: prev && p.pr ? dayPts(prev, p.pr.from, p.pr.to).map(function (x) { return m.v(x.s); }) : null,
        pick: function (pt) { return { t: "range", from: pt.key, to: pt.key }; } });
    } };
  };

  VIEWS.type = function (v) {
    var t = v.id, metric = v.metric || "cost", o = { type: t, ignoreFocus: true };
    var p = scopePair(o), cur = p.cur, prev = p.prev;
    var everyType = aggregate(ALL_ROWS.filter(function (r) { return r.day >= state.from && r.day <= state.to && (state.account === "__all__" || r.account === state.account) && (state.status === "__all__" || r.state === state.status); }));
    var html = dHead("Campaign type", t, cur.campList.length + " campaigns in " + cur.accList.length + " accounts &middot; " + esc(rangeText()) + filterNote(o), typeColor(t)) +
      dKpis(cur, prev, ["cost", "clicks", "impressions", "conversions", "ctr", "cpc", "cpa", "cvr", "top_pct", "view_through"], metric) +
      dSection(METRICS[metric].label + " by day", '<div class="gad-dchart" data-line></div>', "pick a figure above to switch") +
      dFacts([
        { k: "Share of spend", v: shareOf(cur.totals.cost, everyType.totals.cost), s: "of " + fmtMoney(everyType.totals.cost) + " across all types" },
        { k: "Share of conversions", v: shareOf(cur.totals.conversions, everyType.totals.conversions) }
      ]) +
      dSection("Accounts", dList(accItems(cur, "cost").sort(sortFor("cost")))) +
      dSection("Campaigns", dList(campItems(cur, "cost").sort(sortFor("cost")), { limit: 20 }), "by spend") +
      dActions([{ act: "type", id: t, label: state.type === t ? "Show every type on the page" : "Filter the page to " + t, primary: true }]);
    return { html: html, draw: function (body) {
      var m = METRICS[metric];
      lineChart(body.querySelector("[data-line]"), { m: m, pts: dayPts(cur, state.from, state.to), H: 220,
        pvals: prev && p.pr ? dayPts(prev, p.pr.from, p.pr.to).map(function (x) { return m.v(x.s); }) : null,
        pick: function (pt) { return { t: "range", from: pt.key, to: pt.key }; } });
    } };
  };

  VIEWS.range = function (v) {
    var from = v.from, to = v.to, single = from === to, metric = v.metric || "cost";
    var cur = aggregate(scoped({ from: from, to: to }));
    // A day is compared with the average day of the page's range; a week
    // with the same number of days averaged over the range.
    var pageAgg = aggregate(scoped({})), n = daysBetween(from, to) + 1, factor = n / periodLen();
    var avg = { totals: zero() }; for (var f in pageAgg.totals) avg.totals[f] = pageAgg.totals[f] * factor;
    var title = single ? WEEKDAYS[weekday(from)] + " " + fmtDay(from, true) : fmtDay(from) + " – " + fmtDay(to, true);
    var nav = single ? '<div class="gad-dnav">' +
      (from > MIN_DAY ? '<button type="button" class="gad-btn gad-btn--line" data-go="range" data-id="' + addDays(from, -1) + "|" + addDays(from, -1) + '">&lsaquo; ' + fmtDay(addDays(from, -1)) + "</button>" : "<span></span>") +
      (to < MAX_DAY ? '<button type="button" class="gad-btn gad-btn--line" data-go="range" data-id="' + addDays(to, 1) + "|" + addDays(to, 1) + '">' + fmtDay(addDays(to, 1)) + " &rsaquo;</button>" : "") + "</div>" : "";
    var html = dHead(single ? "Day" : "Period", title, (single ? "" : n + " days &middot; ") + "compared with the average " + (single ? "day" : n + " days") + " in " + esc(rangeText()) + filterNote({})) + nav +
      dKpis(cur, avg, ["cost", "clicks", "impressions", "conversions", "ctr", "cpc", "cpa", "cvr"], metric, "vs avg.") +
      (single ? "" : dSection(METRICS[metric].label + " by day", '<div class="gad-dchart" data-line></div>')) +
      dSection("Accounts", dList(accItems(cur, "cost").sort(sortFor("cost")))) +
      dSection("Campaign types", dList(typeItems(cur, "cost").sort(sortFor("cost")))) +
      dSection("Campaigns", dList(campItems(cur, "cost").sort(sortFor("cost")), { limit: 15 }), "by spend") +
      dActions([{ act: "range", id: from + "|" + to, label: "Set the page to " + (single ? "this day" : "these dates"), primary: true }]);
    return { html: html, draw: single ? null : function (body) {
      lineChart(body.querySelector("[data-line]"), { m: METRICS[metric], pts: dayPts(cur, from, to), H: 200,
        pick: function (pt) { return { t: "range", from: pt.key, to: pt.key }; } });
    } };
  };

  VIEWS.weekday = function (v) {
    var i = +v.id, cur = aggregate(scoped({}));
    var dates = isoRange(state.from, state.to).filter(function (d) { return weekday(d) === i; });
    var rows = aggregate(scoped({}).filter(function (r) { return weekday(r.day) === i; }));
    var perDay = { totals: zero() }, others = { totals: zero() }, nOther = periodLen() - dates.length;
    for (var f in rows.totals) { perDay.totals[f] = dates.length ? rows.totals[f] / dates.length : 0; others.totals[f] = nOther ? (cur.totals[f] - rows.totals[f]) / nOther : 0; }
    var dateItems = dates.map(function (d) {
      var s = cur.daily[d] || zero();
      return { go: "range", id: d + "|" + d, name: fmtDay(d, true), v: s.cost, label: fmtMoney(s.cost), sub2: METRICS.conversions.fmt(s.conversions) + " conv." };
    });
    var names = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
    var html = dHead("Day of week", names[i], dates.length + " in " + esc(rangeText()) + " &middot; an average " + WEEKDAYS[i] + " compared with an average other day" + filterNote({})) +
      dKpis(perDay, nOther ? others : null, ["cost", "clicks", "impressions", "conversions", "ctr", "cpc", "cpa", "cvr"], null, "vs other days") +
      dSection("Each " + WEEKDAYS[i], dList(dateItems, { limit: 10 }), "click a date for its detail") +
      dSection("Top campaigns on " + names[i], dList(campItems(rows, "cost").sort(sortFor("cost")), { limit: 10 })) +
      dSection("Accounts on " + names[i], dList(accItems(rows, "cost").sort(sortFor("cost"))));
    return { html: html };
  };

  /* ── Opening, stacking, closing ──────────────────────────────────── */
  function viewFrom(el) {
    var t = el.getAttribute("data-go"), id = el.getAttribute("data-id") || "";
    if (t === "range") { var r = id.split("|"); return { t: "range", from: r[0], to: r[1] || r[0] }; }
    return { t: t, id: id };
  }
  function titleOf(v) {
    if (v.t === "range") return v.from === v.to ? fmtDay(v.from) : fmtDay(v.from) + "–" + fmtDay(v.to);
    if (v.t === "metric") return METRICS[v.id].label;
    if (v.t === "campaign") return v.id.split("\u0001")[1];
    if (v.t === "weekday") return WEEKDAYS[+v.id];
    return v.id;
  }
  function openDetail(v, opener) {
    if (!VIEWS[v.t]) return;
    var d = drawer;
    if (!d.el.classList.contains("is-open")) {
      d.stack = [v]; d.opener = opener || doc.activeElement;
      d.el.hidden = false; d.el.setAttribute("aria-hidden", "false");
      root.classList.add("gad-locked");
      paint(false);
      void d.el.offsetWidth;
      requestAnimationFrame(function () { d.el.classList.add("is-open"); });
      setTimeout(function () { d.el.querySelector(".gad-dr-close").focus({ preventScroll: true }); }, 60);
    } else {
      d.stack.push(v); paint(true, 1);
    }
  }
  function goBack(to) {
    var d = drawer;
    if (d.stack.length < 2) { closeDetail(); return; }
    d.stack = d.stack.slice(0, to == null ? d.stack.length - 1 : to + 1);
    paint(true, -1);
  }
  function closeDetail() {
    var d = drawer;
    if (!d.el.classList.contains("is-open")) return;
    d.el.classList.remove("is-open");
    hideTip();
    setTimeout(function () {
      d.el.hidden = true; d.el.setAttribute("aria-hidden", "true"); root.classList.remove("gad-locked");
      d.body.innerHTML = "";
      if (d.opener && d.opener.focus && doc.contains(d.opener)) d.opener.focus({ preventScroll: true });
    }, REDUCED ? 0 : 420);
  }
  function paint(swap, dir) {
    var d = drawer, v = d.stack[d.stack.length - 1];
    var crumbs = d.stack.map(function (x, i) {
      return i === d.stack.length - 1 ? '<span aria-current="page">' + esc(titleOf(x)) + "</span>" : '<button type="button" data-crumb="' + i + '">' + esc(titleOf(x)) + "</button>";
    }).join('<i aria-hidden="true">/</i>');
    d.el.querySelector(".gad-dr-crumbs").innerHTML = crumbs;
    d.el.querySelector(".gad-dr-back").hidden = d.stack.length < 2;
    var out = VIEWS[v.t](v);
    function put() {
      d.body.innerHTML = out.html;
      d.body.scrollTop = 0;
      if (out.draw) out.draw(d.body);
      var big = d.body.querySelector("[data-odo]");
      if (big) { var txt = big.textContent; big.textContent = ""; big.removeAttribute("data-text"); odo(big, txt); }
    }
    if (!swap || REDUCED) { put(); return; }
    d.body.classList.add(dir < 0 ? "is-out-r" : "is-out-l");
    setTimeout(function () {
      d.body.classList.remove("is-out-r", "is-out-l"); d.body.classList.add(dir < 0 ? "is-in-l" : "is-in-r");
      put();
      void d.body.offsetWidth;
      requestAnimationFrame(function () { d.body.classList.remove("is-in-l", "is-in-r"); });
    }, 150);
  }
  function redrawCurrent(patch) {
    var d = drawer, v = d.stack[d.stack.length - 1];
    for (var k in patch) v[k] = patch[k];
    var y = d.body.scrollTop;
    paint(false);
    d.body.scrollTop = y;
  }

  function initDrawer() {
    var d = drawer;
    d.el = $("gad-drawer"); d.body = $("gad-drawer-body");
    d.el.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) { closeDetail(); return; }
      if (e.target.closest(".gad-dr-back")) { goBack(); return; }
      var cr = e.target.closest("[data-crumb]"); if (cr) { goBack(+cr.getAttribute("data-crumb")); return; }
      var sw = e.target.closest("[data-chart-metric]");
      if (sw) { redrawCurrent({ metric: sw.getAttribute("data-chart-metric") }); return; }
      var a = e.target.closest("[data-act]");
      if (a) {
        var id = a.getAttribute("data-id"), act = a.getAttribute("data-act");
        closeDetail();
        if (act === "focus") setFocus(state.focus === id ? null : id);
        else if (act === "account") setAccount(state.account === id ? "__all__" : id);
        else if (act === "type") setType(state.type === id ? "__all__" : id);
        else if (act === "range") { var r = id.split("|"); state.from = r[0]; state.to = r[1]; state.preset = "custom"; state.shown = 15; renderAll(); renderTicker(); }
        else if (act === "trend") {
          state.metric = id;
          var btn = doc.querySelector('[data-metric="' + id + '"]');
          if (btn) btn.click();
          else { $$("[data-metric]").forEach(function (x) { x.classList.remove("is-on"); }); renderAll(); }
          doc.querySelector('[data-panel="trend"]').scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
        }
      }
    });
    doc.addEventListener("keydown", function (e) {
      if (d.el.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); closeDetail(); }
      else if (e.key === "Tab") {
        // Keep focus inside the open panel.
        var f = $$('button:not([hidden]), [tabindex="0"], a[href]', d.el.querySelector(".gad-drawer-panel")).filter(function (x) { return x.offsetParent !== null || x instanceof SVGElement; });
        if (!f.length) return;
        if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    // One handler for every data-go link on the page and in the panel.
    doc.addEventListener("click", function (e) {
      var el = e.target.closest && e.target.closest("[data-go]");
      if (!el) return;
      e.preventDefault();
      hideTip();
      openDetail(viewFrom(el), el);
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = e.target.closest && e.target.closest("[data-go]");
      if (!el || el.tagName === "BUTTON") return;
      e.preventDefault();
      openDetail(viewFrom(el), el);
    });
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
  initDrawer();
  arrive();
  renderAll();
  renderTicker();
  watchPanels();
})();
