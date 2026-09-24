/* ════════════════════════════════════════════════════════════════════════
   PRESS · PLAY — the public site's playful motion.

   No libraries. Every effect here follows three rules:

     1. The page is complete without it. The markup carries every word and
        every final number; this script only animates between states that
        already make sense on their own.
     2. prefers-reduced-motion switches ALL of it off, not down.
     3. Nothing arrives card by card. The banned entrance is a grid of cards
        fading and lifting in with a delay per card; nothing below staggers a
        card. The only per-index timing is per LETTER of one word (the
        footer wordmark), which is type setting itself, not a grid arriving.

   What it does:
     - Headlines and the footer wordmark are "springy": the Fraunces weight
       swells under the pointer, letter by letter, and settles back to 600.
     - The highlighter behind a phrase draws itself once the line is in.
     - The hero deck deals its top signal card to the back every few seconds
       and drifts slightly against the pointer.
     - Pill buttons flood with colour from the point the pointer entered.
     - Stats roll their digits like an odometer.
     - The ticker speeds up and leans with the scroll.
     - The colour-block track slides sideways while the page scrolls down.
     - Ink and sky blocks settle into place as they arrive.
     - The footer wordmark's letters rise out of the baseline.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FINE = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (RM) { root.classList.add("rm"); return; }
  root.classList.add("play");

  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  var raf = window.requestAnimationFrame.bind(window);

  function onView(els, fn, opts) {
    if (!("IntersectionObserver" in window)) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { fn(e.target); io.unobserve(e.target); } });
    }, opts || { threshold: 0.25 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ── 1. Split a heading into letters ─────────────────────────────────
     Text nodes only, so .it and .mk keep their own spans around the
     letters. The heading keeps its words for assistive tech through
     aria-label; the letters are presentation. */
  function split(el) {
    if (el.__split) return el.__chars;
    var label = el.textContent.replace(/\s+/g, " ").trim(), chars = [], i = 0;
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!n.nodeValue.trim()) return;
      var frag = doc.createDocumentFragment();
      n.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
        var word = doc.createElement("span"); word.className = "wd";
        part.split("").forEach(function (c) {
          var s = doc.createElement("span"); s.className = "ch"; s.textContent = c;
          s.style.setProperty("--i", i++); word.appendChild(s); chars.push(s);
        });
        frag.appendChild(word);
      });
      n.parentNode.replaceChild(frag, n);
    });
    el.setAttribute("aria-label", label);
    el.__split = true; el.__chars = chars;
    return chars;
  }

  /* ── 2. Springy weight ────────────────────────────────────────────────
     Letters within ~150px of the pointer swell towards weight 860; the
     resting weight is the heading's own 600, so at rest nothing differs
     from the kept Fraunces setting. Rects are measured once per hover. */
  function springy(el, reach, peak) {
    if (!FINE) return;
    var chars = split(el), rects = null, px = 0, py = 0, pending = false;
    function measure() { rects = chars.map(function (c) { var r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); }
    function paint() {
      pending = false;
      if (!rects) return;
      for (var k = 0; k < chars.length; k++) {
        var dx = rects[k][0] - px, dy = rects[k][1] - py;
        var t = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / reach);
        chars[k].style.setProperty("--w", Math.round(600 + (peak - 600) * t * t));
      }
    }
    el.addEventListener("pointerenter", function () { measure(); el.classList.add("is-live"); });
    el.addEventListener("pointermove", function (e) { px = e.clientX; py = e.clientY; if (!pending) { pending = true; raf(paint); } });
    el.addEventListener("pointerleave", function () {
      rects = null; el.classList.remove("is-live");
      chars.forEach(function (c) { c.style.removeProperty("--w"); });
    });
    window.addEventListener("scroll", function () { if (rects) measure(); }, { passive: true });
  }
  $$(".d1").forEach(function (h) { springy(h, 170, 880); });
  var word = doc.querySelector(".foot-word");
  if (word) {
    split(word);
    springy(word, 260, 900);
    onView([word], function (w) { w.classList.add("up"); }, { threshold: 0.35 });
  }

  /* ── 3. The highlighter draws ─────────────────────────────────────────
     Once a highlighted phrase is on screen (and its line has had time to
     rise), the stroke sweeps left to right. CSS draws it (.play .mk.drawn). */
  onView($$(".mk"), function (m) { setTimeout(function () { m.classList.add("drawn"); }, 650); }, { threshold: 0.6 });

  /* ── 4. The hero deck ─────────────────────────────────────────────── */
  var deck = doc.getElementById("deck");
  if (deck) {
    var cards = $$(".deck-card", deck), n = cards.length, timer = null, busy = false;
    function order() { cards.forEach(function (c, k) { c.setAttribute("data-pos", k); }); }
    function deal() {
      if (busy || doc.hidden) return;
      busy = true;
      var top = cards[0];
      top.classList.add("fling");
      setTimeout(function () {
        cards.push(cards.shift()); order();
        top.classList.remove("fling");
        busy = false;
      }, 520);
    }
    function play() { if (!timer) timer = setInterval(deal, 3200); }
    function stop() { clearInterval(timer); timer = null; }
    order();
    requestAnimationFrame(function () { deck.classList.add("dealt"); });
    deck.addEventListener("click", deal);
    deck.addEventListener("pointerenter", stop);
    deck.addEventListener("pointerleave", play);
    play();
    if (FINE) {
      var hero = deck.parentNode, dpend = false, dx = 0, dy = 0;
      hero.addEventListener("pointermove", function (e) {
        var r = hero.getBoundingClientRect();
        dx = (e.clientX - r.left) / r.width - 0.5; dy = (e.clientY - r.top) / r.height - 0.5;
        if (!dpend) { dpend = true; raf(function () { dpend = false; deck.style.setProperty("--dx", (dx * -18).toFixed(1) + "px"); deck.style.setProperty("--dy", (dy * -14).toFixed(1) + "px"); }); }
      });
      hero.addEventListener("pointerleave", function () { deck.style.setProperty("--dx", "0px"); deck.style.setProperty("--dy", "0px"); });
    }
  }

  /* ── 5. Pill buttons flood from the pointer ───────────────────────────
     The flood is a circle drawn by ::before at --x/--y; this only records
     where the pointer came in (and left, so it drains the same way). */
  function origin(e) {
    var r = this.getBoundingClientRect();
    this.style.setProperty("--x", (e.clientX - r.left) + "px");
    this.style.setProperty("--y", (e.clientY - r.top) + "px");
  }
  if (FINE) $$(".btn, .ag, a.cell").forEach(function (b) {
    b.addEventListener("pointerenter", origin);
    b.addEventListener("pointerleave", origin);
  });

  /* ── 6. Odometer stats ────────────────────────────────────────────────
     Each digit becomes a column of 0–9 that rolls to its final place. The
     columns are built only when the stat scrolls in, so until then (and
     forever, with JS off) the plain number stands. */
  onView($$("[data-count]"), function (el) {
    var final = el.textContent.trim();
    if (!/^\d+$/.test(final)) return;
    el.setAttribute("aria-label", final);
    el.textContent = "";
    el.classList.add("odo");
    final.split("").forEach(function (d, k) {
      var col = doc.createElement("span"); col.className = "odo-col"; col.setAttribute("aria-hidden", "true");
      var strip = doc.createElement("span"); strip.className = "odo-strip";
      for (var v = 0; v <= 9; v++) { var c = doc.createElement("span"); c.textContent = v; strip.appendChild(c); }
      col.appendChild(strip); el.appendChild(col);
      // Longer travel for the leading digits, so the number settles from
      // the left like a counter rolling over.
      strip.style.setProperty("--d", d);
      strip.style.setProperty("--t", (1100 + (final.length - k) * 180) + "ms");
    });
    raf(function () { raf(function () { el.classList.add("roll"); }); });
    // Each column is as wide as its widest digit, which spaces a "1" out;
    // once the leading (slowest) digit lands, the plain number goes back.
    var lead = el.querySelector(".odo-strip");
    setTimeout(function () {
      el.classList.remove("odo", "roll"); el.textContent = final; el.removeAttribute("aria-label");
    }, 1100 + final.length * 180 + 120);
    lead = null;
  }, { threshold: 0.5 });

  /* ── 7. The ticker leans into the scroll ──────────────────────────────
     Its CSS animation keeps running; scroll speed raises its playback rate
     and tips the words forward, and both ease back when the page stops. */
  var ticks = $$(".tick-track").map(function (t) { return { el: t, anim: t.getAnimations ? t.getAnimations()[0] : null }; });
  if (ticks.length) {
    var lastY = window.scrollY, vel = 0, looping = false;
    function loop() {
      vel *= 0.9;
      ticks.forEach(function (t) {
        if (t.anim) t.anim.playbackRate = 1 + Math.min(6, Math.abs(vel) / 6);
        t.el.style.setProperty("--skew", Math.max(-12, Math.min(12, -vel / 3)).toFixed(2) + "deg");
      });
      if (Math.abs(vel) > 0.05) raf(loop); else looping = false;
    }
    window.addEventListener("scroll", function () {
      var y = window.scrollY; vel = vel * 0.6 + (y - lastY) * 0.4; lastY = y;
      if (!looping) { looping = true; raf(loop); }
    }, { passive: true });
  }

  /* ── 8. The track ─────────────────────────────────────────────────────
     Pinned with position:sticky; this turns the section's scroll progress
     into a sideways shift of the rail and marks the tab you are on. Only
     on a wide screen: a phone gets the four blocks stacked. */
  var track = doc.getElementById("track");
  if (track) {
    var rail = track.querySelector(".track-rail"), view = track.querySelector(".track-view");
    var tabs = $$(".track-tabs button", track), tn = tabs.length, wide = false, tpend = false;
    function sizeTrack() {
      wide = window.innerWidth >= 900;
      track.classList.toggle("is-pinned", wide);
      if (!wide) { rail.style.transform = ""; return; }
      paintTrack();
    }
    function progress() {
      var r = track.getBoundingClientRect(), span = track.offsetHeight - window.innerHeight;
      return span > 0 ? Math.max(0, Math.min(1, -r.top / span)) : 0;
    }
    function paintTrack() {
      tpend = false;
      if (!wide) return;
      var p = progress(), shift = rail.scrollWidth - view.clientWidth;
      rail.style.transform = "translate3d(" + (-p * shift).toFixed(1) + "px,0,0)";
      track.style.setProperty("--p", p.toFixed(4));
      var on = Math.min(tn - 1, Math.round(p * (tn - 1)));
      tabs.forEach(function (b, k) { b.classList.toggle("on", k === on); b.setAttribute("aria-selected", k === on ? "true" : "false"); });
    }
    tabs.forEach(function (b, k) {
      b.addEventListener("click", function () {
        if (!wide) { track.querySelectorAll(".track-card")[k].scrollIntoView({ behavior: "smooth", block: "center" }); return; }
        var top = track.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top + (track.offsetHeight - window.innerHeight) * (k / (tn - 1)), behavior: "smooth" });
      });
    });
    window.addEventListener("scroll", function () { if (!tpend) { tpend = true; raf(paintTrack); } }, { passive: true });
    window.addEventListener("resize", sizeTrack);
    sizeTrack();
  }

  /* ── 9. Blocks settle ─────────────────────────────────────────────────
     A full-width ink or sky block arrives slightly small and rounder, and
     springs to its place. One block, one motion. */
  onView($$(".inkband, .limeband"), function (el) { el.classList.add("settled"); }, { threshold: 0.12 });
})();
