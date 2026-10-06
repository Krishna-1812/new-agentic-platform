/* ════════════════════════════════════════════════════════════════════════
   WHICH ACCOUNT THIS PAGE'S WORK IS FOR (/<account>/agents/<agent>)

   app.py renders an agent's own page inside a client account and loads this
   first, in the head, with the account's URL name (data-acct). Every call the
   page makes to this site then carries "X-Account: <name>", so the server saves
   a run it starts to the account (the whole team's) and lists the account's
   runs, not the person's own General ones (app.py _work_acct;
   docs/account-memory-plan.md). Calls to other sites are left alone.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var me = document.currentScript;
  var ACCT = me && me.getAttribute("data-acct");
  if (!ACCT || window.__acctContext) return;
  window.__acctContext = ACCT;

  function ours(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  if (window.fetch) {
    var fetch0 = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" || input instanceof URL ? String(input) : (input && input.url);
      if (url && ours(url)) {
        init = Object.assign({}, init || {});
        var h = new Headers(init.headers || (input && typeof input === "object" && input.headers) || undefined);
        h.set("X-Account", ACCT);
        init.headers = h;
      }
      return fetch0.call(this, input, init);
    };
  }

  if (window.XMLHttpRequest) {
    var open0 = XMLHttpRequest.prototype.open, send0 = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__acctOurs = ours(url);
      return open0.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__acctOurs) {
        try { this.setRequestHeader("X-Account", ACCT); } catch (e) { /* already sent */ }
      }
      return send0.apply(this, arguments);
    };
  }
})();
