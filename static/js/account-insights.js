/* An account's briefing on its home (templates/_account_insights.html, drawn by /<account>/insights).

   The home paints at once with the briefing's shape shimmering; this asks for the briefing, puts it in,
   and makes it work: the numbers count up, the kinds and the sources filter the cards, "Show all" shows
   the rest, and "Read again" reads every source again (?fresh=1). Nothing here decides what an insight
   says; that is tracker/account_insights.py. */
(function () {
  "use strict";
  var box = document.querySelector("[data-insights]");
  if (!box) return;
  var url = box.getAttribute("data-insights");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ageTimer = null;

  function load(fresh) {
    var busy = box.querySelectorAll("[data-ib-refresh]");
    busy.forEach(function (b) { b.classList.add("is-busy"); b.disabled = true; });
    return fetch(url + (fresh ? "?fresh=1" : ""), { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then(function (html) {
        box.innerHTML = html;
        box.setAttribute("aria-busy", "false");
        wire();
      })
      .catch(function () {
        box.setAttribute("aria-busy", "false");
        box.innerHTML = '<div class="ib ib--error" data-ib-ready><div class="ib-err"><b>The briefing could not be read just now.</b>' +
          '<span>Each agent’s own page still has its results.</span>' +
          '<button type="button" class="ib-again" data-ib-refresh>Try again</button></div></div>';
        wire();
      });
  }

  function wire() {
    var root = box.querySelector("[data-ib-ready]");
    if (!root) return;
    box.querySelectorAll("[data-ib-refresh]").forEach(function (b) {
      b.addEventListener("click", function () { load(true); });
    });
    countUp(root);
    age(root);

    var cells = Array.prototype.slice.call(root.querySelectorAll(".ib-cell"));
    var first = parseInt(root.getAttribute("data-ib-first") || "9", 10);
    var tabs = Array.prototype.slice.call(root.querySelectorAll("[data-ib-tone]"));
    var srcs = Array.prototype.slice.call(root.querySelectorAll("[data-ib-via]"));
    var more = root.querySelector("[data-ib-more]");
    var none = root.querySelector("[data-ib-none]");
    var ink = root.querySelector(".ib-tab-ink");
    var state = { tone: "", via: "", all: false };

    function apply(animate) {
      var filtered = !!(state.tone || state.via);
      var n = 0;
      cells.forEach(function (c) {
        var match = (!state.tone || c.getAttribute("data-tone") === state.tone) &&
                    (!state.via || c.getAttribute("data-via") === state.via);
        var show = match && (filtered || state.all || n < first);
        if (match) n++;
        c.hidden = !show;
        if (show && animate && !reduce) {          // the cards shown come in again, all at once
          c.style.animation = "none";
          void c.offsetWidth;
          c.style.animation = "";
        }
      });
      if (none) none.hidden = n > 0;
      if (more) more.hidden = filtered;
      // The first card shown leads, whatever the filter.
      cells.forEach(function (c) { c.classList.remove("ib-cell--lead"); var a = c.querySelector(".ib-card"); if (a) a.classList.remove("ib-card--lead"); });
      var lead = cells.filter(function (c) { return !c.hidden; })[0];
      if (lead && !state.via && !state.tone) {
        lead.classList.add("ib-cell--lead");
        var a = lead.querySelector(".ib-card");
        if (a) a.classList.add("ib-card--lead");
      }
    }

    function slide() {
      if (!ink) return;
      var on = root.querySelector(".ib-tab.is-on");
      if (!on) return;
      ink.style.width = on.offsetWidth + "px";
      ink.style.transform = "translate(" + on.offsetLeft + "px, " + (on.offsetTop - 4) + "px)";
      root.querySelector(".ib-tabs").classList.add("is-ready");
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.toggle("is-on", x === t); x.setAttribute("aria-pressed", x === t ? "true" : "false"); });
        state.tone = t.getAttribute("data-ib-tone") || "";
        slide();
        apply(true);
      });
    });
    srcs.forEach(function (s) {
      s.addEventListener("click", function () {
        var on = s.getAttribute("aria-pressed") !== "true";
        srcs.forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        s.setAttribute("aria-pressed", on ? "true" : "false");
        state.via = on ? s.getAttribute("data-ib-via") : "";
        apply(true);
        if (on) {
          var grid = root.querySelector(".ib-grid");
          if (grid && grid.getBoundingClientRect().top > window.innerHeight * 0.8) grid.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        }
      });
    });
    if (more) {
      var label = more.querySelector("[data-ib-more-t]");
      var text = label ? label.textContent : "";
      more.addEventListener("click", function () {
        state.all = !state.all;
        more.setAttribute("aria-expanded", state.all ? "true" : "false");
        if (label) label.textContent = state.all ? "Show the first " + first : text;
        apply(true);
      });
    }
    apply(false);
    slide();
    window.addEventListener("resize", slide);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(slide);
  }

  // The numbers count up from nothing, once, as the briefing arrives.
  function countUp(root) {
    var els = root.querySelectorAll("[data-ib-count]");
    if (reduce || !window.requestAnimationFrame) return;
    els.forEach(function (el) {
      var to = parseInt(el.getAttribute("data-ib-count"), 10) || 0;
      if (to < 2) return;
      var start = null, dur = 700 + Math.min(to, 20) * 25;
      function step(t) {
        if (start === null) start = t;
        var p = Math.min(1, (t - start) / dur);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      }
      el.textContent = "0";
      requestAnimationFrame(step);
    });
  }

  // "read 4 min ago": how old the briefing on the screen is.
  function age(root) {
    var el = root.querySelector("[data-ib-age]");
    var at = Date.parse(root.getAttribute("data-ib-at") || "");
    if (ageTimer) clearInterval(ageTimer);
    if (!el || isNaN(at)) return;
    function tick() {
      var m = Math.round((Date.now() - at) / 60000);
      el.textContent = m < 1 ? "read just now" : m < 60 ? "read " + m + " min ago" : "read " + Math.round(m / 60) + " h ago";
    }
    tick();
    ageTimer = setInterval(tick, 30000);
  }

  load(false);
})();
