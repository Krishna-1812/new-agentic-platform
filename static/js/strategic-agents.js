/* ════════════════════════════════════════════════════════════════════════
   GO-TO-MARKET AGENTS — the page's motion and filtering.

   The page is complete without this file. What it adds follows the public
   site's playbook (press-play.js):
     - the hero settles in, its headline rises line by line and the marker
       draws; the headline's letters swell under the pointer;
     - labels decode from scrambled glyphs; figures roll like an odometer;
     - the ticker loops and leans with the scroll;
     - the "notice / understand / act" path draws itself with the scroll,
       a dot riding its head;
     - each group of cards wipes open as one object (never card by card);
     - pills and cards flood with colour from where the pointer came in;
     - filtering glides the survivors into their new places (FLIP);
     - the ink band opens like a portal; the footer wordmark rises letter
       by letter, then jumps under the pointer.
   prefers-reduced-motion switches all of it off; filtering still works.

   Reveals are watched on UNCLIPPED wrappers: an element clipped to zero
   width never reports as intersecting, so the clip always sits on a child.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FINE = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var raf = window.requestAnimationFrame.bind(window);
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  if (!REDUCED) root.classList.add("sa-play");

  /* ── On-screen watcher ─────────────────────────────────────────────── */
  function onView(els, fn, threshold) {
    els = els.filter(Boolean);
    if (!("IntersectionObserver" in window)) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } });
    }, { threshold: threshold == null ? 0.2 : threshold, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }
  // Arm now (hidden state), reveal when seen. Content already on screen at
  // load still animates in, one frame later, so nothing flashes.
  function arm(els, threshold, after) {
    if (REDUCED) return;
    els = els.filter(Boolean);
    els.forEach(function (el) { el.classList.add("is-armed"); });
    void doc.body.offsetWidth;
    onView(els, function (el) {
      raf(function () { raf(function () { el.classList.add("is-in"); if (after) after(el); }); });
    }, threshold);
  }

  /* ── Decode: labels resolve out of scrambled glyphs ────────────────── */
  function decode(el) {
    if (REDUCED || el.__decoded) return;
    el.__decoded = true;
    var final = el.textContent, glyphs = "#%&*+=<>/\\|ABCDEFGHKMNPRSTXZ0123456789", start = performance.now();
    (function step(t) {
      var p = Math.min(1, (t - start) / 720), n = Math.floor(final.length * p), out = "";
      for (var i = 0; i < final.length; i++) {
        var ch = final.charAt(i);
        out += i < n || /[\s·&]/.test(ch) ? ch : glyphs.charAt(Math.floor(Math.random() * glyphs.length));
      }
      el.textContent = out;
      if (p < 1) raf(step); else el.textContent = final;
    })(start);
  }

  /* ── Odometer: each digit rolls to its value ───────────────────────── */
  function odo(el) {
    if (REDUCED || el.__odo) return;
    el.__odo = true;
    var text = el.textContent.trim(), strips = [];
    el.setAttribute("aria-label", text);
    var wrap = doc.createElement("span"); wrap.className = "sa-odo"; wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "display:inline-flex;font-variant-numeric:tabular-nums";
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (/\d/.test(ch)) {
        var col = doc.createElement("span"); col.style.cssText = "display:inline-block;height:1em;overflow:hidden;line-height:1";
        var strip = doc.createElement("span"); strip.style.cssText = "display:flex;flex-direction:column;transform:translateY(0)";
        for (var d = 0; d <= 9; d++) { var s = doc.createElement("span"); s.textContent = d; s.style.cssText = "display:block;height:1em;line-height:1"; strip.appendChild(s); }
        col.appendChild(strip); wrap.appendChild(col); strips.push([strip, +ch]);
      } else { var t = doc.createElement("span"); t.textContent = ch; wrap.appendChild(t); }
    }
    el.textContent = ""; el.appendChild(wrap);
    void wrap.offsetWidth;
    raf(function () {
      strips.forEach(function (p, k) {
        // One easing for the whole figure; later columns travel further, which
        // is what makes it read as a roll rather than a fade.
        p[0].style.transition = "transform " + (1100 + k * 90) + "ms cubic-bezier(.22,1,.36,1)";
        p[0].style.transform = "translateY(" + (-p[1]) + "em)";
      });
    });
    setTimeout(function () { el.textContent = text; }, 1300 + strips.length * 90);
  }

  /* ── Split a heading into letters (words kept whole) ───────────────── */
  function split(el) {
    if (el.__chars) return el.__chars;
    var label = el.textContent.replace(/\s+/g, " ").trim(), chars = [], i = 0;
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!n.nodeValue.trim()) return;
      var frag = doc.createDocumentFragment();
      n.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
        var w = doc.createElement("span"); w.className = "wd";
        part.split("").forEach(function (c) {
          var s = doc.createElement("span"); s.className = "ch"; s.textContent = c;
          s.style.setProperty("--i", i++); w.appendChild(s); chars.push(s);
        });
        frag.appendChild(w);
      });
      n.parentNode.replaceChild(frag, n);
    });
    el.setAttribute("aria-label", label);
    el.__chars = chars;
    return chars;
  }

  /* ── Springy weight under the pointer ──────────────────────────────── */
  function springy(el, reach, peak) {
    if (REDUCED || !FINE || !el) return;
    var chars = split(el), rects = null, px = 0, py = 0, pending = false;
    function measure() { rects = chars.map(function (c) { var r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); }
    function paint() {
      pending = false; if (!rects) return;
      for (var k = 0; k < chars.length; k++) {
        var dx = rects[k][0] - px, dy = rects[k][1] - py, t = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / reach);
        chars[k].style.setProperty("--w", Math.round(600 + (peak - 600) * t * t));
      }
    }
    el.addEventListener("pointerenter", function () { measure(); el.classList.add("is-live"); });
    el.addEventListener("pointermove", function (e) { px = e.clientX; py = e.clientY; if (!pending) { pending = true; raf(paint); } });
    el.addEventListener("pointerleave", function () { rects = null; el.classList.remove("is-live"); chars.forEach(function (c) { c.style.removeProperty("--w"); }); });
    window.addEventListener("scroll", function () { if (rects) measure(); }, { passive: true });
  }

  /* ── Pointer floods (pills and cards) ──────────────────────────────── */
  doc.addEventListener("pointerover", function (e) {
    var b = e.target.closest && e.target.closest(".sa-btn, .sa-chip, .sa-card");
    if (!b || b.contains(e.relatedTarget)) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty("--x", (e.clientX - r.left) + "px");
    b.style.setProperty("--y", (e.clientY - r.top) + "px");
  });

  /* ── Scroll-driven pieces: progress rule, ticker lean, flow, portal ── */
  var prog = $(".sa-prog i"), track = $(".sa-tick-track"), flowGrid = $(".sa-flow-grid");
  var flowPath = $(".sa-flow-path path"), flowDot = $(".sa-flow-dot"), ink = $("[data-sa-portal]");
  var lastY = window.scrollY, skew = 0, ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY, vh = window.innerHeight, max = doc.documentElement.scrollHeight - vh;
    if (prog) prog.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0) + ")";
    if (REDUCED) return;
    // Ticker: lean with scroll velocity, relax back to upright.
    var v = y - lastY; lastY = y;
    skew += (Math.max(-8, Math.min(8, v * 0.35)) - skew) * 0.35;
    if (track) track.style.setProperty("--skew", skew.toFixed(2) + "deg");
    if (Math.abs(skew) > 0.05) schedule();
    // Flow path: draws from 0 to 1 as the section crosses the viewport.
    if (flowGrid && flowPath && getComputedStyle(flowPath.parentNode).display !== "none") {
      var r = flowGrid.getBoundingClientRect();
      var p = Math.max(0, Math.min(1, (vh * 0.95 - r.top) / (vh * 0.6)));
      flowGrid.style.setProperty("--fp", p.toFixed(3));
      flowGrid.style.setProperty("--fdot", p > 0.01 ? 1 : 0);
      try {
        // Dash and dot both measured in the path's own units, so the dot
        // always rides exactly on the head of the drawn line.
        var svg = flowPath.ownerSVGElement, sb = svg.getBoundingClientRect(), gb = r;
        var L = flowPath.getTotalLength(), pt = flowPath.getPointAtLength(L * p);
        flowPath.style.strokeDasharray = L;
        flowPath.style.strokeDashoffset = L * (1 - p);
        var vb = svg.viewBox.baseVal;
        flowDot.style.setProperty("--dx", (sb.left - gb.left + pt.x / vb.width * sb.width) + "px");
        flowDot.style.setProperty("--dy", (sb.top - gb.top + pt.y / vb.height * sb.height) + "px");
      } catch (e) { /* not laid out yet */ }
    }
    // Portal: the ink band opens as it rises into view.
    if (ink) {
      var ir = ink.getBoundingClientRect();
      var pp = Math.max(0, Math.min(1, (vh - ir.top) / (vh * 0.7)));
      ink.style.setProperty("--pp", pp.toFixed(3));
    }
  }
  function schedule() { if (!ticking) { ticking = true; raf(onScroll); } }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);

  /* ── Filters ───────────────────────────────────────────────────────── */
  var cards = $$(".sa-card"), groups = $$("[data-sa-groupbox]"), q = $("#sa-q");
  var fGroup = "all", fState = "all", fText = "";
  cards.forEach(function (c) { c.__text = c.textContent.replace(/\s+/g, " ").toLowerCase(); });
  function matches(c) {
    if (fGroup !== "all" && c.getAttribute("data-group") !== fGroup) return false;
    if (fState !== "all" && c.getAttribute("data-badge") !== fState) return false;
    if (fText && c.__text.indexOf(fText) === -1) return false;
    return true;
  }
  function apply() {
    // FLIP: remember where every visible card is, change the DOM, then play
    // each survivor from its old place to its new one.
    var first = new Map();
    if (!REDUCED) cards.forEach(function (c) { if (!c.hidden) first.set(c, c.getBoundingClientRect()); });
    var shown = 0;
    cards.forEach(function (c) { var ok = matches(c); c.hidden = !ok; if (ok) shown++; });
    groups.forEach(function (g) { g.hidden = !$$(".sa-card", g).some(function (c) { return !c.hidden; }); });
    $("#sa-count").textContent = "Showing " + shown + " of " + cards.length;
    $("#sa-none").hidden = shown > 0;
    if (REDUCED) return;
    cards.forEach(function (c) {
      if (c.hidden) return;
      var a = first.get(c), b = c.getBoundingClientRect();
      if (!a) {
        c.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
        return;
      }
      var dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 560, easing: "cubic-bezier(.22,1,.36,1)" });
    });
  }
  function setChip(attr, val) {
    $$("[" + attr + "]").forEach(function (b) {
      var on = b.getAttribute(attr) === val;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  $$("[data-sa-group]").forEach(function (b) {
    b.setAttribute("aria-pressed", b.classList.contains("is-on") ? "true" : "false");
    b.addEventListener("click", function () { fGroup = b.getAttribute("data-sa-group"); setChip("data-sa-group", fGroup); apply(); });
  });
  $$("[data-sa-state]").forEach(function (b) {
    b.setAttribute("aria-pressed", b.classList.contains("is-on") ? "true" : "false");
    b.addEventListener("click", function () { fState = b.getAttribute("data-sa-state"); setChip("data-sa-state", fState); apply(); });
  });
  if (q) {
    var qt = null;
    q.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { fText = q.value.trim().toLowerCase(); apply(); }, 120); });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((doc.activeElement || {}).tagName || "") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); q.focus(); q.select();
      } else if (e.key === "Escape" && doc.activeElement === q && q.value) { q.value = ""; fText = ""; apply(); }
    });
  }
  var filters = $("#sa-filters");
  if (filters) window.addEventListener("scroll", function () {
    filters.classList.toggle("is-stuck", filters.getBoundingClientRect().top <= 70 && window.scrollY > 400);
  }, { passive: true });

  // Links from the flow steps: clear any filter hiding the card, glide to
  // it, and ring it once so the eye lands on the right one.
  $$(".sa-step a").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var t = doc.getElementById(a.getAttribute("href").slice(1));
      if (!t) return;
      e.preventDefault();
      if (t.hidden) { fGroup = "all"; fState = "all"; fText = ""; if (q) q.value = ""; setChip("data-sa-group", "all"); setChip("data-sa-state", "all"); apply(); }
      t.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
      t.classList.remove("is-target"); void t.offsetWidth; t.classList.add("is-target");
      setTimeout(function () { t.focus({ preventScroll: true }); }, REDUCED ? 0 : 600);
    });
  });

  /* ── The ticker: duplicate once so the loop is seamless ───────────── */
  if (track && !REDUCED) {
    $$(".sa-tick-i", track).forEach(function (a) {
      var c = a.cloneNode(true); c.setAttribute("aria-hidden", "true"); c.tabIndex = -1; track.appendChild(c);
    });
  }

  /* ── Arrival ───────────────────────────────────────────────────────── */
  var hero = $(".sa-hero");
  arm([hero], 0, function () {
    var lbl = $("[data-sa-decode]", hero); if (lbl) decode(lbl);
    setTimeout(function () { $$("[data-sa-odo]", hero).forEach(odo); }, 350);
  });
  springy($("[data-sa-springy]"), 180, 880);
  arm([flowGrid]);
  arm(groups, 0.05);
  arm($$(".sa-cta"));
  arm([$(".sa-toys")]);
  // Headings with a marker draw it once they are on screen; section labels
  // decode as they arrive; figures in the ink band roll when it opens.
  onView($$(".sa-h2").filter(function (h) { return h.querySelector(".sa-mk"); }), function (h) { h.classList.add("is-in"); });
  onView($$("[data-sa-decode]").filter(function (l) { return !hero || !hero.contains(l); }), decode, 0.6);
  onView($$(".sa-ink [data-sa-odo]"), odo, 0.6);

  var word = $(".sa-foot-word");
  if (word && !REDUCED) {
    split(word);
    onView([word], function (w) {
      w.classList.add("is-in");
      setTimeout(function () { w.classList.add("is-risen"); }, 900 + w.__chars.length * 45);
    }, 0.3);
  }

  schedule();
})();
