/* ════════════════════════════════════════════════════════════════════════
   BENTO — MOTION (behaviour)

   Two jobs, both small:

     1. Arm and fire the scroll reveal for anything marked `.bn-reveal`.
     2. Expose bentoReveal(root) so pages that inject markup after load
        (every agent page renders its results from JS) can reveal the new
        region with the same gesture instead of inventing their own.

   Loaded with `defer`, no module graph, no dependencies -- this codebase
   has no build step and this file must not introduce one.

   The no-JS contract: `.bn-reveal` on its own is inert in CSS. The hidden
   state lives in `.bn-armed`, which only this script applies. If the script
   fails to load, every page renders complete and static rather than blank,
   which is the failure mode a clip-path reveal must be designed around.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* One observer for the whole document. rootMargin pulls the trigger 10%
     up from the bottom edge so a tile finishes its wipe at about the moment
     it is comfortably in view, rather than starting as its first pixel
     appears and finishing off-screen. */
  var io = null;
  function observer() {
    if (io || !("IntersectionObserver" in window)) return io;
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add("bn-shown");
        io.unobserve(entries[i].target);   /* reveal once, never replay */
      }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.01 });
    return io;
  }

  /* Arm everything inside `root` that asks to be revealed.

     Anything already on screen when this runs is shown immediately and
     never armed: arming it would clip it to zero width for a frame and
     produce a flash of missing content above the fold. */
  function reveal(root) {
    root = root || document;
    var nodes = root.querySelectorAll(".bn-reveal:not(.bn-armed)");
    if (!nodes.length) return;

    if (REDUCED || !("IntersectionObserver" in window)) {
      /* Nothing to do: un-armed elements are already visible. Marking them
         shown keeps the DOM honest for anything inspecting state. */
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("bn-shown");
      return;
    }

    var ob = observer();
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var box = el.getBoundingClientRect();
      var onscreen = box.top < (window.innerHeight || 0) && box.bottom > 0;
      el.classList.add("bn-armed");
      if (onscreen) el.classList.add("bn-shown");
      else ob.observe(el);
    }
  }

  /* For JS-rendered regions: mark the container and reveal it in one call.
     Takes the container, not its children, because the paradigm is one wipe
     across a region rather than one per card. */
  function revealNow(el) {
    if (!el) return;
    if (REDUCED) return;
    el.classList.remove("bn-wipe");
    /* Reading offsetWidth forces a reflow, which is what lets the same
       class be re-applied and re-run on a container that is re-rendered
       repeatedly -- without it the second search does not animate. */
    void el.offsetWidth;
    el.classList.add("bn-wipe");
  }

  /* ── A little play ─────────────────────────────────────────────────────
     Three small touches, all off under reduced motion:
       - a stat number that arrives with the page counts up to itself once;
       - a primary button floods orange from where the pointer came in;
       - a chip that turns on gives a small pop (CSS, bento-motion.css).
     Dashboards keep their data still: the count-up only touches a number
     the server rendered, and stops the moment the page's own script writes
     a different value into it. */
  function countUp(el) {
    var raw = el.textContent.trim(), m = raw.match(/^(\d{1,3}(?:,\d{3})*|\d+)(\+|%)?$/);
    if (!m) return;
    var target = parseInt(m[1].replace(/,/g, ""), 10), suffix = m[2] || "";
    if (!(target > 1)) return;
    var start = performance.now(), dur = 900, last = null;
    function fmt(v) { return (m[1].indexOf(",") > -1 ? v.toLocaleString("en-US") : String(v)) + suffix; }
    (function step(t) {
      if (last !== null && el.textContent !== last) return;   /* the page took over */
      var p = Math.min(1, (t - start) / dur), k = 1 - Math.pow(1 - p, 3);
      last = fmt(p < 1 ? Math.round(target * k) : target);
      el.textContent = last;
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }
  function play() {
    if (REDUCED) return;
    document.documentElement.classList.add("bn-play");
    var nums = document.querySelectorAll(".bn-stat-v, .hb-n b, .hb-c b");
    for (var i = 0; i < nums.length; i++) countUp(nums[i]);
    document.addEventListener("pointerover", function (e) {
      var b = e.target.closest && e.target.closest(".bn-btn--primary, .hb-go, .bn-nav a");
      if (!b || b.contains(e.relatedTarget)) return;
      var r = b.getBoundingClientRect();
      b.style.setProperty("--x", (e.clientX - r.left) + "px");
      b.style.setProperty("--y", (e.clientY - r.top) + "px");
    });
  }

  window.bentoReveal = reveal;
  window.bentoRevealNow = revealNow;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { reveal(document); play(); });
  } else {
    reveal(document); play();
  }
})();
