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

  window.bentoReveal = reveal;
  window.bentoRevealNow = revealNow;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { reveal(document); });
  } else {
    reveal(document);
  }
})();
