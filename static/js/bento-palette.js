/* ════════════════════════════════════════════════════════════════════════
   BENTO — COMMAND PALETTE  (Ctrl/Cmd + K)

   One implementation. This was previously pasted into twelve templates, each
   carrying its own ~120-line copy with its own inline stylesheet built from a
   JS string, which is why the palette looked slightly different depending on
   which page you opened it from and why fixing it anywhere fixed it nowhere.

   The styling now lives in bento-components.css with everything else. This
   file is behaviour only.

   Two inputs, both optional, both set by the page before this script runs:
     window.__KP_BASE__   the platform-wide destinations (from _bento.html, so
                          the brand strings resolve server-side)
     window.__KP_ITEMS__  page-specific entries, listed first
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  if (window.__bnPalette) return;
  window.__bnPalette = 1;

  var ITEMS = (window.__KP_ITEMS || []).concat(window.__KP_BASE__ || []);
  if (!ITEMS.length) return;

  var ov = document.createElement("div");
  ov.id = "bnPal";
  ov.className = "bn-pal";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Jump to");
  ov.innerHTML =
    '<div class="bn-pal-box">' +
      '<div class="bn-pal-head">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-3.4-3.4"/></svg>' +
        '<input id="bnPalIn" placeholder="Jump to any tool or section" autocomplete="off" spellcheck="false">' +
        '<kbd>esc</kbd>' +
      '</div>' +
      '<div class="bn-pal-list" id="bnPalList" role="listbox"></div>' +
      '<div class="bn-pal-foot"><span>&uarr;&darr; move</span><span>&crarr; open</span></div>' +
    '</div>';
  document.body.appendChild(ov);

  var inp = ov.querySelector("#bnPalIn");
  var list = ov.querySelector("#bnPalList");
  var cur = [], sel = 0, lastFocus = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function render() {
    if (!cur.length) {
      list.innerHTML = '<div class="bn-pal-empty">No matches. Try fewer letters.</div>';
      return;
    }
    list.innerHTML = cur.map(function (x, i) {
      return '<div class="bn-pal-it' + (i === sel ? " on" : "") + '" data-i="' + i + '"' +
             ' role="option" aria-selected="' + (i === sel) + '">' +
             '<span class="bn-pal-k">' + esc(x.k || (x.t || "?").charAt(0)) + '</span>' +
             '<span class="bn-pal-txt"><b>' + esc(x.t) + '</b>' +
             (x.d ? '<i>' + esc(x.d) + '</i>' : '') + '</span></div>';
    }).join("");
    var s = list.querySelector(".on");
    if (s) s.scrollIntoView({ block: "nearest" });
  }

  function filter(q) {
    q = (q || "").toLowerCase().trim();
    cur = !q ? ITEMS.slice() : ITEMS.filter(function (x) {
      return (x.t + " " + (x.d || "")).toLowerCase().indexOf(q) >= 0;
    });
    sel = 0;
    render();
  }

  function go(x) {
    if (!x) return;
    close();
    if (x.u.charAt(0) === "#") { location.hash = x.u; return; }
    /* Navigating to the page you are already on looks like the palette broke. */
    if (location.pathname === x.u) return;
    window.location.href = x.u;
  }

  function open() {
    lastFocus = document.activeElement;
    ov.classList.add("on");
    inp.value = "";
    filter("");
    setTimeout(function () { inp.focus(); }, 30);
  }

  function close() {
    ov.classList.remove("on");
    /* Returning focus is what makes this usable from the keyboard alone:
       without it, dismissing the palette drops focus onto <body> and the next
       Tab starts over from the top of the page. */
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  inp.addEventListener("input", function () { filter(inp.value); });
  inp.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, cur.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); go(cur[sel]); }
  });
  list.addEventListener("click", function (e) {
    var it = e.target.closest(".bn-pal-it");
    if (it) go(cur[parseInt(it.getAttribute("data-i"), 10)]);
  });
  ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });

  /* Ctrl/Cmd+K is claimed by the assistant widget on the six pages that
     include it, and that binding predates this palette. Taking it would break
     a shortcut people already use, and two handlers on one chord means both
     fire. So the palette binds it only where it is free, and its click
     affordance -- in the topbar, on every page -- is the entry point that
     always works. A hidden shortcut was the old palette's whole problem. */
  var assistantOwnsK = !!document.getElementById("k-root");

  document.addEventListener("keydown", function (e) {
    if (!assistantOwnsK && (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      ov.classList.contains("on") ? close() : open();
    } else if (e.key === "Escape" && ov.classList.contains("on")) {
      close();
    }
  });

  /* The topbar control says which chord actually works on this page rather
     than advertising one that does nothing. */
  document.addEventListener("DOMContentLoaded", function () {
    if (!assistantOwnsK) return;
    document.querySelectorAll("[data-bn-palette] .bn-kbd, .bn-top-k").forEach(function (el) {
      el.hidden = true;
    });
  });

  /* Anything with data-bn-palette opens it by click, so the shortcut is not the
     only way in. The old build announced Ctrl+K with a toast shown once, ever,
     and was undiscoverable to everyone who missed it. */
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-bn-palette]")) { e.preventDefault(); open(); }
  });

  window.bentoPalette = open;
})();
