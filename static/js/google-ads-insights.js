/* ════════════════════════════════════════════════════════════════════════
   GOOGLE ADS PERFORMANCE — the insights panels.

   Impression share, budget pacing, search terms, keywords, devices, hours,
   locations, conversions, ads, optimization score, change history, age and
   gender, and landing pages, from the tabs that
   scripts/google_ads/export_insights.js writes.

   Every panel follows every filter above it. The main page script
   (google-ads-dashboard.js) announces its filters on each render
   ("gad:render": dates, account, campaign type, status, search text, focused
   campaign); this script asks the server for the insights for exactly those
   (/api/dashboards/google-ads/insights, built by
   tracker/google_ads_insights.py from each item's daily figures), so every
   total covers everything exported, not only what fits on the page. Each
   panel heading says which dates it covers; current states (budgets this
   month, optimization score, recommendations) say "Now". Account-level
   reports (hours, locations, landing pages) say when a campaign filter
   cannot apply to them. The first render uses the insights embedded in the
   page (#gad-insights) for the page's opening filters.

   Impression-share figures are kept as Google reports them: 0.0999 means
   "below 10%" and 0.9001 "above 90%" (Google Ads API field reference).
   Anything built from such a figure is marked "≈".

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
  // The page's filters as last announced; the data in INS has already been filtered by the server.
  var filters = { account: "__all__", search: "", type: "", status: "", focus: "", from: "", to: "" };
  var ADS_STEP = window.innerWidth < 700 ? 6 : 12;       // ad cards are tall on a phone
  var CHG_STEP = window.innerWidth < 700 ? 8 : 20;
  var ui = { shareShown: 12, shareSort: "cost", shareDir: -1, paceShown: 10, pace: "all",
             view: "spend", n: 1, termsShown: 25, termsSort: null, termsDir: -1,
             kwView: "spend", kwShown: 25, kwSort: null, kwDir: -1, devShown: 12, hMetric: "cost",
             locLevel: "region", locType: "all", locShown: 15, adView: "all", adsShown: ADS_STEP,
             scoresShown: 10, recsShown: 15, chgView: "all", chgShown: CHG_STEP, lpShown: 20 };

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
  function share(v, approx) {
    if (v == null) return "–";
    if (isLow(v)) return "<10%";
    if (isHigh(v)) return ">90%";
    return (approx ? "≈" : "") + (v * 100).toFixed(v >= 0.995 || v < 0.1 ? 0 : 1).replace(/\.0$/, "") + "%";
  }
  function pct(v, approx) { return v == null ? "–" : (approx ? "≈" : "") + (v * 100).toFixed(1).replace(/\.0$/, "") + "%"; }
  // The server applies every filter (tracker/google_ads_insights.py, Filters), so rows here are kept.
  function matchesText() { return true; }
  function inAccount() { return true; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso, year) { return +iso.slice(8, 10) + " " + MONTHS[+iso.slice(5, 7) - 1] + (year ? " " + iso.slice(0, 4) : ""); }
  function fmtRange(a, b) {
    if (a === b) return fmtD(a, true);
    return fmtD(a, a.slice(0, 4) !== b.slice(0, 4)) + " – " + fmtD(b, true);
  }
  function narrowed() { return !!(filters.type || filters.status || filters.search || filters.focus); }
  /**
   * What a panel's figures cover, for its heading: the dates (and why they are fewer than the ones
   * picked, if they are), "Now" for a current state, and a note when a campaign filter cannot apply.
   */
  function period(key) {
    var m = (INS.meta || {})[key] || {}, r = INS.range || {}, out;
    if (m.scope === "current") return "Now";
    if (!m.dated) out = "Last 30 days, as exported (update the Google Ads script for date filtering)";
    else if (!m.cover) out = "No data for " + (r.from && r.to ? fmtRange(r.from, r.to) : "these dates") +
      (m.from ? " (kept from " + fmtD(m.from, true) + " to " + fmtD(m.to, true) + ")" : "") +
      (m.ahead ? "; not yet exported for every account shown, each being exported up to its own yesterday" : "");
    else {
      out = fmtRange(m.cover[0], m.cover[1]);
      // Fewer dates than picked: say why, so a shorter period is never mistaken for the whole one.
      var cut = [];
      if (r.from && r.from < m.cover[0]) cut.push("the export keeps " + (key === "changes" ? "changes" : "daily figures") + " from " + fmtD(m.cover[0], true));
      if (r.to && r.to > m.cover[1]) cut.push(m.ahead
        ? "later days are not yet exported for every account shown"
        : "the latest exported day is " + fmtD(m.cover[1], true));
      if (cut.length) out += " (" + cut.join("; ") + ")";
    }
    if (m.scope === "account" && narrowed()) out += " · account-level report: the campaign filters do not apply";
    return out;
  }
  /** How much of the campaign report's spend, over the same days, a panel from a narrower Google report
   * accounts for, when it is not all of it: the figures and Google's reason. */
  var SHORT = {
    terms: "Google withholds search terms very few people searched",
    locations: "the rest is spend Google's geographic report does not place",
    landing: "the rest is spend Google's landing page report does not assign to a page",
    ads: "the rest was spent by ads paused or removed since, which the list leaves out"
  };
  function coverage(key) {
    var c = (INS.coverage || {})[key];
    if (!c || !(c.spent > 0)) return "";
    var gap = c.spent - c.shown;
    if (Math.abs(gap) <= Math.max(1, c.spent * 0.005)) return "";
    if (gap < 0) return "";
    return " · " + money(c.shown, c.cur) + " of the " + money(c.spent, c.cur) + " spent" +
      (c.scope === "search" ? " on Search campaigns" : "") + " in these dates (" +
      Math.round(100 * c.shown / c.spent) + "%): " + SHORT[key];
  }
  function has(key) { return !INS.has || INS.has[key] !== false; }
  function mixedNote(t) { return t && t.mixed ? " · " + t.cur + " accounts only" : ""; }
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
    d.appendChild(el("b", "gai-kpi-v" + (/^[A-Za-z]/.test(value) && value.length > 7 ? " is-text" : ""), value));
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
  /** Eligible search impressions (the server's sum of impressions ÷ share over each day); null when unknown. */
  function eligible(r) { return r.se ? r.se : null; }
  function missed(r) { var e = eligible(r); return e == null ? null : Math.max(0, e - (r.sg || 0)); }
  var WEIGHTS = ["sg", "se", "lbe", "lre", "xe", "xw", "tg", "te", "ltbe", "ltre", "ag", "ae", "labe", "lare", "cg", "ce", "capped"];
  /**
   * Shares over several campaigns, exactly as the server builds a range from days
   * (google_ads_insights.share_row): every share is its impressions ÷ its eligible impressions,
   * added up; lost shares are fractions of the same eligible impressions.
   */
  function combine(rows) {
    var t = {};
    WEIGHTS.forEach(function (k) { t[k] = 0; });
    rows.forEach(function (r) { WEIGHTS.forEach(function (k) { t[k] += r[k] || 0; }); });
    if (!t.se) return null;
    var q = function (a, b) { return b > 0 ? a / b : null; };
    return { is: t.sg / t.se, lb: t.lbe / t.se, lr: t.lre / t.se, top: q(t.tg, t.te), abs: q(t.ag, t.ae),
             exact: q(t.xe, t.xw), click: q(t.cg, t.ce), approx: t.capped > 0, elig: t.se, impr: t.sg };
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
    $("gai-share-d").textContent = period("is") + " · " + rows.length + (rows.length === 1 ? " search campaign" : " search campaigns");
    if (!all) {
      box.appendChild(el("p", "gad-empty-chart", "No search campaigns with impression share for this selection."));
      renderWeekly(); renderMissed([]); renderShareTable([]);
      return;
    }
    // One stacked bar: got / lost to budget / lost to rank.
    var parts = [["Shown", all.is, C_CAP], ["Lost to budget", all.lb || 0, C_BUD], ["Lost to ad rank", all.lr || 0, C_RANK]];
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
     ["Exact-match share", all.exact == null ? "–" : pct(all.exact, true), "for searches matching a keyword exactly (weighted by eligible impressions)"],
     ["Impressions missed", (all.approx ? "≈" : "") + int(missedImpr), "eligible but not shown"]]
      .forEach(function (s) { kpi(stats, s[0], s[1], s[2]); });
    renderWeekly();
    renderMissed(rows);
    renderShareTable(rows);
  }

  function renderWeekly() {
    var box = $("gai-weekly");
    clear(box);
    var byDay = INS.weekly_grain !== "week";
    $("gai-weekly-h").textContent = byDay ? "Day by day" : "Week by week";
    legend($("gai-weekly-legend"), [["Shown", C_CAP], ["Lost to budget", C_BUD], ["Lost to ad rank", C_RANK]]);
    var pts = (INS.weekly || []).filter(function (p) { return p.is != null; });
    if (!pts.length) { box.appendChild(el("p", "gad-empty-chart", "No impression share for this selection.")); return; }
    var W = box.clientWidth || 520, H = 220, pl = 36, pr = 8, pt = 8, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img",
                         "aria-label": "Search impression share by " + (byDay ? "day" : "week") }, box);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      var y = pt + ih - g * ih;
      svg("line", { x1: pl, x2: W - pr, y1: y, y2: y, "class": "gad-grid-l" }, s);
      svg("text", { x: pl - 6, y: y + 4, "text-anchor": "end", "class": "gad-ax" }, s).textContent = (g * 100) + "%";
    });
    var bw = Math.max(4, Math.min(34, iw / pts.length * 0.7));
    pts.forEach(function (p, i) {
      var x = pl + (i + 0.5) * iw / pts.length - bw / 2, y0 = pt + ih;
      var lb = p.lb || 0, lr = p.lr || 0, tot = (p.is + lb + lr) || 1;
      [[p.is, C_CAP], [lb, C_BUD], [lr, C_RANK]].forEach(function (seg) {
        var h = ih * seg[0] / tot;
        svg("rect", { x: x, y: y0 - h, width: bw, height: Math.max(0, h), fill: seg[1], rx: 2, opacity: p.partial ? 0.55 : 1 }, s);
        y0 -= h;
      });
      var hit = svg("rect", { x: x - 2, y: pt, width: bw + 4, height: ih, fill: "transparent" }, s);
      hit.addEventListener("mousemove", function (e) {
        var title = byDay ? fmtD(p.week, true) : "Week of " + fmtD(p.week, true) + (p.partial ? " (part of the week)" : "");
        showTip([title, ["Shown", pct(p.is, p.approx), C_CAP], ["Lost to budget", pct(lb, p.approx), C_BUD],
                 ["Lost to ad rank", pct(lr, p.approx), C_RANK], ["Impressions", int(p.impr)]], e.clientX, e.clientY);
      });
      hit.addEventListener("mouseleave", hideTip);
      if (pts.length <= 8 || i % Math.ceil(pts.length / 7) === 0 || i === pts.length - 1) {
        svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "class": "gad-ax" }, s).textContent = fmtD(p.week);
      }
    });
  }

  function renderMissed(rows) {
    var box = $("gai-missed");
    clear(box);
    legend($("gai-missed-legend"), [["Lost to budget", C_BUD], ["Lost to ad rank", C_RANK]]);
    var list = rows.map(function (r) {
      return { r: r, bud: r.lbe || 0, rank: r.lre || 0, ctr: r.impr ? r.clicks / r.impr : 0 };
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
                   ["Share lost", share(p[1] === C_BUD ? x.r.lb : x.r.lr, x.r.approx)]], e.clientX, e.clientY);
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
      [money(r.cost, r.cur), share(r.is, r.approx), share(r.lb, r.approx), share(r.lr, r.approx), share(r.top, r.approx),
       share(r.abs, r.approx), share(r.click, r.approx), missed(r) == null ? "–" : (r.approx ? "≈" : "") + int(missed(r))]
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
  /** Campaigns losing 10% or more of their searches to budget in the last 7 days exported (the server's). */
  function limitedCampaigns() { return INS.budget_limited || {}; }
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
    $("gai-pace-d").textContent = first.dim ? "Now: day " + Math.floor(first.elapsed + 1) + " of " + first.dim +
      " · " + all.length + (all.length === 1 ? " budget" : " budgets") : "";
    kpi(kpis, "Daily budgets", money(daily, mc.cur), all.length + " budgets" + (mc.mixed ? " (" + mc.cur + " only)" : ""));
    kpi(kpis, "Spent this month", money(mtd, mc.cur), cap ? Math.round(100 * mtd / cap) + "% of the month’s budget" : "");
    kpi(kpis, "Projected month end", money(proj, mc.cur), cap ? (proj > cap ? "over" : "under") + " the month’s budget by " +
      money(Math.abs(proj - cap), mc.cur) : "", proj > cap * 1.05 ? "is-warn" : "");
    kpi(kpis, "Need attention", String(attention.length), "ahead of, behind, or capped", attention.length ? "is-warn" : "is-good");
    kpi(kpis, "Losing searches to budget", String(all.filter(function (b) { return b._lost; }).length),
      "budgets with a campaign losing ≥10% (last 7 days)", all.some(function (b) { return b._lost; }) ? "is-bad" : "is-good");

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
    if (b._lost) notes.push("In the last 7 days a campaign on this budget lost " + share(b._lost) + " of its searches to budget.");
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
  function termTotals() {
    return (INS.terms.totals || {}).__all__ || { terms: 0, clicks: 0, cost: 0, conv: 0, value: 0, wasted: 0, wasted_terms: 0,
                                                 converting: 0, other_cost: 0, other_conv: 0, cur: "" };
  }
  function renderTerms() {
    var rows = termRows(), kpis = $("gai-terms-kpis");
    clear(kpis);
    // The server's totals: every search term read for these filters, plus each account's rolled-up rest.
    var t = termTotals(), cur = t.cur, rest = t.other_cost > 0, listed = t.cost - (t.other_cost || 0);
    $("gai-terms-d").textContent = period("terms") + " · " + int(t.terms) + (rest ? "+" : "") + " search terms with clicks" + mixedNote(t) +
      coverage("terms");
    kpi(kpis, "Search terms", int(t.terms) + (rest ? "+" : ""), rest ? "listed, and smaller ones rolled up" : "with clicks");
    kpi(kpis, "Spend on them", money(t.cost, cur), int(t.clicks) + " clicks");
    kpi(kpis, "Converting terms", int(t.converting), num1(t.conv) + " conversions", "is-good");
    kpi(kpis, "Spend with no conversion", money(t.wasted, cur),
      (listed ? Math.round(100 * t.wasted / listed) : 0) + "% of " + (rest ? "listed terms' " : "") + "spend · " + int(t.wasted_terms) + " terms",
      listed && t.wasted / listed > 0.3 ? "is-bad" : "is-warn");
    kpi(kpis, "Cost / conv.", t.conv ? money2(t.cost / t.conv, cur) : "–", "across these terms");
    renderMatchMix();
    renderTermTable(rows);
  }
  function renderMatchMix() {
    var box = $("gai-match");
    clear(box);
    var mix = (INS.terms || {}).mix || { parts: {} }, by = mix.parts || {}, cur = mix.cur, total = 0;
    Object.keys(by).forEach(function (k) { total += by[k].cost; });
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
  /** Words and phrases, added up by the server over every search term read (the top ones by spend). */
  function ngrams(n) { return (((INS.terms || {}).grams || {})[String(n)] || []).map(function (g) { return Object.assign({}, g); }); }

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
    var tt = termTotals(), total = tt.cost - (tt.other_cost || 0);
    var list, cols;
    if (ui.view === "words") {
      cols = GRAM_COLS;
      list = ngrams(ui.n).map(function (g) { g.cpa = g.conv ? g.cost / g.conv : null; g.share = total ? g.cost / total : 0; return g; });
      var nAll = (((INS.terms || {}).gram_count) || {})[String(ui.n)] || list.length;
      note.textContent = "Each word or phrase adds up every search term containing it" +
        (nAll > list.length ? " (the " + int(list.length) + " that spent most of " + int(nAll) + ")" : "") +
        ". Words with spend and no conversions are candidates for negative keywords.";
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
      : ["Account", "Campaign", "Ad group", "Search term", "Matched as", "Keyword", "Keyword match", "Status",
         "Clicks", "Spend", "Conversions", "Conv. value", "Currency", "From", "To"]];
    var m = (INS.meta || {}).terms || {}, cov = m.cover || ["", ""];
    list.forEach(function (x) {
      if (ui.view === "words") rows.push([x.gram, x.terms, x.clicks, x.cost.toFixed(2), x.conv, x.cpa == null ? "" : x.cpa.toFixed(2), (x.share * 100).toFixed(1)]);
      else rows.push(x.r.slice(0, 8).concat(x.r.slice(9), cov));
    });
    download("google-ads-search-terms-" + ui.view + (filters.account === "__all__" ? "" : "-" + filters.account.replace(/[^\w]+/g, "-").toLowerCase()) + ".csv", rows);
    return cols;
  }

  /* ══ Keywords and Quality Score ══════════════════════════════════════ */
  var BUCKET = { ABOVE_AVERAGE: ["Above average", "is-good"], AVERAGE: ["Average", ""], BELOW_AVERAGE: ["Below average", "is-bad"] };
  var C_ABOVE = "#0E9F6E", C_AVG = "#CFCAC2", C_BELOW = "#E0533D";
  function kwRows() {
    return ((INS.keywords || {}).rows || []).filter(function (k) {
      return inAccount(k.account) && matchesText([k.kw, k.campaign, k.ad_group]);
    });
  }
  function kwTotals(rows) {
    // Without search text: totals over every keyword read. With it: over the keywords on the page.
    // The server's totals cover every keyword read for these filters.
    var tot = ((INS.keywords || {}).totals || {}).__all__;
    if (tot) return tot;
    var t = { keywords: 0, cost: 0, clicks: 0, conv: 0, qs_impr: 0, qs_w: 0, with_qs: 0, low_qs: 0, low_qs_cost: 0,
              below_first_page: 0, rarely_served: 0, dist: {}, parts: {}, cur: "" };
    for (var i = 1; i <= 10; i++) t.dist[i] = { keywords: 0, cost: 0, conv: 0 };
    ["ctr", "relevance", "landing"].forEach(function (p) { t.parts[p] = { ABOVE_AVERAGE: 0, AVERAGE: 0, BELOW_AVERAGE: 0 }; });
    rows.forEach(function (k) {
      t.cur = t.cur && t.cur !== k.cur ? "mixed" : k.cur;
      t.keywords++; t.cost += k.cost; t.clicks += k.clicks; t.conv += k.conv;
      if (k.qs) {
        t.with_qs++; t.qs_impr += k.impr; t.qs_w += k.qs * k.impr;
        t.dist[k.qs].keywords++; t.dist[k.qs].cost += k.cost; t.dist[k.qs].conv += k.conv;
        if (k.qs <= 4) { t.low_qs++; t.low_qs_cost += k.cost; }
      }
      ["ctr", "relevance", "landing"].forEach(function (p) { if (t.parts[p][k[p]] != null) t.parts[p][k[p]] += k.cost; });
      if (k.bid && k.first_page && k.bid < k.first_page) t.below_first_page++;
      if (k.serving === "RARELY_SERVED") t.rarely_served++;
    });
    t.avg_qs = t.qs_impr ? t.qs_w / t.qs_impr : null;
    return t;
  }
  function renderKeywords() {
    var panel = $("gai-kw-panel");
    panel.hidden = !has("keywords");
    if (panel.hidden) return;
    var rows = kwRows(), t = kwTotals(rows), cur = t.cur, kpis = $("gai-kw-kpis");
    clear(kpis);
    $("gai-kw-d").textContent = period("keywords") + " · " + int(t.keywords) + (t.other_cost ? "+" : "") + " keywords with impressions" + mixedNote(t);
    kpi(kpis, "Average Quality Score", t.avg_qs == null ? "–" : t.avg_qs.toFixed(1), "weighted by impressions · " + int(t.with_qs) + " rated",
      t.avg_qs == null ? "" : t.avg_qs < 5 ? "is-bad" : t.avg_qs < 7 ? "is-warn" : "is-good");
    kpi(kpis, "Keywords with impressions", int(t.keywords) + (t.other_cost ? "+" : ""), money(t.cost, cur) + " spend");
    kpi(kpis, "Spend on Quality Score 1–4", money(t.low_qs_cost, cur),
      (t.cost ? Math.round(100 * t.low_qs_cost / t.cost) : 0) + "% of spend · " + int(t.low_qs) + " keywords",
      t.cost && t.low_qs_cost / t.cost > 0.2 ? "is-bad" : "is-warn");
    kpi(kpis, "Bid below first page", int(t.below_first_page), "max CPC under Google’s first-page estimate",
      t.below_first_page ? "is-warn" : "is-good");
    kpi(kpis, "Rarely served", int(t.rarely_served), "keywords Google seldom shows (low search volume)");
    renderQsDist(t, cur);
    renderQsParts(t);
    renderKwTable(rows);
  }
  function qsColor(i) { return i <= 4 ? C_BELOW : i <= 6 ? "#E0A100" : C_ABOVE; }
  function renderQsDist(t, cur) {
    var box = $("gai-qs-dist");
    clear(box);
    var vals = [], max = 0;
    for (var i = 1; i <= 10; i++) { var d = t.dist[i] || { cost: 0, keywords: 0, conv: 0 }; vals.push(d); if (d.cost > max) max = d.cost; }
    if (!max) { box.appendChild(el("p", "gad-empty-chart", "No Quality Scores for this selection.")); return; }
    var W = box.clientWidth || 520, H = 210, pl = 8, pr = 8, pt = 20, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": "Spend by Quality Score" }, box);
    var bw = iw / 10 * 0.7;
    vals.forEach(function (d, i) {
      var x = pl + (i + 0.5) * iw / 10 - bw / 2, h = ih * d.cost / max;
      svg("rect", { x: x, y: pt + ih - h, width: bw, height: Math.max(0, h), rx: 3, fill: qsColor(i + 1) }, s);
      svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "class": "gad-ax" }, s).textContent = String(i + 1);
      if (d.keywords) svg("text", { x: x + bw / 2, y: pt + ih - h - 5, "text-anchor": "middle", "class": "gad-ax" }, s).textContent = int(d.keywords);
      var hit = svg("rect", { x: x - 4, y: pt, width: bw + 8, height: ih, fill: "transparent" }, s);
      hit.addEventListener("mousemove", function (e) {
        showTip(["Quality Score " + (i + 1), ["Spend", money(d.cost, cur), qsColor(i + 1)], ["Keywords", int(d.keywords)],
                 ["Conversions", num1(d.conv)], ["Cost / conv.", d.conv ? money2(d.cost / d.conv, cur) : "–"]], e.clientX, e.clientY);
      });
      hit.addEventListener("mouseleave", hideTip);
    });
  }
  function renderQsParts(t) {
    var box = $("gai-qs-parts");
    clear(box);
    [["ctr", "Expected click-through rate"], ["relevance", "Ad relevance"], ["landing", "Landing page experience"]].forEach(function (p) {
      var part = (t.parts || {})[p[0]] || {}, tot = (part.ABOVE_AVERAGE || 0) + (part.AVERAGE || 0) + (part.BELOW_AVERAGE || 0);
      var row = el("div", "gai-part");
      var head = el("div", "gai-part-h");
      head.appendChild(el("b", "", p[1]));
      head.appendChild(el("span", "", tot ? Math.round(100 * (part.BELOW_AVERAGE || 0) / tot) + "% of spend below average" : "not rated"));
      row.appendChild(head);
      var bar = el("div", "gai-stack gai-stack--thin");
      [["ABOVE_AVERAGE", C_ABOVE], ["AVERAGE", C_AVG], ["BELOW_AVERAGE", C_BELOW]].forEach(function (b) {
        if (!tot || !part[b[0]]) return;
        var seg = el("span", "gai-seg");
        seg.style.width = (100 * part[b[0]] / tot) + "%"; seg.style.background = b[1];
        seg.addEventListener("mousemove", function (e) {
          showTip([p[1], [BUCKET[b[0]][0], Math.round(100 * part[b[0]] / tot) + "% of spend", b[1]]], e.clientX, e.clientY);
        });
        seg.addEventListener("mouseleave", hideTip);
        bar.appendChild(seg);
      });
      row.appendChild(bar);
      box.appendChild(row);
    });
    var keys = el("div", "gai-stack-keys");
    [["Above average", C_ABOVE], ["Average", C_AVG], ["Below average", C_BELOW]].forEach(function (k) {
      var kk = el("span", "gai-stack-k"), i = el("i"); i.style.background = k[1];
      kk.appendChild(i); kk.appendChild(el("span", "", k[0])); keys.appendChild(kk);
    });
    box.appendChild(keys);
  }
  function kwList(rows) {
    var list = rows.map(function (k) {
      return Object.assign({}, k, { cpa: k.conv ? k.cost / k.conv : null });
    });
    if (ui.kwView === "lowqs") list = list.filter(function (k) { return k.qs && k.qs <= 4; });
    if (ui.kwView === "converting") list = list.filter(function (k) { return k.conv > 0; });
    if (ui.kwView === "wasted") list = list.filter(function (k) { return !k.conv && k.cost > 0; });
    if (ui.kwView === "bid") list = list.filter(function (k) { return k.bid && k.first_page && k.bid < k.first_page; });
    var key = ui.kwSort || (ui.kwView === "converting" ? "conv" : "cost"), dir = ui.kwDir;
    list.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "string") { x = x.toLowerCase(); y = String(y).toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    return list;
  }
  function bucketCell(v) {
    var td = el("td"), b = BUCKET[v];
    if (b) td.appendChild(el("span", "gai-chip " + b[1], b[0])); else td.textContent = "–";
    return td;
  }
  function renderKwTable(rows) {
    var body = $("gai-kw-body");
    clear(body);
    var list = kwList(rows);
    ui._kw = list;
    $("gai-kw-empty").hidden = list.length > 0;
    list.slice(0, ui.kwShown).forEach(function (k) {
      var tr = el("tr");
      var td = el("td");
      td.appendChild(el("b", "gai-cell-t", k.kw + " · " + (k.match || "").toLowerCase()));
      td.appendChild(el("span", "gai-cell-s", (filters.account === "__all__" ? k.account + " · " : "") + k.campaign + " › " + k.ad_group +
        (k.serving === "RARELY_SERVED" ? " · rarely served" : "")));
      tr.appendChild(td);
      var q = el("td", "is-num");
      if (k.qs) { var c = el("span", "gai-qs"); c.textContent = String(k.qs); c.style.background = qsColor(k.qs); q.appendChild(c); } else q.textContent = "–";
      tr.appendChild(q);
      tr.appendChild(bucketCell(k.ctr)); tr.appendChild(bucketCell(k.relevance)); tr.appendChild(bucketCell(k.landing));
      [int(k.clicks), money(k.cost, k.cur), num1(k.conv), k.cpa == null ? "–" : money2(k.cpa, k.cur),
       k.bid == null ? "–" : money2(k.bid, k.cur)].forEach(function (v) { tr.appendChild(el("td", "is-num", v)); });
      var fp = el("td", "is-num" + (k.bid && k.first_page && k.bid < k.first_page ? " gai-under" : ""), k.first_page == null ? "–" : money2(k.first_page, k.cur));
      tr.appendChild(fp);
      tr.appendChild(el("td", "is-num", share(k.is, k.approx)));
      if (!k.conv && k.cost > 0) tr.className = "is-waste";
      body.appendChild(tr);
    });
    $("gai-kw-more").hidden = list.length <= ui.kwShown;
    markSort("kw");
  }
  function kwCsv() {
    var rows = [["Account", "Campaign", "Ad group", "Keyword", "Match type", "Status", "Serving", "Quality Score", "Expected CTR",
                 "Ad relevance", "Landing page experience", "Max CPC", "First page bid", "Top of page bid", "Impressions",
                 "Clicks", "Cost", "Conversions", "Conv. value", "Search impression share", "Currency"]];
    (ui._kw || []).forEach(function (k) {
      rows.push([k.account, k.campaign, k.ad_group, k.kw, k.match, k.status, k.serving, k.qs, k.ctr, k.relevance, k.landing,
                 k.bid, k.first_page, k.top_page, k.impr, k.clicks, k.cost, k.conv, k.value, k.is, k.cur]);
    });
    download("google-ads-keywords-" + ui.kwView + ".csv", rows);
  }

  /* ══ Devices ════════════════════════════════════════════════════════ */
  var DEVICE = { MOBILE: "Mobile", DESKTOP: "Computers", TABLET: "Tablets", CONNECTED_TV: "TV screens", OTHER: "Other" };
  var DEVICE_ORDER = ["MOBILE", "DESKTOP", "TABLET", "CONNECTED_TV", "OTHER"];
  function renderDevices() {
    var panel = $("gai-dev-panel");
    panel.hidden = !has("devices");
    if (panel.hidden) return;
    var rows = (INS.devices || []).filter(function (d) { return inAccount(d.account) && matchesText([d.campaign, d.account]); });
    var mc = mainCurrency(rows, function (d) { return d.cost; }, function (d) { return d.cur; });
    rows = rows.filter(function (d) { return d.cur === mc.cur; });
    var by = {}, tot = { cost: 0, conv: 0, clicks: 0, impr: 0 };
    rows.forEach(function (d) {
      var x = by[d.device] = by[d.device] || { cost: 0, conv: 0, clicks: 0, impr: 0, value: 0 };
      ["cost", "conv", "clicks", "impr", "value"].forEach(function (k) { x[k] += d[k]; if (tot[k] != null) tot[k] += d[k]; });
    });
    $("gai-dev-d").textContent = period("devices") + (mc.mixed ? " · " + mc.cur + " accounts only" : "");
    var box = $("gai-dev");
    clear(box);
    if (!rows.length) box.appendChild(el("p", "gad-empty-chart", "No device figures for this selection."));
    var avgCpa = tot.conv ? tot.cost / tot.conv : null;
    DEVICE_ORDER.filter(function (k) { return by[k] && (by[k].cost || by[k].impr); }).forEach(function (k) {
      var x = by[k], card = el("div", "gai-dev");
      card.appendChild(el("b", "gai-dev-n", DEVICE[k] || k));
      var cpa = x.conv ? x.cost / x.conv : null;
      [["Share of spend", tot.cost ? x.cost / tot.cost : 0, C_CAP], ["Share of conversions", tot.conv ? x.conv / tot.conv : 0, C_GOOD]].forEach(function (b) {
        var line = el("div", "gai-dev-bar");
        line.appendChild(el("span", "gai-dev-l", b[0]));
        var tr = el("span", "gai-dev-t"), f = el("i"); f.style.width = (100 * b[1]) + "%"; f.style.background = b[2];
        tr.appendChild(f); line.appendChild(tr);
        line.appendChild(el("b", "", Math.round(100 * b[1]) + "%"));
        card.appendChild(line);
      });
      var facts = el("div", "gai-pfacts gai-pfacts--4");
      [["Spend", money(x.cost, mc.cur)], ["Cost / conv.", cpa == null ? "–" : money2(cpa, mc.cur)],
       ["Conv. rate", x.clicks ? (100 * x.conv / x.clicks).toFixed(1) + "%" : "–"],
       ["CTR", x.impr ? (100 * x.clicks / x.impr).toFixed(1) + "%" : "–"]].forEach(function (f) {
        var d = el("div"); d.appendChild(el("span", "", f[0])); d.appendChild(el("b", "", f[1])); facts.appendChild(d);
      });
      card.appendChild(facts);
      if (cpa != null && avgCpa && x.cost > tot.cost * 0.05) {
        var diff = cpa / avgCpa - 1;
        if (Math.abs(diff) >= 0.2) card.appendChild(el("p", "gai-pnote", (diff > 0 ? "Costs " : "Costs ") + Math.round(Math.abs(diff) * 100) +
          "% " + (diff > 0 ? "more" : "less") + " per conversion than the average."));
      } else if (!x.conv && x.cost > tot.cost * 0.05) {
        card.appendChild(el("p", "gai-pnote", "Spent " + money(x.cost, mc.cur) + " with no conversions."));
      }
      box.appendChild(card);
    });
    renderDeviceTable(rows);
  }
  function renderDeviceTable(rows) {
    var camps = {}, devs = {};
    rows.forEach(function (d) {
      var k = d.account + "\u0001" + d.campaign;
      var c = camps[k] = camps[k] || { account: d.account, campaign: d.campaign, cur: d.cur, cost: 0, by: {} };
      c.cost += d.cost;
      var x = c.by[d.device] = c.by[d.device] || { cost: 0, conv: 0 };
      x.cost += d.cost; x.conv += d.conv; devs[d.device] = 1;
    });
    var cols = DEVICE_ORDER.filter(function (k) { return devs[k]; });
    var head = $("gai-dev-head"); clear(head);
    var tr = el("tr");
    [["Campaign", ""], ["Spend", "is-num"]].concat(cols.map(function (k) { return [DEVICE[k] + " share", "is-num"]; }))
      .concat(cols.map(function (k) { return [DEVICE[k] + " cost / conv.", "is-num"]; }))
      .forEach(function (h) { var th = el("th", h[1], h[0]); th.setAttribute("scope", "col"); tr.appendChild(th); });
    head.appendChild(tr);
    var list = Object.keys(camps).map(function (k) { return camps[k]; }).sort(function (a, b) { return b.cost - a.cost; });
    var body = $("gai-dev-body"); clear(body);
    list.slice(0, ui.devShown).forEach(function (c) {
      var row = el("tr"), td = el("td");
      td.appendChild(el("b", "gai-cell-t", c.campaign));
      if (filters.account === "__all__") td.appendChild(el("span", "gai-cell-s", c.account));
      row.appendChild(td);
      row.appendChild(el("td", "is-num", money(c.cost, c.cur)));
      cols.forEach(function (k) { var x = c.by[k]; row.appendChild(el("td", "is-num", x && c.cost ? Math.round(100 * x.cost / c.cost) + "%" : "–")); });
      var cpas = cols.map(function (k) { var x = c.by[k]; return x && x.conv ? x.cost / x.conv : null; });
      var known = cpas.filter(function (v) { return v != null; }), lo = Math.min.apply(null, known), hi = Math.max.apply(null, known);
      cpas.forEach(function (v) {
        var cell = el("td", "is-num", v == null ? "–" : money2(v, c.cur));
        if (v != null && known.length > 1 && v === hi && hi >= lo * 1.5) cell.className += " gai-under";
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    $("gai-dev-more").hidden = list.length <= ui.devShown;
  }

  /* ══ Day and hour ═══════════════════════════════════════════════════ */
  var WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function hourCells() {
    var rows = (INS.hours || []).filter(function (h) { return inAccount(h.account) && matchesText([h.account]); });
    var mc = mainCurrency(rows, function (h) { return h.cost; }, function (h) { return h.cur; });
    var grid = [], tzs = {};
    for (var d = 0; d < 7; d++) { grid.push([]); for (var h = 0; h < 24; h++) grid[d].push({ day: d, hour: h, cost: 0, clicks: 0, conv: 0, impr: 0 }); }
    rows.forEach(function (r) {
      if (r.cur !== mc.cur) return;
      tzs[r.tz] = 1;
      var c = grid[r.day][r.hour];
      c.cost += r.cost; c.clicks += r.clicks; c.conv += r.conv; c.impr += r.impr;
    });
    return { grid: grid, cur: mc.cur, mixed: mc.mixed, tzs: Object.keys(tzs) };
  }
  function cellValue(c, m) {
    if (m === "cvr") return c.clicks >= 20 ? c.conv / c.clicks : null;
    if (m === "cpa") return c.conv ? c.cost / c.conv : null;
    return c[m];
  }
  function fmtCell(v, m, cur) {
    if (v == null) return "–";
    if (m === "cost") return money(v, cur);
    if (m === "cpa") return money2(v, cur);
    if (m === "cvr") return (100 * v).toFixed(1) + "%";
    return num1(v);
  }
  function renderHours() {
    var panel = $("gai-hour-panel");
    panel.hidden = !has("hours");
    if (panel.hidden) return;
    var H = hourCells(), m = ui.hMetric, box = $("gai-heat");
    clear(box);
    $("gai-hour-d").textContent = period("hours") + (H.tzs.length ? " · " + (H.tzs.length === 1 ? H.tzs[0] : H.tzs.length + " time zones") : "") +
      (H.mixed ? " · " + H.cur + " accounts only" : "");
    var vals = [];
    H.grid.forEach(function (row) { row.forEach(function (c) { var v = cellValue(c, m); if (v != null) vals.push(v); }); });
    var max = Math.max.apply(null, vals.concat([0])), min = Math.min.apply(null, vals.concat([max]));
    var head = el("div", "gai-heat-row gai-heat-row--h");
    head.appendChild(el("span", "gai-heat-d", ""));
    for (var h = 0; h < 24; h++) head.appendChild(el("span", "gai-heat-hh", h % 3 === 0 ? String(h) : ""));
    box.appendChild(head);
    H.grid.forEach(function (row, d) {
      var line = el("div", "gai-heat-row");
      line.appendChild(el("span", "gai-heat-d", WEEK[d]));
      row.forEach(function (c) {
        var v = cellValue(c, m), cell = el("span", "gai-heat-c");
        if (v != null && max > min) {
          var t = (v - min) / (max - min);
          if (m === "cpa") t = 1 - t;              // cheaper conversions read darker, like more of anything else
          cell.style.background = "rgba(255, 96, 34, " + (0.08 + 0.92 * t).toFixed(3) + ")";
        } else if (v != null) {
          cell.style.background = "rgba(255, 96, 34, .5)";
        }
        cell.addEventListener("mousemove", function (e) {
          showTip([WEEK[c.day] + " " + String(c.hour).padStart(2, "0") + ":00–" + String(c.hour).padStart(2, "0") + ":59",
                   ["Spend", money(c.cost, H.cur)], ["Clicks", int(c.clicks)], ["Conversions", num1(c.conv)],
                   ["Conv. rate", c.clicks ? (100 * c.conv / c.clicks).toFixed(1) + "%" : "–"],
                   ["Cost / conv.", c.conv ? money2(c.cost / c.conv, H.cur) : "–"]], e.clientX, e.clientY);
        });
        cell.addEventListener("mouseleave", hideTip);
        line.appendChild(cell);
      });
      box.appendChild(line);
    });
    var cells = [];
    H.grid.forEach(function (row) { row.forEach(function (c) { cells.push(c); }); });
    var best = cells.filter(function (c) { return c.clicks >= 20 && c.conv > 0; })
      .sort(function (a, b) { return b.conv / b.clicks - a.conv / a.clicks; }).slice(0, 5);
    var worst = cells.filter(function (c) { return !c.conv && c.cost > 0; }).sort(function (a, b) { return b.cost - a.cost; }).slice(0, 5);
    [[$("gai-hour-best"), best, function (c) { return (100 * c.conv / c.clicks).toFixed(1) + "% conv. rate · " + num1(c.conv) + " conv."; }, "Not enough clicks in any hour yet."],
     [$("gai-hour-worst"), worst, function (c) { return money(c.cost, H.cur) + " · " + int(c.clicks) + " clicks, no conversions"; }, "Every hour with spend converted."]]
      .forEach(function (x) {
        var ol = x[0]; clear(ol);
        if (!x[1].length) { ol.appendChild(el("li", "gai-rank-empty", x[3])); return; }
        x[1].forEach(function (c) {
          var li = el("li");
          li.appendChild(el("b", "", WEEK[c.day] + " " + String(c.hour).padStart(2, "0") + ":00"));
          li.appendChild(el("span", "", x[2](c)));
          ol.appendChild(li);
        });
      });
  }

  /* ══ Locations ══════════════════════════════════════════════════════ */
  function renderLocations() {
    var panel = $("gai-loc-panel");
    panel.hidden = !has("locations");
    if (panel.hidden) return;
    // Regions and cities as the server added them up over every location read (main currency).
    var L = INS.locations || {}, G = ((L.groups || {})[ui.locLevel] || {})[ui.locType] ||
      { list: [], count: 0, spent: 0, cost: 0, conv: 0, waste_cost: 0, waste_n: 0 };
    var mc = { cur: L.cur || "", mixed: !!L.mixed };
    var list = G.list, total = G.cost, conv = G.conv;
    var tot = (L.totals || {}).__all__ || {};
    var noun = ui.locLevel === "city" ? " cities" : " regions";
    $("gai-loc-d").textContent = period("locations") + " · " + int(G.spent) + noun + " with spend" + (mc.mixed ? " · " + mc.cur + " accounts only" : "") +
      coverage("locations");
    var kpis = $("gai-loc-kpis"); clear(kpis);
    kpi(kpis, ui.locLevel === "city" ? "Cities with spend" : "Regions with spend", int(G.spent), money(total, mc.cur) + " spend");
    kpi(kpis, "Top " + (ui.locLevel === "city" ? "city" : "region"), list[0] ? list[0].name : "–",
      list[0] && total ? Math.round(100 * list[0].cost / total) + "% of spend" : "");
    kpi(kpis, "Cost / conv.", conv ? money2(total / conv, mc.cur) : "–", num1(conv) + " conversions");
    kpi(kpis, "Spend with no conversion", money(G.waste_cost, mc.cur), int(G.waste_n) + noun, G.waste_n ? "is-warn" : "is-good");
    kpi(kpis, "From people elsewhere", tot.cost ? Math.round(100 * (tot.interest_cost || 0) / (tot.cost - (tot.other_cost || 0) || 1)) + "%" : "–",
      "of spend: interested in a place, not in it");
    var box = $("gai-loc-bars"); clear(box);
    var max = list[0] ? list[0].cost : 0, avg = conv ? total / conv : null;
    list.slice(0, ui.locShown).forEach(function (g) {
      var row = el("div", "gai-brow" + (!g.conv && g.cost > 0 ? " is-waste" : ""));
      var name = el("div", "gai-mname");
      name.appendChild(el("b", "", g.name));
      name.appendChild(el("span", "", g.sub || ""));
      row.appendChild(name);
      var track = el("div", "gai-mtrack"), f = el("span", "gai-mseg");
      f.style.width = (max ? 100 * g.cost / max : 0) + "%"; f.style.background = C_CAP; track.appendChild(f);
      row.appendChild(track);
      var cpa = g.conv ? g.cost / g.conv : null;
      var facts = el("div", "gai-bfacts");
      facts.appendChild(el("b", "", money(g.cost, mc.cur)));
      facts.appendChild(el("span", "", num1(g.conv) + " conv."));
      facts.appendChild(el("span", cpa != null && avg && cpa > avg * 1.5 ? "gai-under" : "", cpa == null ? "no conversions" : money2(cpa, mc.cur) + " / conv."));
      row.appendChild(facts);
      box.appendChild(row);
    });
    if (!list.length) box.appendChild(el("p", "gad-empty-chart", "No locations for this selection."));
    $("gai-loc-more").hidden = list.length <= ui.locShown;
  }

  /* ══ Conversion actions ═════════════════════════════════════════════ */
  var CONV_COLORS = ["#FF6022", "#1D65A6", "#E0A100", "#0E9F6E", "#8C4FD9", "#E34970"];
  function days(n) { return n ? n + (n === 1 ? " day" : " days") : "–"; }
  function renderConversions() {
    var panel = $("gai-conv-panel");
    panel.hidden = !has("conversions");
    if (panel.hidden) return;
    var acts = (INS.actions || []).filter(function (a) { return inAccount(a.account) && matchesText([a.name, a.category, a.account]); });
    var conv = (INS.conversions || []).filter(function (c) { return inAccount(c.account) && matchesText([c.action, c.campaign, c.account]); });
    var byAction = {}, primary = 0, all = 0;
    conv.forEach(function (c) {
      var x = byAction[c.action] = byAction[c.action] || { name: c.action, category: c.category, conv: 0, all: 0, value: 0 };
      x.conv += c.conv; x.all += c.all; x.value += c.value; primary += c.conv; all += c.all;
    });
    var flags = acts.reduce(function (n, a) { return n + a.flags.filter(function (f) { return f[0] === "warn"; }).length; }, 0);
    $("gai-conv-d").textContent = period("conversions") + " · " + acts.length + (acts.length === 1 ? " action" : " actions");
    var kpis = $("gai-conv-kpis"); clear(kpis);
    kpi(kpis, "Conversions", num1(primary), "primary actions: what bidding uses");
    kpi(kpis, "All conversions", num1(all), "adds secondary actions");
    kpi(kpis, "Primary actions", int(acts.filter(function (a) { return a.primary && a.status === "ENABLED"; }).length),
      "of " + acts.length + " set up");
    kpi(kpis, "Setup warnings", int(flags), flags ? "see the actions below" : "none found", flags ? "is-bad" : "is-good");
    var mix = $("gai-conv-mix"); clear(mix);
    // The mix of primary conversions (what bidding counts); all conversions only when there are none.
    var usePrimary = primary > 0, key = usePrimary ? "conv" : "all", total = usePrimary ? primary : all;
    $("gai-conv-mix-h").textContent = usePrimary ? "What the conversions are" : "What the conversions are (all, none are primary)";
    var list = Object.keys(byAction).map(function (k) { return byAction[k]; })
      .filter(function (x) { return x[key] > 0; }).sort(function (a, b) { return b[key] - a[key]; });
    if (!total) mix.appendChild(el("p", "gad-empty-chart", "No conversions recorded for this selection."));
    else {
      var bar = el("div", "gai-stack"), keys = el("div", "gai-stack-keys");
      list.forEach(function (x, i) {
        var c = i < CONV_COLORS.length ? CONV_COLORS[i] : C_GREY;
        var seg = el("span", "gai-seg"); seg.style.width = (100 * x[key] / total) + "%"; seg.style.background = c;
        seg.addEventListener("mousemove", function (e) {
          showTip([x.name, ["Conversions", num1(x.conv), c], ["All conversions", num1(x.all)], ["Share", Math.round(100 * x[key] / total) + "%"]], e.clientX, e.clientY);
        });
        seg.addEventListener("mouseleave", hideTip);
        bar.appendChild(seg);
        var k = el("span", "gai-stack-k"), sw = el("i"); sw.style.background = c;
        k.appendChild(sw); k.appendChild(el("span", "", x.name + " ")); k.appendChild(el("b", "", Math.round(100 * x[key] / total) + "%"));
        keys.appendChild(k);
      });
      mix.appendChild(bar); mix.appendChild(keys);
    }
    var box = $("gai-actions"); clear(box);
    acts.forEach(function (a) {
      var card = el("div", "gai-act");
      var head = el("div", "gai-phead"), name = el("div", "gai-pname");
      name.appendChild(el("b", "", a.name));
      name.appendChild(el("span", "", (filters.account === "__all__" ? a.account + " · " : "") +
        (a.category || "").replace(/_/g, " ").toLowerCase() + " · " + (a.origin || a.type || "").replace(/_/g, " ").toLowerCase()));
      head.appendChild(name);
      var chips = el("div", "gai-chips");
      chips.appendChild(el("span", "gai-chip " + (a.primary ? "is-good" : ""), a.primary ? "Primary" : "Secondary"));
      chips.appendChild(el("span", "gai-chip", a.counting === "ONE_PER_CLICK" ? "Counts one" : a.counting === "MANY_PER_CLICK" ? "Counts every" : "–"));
      if (a.status !== "ENABLED") chips.appendChild(el("span", "gai-chip is-warn", a.status.toLowerCase()));
      head.appendChild(chips);
      card.appendChild(head);
      var facts = el("div", "gai-pfacts");
      [["Conversions", num1(a.conv)], ["All conversions", num1(a.all)], ["Value", a.all_value ? money(a.all_value, a.cur) : "–"],
       // A setting typed in the account's own currency: shown in it.
       ["Default value", a.default_value == null ? "–" : money2(a.default_value, a.native_cur || a.cur).replace(/\.00$/, "") + (a.always_default ? " (always)" : "")],
       ["Click window", days(a.click_window)], ["View window", days(a.view_window)],
       ["Attribution", (a.model || "–").replace(/^GOOGLE_(SEARCH_)?ATTRIBUTION_/, "").replace(/_/g, " ").toLowerCase()],
       ["In “Conversions”", a.in_conversions ? "Yes" : "No"]].forEach(function (f) {
        var d = el("div"); d.appendChild(el("span", "", f[0])); d.appendChild(el("b", "", f[1])); facts.appendChild(d);
      });
      card.appendChild(facts);
      a.flags.forEach(function (f) { card.appendChild(el("p", "gai-flag gai-flag--" + f[0], f[1])); });
      box.appendChild(card);
    });
  }

  /* ══ Ads and ad strength ════════════════════════════════════════════ */
  var STRENGTH = { EXCELLENT: ["Excellent", "#0E9F6E", "is-good"], GOOD: ["Good", "#7CC9A5", "is-good"],
                   AVERAGE: ["Average", "#E0A100", "is-warn"], POOR: ["Poor", "#E0533D", "is-bad"],
                   PENDING: ["Pending", "#CFCAC2", ""] };
  var APPROVAL = { APPROVED: ["Approved", "is-good"], APPROVED_LIMITED: ["Approved (limited)", "is-warn"],
                   DISAPPROVED: ["Disapproved", "is-bad"], AREA_OF_INTEREST_ONLY: ["Area of interest only", "is-warn"] };
  var LABEL = { BEST: ["Best", "is-good"], GOOD: ["Good", "is-good"], LOW: ["Low", "is-bad"], LEARNING: ["Learning", ""],
                PENDING: ["Pending", ""] };
  function adRows() {
    return ((INS.ads || {}).rows || []).filter(function (a) {
      if (!inAccount(a.account)) return false;
      var texts = [a.campaign, a.ad_group].concat((a.heads || []).map(function (h) { return h.t; }));
      return matchesText(texts);
    });
  }
  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(url || "");
    return m ? m[1].replace(/^www\./i, "") : "";
  }
  function renderAds() {
    var panel = $("gai-ads-panel");
    panel.hidden = !has("ads");
    if (panel.hidden) return;
    var rows = adRows();
    var tot = (INS.ads.totals || {}).__all__ || adTotals(rows);
    var cur = tot.cur, kpis = $("gai-ads-kpis");
    clear(kpis);
    $("gai-ads-d").textContent = int(tot.ads) + " live ads and asset groups now · performance " + period("ads") + mixedNote(tot) +
      coverage("ads");
    var weak = (tot.strength.POOR.cost || 0) + (tot.strength.AVERAGE.cost || 0);
    kpi(kpis, "Live ads", int(tot.ads), int(tot.rsa) + " search ads · " + int(tot.asset_groups) + " asset groups" +
      (tot.other ? " · " + int(tot.other) + " other" : ""));
    kpi(kpis, "Spend on Poor or Average ads", money(weak, cur), (tot.cost ? Math.round(100 * weak / tot.cost) : 0) + "% of ad spend",
      tot.cost && weak / tot.cost > 0.25 ? "is-bad" : "is-warn");
    kpi(kpis, "Disapproved", int(tot.disapproved), int(tot.limited) + " approved with limits", tot.disapproved ? "is-bad" : "is-good");
    kpi(kpis, "Ads with pinning", int(tot.pinned_ads), "pinning narrows what Google can test");
    kpi(kpis, "Assets rated Low", int(tot.low_assets), "headlines and descriptions to replace", tot.low_assets ? "is-warn" : "is-good");
    renderStrengthMix(tot, cur);
    var list = rows.filter(function (a) {
      if (ui.adView === "attention") return a.flags.some(function (f) { return f[0] !== "info"; });
      if (ui.adView === "disapproved") return a.approval === "DISAPPROVED" || a.approval === "APPROVED_LIMITED";
      if (ui.adView === "rsa") return a.kind === "RSA";
      if (ui.adView === "pmax") return a.kind === "ASSET_GROUP";
      return true;
    });
    var box = $("gai-ads");
    clear(box);
    $("gai-ads-empty").hidden = list.length > 0;
    list.slice(0, ui.adsShown).forEach(function (a) { box.appendChild(adCard(a)); });
    $("gai-ads-more").hidden = list.length <= ui.adsShown;
  }
  function adTotals(rows) {
    var t = { ads: 0, rsa: 0, asset_groups: 0, other: 0, cost: 0, disapproved: 0, limited: 0, pinned_ads: 0, low_assets: 0, strength: {}, cur: "" };
    Object.keys(STRENGTH).forEach(function (k) { t.strength[k] = { n: 0, cost: 0 }; });
    rows.forEach(function (a) {
      t.cur = t.cur && t.cur !== a.cur ? "mixed" : a.cur;
      t.ads++; t.cost += a.cost;
      if (a.kind === "RSA") t.rsa++; else if (a.kind === "ASSET_GROUP") t.asset_groups++; else t.other++;
      if (t.strength[a.strength]) { t.strength[a.strength].n++; t.strength[a.strength].cost += a.cost; }
      if (a.approval === "DISAPPROVED") t.disapproved++;
      if (a.approval === "APPROVED_LIMITED") t.limited++;
      if (a.pinned) t.pinned_ads++;
      t.low_assets += (a.assets || []).filter(function (x) { return x.label === "LOW"; }).length;
    });
    return t;
  }
  function renderStrengthMix(tot, cur) {
    var box = $("gai-ads-strength");
    clear(box);
    var keys = Object.keys(STRENGTH), total = keys.reduce(function (s, k) { return s + (tot.strength[k] ? tot.strength[k].cost : 0); }, 0);
    if (!total) { box.appendChild(el("p", "gad-empty-chart", "No spend on rated ads yet.")); return; }
    var bar = el("div", "gai-stack"), legendBox = el("div", "gai-stack-keys");
    keys.forEach(function (k) {
      var x = tot.strength[k];
      if (!x || !x.cost) return;
      var seg = el("span", "gai-seg");
      seg.style.width = (100 * x.cost / total) + "%"; seg.style.background = STRENGTH[k][1];
      seg.addEventListener("mousemove", function (e) {
        showTip([STRENGTH[k][0], ["Spend", money(x.cost, cur), STRENGTH[k][1]], ["Ads", int(x.n)], ["Share", Math.round(100 * x.cost / total) + "%"]], e.clientX, e.clientY);
      });
      seg.addEventListener("mouseleave", hideTip);
      bar.appendChild(seg);
      var kk = el("span", "gai-stack-k"), i = el("i"); i.style.background = STRENGTH[k][1];
      kk.appendChild(i); kk.appendChild(el("span", "", STRENGTH[k][0] + " ")); kk.appendChild(el("b", "", Math.round(100 * x.cost / total) + "%"));
      legendBox.appendChild(kk);
    });
    box.appendChild(bar); box.appendChild(legendBox);
  }
  function chip(map, v) {
    var m = map[v];
    return m ? el("span", "gai-chip " + m[m.length - 1], m[0]) : null;
  }
  function searchPreview(a) {
    var top = (a.combos || [])[0];
    var heads = top && top.heads.length ? top.heads : (a.heads || []).slice(0, 3).map(function (h) { return h.t; });
    var descs = top && top.descs.length ? top.descs : (a.descs || []).slice(0, 2).map(function (d) { return d.t; });
    var box = el("div", "gai-serp");
    var meta = el("div", "gai-serp-meta");
    meta.appendChild(el("b", "", "Sponsored"));
    meta.appendChild(el("span", "", [hostOf(a.url), a.path1, a.path2].filter(Boolean).join(" › ")));
    box.appendChild(meta);
    box.appendChild(el("div", "gai-serp-h", heads.join(" | ") || "–"));
    box.appendChild(el("p", "gai-serp-d", descs.join(" ") || ""));
    box.appendChild(el("span", "gai-serp-src", top ? "The combination Google served most" + (top.impr ? " (" + int(top.impr) + " impressions)" : "") : "Assembled from the first headlines: no served combinations yet"));
    return box;
  }
  function pmaxPreview(a) {
    var box = el("div", "gai-pmax");
    var cats = {};
    (a.combos || []).forEach(function (c) { (cats[c.category || "TEXT"] = cats[c.category || "TEXT"] || []).push(c); });
    var imgs = [], vids = [], texts = [];
    Object.keys(cats).forEach(function (k) {
      cats[k].forEach(function (c) {
        c.parts.forEach(function (p) {
          if (p.img && imgs.indexOf(p.img) < 0) imgs.push(p.img);
          if (p.vid && vids.indexOf(p.vid) < 0) vids.push(p.vid);
          if (p.x && /HEADLINE/.test(p.f) && texts.indexOf(p.x) < 0) texts.push(p.x);
        });
      });
    });
    if (!imgs.length && !vids.length && !texts.length) {
      box.appendChild(el("p", "gai-serp-src", "Google has not reported top combinations for this asset group yet."));
      return box;
    }
    if (imgs.length || vids.length) {
      var strip = el("div", "gai-thumbs");
      imgs.slice(0, 6).forEach(function (u) {
        var im = el("img"); im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.alt = "Image Google served";
        im.onerror = function () { im.remove(); }; im.src = u; strip.appendChild(im);
      });
      vids.slice(0, 3).forEach(function (v) {
        var im = el("img"); im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.alt = "YouTube video " + v;
        im.onerror = function () { im.remove(); };
        im.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v) + "/mqdefault.jpg"; strip.appendChild(im);
      });
      box.appendChild(strip);
    }
    if (texts.length) {
      var ul = el("ul", "gai-pmax-t");
      texts.slice(0, 5).forEach(function (t) { ul.appendChild(el("li", "", t)); });
      box.appendChild(ul);
    }
    box.appendChild(el("span", "gai-serp-src", "From Google’s top combinations for this asset group"));
    return box;
  }
  function adCard(a) {
    var card = el("article", "gai-ad");
    var head = el("div", "gai-phead"), name = el("div", "gai-pname");
    name.appendChild(el("b", "", a.kind === "ASSET_GROUP" ? a.ad_group : a.ad_group + (a.kind === "RSA" ? "" : " · " + a.type.replace(/_/g, " ").toLowerCase())));
    name.appendChild(el("span", "", (filters.account === "__all__" ? a.account + " · " : "") + a.campaign +
      (a.kind === "ASSET_GROUP" ? " · asset group" : "")));
    head.appendChild(name);
    var chips = el("div", "gai-chips");
    var s = STRENGTH[a.strength];
    if (s) chips.appendChild(el("span", "gai-chip " + s[2], "Ad strength: " + s[0]));
    var ap = chip(APPROVAL, a.approval);
    if (ap) chips.appendChild(ap);
    head.appendChild(chips);
    card.appendChild(head);
    card.appendChild(a.kind === "ASSET_GROUP" ? pmaxPreview(a) : searchPreview(a));
    var facts = el("div", "gai-pfacts gai-pfacts--6");
    [["Impressions", int(a.impr)], ["Clicks", int(a.clicks)], ["CTR", a.impr ? (100 * a.clicks / a.impr).toFixed(1) + "%" : "–"],
     ["Spend", money(a.cost, a.cur)], ["Conv.", num1(a.conv)], ["Cost / conv.", a.conv ? money2(a.cost / a.conv, a.cur) : "–"]]
      .forEach(function (f) { var d = el("div"); d.appendChild(el("span", "", f[0])); d.appendChild(el("b", "", f[1])); facts.appendChild(d); });
    card.appendChild(facts);
    a.flags.forEach(function (f) { card.appendChild(el("p", "gai-flag gai-flag--" + (f[0] === "bad" ? "warn" : f[0] === "warn" ? "amber" : "info"), f[1])); });
    if (a.kind === "RSA") {
      var more = el("details", "gai-more-d");
      more.appendChild(el("summary", "", "Headlines, descriptions and what Google served"));
      more.appendChild(assetList(a));
      if ((a.combos || []).length > 1) {
        more.appendChild(el("h4", "gai-h4", "Served most"));
        var ol = el("ol", "gai-combos");
        var totalImpr = a.combos.reduce(function (s, c) { return s + (c.impr || 0); }, 0);
        a.combos.forEach(function (c) {
          var li = el("li");
          li.appendChild(el("b", "", c.heads.join(" | ")));
          if (c.descs.length) li.appendChild(el("span", "", c.descs.join(" ")));
          if (c.impr) li.appendChild(el("i", "", int(c.impr) + " impressions" + (totalImpr ? " · " + Math.round(100 * c.impr / totalImpr) + "% of the top " + a.combos.length : "")));
          ol.appendChild(li);
        });
        more.appendChild(ol);
      }
      card.appendChild(more);
    }
    return card;
  }
  function assetList(a) {
    var wrap = el("div", "gai-assets");
    var perf = {};
    (a.assets || []).forEach(function (x) { perf[x.f + "\u0001" + x.t] = x; });
    [["HEADLINE", "Headlines", a.heads || [], 15], ["DESCRIPTION", "Descriptions", a.descs || [], 4]].forEach(function (g) {
      wrap.appendChild(el("h4", "gai-h4", g[1] + " · " + g[2].length + " of " + g[3]));
      var ul = el("ul", "gai-asset-l");
      g[2].forEach(function (h) {
        var x = perf[g[0] + "\u0001" + h.t] || {};
        var li = el("li");
        li.appendChild(el("span", "gai-asset-t", h.t));
        var meta = el("span", "gai-asset-m");
        if (h.pin) meta.appendChild(el("span", "gai-chip", "Pinned: " + h.pin.replace(/_/g, " ").toLowerCase()));
        var lb = chip(LABEL, x.label);
        if (lb) meta.appendChild(lb);
        if (x.impr) meta.appendChild(el("span", "gai-asset-n", int(x.impr) + " impr. · " + (100 * x.clicks / x.impr).toFixed(1) + "% CTR"));
        li.appendChild(meta);
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    });
    return wrap;
  }

  /* ══ Optimization score and recommendations ═════════════════════════ */
  function scoreTone(s) { return s == null ? "" : s >= 0.8 ? "is-good" : s >= 0.6 ? "is-warn" : "is-bad"; }
  function scoreColor(s) { return s >= 0.8 ? C_GOOD : s >= 0.6 ? C_BUD : "#E0533D"; }
  function signed(n, fmt) { return n == null || !n ? "–" : (n > 0 ? "+" : "−") + fmt(Math.abs(n)); }
  function renderHealth() {
    var H = INS.health || {}, R = INS.recs || {};
    var panel = $("gai-health-panel");
    panel.hidden = !has("health");
    if (panel.hidden) return;
    var accts = (H.accounts || []).filter(function (a) { return inAccount(a.account) && matchesText([a.account]); });
    var w = 0, sw = 0;
    accts.forEach(function (a) { if (a.score != null && a.weight > 0) { w += a.weight; sw += a.score * a.weight; } });
    var overall = w ? sw / w : (accts.length === 1 ? accts[0].score : null);
    var camps = (H.campaigns || []).filter(function (c) { return inAccount(c.account) && matchesText([c.campaign, c.account]); });
    var recs = (R.rows || []).filter(function (r) { return inAccount(r.account) && matchesText([r.campaign, r.label, r.detail, r.account]); });
    var mc = mainCurrency(recs, function (r) { return r.gain ? Math.abs(r.gain.cost) + 1 : 1; }, function (r) { return r.cur; });
    var gain = { clicks: 0, conv: 0, cost: 0 };
    recs.forEach(function (r) { if (r.gain && r.cur === mc.cur) { gain.clicks += r.gain.clicks; gain.conv += r.gain.conv; gain.cost += r.gain.cost; } });
    $("gai-health-d").textContent = "Now · " + int(recs.length) + (recs.length === 1 ? " open recommendation" : " open recommendations");
    var kpis = $("gai-health-kpis"); clear(kpis);
    kpi(kpis, "Optimization score", overall == null ? "–" : Math.round(overall * 100) + "%",
      accts.length > 1 ? "across " + accts.length + " accounts" : overall == null ? "not scored by Google" : "Google's estimate", scoreTone(overall));
    var types = {}; recs.forEach(function (r) { types[r.label] = (types[r.label] || 0) + 1; });
    var low = camps.filter(function (c) { return c.score != null && c.score < 0.6 && c.cost > 0; });
    var lc = mainCurrency(low, function (c) { return c.cost; }, function (c) { return c.cur; });
    kpi(kpis, "Campaigns below 60%", int(low.length), low.length ? money(low.reduce(function (s, c) { return s + (c.cur === lc.cur ? c.cost : 0); }, 0), lc.cur) + " spend, last 30 days" : "none with spend",
      low.length ? "is-warn" : "is-good");
    kpi(kpis, "Open recommendations", int(recs.length), Object.keys(types).length + (Object.keys(types).length === 1 ? " kind" : " kinds"));
    kpi(kpis, "Extra conversions / week", gain.conv ? "+" + num1(Math.round(gain.conv * 10) / 10) : "–", "if all were applied, per Google");
    kpi(kpis, "Extra cost / week", gain.cost ? signed(gain.cost, function (v) { return money(v, mc.cur); }) : "–",
      gain.clicks ? "for " + signed(gain.clicks, int) + " clicks" + (mc.mixed ? " · " + mc.cur + " only" : "") : "per Google");
    // Campaign scores, by spend.
    var box = $("gai-scores"); clear(box);
    var scored = camps.filter(function (c) { return c.score != null; });
    $("gai-score-block").hidden = !scored.length;
    scored.slice(0, ui.scoresShown).forEach(function (c) {
      var row = el("div", "gai-brow" + (c.score < 0.6 && c.cost > 0 ? " is-waste" : ""));
      var name = el("div", "gai-mname");
      name.appendChild(el("b", "", c.campaign));
      name.appendChild(el("span", "", (filters.account === "__all__" ? c.account + " · " : "") + (c.channel || "").replace(/_/g, " ").toLowerCase()));
      row.appendChild(name);
      var track = el("div", "gai-mtrack"), f = el("span", "gai-mseg");
      f.style.width = (100 * c.score) + "%"; f.style.background = scoreColor(c.score); track.appendChild(f);
      row.appendChild(track);
      var facts = el("div", "gai-bfacts");
      facts.appendChild(el("b", "", Math.round(c.score * 100) + "%"));
      facts.appendChild(el("span", "", money(c.cost, c.cur) + " spend"));
      facts.appendChild(el("span", "", num1(c.conv) + " conv."));
      row.appendChild(facts);
      box.appendChild(row);
    });
    $("gai-scores-more").hidden = scored.length <= ui.scoresShown;
    // Recommendations.
    $("gai-recs-block").hidden = !recs.length;
    var tb = $("gai-rec-types"); clear(tb);
    Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).forEach(function (t) {
      var k = el("span", "gai-stack-k"); k.appendChild(el("span", "", t + " ")); k.appendChild(el("b", "", String(types[t]))); tb.appendChild(k);
    });
    var body = $("gai-recs-body"); clear(body);
    recs.slice(0, ui.recsShown).forEach(function (r) {
      var tr = el("tr"), td = el("td");
      td.appendChild(el("b", "gai-cell-t", r.label));
      if (filters.account === "__all__") td.appendChild(el("span", "gai-cell-s", r.account));
      tr.appendChild(td);
      var what = el("td"), bits = [];
      if (r.campaign) bits.push(r.campaign);
      if (r.detail) bits.push(r.detail);
      what.appendChild(el("span", "gai-cell-t gai-cell-t--n", bits.join(" · ") || "Account-wide"));
      if (r.budget_now != null && r.budget_rec != null) what.appendChild(el("span", "gai-cell-s", "Budget " + money(r.budget_now, r.cur) + " → " + money(r.budget_rec, r.cur) + " a day"));
      tr.appendChild(what);
      var g = r.gain;
      tr.appendChild(el("td", "is-num", g ? signed(g.clicks, int) : "–"));
      tr.appendChild(el("td", "is-num", g ? signed(Math.round(g.conv * 10) / 10, num1) : "–"));
      tr.appendChild(el("td", "is-num", g ? signed(g.cost, function (v) { return money(v, r.cur); }) : "–"));
      body.appendChild(tr);
    });
    $("gai-recs-more").hidden = recs.length <= ui.recsShown;
  }

  /* ══ Change history ═════════════════════════════════════════════════ */
  var KIND = { budget: ["Budget", C_BUD], bidding: ["Bidding", C_RANK], status: ["Paused or enabled", "#6F6A63"],
               keywords: ["Keywords", C_CAP], ads: ["Ads and assets", "#8C4FD9"], targeting: ["Targeting", C_GOOD],
               other: ["Other", C_GREY] };
  var KIND_ORDER = ["budget", "bidding", "status", "keywords", "ads", "targeting", "other"];
  var VIA = { GOOGLE_ADS_WEB_CLIENT: "Google Ads website", GOOGLE_ADS_API: "API", GOOGLE_ADS_SCRIPTS: "Script",
              GOOGLE_ADS_AUTOMATED_RULE: "Automated rule", GOOGLE_ADS_BULK_UPLOAD: "Bulk upload",
              GOOGLE_ADS_EDITOR: "Google Ads Editor", GOOGLE_ADS_MOBILE_APP: "Mobile app",
              GOOGLE_ADS_RECOMMENDATIONS: "Applied from recommendations",
              GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION: "Auto-applied by Google", SEARCH_ADS_360_POST: "Search Ads 360",
              SEARCH_ADS_360_SYNC: "Search Ads 360", INTERNAL_TOOL: "Google internal tool", OTHER: "Other" };
  var FIELD = { "amount_micros": "Daily budget", "total_amount_micros": "Total budget", "status": "Status",
                "name": "Name", "bidding_strategy_type": "Bid strategy", "bidding_strategy": "Portfolio bid strategy",
                "target_cpa.target_cpa_micros": "Target CPA", "maximize_conversions.target_cpa_micros": "Target CPA",
                "target_roas.target_roas": "Target ROAS", "maximize_conversion_value.target_roas": "Target ROAS",
                "target_impression_share.location_fraction_micros": "Target impression share",
                "target_impression_share.location": "Where on the page",
                "target_impression_share.cpc_bid_ceiling_micros": "Max CPC limit",
                "cpc_bid_micros": "Max CPC", "keyword.text": "Keyword", "keyword.match_type": "Match type",
                "final_urls": "Final URL", "delivery_method": "Delivery", "bid_modifier": "Bid adjustment",
                "negative": "Excluded", "end_date": "End date", "start_date": "Start date" };
  function fieldName(f) {
    if (FIELD[f]) return FIELD[f];
    var last = f.split(".").pop().replace(/_micros$/, "").replace(/_/g, " ");
    return last.charAt(0).toUpperCase() + last.slice(1);
  }
  function fieldValue(f, v, cur) {
    if (v == null || v === "") return "none";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (/location_fraction_micros$/.test(f) && typeof v === "number") return Math.round(v * 100) + "%";
    if (/_micros$/.test(f) && typeof v === "number") return money2(v, cur).replace(/\.00$/, "");
    if (/target_roas$/.test(f) && typeof v === "number") return Math.round(v * 100) + "%";
    if (typeof v === "number") return num1(v);
    var s = String(v);
    if (/^[A-Z][A-Z0-9_]+$/.test(s)) return s.replace(/_/g, " ").toLowerCase();
    return s.length > 90 ? s.slice(0, 88) + "…" : s;
  }
  function what(c) {
    var t = (c.type || "").replace(/_/g, " ").toLowerCase().replace("ad group ad", "ad").replace("ad group criterion", "ad group targeting")
      .replace("campaign criterion", "campaign targeting");
    return ({ CREATE: "Added ", REMOVE: "Removed ", UPDATE: "Changed " }[c.op] || "") + t;
  }
  var DAILY = null;
  /** The campaign report rows (#gad-data) by account + campaign, then day. */
  function daily() {
    if (DAILY) return DAILY;
    DAILY = { byKey: {}, byName: {}, min: "", max: "" };
    var node = doc.getElementById("gad-data"), rows = [];
    try { rows = JSON.parse((node && node.textContent) || "[]"); } catch (e) { rows = []; }
    rows.forEach(function (r) {
      if (!r.day) return;
      [r.account + "\u0001" + r.campaign, "\u0001" + r.campaign].forEach(function (k, i) {
        var m = (i ? DAILY.byName : DAILY.byKey)[k] = (i ? DAILY.byName : DAILY.byKey)[k] || {};
        var d = m[r.day] = m[r.day] || { cost: 0, conv: 0 };
        d.cost += r.cost || 0; d.conv += r.conversions || 0;
      });
      if (!DAILY.min || r.day < DAILY.min) DAILY.min = r.day;
      if (r.day > DAILY.max) DAILY.max = r.day;
    });
    return DAILY;
  }
  function isoAdd(iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  /** Average day in the 7 days before the change and the (up to) 7 after it; null without enough days. */
  function beforeAfter(c) {
    if (!c.campaign || ["budget", "bidding", "status"].indexOf(c.kind) < 0) return null;
    var D = daily(), m = D.byKey[c.account + "\u0001" + c.campaign] || D.byName["\u0001" + c.campaign];
    if (!m) return null;
    function win(from, to) {
      var s = { cost: 0, conv: 0, n: 0 };
      for (var d = from; d <= to; d = isoAdd(d, 1)) {
        if (d < D.min || d > D.max) continue;
        s.n++; if (m[d]) { s.cost += m[d].cost; s.conv += m[d].conv; }
      }
      return s;
    }
    var b = win(isoAdd(c.day, -7), isoAdd(c.day, -1)), a = win(isoAdd(c.day, 1), isoAdd(c.day, 7));
    if (b.n < 3 || a.n < 3) return null;
    return { b: b, a: a };
  }
  function chgRows() {
    return ((INS.changes || {}).rows || []).filter(function (c) {
      if (!inAccount(c.account)) return false;
      if (!matchesText([c.campaign, c.ad_group, c.item, c.by, c.account])) return false;
      var v = ui.chgView;
      if (v === "money") return c.kind === "budget" || c.kind === "bidding";
      if (v === "auto") return c.via === "GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION";
      return v === "all" || c.kind === v;
    });
  }
  function renderChanges() {
    var panel = $("gai-chg-panel");
    panel.hidden = !has("changes");
    if (panel.hidden) return;
    var all = (INS.changes.rows || []).slice(), cm = (INS.meta || {}).changes || {};
    // Counts from the server's totals: every change read for these filters, not only those listed.
    var CT = (INS.changes.totals || {}).__all__ || { kinds: {}, auto: 0, people: 0, day_kinds: {} };
    var kinds = CT.kinds || {}, auto = CT.auto || 0, days = CT.day_kinds || {};
    var read = ((INS.changes.totals || {}).__all__ || {}).n || all.length;
    $("gai-chg-d").textContent = period("changes") + " · " + int(read) + (read === 1 ? " change" : " changes") +
      (read > all.length ? " (newest " + int(all.length) + " listed)" : "");
    var kpis = $("gai-chg-kpis"); clear(kpis);
    kpi(kpis, "Changes", int(read), Object.keys(days).length + " days with changes");
    kpi(kpis, "Budget and bidding", int((kinds.budget || 0) + (kinds.bidding || 0)), int(kinds.budget || 0) + " budget · " + int(kinds.bidding || 0) + " bidding");
    kpi(kpis, "Paused or enabled", int(kinds.status || 0), "campaigns, ad groups, ads, keywords");
    kpi(kpis, "Auto-applied by Google", int(auto), auto ? "from recommendation auto-apply" : "none", auto ? "is-warn" : "");
    kpi(kpis, "People", int(CT.people || 0), all[0] ? "last change " + all[0].at : "");
    // Changes per day: one stacked column per day, oldest to newest.
    var box = $("gai-chg-days"); clear(box);
    // One column per day the change history covers inside the range picked.
    var first = cm.cover ? cm.cover[0] : "", last = cm.cover ? cm.cover[1] : "";
    var max = 0, cols = [];
    for (var d = first; last && d <= last; d = isoAdd(d, 1)) {
      var t = 0, x = days[d] || {}; KIND_ORDER.forEach(function (k) { t += x[k] || 0; }); max = Math.max(max, t); cols.push([d, x, t]);
    }
    cols.forEach(function (c, i) {
      var col = el("div", "gai-day");
      var stack = el("div", "gai-day-s");
      KIND_ORDER.forEach(function (k) {
        if (!c[1][k]) return;
        var seg = el("span"); seg.style.height = (100 * c[1][k] / max) + "%"; seg.style.background = KIND[k][1]; stack.appendChild(seg);
      });
      col.appendChild(stack);
      col.appendChild(el("span", "gai-day-l", i % 7 === 0 || i === cols.length - 1 ? String(+c[0].slice(8)) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+c[0].slice(5, 7) - 1] : ""));
      col.addEventListener("mousemove", function (e) {
        showTip([c[0] + " · " + c[2] + (c[2] === 1 ? " change" : " changes")].concat(KIND_ORDER.filter(function (k) { return c[1][k]; })
          .map(function (k) { return [KIND[k][0], String(c[1][k]), KIND[k][1]]; })), e.clientX, e.clientY);
      });
      col.addEventListener("mouseleave", hideTip);
      box.appendChild(col);
    });
    legend($("gai-chg-legend"), KIND_ORDER.filter(function (k) { return kinds[k]; }).map(function (k) { return [KIND[k][0], KIND[k][1]]; }));
    // The list.
    var rows = chgRows(), list = $("gai-changes"); clear(list);
    rows.slice(0, ui.chgShown).forEach(function (c) {
      var card = el("div", "gai-chg");
      card.style.boxShadow = "inset 3px 0 0 " + KIND[c.kind][1];
      var head = el("div", "gai-phead"), name = el("div", "gai-pname");
      name.appendChild(el("b", "", what(c) + (c.item && c.item !== c.campaign_id && !/^\d+$/.test(c.item) ? ": " + c.item : "")));
      name.appendChild(el("span", "", [filters.account === "__all__" ? c.account : "", c.campaign, c.ad_group].filter(Boolean).join(" · ") || "Account"));
      head.appendChild(name);
      var chips = el("div", "gai-chips");
      chips.appendChild(el("span", "gai-chip", c.at));
      chips.appendChild(el("span", "gai-chip" + (c.via === "GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION" ? " is-warn" : ""), VIA[c.via] || (c.via || "unknown").replace(/_/g, " ").toLowerCase()));
      head.appendChild(chips);
      card.appendChild(head);
      if (c.diffs.length) {
        var ul = el("ul", "gai-diffs");
        c.diffs.forEach(function (d) {
          var li = el("li");
          li.appendChild(el("span", "gai-diff-f", fieldName(d[0])));
          if (c.op === "CREATE" || d[1] == null) li.appendChild(el("b", "", fieldValue(d[0], d[2], c.cur)));
          else {
            li.appendChild(el("s", "", fieldValue(d[0], d[1], c.cur)));
            li.appendChild(el("span", "gai-diff-a", "→"));
            li.appendChild(el("b", "", fieldValue(d[0], d[2], c.cur)));
          }
          ul.appendChild(li);
        });
        card.appendChild(ul);
      } else if (c.fields.length) {
        card.appendChild(el("p", "gai-pnote", "Fields: " + c.fields.map(fieldName).join(", ")));
      }
      var ba = beforeAfter(c);
      if (ba) {
        // Spend here comes from the campaign report above, so it is in the report's currency,
        // not the account's own (the change itself stays in the currency it was typed in).
        var p = el("p", "gai-ba"), cur = (INS.fx || {}).to || c.cur;
        var cb = ba.b.cost / ba.b.n, ca = ba.a.cost / ba.a.n, vb = ba.b.conv / ba.b.n, va = ba.a.conv / ba.a.n;
        p.appendChild(el("span", "gai-ba-l", "Before and after (" + ba.a.n + (ba.a.n === 1 ? " day" : " days") + " after)"));
        p.appendChild(el("span", "", "Spend a day " + money(cb, cur) + " → " + money(ca, cur) + (cb ? " (" + (ca >= cb ? "+" : "−") + Math.round(Math.abs(100 * (ca / cb - 1))) + "%)" : "")));
        p.appendChild(el("span", "", "Conv. a day " + num1(Math.round(vb * 10) / 10) + " → " + num1(Math.round(va * 10) / 10)));
        card.appendChild(p);
      }
      if (c.by) card.appendChild(el("span", "gai-chg-by", "By " + c.by));
      list.appendChild(card);
    });
    $("gai-chg-empty").hidden = rows.length > 0;
    $("gai-chg-more").hidden = rows.length <= ui.chgShown;
  }

  /* ══ Age and gender ═════════════════════════════════════════════════ */
  function renderDemographics() {
    var panel = $("gai-demo-panel");
    panel.hidden = !has("demographics");
    if (panel.hidden) return;
    var rows = INS.demographics.filter(function (d) { return inAccount(d.account) && matchesText([d.campaign, d.account]); });
    var mc = mainCurrency(rows, function (d) { return d.cost; }, function (d) { return d.cur; });
    rows = rows.filter(function (d) { return d.cur === mc.cur; });
    $("gai-demo-d").textContent = period("demographics") + (mc.mixed ? " · " + mc.cur + " accounts only" : "");
    [["Age", $("gai-demo-age")], ["Gender", $("gai-demo-gender")]].forEach(function (x) {
      var box = x[1]; clear(box);
      var by = {}, tot = { cost: 0, conv: 0 };
      rows.filter(function (d) { return d.dim === x[0]; }).forEach(function (d) {
        var g = by[d.seg] = by[d.seg] || { label: d.label, order: d.order, cost: 0, conv: 0, clicks: 0, impr: 0 };
        g.cost += d.cost; g.conv += d.conv; g.clicks += d.clicks; g.impr += d.impr; tot.cost += d.cost; tot.conv += d.conv;
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.order - b.order; });
      if (!list.length) { box.appendChild(el("p", "gad-empty-chart", "No " + x[0].toLowerCase() + " data for this selection.")); return; }
      var avg = tot.conv ? tot.cost / tot.conv : null;
      list.forEach(function (g) {
        var row = el("div", "gai-demo-r");
        row.appendChild(el("b", "gai-demo-n", g.label));
        var bars = el("div", "gai-demo-b");
        [[tot.cost ? g.cost / tot.cost : 0, C_CAP, "of spend"], [tot.conv ? g.conv / tot.conv : 0, C_GOOD, "of conversions"]].forEach(function (b) {
          var t = el("span", "gai-dev-t"), f = el("i"); f.style.width = (100 * b[0]) + "%"; f.style.background = b[1];
          t.appendChild(f); t.title = Math.round(100 * b[0]) + "% " + b[2]; bars.appendChild(t);
        });
        row.appendChild(bars);
        var cpa = g.conv ? g.cost / g.conv : null;
        var facts = el("div", "gai-bfacts");
        facts.appendChild(el("b", "", Math.round(tot.cost ? 100 * g.cost / tot.cost : 0) + "% / " + Math.round(tot.conv ? 100 * g.conv / tot.conv : 0) + "%"));
        facts.appendChild(el("span", cpa != null && avg && cpa > avg * 1.5 ? "gai-under" : (!g.conv && g.cost > tot.cost * 0.05 ? "gai-under" : ""),
          cpa == null ? (g.cost ? "no conv." : "–") : money2(cpa, mc.cur) + " / conv."));
        row.appendChild(facts);
        row.addEventListener("mousemove", function (e) {
          showTip([x[0] + ": " + g.label, ["Spend", money(g.cost, mc.cur), C_CAP], ["Conversions", num1(g.conv), C_GOOD],
                   ["Cost / conv.", cpa == null ? "–" : money2(cpa, mc.cur)], ["Conv. rate", g.clicks ? (100 * g.conv / g.clicks).toFixed(1) + "%" : "–"],
                   ["CTR", g.impr ? (100 * g.clicks / g.impr).toFixed(1) + "%" : "–"]], e.clientX, e.clientY);
        });
        row.addEventListener("mouseleave", hideTip);
        box.appendChild(row);
      });
    });
    legend($("gai-demo-legend"), [["Share of spend", C_CAP], ["Share of conversions", C_GOOD]]);
  }

  /* ══ Landing pages ══════════════════════════════════════════════════ */
  function speedColor(s) { return s <= 3 ? "#E0533D" : s <= 6 ? C_BUD : C_GOOD; }
  function pageName(url) {
    var m = /^https?:\/\/([^\/?#]+)([^?#]*)/i.exec(url || "");
    if (!m) return [url, ""];
    return [(m[2] && m[2] !== "/" ? m[2] : "/"), m[1].replace(/^www\./i, "")];
  }
  function renderLanding() {
    var panel = $("gai-lp-panel");
    panel.hidden = !has("landing");
    if (panel.hidden) return;
    // KPIs from the server's totals over every landing page read (and each account's rolled-up rest).
    var rows = (INS.landing.rows || []).slice(), T = (INS.landing.totals || {}).__all__ ||
      { pages: 0, cost: 0, conv: 0, scored_cost: 0, speed_w: 0, speed_cost: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], speeds: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        mobile_share: null, avg_speed: null, other_cost: 0, cur: "" };
    var mc = { cur: T.cur, mixed: !!T.mixed };
    var t = { cost: T.cost, conv: T.conv, buckets: T.speed_cost.slice(),
              slow: T.speed_cost[0] + T.speed_cost[1] + T.speed_cost[2], slowN: T.speeds[0] + T.speeds[1] + T.speeds[2] };
    $("gai-lp-d").textContent = period("landing") + " · " + int(T.pages) + (T.other_cost ? "+" : "") + (T.pages === 1 ? " page" : " pages") +
      (mc.mixed ? " · " + mc.cur + " accounts only" : "") + coverage("landing");
    var kpis = $("gai-lp-kpis"); clear(kpis);
    var avg = T.avg_speed;
    kpi(kpis, "Pages with spend", int(T.pages) + (T.other_cost ? "+" : ""), money(t.cost, mc.cur) + " spend");
    kpi(kpis, "Speed score", avg == null ? "–" : avg.toFixed(1) + " / 10", "Google's last 30 days; average weighted by spend", avg == null ? "" : avg <= 3 ? "is-bad" : avg <= 6 ? "is-warn" : "is-good");
    kpi(kpis, "Spend on pages scoring 1–3", money(t.slow, mc.cur), int(t.slowN) + (t.slowN === 1 ? " page" : " pages") + (t.cost ? " · " + Math.round(100 * t.slow / t.cost) + "% of spend" : ""), t.slow ? "is-bad" : "is-good");
    kpi(kpis, "Mobile-friendly clicks", T.mobile_share != null ? pct(T.mobile_share, true) : "–", "of mobile clicks, Google's last 30 days; weighted", T.mobile_share != null && T.mobile_share < 0.9 ? "is-warn" : "");
    kpi(kpis, "Cost / conv.", t.conv ? money2(t.cost / t.conv, mc.cur) : "–", num1(t.conv) + " conversions");
    // Spend by speed score, 1 to 10.
    var box = $("gai-lp-speed"); clear(box);
    var maxB = Math.max.apply(null, t.buckets.concat([0]));
    t.buckets.forEach(function (v, i) {
      var col = el("div", "gai-speed-c");
      var bar = el("div", "gai-speed-b"), f = el("span");
      f.style.height = (maxB ? 100 * v / maxB : 0) + "%"; f.style.background = speedColor(i + 1); bar.appendChild(f);
      col.appendChild(el("span", "gai-speed-v", v ? money(v, mc.cur).replace(/\s/g, "") : ""));
      col.appendChild(bar);
      col.appendChild(el("b", "gai-speed-l", String(i + 1)));
      box.appendChild(col);
    });
    var body = $("gai-lp-body"); clear(body);
    var avgCpa = t.conv ? t.cost / t.conv : null;
    rows.slice(0, ui.lpShown).forEach(function (x) {
      var tr = el("tr"), td = el("td"), n = pageName(x.url);
      td.appendChild(el("b", "gai-cell-t", n[0]));
      td.appendChild(el("span", "gai-cell-s", n[1] + (filters.account === "__all__" ? " · " + x.account : "")));
      tr.appendChild(td);
      var sc = el("td", "is-num");
      if (x.speed != null) { var q = el("span", "gai-qs", String(x.speed)); q.style.background = speedColor(x.speed); sc.appendChild(q); }
      else sc.textContent = "–";
      tr.appendChild(sc);
      tr.appendChild(el("td", "is-num" + (x.mobile != null && x.mobile < 0.9 ? " gai-under" : ""), x.mobile == null ? "–" : pct(x.mobile)));
      tr.appendChild(el("td", "is-num", int(x.clicks)));
      tr.appendChild(el("td", "is-num", money(x.cost, x.cur)));
      tr.appendChild(el("td", "is-num", num1(x.conv)));
      tr.appendChild(el("td", "is-num", x.clicks ? (100 * x.conv / x.clicks).toFixed(1) + "%" : "–"));
      var cpa = x.conv ? x.cost / x.conv : null;
      tr.appendChild(el("td", "is-num" + (cpa != null && avgCpa && cpa > avgCpa * 1.5 ? " gai-under" : ""), cpa == null ? (x.cost ? "no conv." : "–") : money2(cpa, x.cur)));
      if (x.speed != null && x.speed <= 3) tr.className = "is-waste";
      body.appendChild(tr);
    });
    $("gai-lp-more").hidden = rows.length <= ui.lpShown;
  }

  /* ── Sorting, controls ──────────────────────────────────────────────── */
  function markSort(table) {
    doc.querySelectorAll('[data-gai-sort^="' + table + ':"]').forEach(function (th) {
      var k = th.getAttribute("data-gai-sort").split(":")[1];
      var on = table === "share" ? k === ui.shareSort
        : table === "kw" ? k === (ui.kwSort || (ui.kwView === "converting" ? "conv" : "cost"))
        : k === (ui.termsSort || (ui.view === "converting" ? "conv" : "cost"));
      var asc = table === "share" ? ui.shareDir === 1 : table === "kw" ? ui.kwDir === 1 : ui.termsDir === 1;
      th.classList.toggle("is-sorted", on);
      th.classList.toggle("is-asc", on && asc);
    });
  }
  doc.addEventListener("click", function (e) {
    var th = e.target.closest && e.target.closest("[data-gai-sort]");
    if (th) {
      var p = th.getAttribute("data-gai-sort").split(":"), text = p[1] === "campaign" || p[1] === "term" || p[1] === "gram" || p[1] === "keyword";
      if (p[0] === "kw") {
        var kc = ui.kwSort || (ui.kwView === "converting" ? "conv" : "cost");
        ui.kwDir = kc === p[1] ? -ui.kwDir : (p[1] === "kw" ? 1 : -1); ui.kwSort = p[1]; renderKwTable(kwRows());
      } else if (p[0] === "share") {
        ui.shareDir = ui.shareSort === p[1] ? -ui.shareDir : (text ? 1 : -1); ui.shareSort = p[1]; renderShareTable(shareRows().filter(function (r) { return r.is != null; }));
      } else {
        var cur = ui.termsSort || (ui.view === "converting" ? "conv" : "cost");
        ui.termsDir = cur === p[1] ? -ui.termsDir : (text ? 1 : -1); ui.termsSort = p[1]; renderTermTable(termRows());
      }
      return;
    }
    var b = e.target.closest && e.target.closest("[data-pace],[data-view],[data-n],[data-kwview],[data-hmetric],[data-loclevel],[data-loctype],[data-adview],[data-chgview]");
    if (!b) return;
    var group = b.parentNode;
    Array.prototype.forEach.call(group.children, function (x) { x.classList.toggle("is-on", x === b); });
    if (b.hasAttribute("data-pace")) { ui.pace = b.getAttribute("data-pace"); ui.paceShown = 10; renderPacing(); }
    if (b.hasAttribute("data-view")) { ui.view = b.getAttribute("data-view"); ui.termsShown = 25; ui.termsSort = null; ui.termsDir = -1; renderTermTable(termRows()); }
    if (b.hasAttribute("data-n")) { ui.n = +b.getAttribute("data-n"); ui.termsShown = 25; renderTermTable(termRows()); }
    if (b.hasAttribute("data-kwview")) { ui.kwView = b.getAttribute("data-kwview"); ui.kwShown = 25; ui.kwSort = null; ui.kwDir = -1; renderKwTable(kwRows()); }
    if (b.hasAttribute("data-hmetric")) { ui.hMetric = b.getAttribute("data-hmetric"); renderHours(); }
    if (b.hasAttribute("data-loclevel")) { ui.locLevel = b.getAttribute("data-loclevel"); ui.locShown = 15; renderLocations(); }
    if (b.hasAttribute("data-loctype")) { ui.locType = b.getAttribute("data-loctype"); ui.locShown = 15; renderLocations(); }
    if (b.hasAttribute("data-adview")) { ui.adView = b.getAttribute("data-adview"); ui.adsShown = ADS_STEP; renderAds(); }
    if (b.hasAttribute("data-chgview")) { ui.chgView = b.getAttribute("data-chgview"); ui.chgShown = CHG_STEP; renderChanges(); }
  });
  $("gai-share-more").addEventListener("click", function () { ui.shareShown += 12; renderShareTable(shareRows().filter(function (r) { return r.is != null; })); });
  $("gai-pace-more").addEventListener("click", function () { ui.paceShown += 10; renderPacing(); });
  $("gai-terms-more").addEventListener("click", function () { ui.termsShown += 25; renderTermTable(termRows()); });
  $("gai-terms-csv").addEventListener("click", termsCsv);
  $("gai-kw-more").addEventListener("click", function () { ui.kwShown += 25; renderKwTable(kwRows()); });
  $("gai-kw-csv").addEventListener("click", kwCsv);
  $("gai-dev-more").addEventListener("click", function () { ui.devShown += 12; renderDevices(); });
  $("gai-loc-more").addEventListener("click", function () { ui.locShown += 15; renderLocations(); });
  $("gai-ads-more").addEventListener("click", function () { ui.adsShown += ADS_STEP; renderAds(); });
  $("gai-scores-more").addEventListener("click", function () { ui.scoresShown += 10; renderHealth(); });
  $("gai-recs-more").addEventListener("click", function () { ui.recsShown += 15; renderHealth(); });
  $("gai-chg-more").addEventListener("click", function () { ui.chgShown += CHG_STEP; renderChanges(); });
  $("gai-lp-more").addEventListener("click", function () { ui.lpShown += 20; renderLanding(); });

  /** One sentence on currencies: which accounts were converted, and which could not be. */
  function fxNote() {
    var f = INS.fx || {}, out = [];
    var conv = f.converted || {}, kept = f.kept || {};
    Object.keys(conv).forEach(function (c) {
      var n = conv[c].length;
      out.push((n === 1 ? conv[c][0] + " is" : n + " accounts are") + " billed in " + c + ": converted to " + f.to +
        (INS.rate_source === "ecb"
          ? " at the European Central Bank daily reference rates the campaign report above uses."
          : " at Google Ads’ own daily rates, from the campaign report above."));
    });
    Object.keys(kept).forEach(function (c) {
      var n = kept[c].length;
      out.push((n === 1 ? kept[c][0] + " is" : n + " accounts are") + " billed in " + c +
        " and the campaign report gives no rate for " + (n === 1 ? "it" : "them") + ": shown in " + c + ", never added to " + f.to + " totals.");
    });
    if (f.estimated) out.push("The campaign report has rates from " + fmtD(f.estimated.from, true) + " to " + fmtD(f.estimated.to, true) +
      "; converted days outside them use the nearest day's rate, an estimate.");
    return out.join(" ");
  }
  function renderAll() {
    var r = INS.range || {};
    $("gai-asof").textContent = (INS.as_of ? "Exported " + INS.as_of + ". " : "") +
      "Every panel follows the filters above" + (r.from && r.to ? " (" + fmtRange(r.from, r.to) + ")" : "") +
      " and says which dates it covers. " + fxNote();
    // Each panel draws alone, so one bad section never blanks the rest.
    [renderShare, renderPacing, renderTerms, renderKeywords, renderDevices, renderHours, renderLocations, renderConversions, renderAds,
     renderHealth, renderChanges, renderDemographics, renderLanding]
      .forEach(function (fn) {
        try { fn(); } catch (err) { if (window.console) console.error("google-ads-insights:", fn.name, err); }
      });
  }
  function resetShown() {
    ui.shareShown = 12; ui.paceShown = 10; ui.termsShown = 25; ui.kwShown = 25; ui.devShown = 12; ui.locShown = 15; ui.adsShown = ADS_STEP;
    ui.scoresShown = 10; ui.recsShown = 15; ui.chgShown = CHG_STEP; ui.lpShown = 20;
  }

  /* ── Asking the server for the page's filters ───────────────────────── */
  var PARAMS = ["from", "to", "account", "type", "status", "search", "focus"];
  function keyOf(p) { return PARAMS.map(function (k) { return p[k] || ""; }).join("\u0002"); }
  var panels = Array.prototype.slice.call(doc.querySelectorAll("[id^='gai-'].gad-panel, .gai-chapter"));
  function busy(on) { panels.forEach(function (p) { p.classList.toggle("is-updating", on); }); }
  var seq = 0, timer = null, failed = false;
  function load(p) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var my = ++seq, q = PARAMS.map(function (k) { return k + "=" + encodeURIComponent(p[k] || ""); }).join("&");
      busy(true);
      fetch("/api/dashboards/google-ads/insights?" + q, { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
        .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
        .then(function (d) {
          if (my !== seq) return;                  // a newer request is on its way
          busy(false);
          if (!d || !d.ok) throw new Error("empty");
          failed = false;
          INS = d; resetShown(); renderAll();
        })
        .catch(function () {
          if (my !== seq) return;
          busy(false); failed = true;
          // Never leave figures for other filters looking current.
          $("gai-asof").textContent = "Could not load the insights for these filters. The panels below still show " +
            (INS.range && INS.range.from ? fmtRange(INS.range.from, INS.range.to) : "the previous selection") +
            ": refresh the page to try again.";
        });
    }, 120);
  }
  doc.addEventListener("gad:render", function (e) {
    var d = e.detail || {};
    filters.account = d.account || "__all__";
    filters.search = (d.search || "").trim().toLowerCase();
    filters.type = d.type && d.type !== "__all__" ? d.type : "";
    filters.status = d.status && d.status !== "__all__" ? d.status : "";
    filters.focus = d.focus || "";
    filters.from = d.from || ""; filters.to = d.to || "";
    var want = { from: filters.from, to: filters.to, account: filters.account === "__all__" ? "" : filters.account,
                 type: filters.type, status: filters.status, search: filters.search, focus: filters.focus };
    if (keyOf(want) === keyOf(INS.params || {}) && !failed) { resetShown(); renderAll(); return; }
    load(want);
  });
  // After Refresh: new data for the page's opening filters; the gad:render that follows asks for the current ones.
  doc.addEventListener("gad:insights", function (e) { if (e.detail && e.detail.ok) { INS = e.detail; failed = false; } });
  var rt = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(rt);
    rt = setTimeout(function () { renderWeekly(); renderKeywords(); }, 160);
  });
})();
