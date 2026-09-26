/* ════════════════════════════════════════════════════════════════════════
   GOOGLE ADS PERFORMANCE — client-side filter/aggregate/render

   The route embeds the full row set once (#gad-data); everything after
   that -- the account switcher, date range, campaign type/state filters,
   search, every chart, the sortable table -- runs entirely in the browser
   against that same array. That is what makes switching accounts or date
   ranges instant instead of a page reload: there is nothing left to fetch.

   No charting library: four small SVG/DOM renderers (line, donut, bar,
   table) built for exactly the four things this page shows, using the
   platform's own four hues rather than a generic default palette.

   Loaded with `defer`, no build step, same constraint as bento-motion.js.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var dataEl = document.getElementById("gad-data");
  if (!dataEl) return;

  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ALL_ROWS = [];
  try { ALL_ROWS = JSON.parse(dataEl.textContent || "[]"); } catch (e) { ALL_ROWS = []; }
  var CURRENCY = document.body.getAttribute("data-currency-symbol") || "";

  // Four brand hues first (spend/clicks/conversions/CTR and the first four
  // legend slots), then extra tints only if a filter ever needs a fifth+
  // category -- most accounts won't.
  var PALETTE = ["#FF6022", "#1D65A6", "#C8261B", "#B8860B", "#7A5CFA", "#0E9F6E", "#D6336C", "#0891B2"];

  if (!ALL_ROWS.length) return; // empty state is rendered server-side

  var state = {
    account: "__all__", range: "all", type: "__all__", campState: "__all__",
    search: "", metric: "cost", sortKey: "cost", sortDir: "desc"
  };

  // ── Option lists, derived once from the full data set ───────────────────
  function uniqueSorted(key) {
    var seen = {}, out = [];
    for (var i = 0; i < ALL_ROWS.length; i++) {
      var v = ALL_ROWS[i][key];
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    out.sort();
    return out;
  }
  var ACCOUNTS = uniqueSorted("account");
  var TYPES = uniqueSorted("type");
  var STATES = uniqueSorted("state");
  var MAX_DAY = ALL_ROWS.reduce(function (m, r) { return r.day > m ? r.day : m; }, "");

  // ── Filtering + aggregation ──────────────────────────────────────────────
  function rangeStartDay() {
    if (state.range === "all" || !MAX_DAY) return "";
    var days = parseInt(state.range, 10);
    var d = new Date(MAX_DAY + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (days - 1));
    return d.toISOString().slice(0, 10);
  }

  function filteredRows() {
    var start = rangeStartDay();
    var q = state.search.trim().toLowerCase();
    return ALL_ROWS.filter(function (r) {
      if (state.account !== "__all__" && r.account !== state.account) return false;
      if (state.type !== "__all__" && r.type !== state.type) return false;
      if (state.campState !== "__all__" && r.state !== state.campState) return false;
      if (start && r.day < start) return false;
      if (q && (r.campaign || "").toLowerCase().indexOf(q) === -1 &&
          (r.account || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function aggregate(rows) {
    var totals = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    var byDay = {}, byType = {}, byAccount = {}, byCampaign = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      totals.clicks += r.clicks; totals.impressions += r.impressions;
      totals.cost += r.cost; totals.conversions += r.conversions;

      var d = byDay[r.day] || (byDay[r.day] = { day: r.day, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      d.cost += r.cost; d.clicks += r.clicks; d.impressions += r.impressions; d.conversions += r.conversions;

      var tName = r.type || "Other";
      var t = byType[tName] || (byType[tName] = { name: tName, cost: 0 });
      t.cost += r.cost;

      var a = byAccount[r.account] || (byAccount[r.account] = { name: r.account, cost: 0 });
      a.cost += r.cost;

      var key = r.account + "\u0001" + r.campaign;
      var c = byCampaign[key] || (byCampaign[key] = {
        account: r.account, campaign: r.campaign, state: r.state, type: r.type,
        cost: 0, clicks: 0, impressions: 0, conversions: 0
      });
      c.cost += r.cost; c.clicks += r.clicks; c.impressions += r.impressions; c.conversions += r.conversions;
    }

    var daily = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
    var campaigns = Object.keys(byCampaign).map(function (k) { return byCampaign[k]; });
    var byTypeArr = Object.keys(byType).map(function (k) { return byType[k]; })
      .sort(function (a, b) { return b.cost - a.cost; });
    var byAccountArr = Object.keys(byAccount).map(function (k) { return byAccount[k]; })
      .sort(function (a, b) { return b.cost - a.cost; });

    return {
      totals: totals,
      ctr: totals.impressions ? totals.clicks / totals.impressions * 100 : 0,
      avgCpc: totals.clicks ? totals.cost / totals.clicks : 0,
      costPerConv: totals.conversions ? totals.cost / totals.conversions : 0,
      daily: daily,
      campaigns: campaigns,
      byType: byTypeArr,
      byAccount: byAccountArr,
      accountsCount: Object.keys(byAccount).length,
      campaignsCount: campaigns.length,
      asOf: daily.length ? daily[daily.length - 1].day : ""
    };
  }

  // ── Formatting ────────────────────────────────────────────────────────────
  function fmtInt(n) { return Math.round(n).toLocaleString("en-IN"); }
  function fmtMoney(n) { return CURRENCY + Math.round(n).toLocaleString("en-IN"); }
  function fmtMoney2(n) {
    return CURRENCY + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) { return n.toFixed(2) + "%"; }

  // ── Animated numbers: from whatever the tile currently shows, to the new
  //    value -- smooth on every filter change, not just on first load. ──────
  var _numTimers = {};
  function animateNumber(el, toValue, formatter, key) {
    if (_numTimers[key]) cancelAnimationFrame(_numTimers[key]);
    var fromValue = parseFloat(el.getAttribute("data-raw") || "0") || 0;
    el.setAttribute("data-raw", toValue);
    if (REDUCED) { el.textContent = formatter(toValue); return; }
    var start = performance.now(), dur = 600;
    function step(t) {
      var p = Math.min(1, (t - start) / dur);
      var k = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(fromValue + (toValue - fromValue) * k);
      if (p < 1) _numTimers[key] = requestAnimationFrame(step);
    }
    _numTimers[key] = requestAnimationFrame(step);
  }

  function statEl(name) { return document.querySelector('[data-stat="' + name + '"] .gad-stat-v'); }

  function renderStats(agg) {
    animateNumber(statEl("cost"), agg.totals.cost, fmtMoney, "cost");
    animateNumber(statEl("clicks"), agg.totals.clicks, fmtInt, "clicks");
    animateNumber(statEl("impressions"), agg.totals.impressions, fmtInt, "impressions");
    animateNumber(statEl("conversions"), agg.totals.conversions, fmtInt, "conversions");
    animateNumber(statEl("ctr"), agg.ctr, fmtPct, "ctr");
    animateNumber(statEl("cpc"), agg.avgCpc, fmtMoney2, "cpc");
    var cpcEl = statEl("cost-per-conv");
    if (agg.totals.conversions) animateNumber(cpcEl, agg.costPerConv, fmtMoney2, "cpconv");
    else { cpcEl.textContent = "—"; cpcEl.setAttribute("data-raw", "0"); }
  }

  function renderHeader(agg) {
    var sub = document.getElementById("gad-hero-sub");
    if (sub) {
      sub.textContent = (agg.asOf ? "As of " + agg.asOf + " · " : "") +
        agg.accountsCount + " account" + (agg.accountsCount === 1 ? "" : "s") + " · " +
        agg.campaignsCount + " campaign" + (agg.campaignsCount === 1 ? "" : "s");
    }
  }

  // ── Tooltip (one shared floating element) ────────────────────────────────
  var tip = document.createElement("div");
  tip.className = "gad-tooltip";
  tip.style.display = "none";
  document.body.appendChild(tip);
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.left = (x + 14) + "px";
    tip.style.top = (y - 14) + "px";
    tip.style.display = "block";
  }
  function hideTip() { tip.style.display = "none"; }

  // ── Trend chart (single metric, drawn as an SVG path) ────────────────────
  var METRICS = {
    cost: { label: "Spend", fmt: fmtMoney, color: PALETTE[0] },
    clicks: { label: "Clicks", fmt: fmtInt, color: PALETTE[1] },
    conversions: { label: "Conversions", fmt: fmtInt, color: PALETTE[2] },
    ctr: { label: "CTR", fmt: function (n) { return n.toFixed(2) + "%"; }, color: PALETTE[3] }
  };

  function renderTrend(agg) {
    var svg = document.getElementById("gad-trend-svg");
    var rangeEl = document.getElementById("gad-trend-range");
    var minMaxEl = document.getElementById("gad-trend-minmax");
    if (!svg) return;
    svg.innerHTML = "";
    var daily = agg.daily;
    var metric = METRICS[state.metric];
    var values = daily.map(function (d) {
      if (state.metric === "ctr") return d.impressions ? d.clicks / d.impressions * 100 : 0;
      return d[state.metric];
    });

    if (daily.length < 2) {
      if (rangeEl) rangeEl.textContent = "";
      if (minMaxEl) minMaxEl.innerHTML = "";
      var msg = document.createElementNS("http://www.w3.org/2000/svg", "text");
      msg.setAttribute("x", "50%"); msg.setAttribute("y", "50%");
      msg.setAttribute("text-anchor", "middle"); msg.setAttribute("class", "gad-chart-empty");
      msg.textContent = "Not enough days in this filter to draw a trend";
      svg.appendChild(msg);
      return;
    }

    var W = 720, H = 220, PAD = 14;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var span = (hi - lo) || 1;
    var n = values.length;
    var xs = values.map(function (_, i) { return PAD + (W - 2 * PAD) * i / (n - 1); });
    var ys = values.map(function (v) { return H - PAD - (H - 2 * PAD) * (v - lo) / span; });

    var linePath = "M" + xs.map(function (x, i) { return x.toFixed(1) + "," + ys[i].toFixed(1); }).join("L");
    var areaPath = linePath + "L" + xs[n - 1].toFixed(1) + "," + (H - PAD) + "L" + xs[0].toFixed(1) + "," + (H - PAD) + "Z";

    var svgns = "http://www.w3.org/2000/svg";
    var area = document.createElementNS(svgns, "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("class", "gad-chart-area");
    area.setAttribute("fill", metric.color);
    area.style.opacity = "0.14";
    svg.appendChild(area);

    var line = document.createElementNS(svgns, "path");
    line.setAttribute("d", linePath);
    line.setAttribute("class", "gad-chart-line");
    line.setAttribute("stroke", metric.color);
    svg.appendChild(line);

    // Hover targets + hit area
    var overlay = document.createElementNS(svgns, "rect");
    overlay.setAttribute("x", "0"); overlay.setAttribute("y", "0");
    overlay.setAttribute("width", W); overlay.setAttribute("height", H);
    overlay.setAttribute("fill", "transparent");
    overlay.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect();
      var relX = (e.clientX - rect.left) / rect.width * W;
      var idx = 0, best = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var dist = Math.abs(xs[i] - relX);
        if (dist < best) { best = dist; idx = i; }
      }
      showTip("<b>" + daily[idx].day + "</b><br>" + metric.label + ": " + metric.fmt(values[idx]),
              e.clientX, e.clientY);
    });
    overlay.addEventListener("mouseleave", hideTip);
    svg.appendChild(overlay);

    // Draw-in animation: dash the path to its own length, then release it.
    if (!REDUCED) {
      var len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { line.style.strokeDashoffset = "0"; });
      });
    }

    if (rangeEl) rangeEl.textContent = daily[0].day + " – " + daily[n - 1].day;
    if (minMaxEl) minMaxEl.innerHTML =
      "<span>" + metric.fmt(lo) + "</span><span>" + metric.fmt(hi) + "</span>";
  }

  // ── Donut: spend by campaign type ────────────────────────────────────────
  function renderDonut(agg) {
    var svg = document.getElementById("gad-donut-svg");
    var legend = document.getElementById("gad-donut-legend");
    if (!svg || !legend) return;
    svg.innerHTML = ""; legend.innerHTML = "";
    var total = agg.byType.reduce(function (s, t) { return s + t.cost; }, 0);
    if (!total) return;

    var svgns = "http://www.w3.org/2000/svg";
    var R = 70, CX = 90, CY = 90, STROKE = 26;
    var circumference = 2 * Math.PI * R;
    var offset = 0;
    agg.byType.slice(0, 8).forEach(function (t, i) {
      var frac = t.cost / total;
      var seg = document.createElementNS(svgns, "circle");
      seg.setAttribute("cx", CX); seg.setAttribute("cy", CY); seg.setAttribute("r", R);
      seg.setAttribute("fill", "none");
      seg.setAttribute("stroke", PALETTE[i % PALETTE.length]);
      seg.setAttribute("stroke-width", STROKE);
      var dash = frac * circumference;
      seg.setAttribute("stroke-dasharray", (REDUCED ? dash : 0) + " " + circumference);
      seg.setAttribute("stroke-dashoffset", (-offset).toFixed(2));
      seg.setAttribute("transform", "rotate(-90 " + CX + " " + CY + ")");
      seg.style.transition = REDUCED ? "none" : "stroke-dasharray 700ms cubic-bezier(.22,1,.36,1)";
      seg.addEventListener("mousemove", function (e) {
        showTip("<b>" + t.name + "</b><br>" + fmtMoney(t.cost) + " (" + (frac * 100).toFixed(1) + "%)",
                e.clientX, e.clientY);
      });
      seg.addEventListener("mouseleave", hideTip);
      svg.appendChild(seg);
      if (!REDUCED) requestAnimationFrame(function () {
        requestAnimationFrame(function () { seg.setAttribute("stroke-dasharray", dash + " " + circumference); });
      });
      offset += dash;

      var row = document.createElement("div");
      row.className = "gad-legend-item";
      row.innerHTML = '<span class="gad-legend-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' +
        '<span class="gad-legend-name">' + t.name + '</span>' +
        '<span class="gad-legend-val">' + fmtMoney(t.cost) + '</span>';
      legend.appendChild(row);
    });
  }

  // ── Horizontal bars: spend by account (hidden when one account is picked) ─
  function renderAccountBars(agg) {
    var wrap = document.getElementById("gad-accbars-panel");
    var body = document.getElementById("gad-accbars-body");
    if (!wrap || !body) return;
    if (state.account !== "__all__") { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    body.innerHTML = "";
    var max = agg.byAccount.reduce(function (m, a) { return Math.max(m, a.cost); }, 0) || 1;
    agg.byAccount.slice(0, 10).forEach(function (a, i) {
      var row = document.createElement("div");
      row.className = "gad-abar-row";
      var pct = (a.cost / max * 100).toFixed(1);
      row.innerHTML =
        '<span class="gad-abar-name">' + a.name + '</span>' +
        '<span class="gad-abar-track"><span class="gad-abar-fill" style="width:0%;background:' +
          PALETTE[i % PALETTE.length] + '"></span></span>' +
        '<span class="gad-abar-val">' + fmtMoney(a.cost) + '</span>';
      body.appendChild(row);
      var fill = row.querySelector(".gad-abar-fill");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fill.style.width = pct + "%"; });
      });
    });
  }

  // ── Campaign table, sortable ─────────────────────────────────────────────
  function renderTable(agg) {
    var body = document.getElementById("gad-table-body");
    var empty = document.getElementById("gad-table-empty");
    if (!body) return;
    var rows = agg.campaigns.slice().sort(function (a, b) {
      var av = a[state.sortKey], bv = b[state.sortKey];
      if (typeof av === "string") { av = av.toLowerCase(); bv = (bv || "").toLowerCase(); }
      if (av < bv) return state.sortDir === "asc" ? -1 : 1;
      if (av > bv) return state.sortDir === "asc" ? 1 : -1;
      return 0;
    });
    body.innerHTML = "";
    if (!rows.length) {
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";
    rows.slice(0, 50).forEach(function (c) {
      var row = document.createElement("div");
      row.className = "gad-row";
      row.innerHTML =
        '<span class="gad-cell-acc">' + c.account + '</span>' +
        '<span class="gad-cell-camp">' + c.campaign + '</span>' +
        '<span>' + fmtInt(c.clicks) + '</span>' +
        '<span>' + fmtInt(c.impressions) + '</span>' +
        '<span>' + fmtMoney(c.cost) + '</span>' +
        '<span>' + fmtInt(c.conversions) + '</span>';
      body.appendChild(row);
    });
    document.querySelectorAll("[data-sort-key]").forEach(function (h) {
      var arrow = h.querySelector(".gad-sort-arrow");
      if (!arrow) return;
      arrow.textContent = h.getAttribute("data-sort-key") === state.sortKey
        ? (state.sortDir === "asc" ? "↑" : "↓") : "";
    });
  }

  // ── Wire it all together ──────────────────────────────────────────────────
  function renderAll() {
    var agg = aggregate(filteredRows());
    renderHeader(agg);
    renderStats(agg);
    renderTrend(agg);
    renderDonut(agg);
    renderAccountBars(agg);
    renderTable(agg);
  }

  function populateSelect(el, values, allLabel) {
    el.innerHTML = "";
    var optAll = document.createElement("option");
    optAll.value = "__all__"; optAll.textContent = allLabel;
    el.appendChild(optAll);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v;
      el.appendChild(o);
    });
  }

  function init() {
    var accountSel = document.getElementById("gad-account-select");
    var typeSel = document.getElementById("gad-type-select");
    var stateSel = document.getElementById("gad-state-select");
    var searchInput = document.getElementById("gad-search");

    if (accountSel) {
      populateSelect(accountSel, ACCOUNTS, "All accounts");
      accountSel.addEventListener("change", function () { state.account = accountSel.value; renderAll(); });
    }
    if (typeSel) {
      populateSelect(typeSel, TYPES, "All types");
      typeSel.addEventListener("change", function () { state.type = typeSel.value; renderAll(); });
    }
    if (stateSel) {
      populateSelect(stateSel, STATES, "All states");
      stateSel.addEventListener("change", function () { state.campState = stateSel.value; renderAll(); });
    }
    if (searchInput) {
      var t;
      searchInput.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () { state.search = searchInput.value; renderAll(); }, 180);
      });
    }

    document.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("[data-range]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.range = btn.getAttribute("data-range");
        renderAll();
      });
    });

    document.querySelectorAll("[data-metric]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("[data-metric]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.metric = btn.getAttribute("data-metric");
        renderTrend(aggregate(filteredRows()));
      });
    });

    document.querySelectorAll("[data-sort-key]").forEach(function (h) {
      h.addEventListener("click", function () {
        var key = h.getAttribute("data-sort-key");
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = "desc"; }
        renderTable(aggregate(filteredRows()));
      });
    });

    var refreshBtn = document.querySelector("[data-gad-refresh]");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Refreshing…";
        fetch("/api/dashboards/google-ads/refresh", { method: "POST" })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok && data.rows) {
              ALL_ROWS = data.rows;
              CURRENCY = data.currency_symbol || CURRENCY;
              document.body.setAttribute("data-currency-symbol", CURRENCY);
            }
            refreshBtn.disabled = false;
            refreshBtn.textContent = "Refresh";
            renderAll();
          })
          .catch(function () { refreshBtn.disabled = false; refreshBtn.textContent = "Refresh"; });
      });
    }

    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
