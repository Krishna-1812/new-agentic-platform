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

  /* Watches every armed-but-not-yet-shown element and reveals it once its
     box enters the trigger zone -- the bottom 10% of the viewport held
     back, same margin an IntersectionObserver would use here.

     This is a manual scroll/resize check with getBoundingClientRect(),
     not an IntersectionObserver, on purpose: the element being watched is
     the SAME one .bn-armed clips to zero width (clip-path: inset(0 100%
     0 0)), and Chromium computes an IntersectionObserver target's
     intersection against its rendered (i.e. clipped) box, not its layout
     box. A zero-width clipped box never intersects anything, at any
     scroll position -- so the observer would arm an element and then
     never fire for it, leaving it permanently invisible. getBoundingClientRect()
     reads layout geometry, which clip-path does not touch, so it does not
     have that failure mode. Confirmed directly: the same element, same
     scroll, an IntersectionObserver reports isIntersecting: false forever
     while clipped and starts reporting true/false correctly the instant
     the clip-path is removed. */
  var armed = [];
  var watching = false;
  var ticking = false;

  function checkArmed() {
    ticking = false;
    var limit = (window.innerHeight || 0) * 0.9;
    for (var i = armed.length - 1; i >= 0; i--) {
      var box = armed[i].getBoundingClientRect();
      if (box.bottom > 0 && box.top < limit) {
        armed[i].classList.add("bn-shown");
        armed.splice(i, 1);
      }
    }
    if (!armed.length && watching) {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      watching = false;
    }
  }

  function onScrollOrResize() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(checkArmed);
  }

  /* Arms el for the check above. Distinct from the immediate-show path in
     reveal() below, which is for whatever is already on screen when this
     runs. */
  function watch(el) {
    armed.push(el);
    if (!watching) {
      window.addEventListener("scroll", onScrollOrResize, { passive: true });
      window.addEventListener("resize", onScrollOrResize, { passive: true });
      watching = true;
    }
    /* Catches anything armed after the page's own scroll position has
       already moved (e.g. a JS-rendered region added below the fold, or a
       reveal() call that runs after the user has scrolled). */
    onScrollOrResize();
  }

  /* Arm everything inside `root` that asks to be revealed.

     Anything already on screen when this runs is shown immediately and
     never armed: arming it would clip it to zero width for a frame and
     produce a flash of missing content above the fold. */
  function reveal(root) {
    root = root || document;
    var nodes = root.querySelectorAll(".bn-reveal:not(.bn-armed)");
    if (!nodes.length) return;

    if (REDUCED) {
      /* Nothing to do: un-armed elements are already visible. Marking them
         shown keeps the DOM honest for anything inspecting state. */
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("bn-shown");
      return;
    }

    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var box = el.getBoundingClientRect();
      var onscreen = box.top < (window.innerHeight || 0) && box.bottom > 0;
      el.classList.add("bn-armed");
      if (onscreen) el.classList.add("bn-shown");
      else watch(el);
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
