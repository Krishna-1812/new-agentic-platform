/* ════════════════════════════════════════════════════════════════════════
   SHARE AN ACCOUNT — who outside the agency can open it, and what they see

   The dialog on an account's home ([data-share-open]). Admins invite an email
   or a whole company domain, remove people, and choose which of the account's
   pages its clients see; other staff see the same panel read-only. Every change
   is a POST to /<account>/api/access... with the X-Requested-With header the
   server requires (app.py, _acct_admin_guard). textContent only.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var dlg = document.getElementById("sh-dlg");
  if (!dlg) return;
  var slug = dlg.getAttribute("data-slug"), API = "/" + slug + "/api/access";
  var $ = function (id) { return document.getElementById(id); };
  var state = null, busy = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function msg(text, bad) {
    var m = $("sh-msg");
    m.textContent = text || "";
    m.classList.toggle("is-bad", !!bad);
  }
  function send(url, body) {
    var opts = { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } };
    if (body) {
      opts.method = "POST";
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "The server did not answer properly (" + r.status + ")." }; });
    }).catch(function () { return { ok: false, error: "No connection. Try again." }; });
  }

  /* ── Drawing ──────────────────────────────────────────────────────── */
  var VERB = { invited: "invited", removed: "removed", shared: "shared", unshared: "stopped sharing" };
  var SHARE_LABEL = { "google-ads": "the Google Ads dashboard", "ai-review": "the AI review", profile: "the profile" };

  function draw(d) {
    state = d;
    var can = !!d.can_change;
    dlg.classList.toggle("is-readonly", !can);
    $("sh-add").hidden = !can;

    var ul = $("sh-people");
    clear(ul);
    if (!d.people.length) {
      var empty = el("li", "sh-empty");
      empty.appendChild(el("b", "", "Only your team can see this account."));
      empty.appendChild(el("span", "", can ? "Invite someone from the client to give them their own view." :
                                              "An admin can invite the client."));
      ul.appendChild(empty);
    }
    d.people.forEach(function (p) {
      var li = el("li", "sh-person");
      var av = el("span", "sh-av" + (p.kind === "domain" ? " is-domain" : ""), p.kind === "domain" ? "@" : p.who.charAt(0).toUpperCase());
      li.appendChild(av);
      var t = el("span", "sh-person-t");
      t.appendChild(el("b", "", p.kind === "domain" ? "Everyone at " + p.who.slice(1) : p.who));
      t.appendChild(el("small", "", "Added" + (p.added_by ? " by " + p.added_by : "") + (p.added_at ? " on " + when(p.added_at) : "")));
      li.appendChild(t);
      if (can) {
        var rm = el("button", "sh-rm", "Remove");
        rm.type = "button";
        rm.setAttribute("aria-label", "Remove " + p.who);
        rm.addEventListener("click", function () { remove(p.who, li); });
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });

    var sh = $("sh-shares");
    clear(sh);
    d.shares.forEach(function (x) {
      var li = el("li", "sh-share");
      var lab = el("label", "sh-share-l");
      var t = el("span", "sh-share-t");
      t.appendChild(el("b", "", x.label));
      t.appendChild(el("small", "", x.about));
      lab.appendChild(t);
      var sw = el("input", "sh-switch");
      sw.type = "checkbox";
      sw.setAttribute("role", "switch");
      sw.checked = !!x.on;
      sw.disabled = !can;
      sw.addEventListener("change", function () { toggle(x.key, sw); });
      lab.appendChild(sw);
      li.appendChild(lab);
      sh.appendChild(li);
    });

    $("sh-link").textContent = d.link;
    var log = $("sh-log");
    clear(log);
    $("sh-log-box").hidden = !d.audit.length;
    d.audit.forEach(function (a) {
      var what = a.action === "shared" || a.action === "unshared" ? (SHARE_LABEL[a.detail] || a.detail) : a.detail;
      log.appendChild(el("li", "", when(a.at) + " · " + (a.actor || "someone") + " " + (VERB[a.action] || a.action) + " " + what));
    });
  }

  /* ── Changes ──────────────────────────────────────────────────────── */
  function invite(e) {
    e.preventDefault();
    var inp = $("sh-who"), who = inp.value.trim();
    if (!who || busy) return;
    busy = true;
    msg("Adding…");
    send(API, { who: who }).then(function (d) {
      busy = false;
      if (!d.ok) { msg(d.error || "That could not be added.", true); return; }
      inp.value = "";
      draw(d);
      msg("Added. Send them the link below; they sign in with Google as that address.");
    });
  }

  function remove(who, li) {
    if (busy || !window.confirm("Remove " + who + "? They lose access at once.")) return;
    busy = true;
    li.classList.add("is-going");
    send(API + "/remove", { who: who }).then(function (d) {
      busy = false;
      if (!d.ok) { li.classList.remove("is-going"); msg(d.error || "That could not be removed.", true); return; }
      draw(d);
      msg("Removed.");
    });
  }

  function toggle(key, sw) {
    sw.disabled = true;
    send(API + "/share", { share: key, on: sw.checked }).then(function (d) {
      if (!d.ok) { sw.checked = !sw.checked; sw.disabled = false; msg(d.error || "That could not be changed.", true); return; }
      draw(d);
      msg("");
    });
  }

  function copy() {
    var b = $("sh-copy"), label = b.querySelector("span"), was = label.textContent;
    function done(ok) {
      label.textContent = ok ? "Copied" : "Select the link and copy it";
      b.classList.toggle("is-done", ok);
      setTimeout(function () { label.textContent = was; b.classList.remove("is-done"); }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && state) {
      navigator.clipboard.writeText(state.link).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  }

  /* ── Open and close ───────────────────────────────────────────────── */
  function open() {
    msg("Loading…");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    send(API).then(function (d) {
      if (!d.ok) { msg(d.error || "This could not be read.", true); return; }
      msg("");
      draw(d);
      if (d.can_change) setTimeout(function () { $("sh-who").focus(); }, 60);
    });
  }
  function close() { if (dlg.open) dlg.close(); }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-share-open]")) { e.preventDefault(); open(); }
    else if (e.target.closest("[data-share-close]")) close();
  });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });   // the backdrop
  $("sh-add").addEventListener("submit", invite);
  $("sh-copy").addEventListener("click", copy);
})();
