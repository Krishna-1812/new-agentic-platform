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
     - The footer wordmark's letters rise out of the baseline, then jump
       under the pointer like keys.
   And, louder:
     - An opening sequence on the first home visit of a session: the
       wordmark drops in over four colour bars that lift off the page.
     - The deck's top card can be grabbed and thrown; a sticker spins on it.
     - A statement lights up word by word as it scrolls past.
     - A band of display type slides both ways with the scroll.
     - Ink blocks open out of a small rounded window, scrubbed by scroll.
     - Section labels decode from scrambled glyphs.
     - The calls to action throw confetti.
     - The agent directory glides its cards into place when filtered.
     - The footer's shape tiles keep rearranging themselves.
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
  function springy(el, reach, peak, lift) {
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
        if (lift) chars[k].style.setProperty("--lift", (t * t).toFixed(3));
      }
    }
    el.addEventListener("pointerenter", function () { measure(); el.classList.add("is-live"); });
    el.addEventListener("pointermove", function (e) { px = e.clientX; py = e.clientY; if (!pending) { pending = true; raf(paint); } });
    el.addEventListener("pointerleave", function () {
      rects = null; el.classList.remove("is-live");
      chars.forEach(function (c) { c.style.removeProperty("--w"); c.style.removeProperty("--lift"); });
    });
    window.addEventListener("scroll", function () { if (rects) measure(); }, { passive: true });
  }
  $$(".d1").forEach(function (h) { springy(h, 170, 880); });
  var word = doc.querySelector(".foot-word");
  if (word) {
    split(word);
    springy(word, 260, 900, true);
    onView([word], function (w) {
      w.classList.add("up");
      // Once every letter has landed, drop the per-letter delay so they
      // answer the pointer at once.
      setTimeout(function () { w.classList.add("risen"); }, 900 + w.__chars.length * 45);
    }, { threshold: 0.35 });
  }

  /* ── 3. The highlighter draws ─────────────────────────────────────────
     Once a highlighted phrase is on screen (and its line has had time to
     rise), the stroke sweeps left to right. CSS draws it (.play .mk.drawn). */
  whenOpen(function () {
    onView($$(".mk"), function (m) { setTimeout(function () { m.classList.add("drawn"); }, 650); }, { threshold: 0.6 });
  });

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
    whenOpen(function () { raf(function () { deck.classList.add("dealt"); }); });
    deck.addEventListener("pointerenter", stop);
    deck.addEventListener("pointerleave", function () { if (!grab) play(); });
    play();

    /* Grab and throw. A press that barely moves is a click and deals the
       next card; a drag follows the pointer, tilting with the pull; let go
       fast or far and the card flies off along its path, then tucks in at
       the back. Otherwise it springs home. */
    var grab = null;
    deck.addEventListener("pointerdown", function (e) {
      if (busy || e.button > 0 || e.target.closest(".sticker")) return;
      e.preventDefault();
      var top = cards[0];
      grab = { el: top, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, vx: 0, vy: 0, t: performance.now() };
      try { deck.setPointerCapture(e.pointerId); } catch (_) {}
      stop();
    });
    deck.addEventListener("pointermove", function (e) {
      if (!grab) return;
      var now = performance.now(), dt = Math.max(1, now - grab.t);
      var dx = e.clientX - grab.x0, dy = e.clientY - grab.y0;
      grab.vx = grab.vx * 0.5 + ((dx - grab.dx) / dt) * 0.5;
      grab.vy = grab.vy * 0.5 + ((dy - grab.dy) / dt) * 0.5;
      grab.dx = dx; grab.dy = dy; grab.t = now;
      if (Math.abs(dx) + Math.abs(dy) > 4) deck.classList.add("grabbing");
      if (deck.classList.contains("grabbing"))
        grab.el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (-4 + dx / 9).toFixed(1) + "deg)";
    });
    function release() {
      if (!grab) return;
      var g = grab; grab = null;
      var moved = deck.classList.contains("grabbing");
      deck.classList.remove("grabbing");
      if (!moved) { g.el.style.transform = ""; deal(); return; }
      var speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy), far = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
      if (speed > 0.5 || far > 120) {
        busy = true;
        var k = speed > 0.5 ? 520 / speed : 4, tx = g.dx + g.vx * k * 1.4, ty = g.dy + g.vy * k * 1.4;
        if (Math.sqrt(tx * tx + ty * ty) < 420) { var m = 420 / Math.max(1, far); tx = g.dx * m; ty = g.dy * m; }
        g.el.classList.add("thrown");
        g.el.style.transform = "translate(" + tx.toFixed(0) + "px," + ty.toFixed(0) + "px) rotate(" + (g.dx / 3).toFixed(0) + "deg)";
        setTimeout(function () {
          g.el.classList.remove("thrown"); g.el.style.transform = "";
          cards.push(cards.shift()); order(); busy = false;
        }, 560);
      } else {
        g.el.style.transform = "";
      }
    }
    deck.addEventListener("pointerup", release);
    deck.addEventListener("pointercancel", release);

    // The sticker: slap it for a burst of confetti.
    var sticker = deck.querySelector(".sticker");
    if (sticker) sticker.addEventListener("click", function (e) { e.stopPropagation(); burst(e.clientX, e.clientY, 70); });
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
  onView($$(".limeband"), function (el) { el.classList.add("settled"); }, { threshold: 0.12 });

  /* ── One scroll loop for everything scrubbed by scroll position ──────
     Each part registers a painter; they all run in the same frame. */
  var painters = [], spend = false;
  function paintAll() { spend = false; var vh = window.innerHeight; painters.forEach(function (f) { f(vh); }); }
  function schedule() { if (!spend) { spend = true; raf(paintAll); } }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  /* ── 10. Ink blocks open like a portal ────────────────────────────────
     A rounded window in the middle of the block widens to the whole block
     while its top travels from the bottom of the screen to a quarter of
     the way down. Scrubbed, so scrolling back closes it again. */
  $$(".inkband").forEach(function (band) {
    band.classList.add("portal");
    painters.push(function (vh) {
      var r = band.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var e = easeOut(clamp01((vh - r.top) / (vh * 0.75)));
      var iy = ((1 - e) * 16).toFixed(2), ix = ((1 - e) * 30).toFixed(2), rad = (24 + (1 - e) * 280).toFixed(0);
      band.style.clipPath = e >= 0.999 ? "" : "inset(" + iy + "% " + ix + "% " + iy + "% " + ix + "% round " + rad + "px)";
      band.style.setProperty("--pp", e.toFixed(3));
    });
  });

  /* ── 11. The statement lights up as it is read ───────────────────────
     Words (not letters) go from pale to ink in reading order between the
     moment the sentence enters the lower part of the screen and the moment
     it has risen past the middle; a coloured phrase gets its block when
     its first word lights. */
  var said = doc.getElementById("said");
  if (said) {
    var words = [];
    (function wrapWords(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 1) { wrapWords(n); return; }
        if (n.nodeType !== 3 || !n.nodeValue.trim()) return;
        var frag = doc.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
          var w = doc.createElement("span"); w.className = "sw"; w.textContent = part;
          frag.appendChild(w); words.push(w);
        });
        n.parentNode.replaceChild(frag, n);
      });
    })(said);
    var blocks = $$(".said-b", said).map(function (b) { return { el: b, first: words.indexOf(b.querySelector(".sw")) }; });
    var litN = -1;
    painters.push(function (vh) {
      var r = said.getBoundingClientRect();
      var p = clamp01((vh * 0.88 - r.top) / (r.height + vh * 0.38));
      var n = Math.round(p * words.length);
      if (n === litN) return;
      litN = n;
      words.forEach(function (w, k) { w.classList.toggle("lit", k < n); });
      blocks.forEach(function (b) { b.el.classList.toggle("lit", b.first < n); });
    });
  }

  /* ── 12. The kinetic band ─────────────────────────────────────────────
     Each row is wider than the screen; the band's trip through the
     viewport maps to a sideways shift across that extra width, one row
     each way. Shapes between the words turn with it. */
  $$(".kin").forEach(function (band) {
    var rows = $$(".kin-row", band);
    painters.push(function (vh) {
      var r = band.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var p = clamp01((vh - r.top) / (vh + r.height));
      rows.forEach(function (row) {
        var dir = +row.getAttribute("data-dir"), extra = Math.max(0, row.scrollWidth - band.clientWidth);
        var x = dir < 0 ? -p * extra * 0.6 : -(1 - p) * extra * 0.6 - extra * 0.2;
        row.style.setProperty("--kx", x.toFixed(1) + "px");
        row.style.setProperty("--kr", (p * 360 * dir).toFixed(1) + "deg");
      });
    });
  });

  /* ── 13. The scroll's speed ───────────────────────────────────────────
     Shared by the kinetic band (leans into the scroll) and the hero
     sticker (spins faster). Eases back to rest when the page stops. */
  var kinRows = $$(".kin-row"), stickerEl = doc.querySelector(".sticker");
  var stickAnim = stickerEl && stickerEl.getAnimations ? stickerEl.getAnimations()[0] : null;
  if (kinRows.length || stickAnim) {
    var sy = window.scrollY, sv = 0, spinning = false;
    function coast() {
      sv *= 0.9;
      var lean = Math.max(-10, Math.min(10, -sv / 3)).toFixed(2) + "deg";
      kinRows.forEach(function (r) { r.style.setProperty("--kskew", lean); });
      if (stickAnim) stickAnim.playbackRate = 1 + Math.min(8, Math.abs(sv) / 4);
      if (Math.abs(sv) > 0.05) raf(coast); else spinning = false;
    }
    window.addEventListener("scroll", function () {
      var y = window.scrollY; sv = sv * 0.6 + (y - sy) * 0.4; sy = y;
      if (!spinning) { spinning = true; raf(coast); }
    }, { passive: true });
  }

  /* ── 14. Section labels decode ────────────────────────────────────────
     The small uppercase label over a section types itself out of random
     glyphs, left to right, in about half a second. Its box is held at its
     final width so nothing around it moves. */
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>";
  function scramble(el) {
    var text = el.textContent, len = text.length, t0 = null, dur = 520 + len * 14;
    if (!len || len > 48) return;
    var w = el.getBoundingClientRect().width;
    el.style.display = getComputedStyle(el).display === "inline" ? "inline-block" : "";
    el.style.minWidth = w + "px"; el.style.whiteSpace = "nowrap";
    function frame(now) {
      if (t0 === null) t0 = now;
      var done = (now - t0) / dur, out = "";
      for (var k = 0; k < len; k++) {
        var c = text.charAt(k);
        out += (c === " " || k / len < done * 1.15 - 0.1) ? c : GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
      }
      el.textContent = out;
      if (done < 1) raf(frame);
      else { el.textContent = text; el.style.minWidth = ""; el.style.whiteSpace = ""; el.style.display = ""; }
    }
    raf(frame);
  }
  whenOpen(function () {
    onView($$(".hero .lbl, .shead-l .lbl, .dir-bar .lbl"), scramble, { threshold: 1 });
  });

  /* ── 15. Confetti ─────────────────────────────────────────────────────
     Plain elements, not a canvas: a few dozen shapes in the five block
     colours thrown up from the button, pulled down by gravity, then
     removed. Fired by the sign-up and talk-to-us buttons. */
  var COLOURS = ["#FF6022", "#FFB500", "#8CCBFF", "#FF3B30", "#121213"];
  function burst(x, y, n) {
    var layer = doc.createElement("div"); layer.className = "cf-layer"; layer.setAttribute("aria-hidden", "true");
    var bits = [];
    for (var k = 0; k < n; k++) {
      var b = doc.createElement("i"); b.className = "cf k" + (k % 4);
      b.style.background = COLOURS[k % COLOURS.length];
      var a = (-90 + (Math.random() - 0.5) * 130) * Math.PI / 180, v = 7 + Math.random() * 11;
      bits.push({ el: b, x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 360, vr: (Math.random() - 0.5) * 24 });
      layer.appendChild(b);
    }
    doc.body.appendChild(layer);
    var t0 = performance.now();
    (function step(now) {
      var life = (now - t0) / 1700;
      bits.forEach(function (p) {
        p.vy += 0.42; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        p.el.style.transform = "translate3d(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px,0) rotate(" + p.r.toFixed(0) + "deg)";
        p.el.style.opacity = life > 0.7 ? (1 - (life - 0.7) / 0.3).toFixed(2) : "1";
      });
      if (life < 1) raf(step); else layer.remove();
    })(t0);
  }
  doc.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-signup], [data-demo]");
    if (!b) return;
    var r = b.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 56);
  });

  /* ── 16. The directory glides when filtered ───────────────────────────
     Called by the page's own filter (it falls back to filtering in place
     when this is absent). Every card that stays glides from where it was
     to where it lands; cards that come back pop in, all at once. */
  window.pressFlip = function (items, mutate) {
    var before = items.map(function (el) { return el.offsetParent ? el.getBoundingClientRect() : null; });
    mutate();
    items.forEach(function (el, k) {
      if (!el.offsetParent || !el.animate) return;
      var a = before[k], b = el.getBoundingClientRect();
      if (!a) {
        el.animate([{ transform: "scale(.7)", opacity: 0 }, { transform: "none", opacity: 1 }],
                   { duration: 460, easing: "cubic-bezier(.34,1.56,.64,1)" });
        return;
      }
      var dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
                 { duration: 560, easing: "cubic-bezier(.22,1,.36,1)" });
    });
  };

  /* ── 17. Footer toys ──────────────────────────────────────────────────
     Every so often one tile changes its shape and turns a quarter; hover
     turns a tile's shape half a turn, a click changes its colour. */
  var toys = $$(".toy");
  if (toys.length) {
    var TONES = ["t-ink", "t-paper", "t-sky", "t-red", "t-acc"];
    var shape = function (i, next) { i.className = "sh-" + next; };
    toys.forEach(function (t) {
      var i = t.querySelector("i"), turn = 0;
      t.__turn = function (deg) { turn += deg; i.style.setProperty("--tr", turn + "deg"); };
      t.addEventListener("pointerenter", function () { t.__turn(180); });
      t.addEventListener("click", function () {
        var now = TONES.filter(function (c) { return t.classList.contains(c); })[0];
        t.classList.remove(now); t.classList.add(TONES[(TONES.indexOf(now) + 1) % TONES.length]);
        t.__turn(90);
      });
    });
    var foot = doc.querySelector(".foot"), footOn = false;
    if ("IntersectionObserver" in window && foot)
      new IntersectionObserver(function (es) { footOn = es[0].isIntersecting; }).observe(foot);
    setInterval(function () {
      if (!footOn || doc.hidden) return;
      var t = toys[(Math.random() * toys.length) | 0], i = t.querySelector("i");
      var cur = +(i.className.replace("sh-", "")) || 0;
      shape(i, (cur + 1 + ((Math.random() * 3) | 0)) % 4);
      t.__turn(90);
    }, 1100);
  }

  /* ── 18. The opening sequence ─────────────────────────────────────────
     Only when <head> set .intro-on (home, first visit in the session, not
     arriving from another page of the site). The orange cover the head
     put up is swapped for four bars under the wordmark: the bars take
     their colours, the letters drop in, then everything lifts off and the
     hero's lines rise underneath. Any click, key or wheel skips it. */
  function whenOpen(fn) { if (root.classList.contains("intro-on") || root.classList.contains("intro-hold")) doc.addEventListener("pr:open", fn, { once: true }); else fn(); }
  (function intro() {
    if (!root.classList.contains("intro-on")) return;
    try { sessionStorage.setItem("nx-intro", "1"); } catch (_) {}
    var name = (doc.querySelector(".foot-word") || doc.querySelector(".nv-brand") || {}).textContent || "";
    var ov = doc.createElement("div"); ov.className = "intro"; ov.setAttribute("aria-hidden", "true");
    ["c-orange", "c-amber", "c-sky", "c-red"].forEach(function (c) {
      var b = doc.createElement("i"); b.className = "intro-bar " + c; ov.appendChild(b);
    });
    var w = doc.createElement("div"); w.className = "intro-word"; w.textContent = name.replace(/\s+/g, " ").trim(); ov.appendChild(w);
    var meta = doc.createElement("div"); meta.className = "intro-meta";
    var l = doc.createElement("span"); l.textContent = "Reading the signals";
    var pc = doc.createElement("span"); pc.textContent = "0%";
    meta.appendChild(l); meta.appendChild(pc); ov.appendChild(meta);
    split(w);
    doc.body.appendChild(ov);
    root.classList.add("intro-hold");
    root.classList.remove("intro-on");
    var t0 = performance.now(), gone = false;
    (function count(now) {
      var p = Math.min(1, (now - t0) / 1050);
      pc.textContent = Math.round(easeOut(p) * 100) + "%";
      if (p < 1 && !gone) raf(count);
    })(t0);
    raf(function () { raf(function () { ov.classList.add("go"); }); });
    var tOut = setTimeout(leave, 1250);
    function leave() {
      if (gone) return; gone = true; clearTimeout(tOut);
      pc.textContent = "100%";
      ov.classList.add("go", "out");
      setTimeout(function () { root.classList.remove("intro-hold"); doc.dispatchEvent(new Event("pr:open")); }, 180);
      setTimeout(function () { ov.remove(); }, 1250);
      ["click", "keydown", "wheel", "touchstart"].forEach(function (t) { window.removeEventListener(t, leave); });
    }
    ["click", "keydown", "wheel", "touchstart"].forEach(function (t) { window.addEventListener(t, leave, { passive: true }); });
  })();

  schedule();
})();
