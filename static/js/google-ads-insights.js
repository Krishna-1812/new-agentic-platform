/* ════════════════════════════════════════════════════════════════════════
   GOOGLE ADS PERFORMANCE — the insights panels.

   Impression share, budget pacing and search terms, from the tabs that
   scripts/google_ads/export_insights.js writes (read and shaped by
   tracker/google_ads_insights.py, embedded once as #gad-insights).

   The main page script (google-ads-dashboard.js) announces its filters on
   every render ("gad:render": account and search text) and a refresh
   ("gad:insights": new data); these panels follow both. The date filter
   does not apply: the export covers fixed periods (last 30 days, the last
   13 weeks, this month), and every panel says which.

   Impression-share figures are kept as Google reports them: 0.0999 means
   "below 10%" and 0.9001 "above 90%" (Google Ads API field reference).
   Anything computed from one is marked "≈".

   Same drawing rules as the main script: plain SVG at the container's real
   width, one hue per meaning (captured = orange, lost to budget = amber,
   lost to rank = blue), text inserted as text, never as markup.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var dataEl = document.getElementById("gad-insights");
  if (!dataEl) return;
  var INS;
  try { INS = JSON.parse(dataEl.textContent || "{}"); } catch (e) { return; }
  if (!INS || !INS.ok) return;

  var doc = document, SVGNS = "http://www.w3.org/2000/svg";
  var C_CAP = "#FF6022", C_BUD = "#E0A100", C_RANK = "#1D65A6", C_GOOD = "#0E9F6E", C_GREY = "#B9B4AC";
  var LOW = 0.0999, HIGH = 0.9001;
  var MATCH = { EXACT: "Exact", NEAR_EXACT: "Exact (close variant)", PHRASE: "Phrase",
                NEAR_PHRASE: "Phrase (close variant)", BROAD: "Broad" };
  var MATCH_COLOR = { EXACT: "#FF6022", NEAR_EXACT: "#FF8B5D", PHRASE: "#1D65A6", NEAR_PHRASE: "#6C9BD2", BROAD: "#E0A100" };
  var STATUS = { ADDED: "Added as keyword", EXCLUDED: "Excluded", ADDED_EXCLUDED: "Added and excluded", NONE: "" };
  var VERDICT = {
    capped: ["Will hit the monthly limit", "is-bad"], over: ["Spending ahead of budget", "is-warn"],
    under: ["Spending behind budget", "is-warn"], on_track: ["On track", "is-good"], unknown: ["No daily budget", ""]
  };
  var VERDICT_ORDER = { capped: 0, over: 1, under: 2, on_track: 3, unknown: 4 };
  var filters = { account: "__all__", search: "" };
  var ui = { shareShown: 12, shareSort: "cost", shareDir: -1, paceShown: 10, pace: "all",
             view: "spend", n: 1, termsShown: 25, termsSort: null, termsDir: -1 };

  /* ── Small helpers ──────────────────────────────────────────────────── */
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs, parent) {
    var e = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function sym(cur) { return (INS.symbols && INS.symbols[cur]) || (cur ? cur + " " : ""); }
  function money(n, cur) { return n == null ? "–" : sym(cur) + Math.round(n).toLocaleString("en-IN"); }
  function money2(n, cur) {
    return n == null ? "–" : sym(cur) + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function int(n) { return n == null ? "–" : Math.round(n).toLocaleString("en-IN"); }
  function num1(n) { return n == null ? "–" : (n % 1 ? n.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : int(n)); }
  function isLow(v) { return v != null && Math.abs(v - LOW) < 1e-6; }
  function isHigh(v) { return v != null && Math.abs(v - HIGH) < 1e-6; }
  /** A share as Google reports it: <10% and >90% where Google caps it. */
  function share(v) {
    if (v == null) return "–";
    if (isLow(v)) return "<10%";
    if (isHigh(v)) return ">90%";
    return (v * 100).toFixed(v >= 0.995 || v < 0.1 ? 0 : 1).replace(/\.0$/, "") + "%";
  }
  function pct(v, approx) { return v == null ? "–" : (approx ? "≈" : "") + (v * 100).toFixed(1).replace(/\.0$/, "") + "%"; }
  function matchesText(parts) {
    if (!filters.search) return true;
    for (var i = 0; i < parts.length; i++) if (String(parts[i] || "").toLowerCase().indexOf(filters.search) > -1) return true;
    return false;
  }
  function inAccount(a) { return filters.account === "__all__" || a === filters.account; }
  /** The currency most of the money is in; rows in other currencies are left out of sums. */
  function mainCurrency(rows, costOf, curOf) {
    var by = {};
    rows.forEach(function (r) { var c = curOf(r) || ""; by[c] = (by[c] || 0) + (costOf(r) || 0); });
    var list = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    return { cur: list[0] || "", mixed: list.length > 1 };
  }
  function kpi(box, label, value, sub, tone) {
    var d = el("div", "gai-kpi" + (tone ? " " + tone : ""));
    d.appendChild(el("span", "gai-kpi-l", label));
    d.appendChild(el("b", "gai-kpi-v", value));
    if (sub) d.appendChild(el("span", "gai-kpi-s", sub));
    box.appendChild(d);
  }
  function legend(box, items) {
    clear(box);
    items.forEach(function (it) {
      var k = el("span", "gad-key");
      var i = el("i"); i.style.background = it[1]; i.style.height = "10px"; i.style.width = "10px";
      k.appendChild(i); k.appendChild(el("span", "", it[0]));
      box.appendChild(k);
    });
  }
  var tip = null;
  function showTip(lines, x, y) {
    tip = tip || doc.querySelector(".gad-tip");
    if (!tip) return;
    clear(tip);
    lines.forEach(function (l, i) {
      if (i === 0) { tip.appendChild(el("div", "gad-tip-t", l)); return; }
      var r = el("div", "gad-tip-r");
      var left = el("span");
      if (l[2]) { var sw = el("i"); sw.style.background = l[2]; left.appendChild(sw); }
      left.appendChild(doc.createTextNode(l[0]));
      r.appendChild(left); r.appendChild(el("b", "", l[1]));
      tip.appendChild(r);
    });
    var w = tip.offsetWidth || 220;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + "px";
    tip.style.top = (y + 14) + "px";
    tip.classList.add("is-on");
  }
  function hideTip() { if (tip) tip.classList.remove("is-on"); }
  function download(name, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (v) {
        var s = v == null ? "" : String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s;          // never a formula in a spreadsheet
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
    var a = doc.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    doc.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ══ Impression share ═══════════════════════════════════════════════ */
  function shareRows() {
    return (INS.is || []).filter(function (r) {
      return inAccount(r.account) && matchesText([r.campaign, r.account]);
    });
  }
  /** Eligible impressions (impressions ÷ share); null when share is unknown or 0. */
  function eligible(r) { return r.is ? r.impr / r.is : null; }
  function missed(r) { var e = eligible(r); return e == null ? null : Math.max(0, e - r.impr); }
  /** Impression-weighted shares over rows: {is, lb, lr, top, abs, click, exact, approx, elig}. */
  function combine(rows) {
    var e = 0, got = 0, lb = 0, lr = 0, top = 0, abs = 0, ex = 0, exW = 0, clicks = 0, eClicks = 0, approx = false;
    rows.forEach(function (r) {
      var el_ = eligible(r);
      if (el_ == null) return;
      if (isLow(r.is) || isHigh(r.lb) || isHigh(r.lr)) approx = true;
      e += el_; got += r.impr;
      lb += el_ * (r.lb || 0); lr += el_ * (r.lr || 0);
      top += el_ * (r.top || 0); abs += el_ * (r.abs || 0);
      if (r.exact != null) { ex += el_ * r.exact; exW += el_; }
      if (r.click) { clicks += r.clicks; eClicks += r.clicks / r.click; }
    });
    if (!e) return null;
    return { is: got / e, lb: lb / e, lr: lr / e, top: top / e, abs: abs / e,
             exact: exW ? ex / exW : null, click: eClicks ? clicks / eClicks : null, approx: approx, elig: e, impr: got };
  }
  function heldBack(r) {
    if (r.is == null) return ["", ""];
    if ((r.lb || 0) >= 0.1 && (r.lb || 0) >= (r.lr || 0)) return ["Budget", "is-bud"];
    if ((r.lr || 0) >= 0.1) return ["Ad rank", "is-rank"];
    if (r.is >= 0.9) return ["Nothing much", "is-good"];
    return ["A little of both", ""];
  }

  function renderShare() {
    var rows = shareRows().filter(function (r) { return r.is != null; });
    var box = $("gai-share"), stats = $("gai-share-stats");
    clear(box); clear(stats);
    var all = combine(rows);
    $("gai-share-d").textContent = rows.length + (rows.length === 1 ? " search campaign" : " search campaigns") + " · last 30 days";
    if (!all) {
      box.appendChild(el("p", "gad-empty-chart", "No search campaigns with impression share for this selection."));
      renderWeekly(); renderMissed([]); renderShareTable([]);
      return;
    }
    // One stacked bar: got / lost to budget / lost to rank.
    var parts = [["Shown", all.is, C_CAP], ["Lost to budget", all.lb, C_BUD], ["Lost to ad rank", all.lr, C_RANK]];
    var total = parts.reduce(function (s, p) { return s + p[1]; }, 0) || 1;
    var head = el("div", "gai-share-head");
    var big = el("b", "gai-big", pct(all.is, all.approx));
    head.appendChild(big);
    head.appendChild(el("span", "gai-big-l", "of the searches your ads were eligible for, they showed on"));
    box.appendChild(head);
    var bar = el("div", "gai-stack");
    parts.forEach(function (p) {
      var seg = el("span", "gai-seg");
      seg.style.width = (100 * p[1] / total) + "%";
      seg.style.background = p[2];
      seg.addEventListener("mousemove", function (e) {
        showTip([p[0], [p[0], pct(p[1], all.approx), p[2]],
                 ["Impressions", int(p[1] * all.elig)]], e.clientX, e.clientY);
      });
      seg.addEventListener("mouseleave", hideTip);
      bar.appendChild(seg);
    });
    box.appendChild(bar);
    var keys = el("div", "gai-stack-keys");
    parts.forEach(function (p) {
      var k = el("span", "gai-stack-k");
      var i = el("i"); i.style.background = p[2];
      k.appendChild(i);
      k.appendChild(el("span", "", p[0] + " "));
      k.appendChild(el("b", "", pct(p[1], all.approx)));
      keys.appendChild(k);
    });
    box.appendChild(keys);
    var missedImpr = Math.max(0, all.elig - all.impr);
    [["Top of page", pct(all.top, all.approx), "shown above the organic results"],
     ["Absolute top", pct(all.abs, all.approx), "shown as the very first ad"],
     ["Click share", all.click == null ? "–" : pct(all.click, all.approx), "of the clicks you could have had"],
     ["Exact-match share", all.exact == null ? "–" : pct(all.exact, all.approx), "for searches matching a keyword exactly"],
     ["Impressions missed", (all.approx ? "≈" : "") + int(missedImpr), "eligible but not shown"]]
      .forEach(function (s) { kpi(stats, s[0], s[1], s[2]); });
    renderWeekly();
    renderMissed(rows);
    renderShareTable(rows);
  }

  function renderWeekly() {
    var box = $("gai-weekly");
    clear(box);
    legend($("gai-weekly-legend"), [["Shown", C_CAP], ["Lost to budget", C_BUD], ["Lost to ad rank", C_RANK]]);
    var weeks = {};
    (INS.weekly || []).forEach(function (r) {
      if (!inAccount(r.account) || !matchesText([r.campaign, r.account])) return;
      (weeks[r.week] = weeks[r.week] || []).push(r);
    });
    var keys = Object.keys(weeks).sort();
    if (!keys.length) { box.appendChild(el("p", "gad-empty-chart", "No weekly figures for this selection.")); return; }
    var pts = keys.map(function (k) { return { week: k, s: combine(weeks[k]) }; }).filter(function (p) { return p.s; });
    var W = box.clientWidth || 520, H = 220, pl = 36, pr = 8, pt = 8, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img",
                         "aria-label": "Search impression share by week" }, box);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      var y = pt + ih - g * ih;
      svg("line", { x1: pl, x2: W - pr, y1: y, y2: y, "class": "gad-grid-l" }, s);
      svg("text", { x: pl - 6, y: y + 4, "text-anchor": "end", "class": "gad-ax" }, s).textContent = (g * 100) + "%";
    });
    var bw = Math.max(6, Math.min(34, iw / pts.length * 0.7));
    pts.forEach(function (p, i) {
      var x = pl + (i + 0.5) * iw / pts.length - bw / 2, y0 = pt + ih;
      var tot = (p.s.is + p.s.lb + p.s.lr) || 1;
      [[p.s.is, C_CAP], [p.s.lb, C_BUD], [p.s.lr, C_RANK]].forEach(function (seg) {
        var h = ih * seg[0] / tot;
        svg("rect", { x: x, y: y0 - h, width: bw, height: Math.max(0, h), fill: seg[1], rx: 2 }, s);
        y0 -= h;
      });
      var hit = svg("rect", { x: x - 4, y: pt, width: bw + 8, height: ih, fill: "transparent" }, s);
      hit.addEventListener("mousemove", function (e) {
        showTip(["Week of " + p.week, ["Shown", pct(p.s.is, p.s.approx), C_CAP], ["Lost to budget", pct(p.s.lb, p.s.approx), C_BUD],
                 ["Lost to ad rank", pct(p.s.lr, p.s.approx), C_RANK], ["Impressions", int(p.s.impr)]], e.clientX, e.clientY);
      });
      hit.addEventListener("mouseleave", hideTip);
      if (pts.length <= 8 || i % Math.ceil(pts.length / 7) === 0 || i === pts.length - 1) {
        var d = new Date(p.week + "T00:00:00Z");
        svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "class": "gad-ax" }, s).textContent =
          d.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
      }
    });
  }

  function renderMissed(rows) {
    var box = $("gai-missed");
    clear(box);
    legend($("gai-missed-legend"), [["Lost to budget", C_BUD], ["Lost to ad rank", C_RANK]]);
    var list = rows.map(function (r) {
      var e = eligible(r);
      return { r: r, bud: e * (r.lb || 0), rank: e * (r.lr || 0), ctr: r.impr ? r.clicks / r.impr : 0 };
    }).filter(function (x) { return x.bud + x.rank > 0; })
      .sort(function (a, b) { return (b.bud + b.rank) - (a.bud + a.rank); }).slice(0, 8);
    if (!list.length) { box.appendChild(el("p", "gad-empty-chart", "No missed searches to show.")); return; }
    var max = list[0].bud + list[0].rank;
    list.forEach(function (x) {
      var row = el("div", "gai-mrow");
      var name = el("div", "gai-mname");
      name.appendChild(el("b", "", x.r.campaign));
      name.appendChild(el("span", "", (filters.account === "__all__" ? x.r.account + " · " : "") +
        "≈" + int((x.bud + x.rank) * x.ctr) + " clicks missed"));
      row.appendChild(name);
      var track = el("div", "gai-mtrack");
      [[x.bud, C_BUD, "Lost to budget"], [x.rank, C_RANK, "Lost to ad rank"]].forEach(function (p) {
        if (!p[0]) return;
        var seg = el("span", "gai-mseg");
        seg.style.width = (100 * p[0] / max) + "%"; seg.style.background = p[1];
        seg.addEventListener("mousemove", function (e) {
          showTip([x.r.campaign, [p[2], int(p[0]) + " impressions", p[1]],
                   ["Share lost", share(p[1] === C_BUD ? x.r.lb : x.r.lr)]], e.clientX, e.clientY);
        });
        seg.addEventListener("mouseleave", hideTip);
        track.appendChild(seg);
      });
      row.appendChild(track);
      row.appendChild(el("b", "gai-mval", int(x.bud + x.rank)));
      box.appendChild(row);
    });
  }

  function renderShareTable(rows) {
    var body = $("gai-share-body");
    clear(body);
    var key = ui.shareSort, dir = ui.shareDir;
    var val = function (r) { return key === "missed" ? missed(r) : key === "campaign" ? r.campaign.toLowerCase() : r[key]; };
    var list = rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    list.slice(0, ui.shareShown).forEach(function (r) {
      var tr = el("tr");
      var td = el("td");
      td.appendChild(el("b", "gai-cell-t", r.campaign));
      td.appendChild(el("span", "gai-cell-s", (filters.account === "__all__" ? r.account + " · " : "") +
        (r.bid || "").replace(/_/g, " ").toLowerCase()));
      tr.appendChild(td);
      [money(r.cost, r.cur), share(r.is), share(r.lb), share(r.lr), share(r.top), share(r.abs), share(r.click),
       missed(r) == null ? "–" : (isLow(r.is) ? "≈" : "") + int(missed(r))]
        .forEach(function (v) { tr.appendChild(el("td", "is-num", v)); });
      var hb = heldBack(r), c = el("td");
      if (hb[0]) c.appendChild(el("span", "gai-chip " + hb[1], hb[0]));
      tr.appendChild(c);
      body.appendChild(tr);
    });
    $("gai-share-more").hidden = list.length <= ui.shareShown;
    markSort("share");
  }

  /* ══ Budget pacing ══════════════════════════════════════════════════ */
  function limitedCampaigns() {
    var out = {};
    (INS.is || []).forEach(function (r) { if ((r.lb || 0) >= 0.1) out[r.account + "\u0001" + r.campaign] = r.lb; });
    return out;
  }
  function renderPacing() {
    var box = $("gai-pace"), kpis = $("gai-pace-kpis");
    clear(box); clear(kpis);
    var limited = limitedCampaigns();
    var all = (INS.budgets || []).filter(function (b) {
      return inAccount(b.account) && matchesText([b.name, b.account].concat(b.campaigns));
    });
    all.forEach(function (b) {
      b._lost = 0;
      b.campaigns.forEach(function (c) { var v = limited[b.account + "\u0001" + c]; if (v && v > b._lost) b._lost = v; });
    });
    var first = all[0] || {};
    var mc = mainCurrency(all, function (b) { return b.mtd; }, function (b) { return b.cur; });
    var same = all.filter(function (b) { return b.cur === mc.cur; });
    var sum = function (k) { return same.reduce(function (s, b) { return s + (b[k] || 0); }, 0); };
    var daily = sum("daily"), mtd = sum("mtd"), proj = sum("projected"), cap = sum("month_budget");
    var attention = all.filter(function (b) { return b.verdict === "capped" || b.verdict === "over" || b.verdict === "under"; });
    $("gai-pace-d").textContent = first.dim ? "Day " + Math.floor(first.elapsed + 1) + " of " + first.dim +
      " · " + all.length + (all.length === 1 ? " budget" : " budgets") : "";
    kpi(kpis, "Daily budgets", money(daily, mc.cur), all.length + " budgets" + (mc.mixed ? " (" + mc.cur + " only)" : ""));
    kpi(kpis, "Spent this month", money(mtd, mc.cur), cap ? Math.round(100 * mtd / cap) + "% of the month’s budget" : "");
    kpi(kpis, "Projected month end", money(proj, mc.cur), cap ? (proj > cap ? "over" : "under") + " the month’s budget by " +
      money(Math.abs(proj - cap), mc.cur) : "", proj > cap * 1.05 ? "is-warn" : "");
    kpi(kpis, "Need attention", String(attention.length), "ahead of, behind, or capped", attention.length ? "is-warn" : "is-good");
    kpi(kpis, "Losing searches to budget", String(all.filter(function (b) { return b._lost; }).length),
      "budgets with a campaign losing ≥10%", all.some(function (b) { return b._lost; }) ? "is-bad" : "is-good");

    var list = all.filter(function (b) {
      if (ui.pace === "attention") return attention.indexOf(b) > -1;
      if (ui.pace === "limited") return b._lost > 0;
      return true;
    }).sort(function (a, b) {
      return (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) || (b.mtd - a.mtd);
    });
    if (!list.length) box.appendChild(el("p", "gad-empty-chart", "No budgets match."));
    list.slice(0, ui.paceShown).forEach(function (b) { box.appendChild(paceRow(b)); });
    $("gai-pace-more").hidden = list.length <= ui.paceShown;
  }
  function paceRow(b) {
    var row = el("div", "gai-prow");
    var head = el("div", "gai-phead");
    var name = el("div", "gai-pname");
    name.appendChild(el("b", "", b.name));
    name.appendChild(el("span", "", (filters.account === "__all__" ? b.account + " · " : "") +
      (b.shared && b.campaigns.length > 1 ? "Shared by " + b.campaigns.length + " campaigns"
        : (b.shared ? "Shared budget \u00b7 " : "") + (b.campaigns[0] || "")) +
      (b.daily ? " · " + money(b.daily, b.cur) + " a day" : "")));
    head.appendChild(name);
    var v = VERDICT[b.verdict] || ["", ""];
    var chips = el("div", "gai-chips");
    chips.appendChild(el("span", "gai-chip " + v[1], v[0]));
    if (b._lost) chips.appendChild(el("span", "gai-chip is-bud", "Limited by budget"));
    head.appendChild(chips);
    row.appendChild(head);
    if (b.month_budget) {
      var scale = Math.max(b.month_budget, b.projected || 0, b.mtd) * 1.04;
      var track = el("div", "gai-ptrack");
      var spent = el("span", "gai-pspent"); spent.style.width = (100 * b.mtd / scale) + "%";
      var proj = el("span", "gai-pproj"); proj.style.width = (100 * (b.projected || 0) / scale) + "%";
      var exp = el("i", "gai-pexp"); exp.style.left = (100 * (b.expected || 0) / scale) + "%";
      var end = el("i", "gai-pend"); end.style.left = (100 * b.month_budget / scale) + "%";
      track.appendChild(proj); track.appendChild(spent); track.appendChild(exp); track.appendChild(end);
      track.addEventListener("mousemove", function (e) {
        showTip([b.name, ["Spent this month", money(b.mtd, b.cur), C_CAP], ["Expected by now", money(b.expected, b.cur)],
                 ["Projected month end", money(b.projected, b.cur), "#FFC2A8"], ["Month’s budget", money(b.month_budget, b.cur)],
                 ["Monthly limit (×30.4)", money(b.monthly_cap, b.cur)], ["Last 7 days, per day", money(b.run_rate, b.cur)]],
                e.clientX, e.clientY);
      });
      track.addEventListener("mouseleave", hideTip);
      row.appendChild(track);
    }
    var facts = el("div", "gai-pfacts");
    [["Spent", money(b.mtd, b.cur)], ["Expected by now", money(b.expected, b.cur)],
     ["Projected", money(b.projected, b.cur)], ["Pace", b.pace == null ? "–" : Math.round(b.pace * 100) + "%"],
     ["Yesterday", money(b.yesterday, b.cur)], ["Conv. this month", num1(b.conv_mtd)],
     ["Cost / conv.", b.conv_mtd ? money2(b.mtd / b.conv_mtd, b.cur) : "–"], ["Last month", money(b.last_month, b.cur)]]
      .forEach(function (f) {
        var d = el("div"); d.appendChild(el("span", "", f[0])); d.appendChild(el("b", "", f[1])); facts.appendChild(d);
      });
    row.appendChild(facts);
    var notes = [];
    if (b._lost) notes.push("A campaign on this budget is losing " + share(b._lost) + " of its searches to budget.");
    if (b.recommended && b.daily && b.recommended > b.daily * 1.01) {
      notes.push("Google recommends " + money(b.recommended, b.cur) + " a day (" +
        Math.round(100 * (b.recommended / b.daily - 1)) + "% more).");
    }
    if (b.period && b.period !== "DAILY") notes.push("Budget period: " + b.period.replace(/_/g, " ").toLowerCase() + ".");
    if (notes.length) row.appendChild(el("p", "gai-pnote", notes.join(" ")));
    return row;
  }

  /* ══ Search terms ═══════════════════════════════════════════════════ */
  var T = { account: 0, campaign: 1, adGroup: 2, term: 3, match: 4, keyword: 5, kwMatch: 6, status: 7,
            impr: 8, clicks: 9, cost: 10, conv: 11, value: 12, cur: 13 };
  function termRows() {
    return ((INS.terms || {}).rows || []).filter(function (r) {
      return inAccount(r[T.account]) && matchesText([r[T.term], r[T.campaign], r[T.keyword], r[T.adGroup]]);
    });
  }
  function renderTerms() {
    var rows = termRows(), kpis = $("gai-terms-kpis");
    clear(kpis);
    var tot = (INS.terms.totals || {})[filters.account === "__all__" ? "__all__" : filters.account];
    var mc = mainCurrency(rows, function (r) { return r[T.cost]; }, function (r) { return r[T.cur]; });
    // With no search text, the totals cover every term read; with it, only the terms on the page.
    var useTot = tot && !filters.search && tot.cur !== "mixed";
    var agg = useTot ? tot : rows.reduce(function (a, r) {
      if (r[T.cur] !== mc.cur) return a;
      a.terms++; a.cost += r[T.cost]; a.conv += r[T.conv]; a.clicks += r[T.clicks];
      if (r[T.conv] > 0) a.converting++;
      if (r[T.conv] <= 0 && r[T.cost] > 0) { a.wasted += r[T.cost]; a.wasted_terms++; }
      return a;
    }, { terms: 0, cost: 0, conv: 0, clicks: 0, converting: 0, wasted: 0, wasted_terms: 0 });
    var cur = useTot ? tot.cur : mc.cur;
    $("gai-terms-d").textContent = "Last 30 days · " + int(INS.terms.read) + " terms read";
    kpi(kpis, "Search terms", int(agg.terms), useTot ? "that spent or showed" : "matching the filters");
    kpi(kpis, "Spend on them", money(agg.cost, cur), int(agg.clicks) + " clicks");
    kpi(kpis, "Converting terms", int(agg.converting), num1(agg.conv) + " conversions", "is-good");
    kpi(kpis, "Spend with no conversion", money(agg.wasted, cur),
      (agg.cost ? Math.round(100 * agg.wasted / agg.cost) : 0) + "% of spend · " + int(agg.wasted_terms) + " terms",
      agg.cost && agg.wasted / agg.cost > 0.3 ? "is-bad" : "is-warn");
    kpi(kpis, "Cost / conv.", agg.conv ? money2(agg.cost / agg.conv, cur) : "–", "across these terms");
    renderMatchMix(rows, mc.cur);
    renderTermTable(rows);
  }
  function renderMatchMix(rows, cur) {
    var box = $("gai-match");
    clear(box);
    var by = {}, total = 0;
    rows.forEach(function (r) {
      if (r[T.cur] !== cur) return;
      var m = r[T.match] || "OTHER";
      by[m] = by[m] || { cost: 0, conv: 0 }; by[m].cost += r[T.cost]; by[m].conv += r[T.conv]; total += r[T.cost];
    });
    var keys = Object.keys(by).sort(function (a, b) { return by[b].cost - by[a].cost; });
    if (!total) { box.appendChild(el("p", "gad-empty-chart", "No spend to break down.")); return; }
    var bar = el("div", "gai-stack");
    var keysBox = el("div", "gai-stack-keys");
    keys.forEach(function (k) {
      var c = MATCH_COLOR[k] || C_GREY, label = MATCH[k] || k.replace(/_/g, " ").toLowerCase();
      var seg = el("span", "gai-seg");
      seg.style.width = (100 * by[k].cost / total) + "%"; seg.style.background = c;
      seg.addEventListener("mousemove", function (e) {
        showTip([label, ["Spend", money(by[k].cost, cur), c], ["Share", Math.round(100 * by[k].cost / total) + "%"],
                 ["Conversions", num1(by[k].conv)],
                 ["Cost / conv.", by[k].conv ? money2(by[k].cost / by[k].conv, cur) : "–"]], e.clientX, e.clientY);
      });
      seg.addEventListener("mouseleave", hideTip);
      bar.appendChild(seg);
      var kk = el("span", "gai-stack-k");
      var i = el("i"); i.style.background = c;
      kk.appendChild(i); kk.appendChild(el("span", "", label + " ")); kk.appendChild(el("b", "", Math.round(100 * by[k].cost / total) + "%"));
      keysBox.appendChild(kk);
    });
    box.appendChild(bar); box.appendChild(keysBox);
  }

  var STOP = { "a": 1, "an": 1, "and": 1, "the": 1, "for": 1, "of": 1, "in": 1, "to": 1, "on": 1, "with": 1, "near": 1,
               "me": 1, "my": 1, "at": 1, "by": 1, "or": 1, "is": 1, "&": 1 };
  function ngrams(rows, n) {
    var by = {};
    rows.forEach(function (r) {
      var words = String(r[T.term]).toLowerCase().split(/\s+/).filter(Boolean), seen = {};
      for (var i = 0; i + n <= words.length; i++) {
        var g = words.slice(i, i + n);
        if (n === 1 && STOP[g[0]]) continue;
        var k = g.join(" ");
        if (seen[k]) continue;
        seen[k] = 1;
        var x = by[k] = by[k] || { gram: k, terms: 0, impr: 0, clicks: 0, cost: 0, conv: 0, cur: r[T.cur] };
        x.terms++; x.impr += r[T.impr]; x.clicks += r[T.clicks]; x.cost += r[T.cost]; x.conv += r[T.conv];
      }
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  var TERM_COLS = [
    ["term", "Search term"], ["match", "Matched as"], ["keyword", "Keyword"], ["clicks", "Clicks", 1], ["cost", "Spend", 1],
    ["conv", "Conv.", 1], ["cpa", "Cost / conv.", 1], ["cvr", "Conv. rate", 1], ["status", ""]
  ];
  var GRAM_COLS = [
    ["gram", "Word"], ["terms", "Terms", 1], ["clicks", "Clicks", 1], ["cost", "Spend", 1], ["conv", "Conv.", 1],
    ["cpa", "Cost / conv.", 1], ["share", "Share of spend", 1]
  ];
  function head(cols) {
    var h = $("gai-terms-head");
    clear(h);
    var tr = el("tr");
    cols.forEach(function (c) {
      var th = el("th", c[2] ? "is-num" : "", c[1]);
      th.setAttribute("scope", "col");
      if (c[0] !== "status" && c[0] !== "match") th.setAttribute("data-gai-sort", "terms:" + c[0]);
      tr.appendChild(th);
    });
    h.appendChild(tr);
  }
  function renderTermTable(rows) {
    var body = $("gai-terms-body"), note = $("gai-terms-note");
    clear(body);
    $("gai-ngram").hidden = ui.view !== "words";
    var total = rows.reduce(function (s, r) { return s + r[T.cost]; }, 0);
    var list, cols;
    if (ui.view === "words") {
      cols = GRAM_COLS;
      list = ngrams(rows, ui.n).map(function (g) { g.cpa = g.conv ? g.cost / g.conv : null; g.share = total ? g.cost / total : 0; return g; });
      note.textContent = "Each word or phrase adds up every search term containing it. Words with spend and no conversions are candidates for negative keywords.";
    } else {
      cols = TERM_COLS;
      list = rows.map(function (r) {
        return { r: r, term: r[T.term], match: r[T.match], keyword: r[T.keyword], clicks: r[T.clicks], cost: r[T.cost], conv: r[T.conv],
                 cpa: r[T.conv] ? r[T.cost] / r[T.conv] : null, cvr: r[T.clicks] ? r[T.conv] / r[T.clicks] : null,
                 status: r[T.status], cur: r[T.cur] };
      });
      if (ui.view === "converting") list = list.filter(function (x) { return x.conv > 0; });
      if (ui.view === "wasted") list = list.filter(function (x) { return x.conv <= 0 && x.cost > 0; });
      note.textContent = {
        spend: "The search terms that cost most.",
        converting: "Terms that led to a conversion. Worth adding as keywords if they are not already.",
        wasted: "Terms that spent and did not convert. Those not already excluded are negative-keyword candidates.",
      }[ui.view];
    }
    var key = ui.termsSort || (ui.view === "converting" ? "conv" : "cost"), dir = ui.termsDir;
    list.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "string") { x = x.toLowerCase(); y = String(y).toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    head(cols);
    ui._list = list; ui._cols = cols;
    $("gai-terms-empty").hidden = list.length > 0;
    list.slice(0, ui.termsShown).forEach(function (x) {
      var tr = el("tr");
      if (ui.view === "words") {
        tr.appendChild(el("td", "", x.gram));
        [int(x.terms), int(x.clicks), money(x.cost, x.cur), num1(x.conv), x.cpa == null ? "–" : money2(x.cpa, x.cur),
         Math.round(100 * x.share) + "%"].forEach(function (v) { tr.appendChild(el("td", "is-num", v)); });
        if (!x.conv && x.cost > 0) tr.className = "is-waste";
      } else {
        var t = el("td");
        t.appendChild(el("b", "gai-cell-t", x.term));
        t.appendChild(el("span", "gai-cell-s", (filters.account === "__all__" ? x.r[T.account] + " · " : "") + x.r[T.campaign] +
          (x.r[T.adGroup] ? " › " + x.r[T.adGroup] : "")));
        tr.appendChild(t);
        tr.appendChild(el("td", "", MATCH[x.match] || (x.match || "").toLowerCase()));
        tr.appendChild(el("td", "", x.keyword ? x.keyword + (x.r[T.kwMatch] ? " (" + x.r[T.kwMatch].toLowerCase() + ")" : "") : "–"));
        [int(x.clicks), money(x.cost, x.cur), num1(x.conv), x.cpa == null ? "–" : money2(x.cpa, x.cur),
         x.cvr == null ? "–" : (x.cvr * 100).toFixed(1) + "%"].forEach(function (v) { tr.appendChild(el("td", "is-num", v)); });
        var st = el("td");
        if (STATUS[x.status]) st.appendChild(el("span", "gai-chip" + (x.status === "EXCLUDED" ? " is-rank" : " is-good"), STATUS[x.status]));
        else if (!x.conv && x.cost > 0) st.appendChild(el("span", "gai-chip is-bad", "Negative candidate"));
        tr.appendChild(st);
        if (!x.conv && x.cost > 0) tr.className = "is-waste";
      }
      body.appendChild(tr);
    });
    $("gai-terms-more").hidden = list.length <= ui.termsShown;
    markSort("terms");
  }
  function termsCsv() {
    var cols = ui._cols || TERM_COLS, list = ui._list || [];
    var rows = [ui.view === "words"
      ? ["Word", "Terms", "Clicks", "Spend", "Conversions", "Cost per conversion", "Share of spend"]
      : ["Account", "Campaign", "Ad group", "Search term", "Matched as", "Keyword", "Keyword match", "Status", "Impressions",
         "Clicks", "Spend", "Conversions", "Conv. value", "Currency"]];
    list.forEach(function (x) {
      if (ui.view === "words") rows.push([x.gram, x.terms, x.clicks, x.cost.toFixed(2), x.conv, x.cpa == null ? "" : x.cpa.toFixed(2), (x.share * 100).toFixed(1)]);
      else rows.push(x.r.slice());
    });
    download("google-ads-search-terms-" + ui.view + (filters.account === "__all__" ? "" : "-" + filters.account.replace(/[^\w]+/g, "-").toLowerCase()) + ".csv", rows);
    return cols;
  }

  /* ── Sorting, controls ──────────────────────────────────────────────── */
  function markSort(table) {
    doc.querySelectorAll('[data-gai-sort^="' + table + ':"]').forEach(function (th) {
      var k = th.getAttribute("data-gai-sort").split(":")[1];
      var on = table === "share" ? k === ui.shareSort : k === (ui.termsSort || (ui.view === "converting" ? "conv" : "cost"));
      var asc = table === "share" ? ui.shareDir === 1 : ui.termsDir === 1;
      th.classList.toggle("is-sorted", on);
      th.classList.toggle("is-asc", on && asc);
    });
  }
  doc.addEventListener("click", function (e) {
    var th = e.target.closest && e.target.closest("[data-gai-sort]");
    if (th) {
      var p = th.getAttribute("data-gai-sort").split(":"), text = p[1] === "campaign" || p[1] === "term" || p[1] === "gram" || p[1] === "keyword";
      if (p[0] === "share") {
        ui.shareDir = ui.shareSort === p[1] ? -ui.shareDir : (text ? 1 : -1); ui.shareSort = p[1]; renderShareTable(shareRows().filter(function (r) { return r.is != null; }));
      } else {
        var cur = ui.termsSort || (ui.view === "converting" ? "conv" : "cost");
        ui.termsDir = cur === p[1] ? -ui.termsDir : (text ? 1 : -1); ui.termsSort = p[1]; renderTermTable(termRows());
      }
      return;
    }
    var b = e.target.closest && e.target.closest("[data-pace],[data-view],[data-n]");
    if (!b) return;
    var group = b.parentNode;
    Array.prototype.forEach.call(group.children, function (x) { x.classList.toggle("is-on", x === b); });
    if (b.hasAttribute("data-pace")) { ui.pace = b.getAttribute("data-pace"); ui.paceShown = 10; renderPacing(); }
    if (b.hasAttribute("data-view")) { ui.view = b.getAttribute("data-view"); ui.termsShown = 25; ui.termsSort = null; ui.termsDir = -1; renderTermTable(termRows()); }
    if (b.hasAttribute("data-n")) { ui.n = +b.getAttribute("data-n"); ui.termsShown = 25; renderTermTable(termRows()); }
  });
  $("gai-share-more").addEventListener("click", function () { ui.shareShown += 12; renderShareTable(shareRows().filter(function (r) { return r.is != null; })); });
  $("gai-pace-more").addEventListener("click", function () { ui.paceShown += 10; renderPacing(); });
  $("gai-terms-more").addEventListener("click", function () { ui.termsShown += 25; renderTermTable(termRows()); });
  $("gai-terms-csv").addEventListener("click", termsCsv);

  function renderAll() {
    $("gai-asof").textContent = INS.as_of ? "Exported " + INS.as_of + ". Follows the account filter and the search box; the date range above does not apply." : "";
    renderShare();
    renderPacing();
    renderTerms();
  }
  doc.addEventListener("gad:render", function (e) {
    var d = e.detail || {};
    filters.account = d.account || "__all__";
    filters.search = (d.search || "").toLowerCase();
    ui.shareShown = 12; ui.paceShown = 10; ui.termsShown = 25;
    renderAll();
  });
  doc.addEventListener("gad:insights", function (e) { if (e.detail && e.detail.ok) INS = e.detail; });
  var rt = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(renderWeekly, 160);
  });
})();
