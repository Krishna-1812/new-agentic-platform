/* ════════════════════════════════════════════════════════════════════════
   ACCOUNTS — the hub's account cards and an account's home

   Draws every [data-spark] series (30 days, oldest first) as a line over a
   soft area, counts the home's four figures up from zero once, copies the
   profile template, and fills the hub's cards from /api/accounts when the
   page could not embed them. textContent only; no data is parsed as HTML.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ── Sparklines ───────────────────────────────────────────────────── */
  function drawSpark(svg) {
    var vals = (svg.getAttribute("data-spark") || "").split(",").map(Number).filter(function (v) { return !isNaN(v); });
    if (vals.length < 2) return;
    var vb = svg.viewBox.baseVal, w = vb.width || 100, h = vb.height || 30;
    var max = Math.max.apply(null, vals), min = Math.min(0, Math.min.apply(null, vals)), span = (max - min) || 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 6)]; });
    /* A gentle curve through the points (Catmull-Rom as cubic Béziers), so 30 days read as a trend. */
    var d = "M" + pts[0][0].toFixed(2) + " " + pts[0][1].toFixed(2);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += "C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2) + " " +
           (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2) + " " +
           p2[0].toFixed(2) + " " + p2[1].toFixed(2);
    }
    var area = document.createElementNS(NS, "path");
    area.setAttribute("class", "ar");
    area.setAttribute("d", d + "L" + w + " " + h + "L0 " + h + "Z");
    var line = document.createElementNS(NS, "path");
    line.setAttribute("class", "ln");
    line.setAttribute("d", d);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.appendChild(area);
    svg.appendChild(line);
    if (!REDUCED && line.getTotalLength) {
      var len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      area.style.opacity = "0";
      requestAnimationFrame(function () {
        line.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.16,1,.3,1)";
        area.style.transition = "opacity 900ms ease 250ms";
        line.style.strokeDashoffset = "0";
        area.style.opacity = "";
      });
    }
  }

  /* ── The home's figures count up once ─────────────────────────────── */
  var SYM = { INR: "₹", USD: "$", GBP: "£", EUR: "€", AUD: "A$", CAD: "C$", SGD: "S$" };
  function fmt(v, kind, cur) {
    if (kind === "money") {
      var loc = cur === "INR" ? "en-IN" : "en-US";
      return (SYM[cur] || (cur ? cur + " " : "")) + Math.round(v).toLocaleString(loc);
    }
    if (kind === "num1") return v % 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString("en-US");
    return Math.round(v).toLocaleString("en-US");
  }
  function countUp(node) {
    var to = parseFloat(node.getAttribute("data-count")), kind = node.getAttribute("data-fmt"), cur = node.getAttribute("data-cur");
    if (isNaN(to) || REDUCED) return;
    var final = node.textContent, t0 = null, dur = 1100;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      node.textContent = k < 1 ? fmt(to * e, kind === "num1" && k < 1 ? "num" : kind, cur) : final;
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── Copy the profile template ────────────────────────────────────── */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy]");
    if (!b) return;
    var src = document.querySelector(b.getAttribute("data-copy"));
    if (!src) return;
    var label = b.querySelector("span"), was = label ? label.textContent : "";
    function done(ok) {
      if (label) label.textContent = ok ? "Copied" : "Select and copy it below";
      b.classList.toggle("is-done", ok);
      setTimeout(function () { if (label) label.textContent = was; b.classList.remove("is-done"); }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(src.textContent).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  });

  /* ── The hub's cards, when the page could not embed the list ──────── */
  function sub(a) { return [a.domain, a.industry].filter(Boolean).join(" · ") || (a.has_ads ? "Google Ads" : "From the master doc"); }
  function card(a) {
    var c = el("a", "as-card");
    c.href = "/" + a.slug;
    c.setAttribute("data-acct-card", a.slug);
    var top = el("span", "as-card-top");
    var av = el("span", "ap-av as-card-av", a.avatar.initials);
    av.style.setProperty("--av-bg", a.avatar.bg);
    av.style.setProperty("--av-fg", a.avatar.fg);
    top.appendChild(av);
    if (a.delta != null) {
      top.appendChild(el("span", "as-delta " + (a.delta >= 0 ? "is-up" : "is-down"),
                         (a.delta >= 0 ? "▲ " : "▼ ") + Math.round(Math.abs(a.delta)) + "%"));
    }
    c.appendChild(top);
    var name = el("span", "as-card-name", a.name);
    name.setAttribute("data-card-name", "");
    c.appendChild(name);
    c.appendChild(el("span", "as-card-sub", sub(a)));
    var foot = el("span", "as-card-foot");
    if (a.spend_fmt) {
      var fig = el("span", "as-card-fig");
      fig.appendChild(el("b", "", a.spend_fmt));
      fig.appendChild(el("small", "", a.conv_fmt + " conv."));
      foot.appendChild(fig);
      var s = document.createElementNS(NS, "svg");
      s.setAttribute("class", "as-spark");
      s.setAttribute("viewBox", "0 0 100 28");
      s.setAttribute("preserveAspectRatio", "none");
      s.setAttribute("aria-hidden", "true");
      s.setAttribute("data-spark", (a.spark || []).join(","));
      foot.appendChild(s);
    } else {
      foot.appendChild(el("span", "as-card-none", a.has_ads ? "No spend in 30 days" : "No Google Ads"));
    }
    c.appendChild(foot);
    return c;
  }

  function fillHub() {
    var sec = document.querySelector("[data-acct-fill]");
    if (!sec || !window.acctPicker) return;
    window.acctPicker.load().then(function (d) {
      var grid = document.getElementById("as-grid");
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      var list = (d && d.accounts) || [];
      if (!list.length) {
        var empty = el("div", "as-accts-empty");
        empty.appendChild(el("b", "", d && d.error ? "The accounts could not be loaded." : "No accounts yet."));
        empty.appendChild(el("span", "", d && d.error ? d.error :
          "Accounts come from the Google Ads campaign report and the master doc's tabs."));
        grid.appendChild(empty);
        return;
      }
      list.forEach(function (a) { grid.appendChild(card(a)); });
      var meta = document.getElementById("as-accts-meta");
      if (meta) meta.textContent = list.length + " accounts · spend in the last 30 days";
      grid.querySelectorAll("svg[data-spark]").forEach(drawSpark);
    });
  }

  function init() {
    document.querySelectorAll("svg[data-spark]").forEach(drawSpark);
    document.querySelectorAll("[data-count]").forEach(countUp);
    if (window.acctPicker) fillHub(); else window.addEventListener("load", fillHub);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
