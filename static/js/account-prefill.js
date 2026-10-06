/* ════════════════════════════════════════════════════════════════════════
   AN AGENT, OPENED FOR ONE CLIENT ACCOUNT (/<account>/agents/<agent>)

   app.py renders the agent's own page and hands this script the account's
   details from the master doc's profile: window.__ACCT_PREFILL__ =
   {fields: {"#selector": "value"}, name}. Each empty field gets its value, as
   if typed (input and change events, so the page's own suggestions and checks
   run), and a note says where the values came from. Nothing is run: the
   person still presses the agent's own button. textContent only.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var P = window.__ACCT_PREFILL__;
  if (!P || !P.fields) return;
  var done = false;

  function fill() {
    var filled = 0;
    Object.keys(P.fields).forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el || el.value) return;
      el.value = P.fields[sel];
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    });
    return filled;
  }

  function note(n) {
    if (done || !n) return;
    done = true;
    var box = document.createElement("div");
    box.setAttribute("role", "status");
    box.textContent = "Filled in for " + P.name + " from the master doc. Change anything before you run it.";
    box.style.cssText = "position:fixed;left:50%;bottom:24px;z-index:9000;transform:translate(-50%,12px);opacity:0;" +
      "max-width:calc(100vw - 32px);padding:12px 20px;border-radius:999px;background:#FF6022;color:#121213;" +
      "font:600 14px/1.35 'Zalando Sans',system-ui,sans-serif;box-shadow:0 18px 40px -12px rgba(0,0,0,.4);" +
      "transition:opacity 260ms ease,transform 420ms cubic-bezier(.16,1,.3,1);text-align:center";
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.style.opacity = "1"; box.style.transform = "translate(-50%,0)"; });
    setTimeout(function () {
      box.style.opacity = "0";
      setTimeout(function () { box.remove(); }, 400);
    }, 5200);
  }

  function run() { note(fill()); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  /* A page that restores its own last values on load would leave nothing empty; one that clears its
     fields late is filled again. */
  window.addEventListener("load", function () { setTimeout(function () { var n = fill(); if (n) note(n); }, 300); });
})();
