/* ════════════════════════════════════════════════════════════════════════
   SHARE AN ACCOUNT — who outside the agency can open it, and what they see

   The dialog on an account's home ([data-share-open]). Admins invite an email
   or a whole company domain, remove people, choose which of the account's
   pages its clients see and which agents and tools they may use (a tile each,
   grouped, with All / None per group), and set the runs a month they may
   start; other staff see the same panel read-only. Every change is a POST to
   /<account>/api/access... with the X-Requested-With header the server
   requires (app.py, _acct_admin_guard). textContent only; the tools' icons are
   cloned from the <template> the page renders.
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
  var ICONS = {};
  (function () {
    var t = document.getElementById("sh-icons");
    if (!t || !t.content) return;
    Array.prototype.forEach.call(t.content.querySelectorAll("[data-icon]"), function (n) {
      ICONS[n.getAttribute("data-icon")] = n.querySelector("svg");
    });
  })();
  function icon(slug) {
    var src = ICONS[slug];
    return src ? src.cloneNode(true) : null;
  }
  function label(key) {
    if (SHARE_LABEL[key]) return SHARE_LABEL[key];
    var t = state && (state.tools || []).filter(function (x) { return x.key === key; })[0];
    return t ? t.label : key;
  }

  function draw(d) {
    state = d;
    var can = !!d.can_change;
    dlg.classList.toggle("is-readonly", !can);
    $("sh-add").hidden = !can;

    $("sh-people-n").textContent = d.people.length ? d.people.length + (d.people.length === 1 ? " person" : " people") : "";
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

    drawTools(d, can);
    drawLimit(d, can);

    $("sh-link").textContent = d.link;
    var log = $("sh-log");
    clear(log);
    $("sh-log-box").hidden = !d.audit.length;
    d.audit.forEach(function (a) {
      var line;
      if (a.action === "set") line = "set the runs a month to " + String(a.detail).split("=")[1];
      else line = (VERB[a.action] || a.action) + " " +
        (a.action === "shared" || a.action === "unshared" ? label(a.detail) : a.detail);
      var li = el("li");
      li.appendChild(el("span", "sh-log-at", when(a.at)));
      li.appendChild(el("span", "", (a.actor || "someone") + " " + line));
      log.appendChild(li);
    });
  }

  /* The tools, a tile each, grouped; a group's switch turns all of it on or off. */
  function drawTools(d, can) {
    var box = $("sh-tools");
    clear(box);
    var tools = d.tools || [];
    var on = tools.filter(function (t) { return t.on; }).length;
    $("sh-tools-n").textContent = on + " of " + tools.length + " on";
    (d.groups || []).forEach(function (g) {
      var mine = tools.filter(function (t) { return t.group === g.key; });
      if (!mine.length) return;
      var n = mine.filter(function (t) { return t.on; }).length;
      var sec = el("div", "sh-grp");
      var head = el("div", "sh-grp-h");
      head.appendChild(el("span", "sh-grp-t", g.label));
      head.appendChild(el("span", "sh-grp-n", n + " of " + mine.length));
      if (can) {
        var all = el("button", "sh-grp-all", n === mine.length ? "None" : "All");
        all.type = "button";
        all.setAttribute("aria-label", (n === mine.length ? "Turn off every " : "Turn on every ") + g.label + " tool");
        all.addEventListener("click", function () {
          var want = n !== mine.length, body = {};
          mine.forEach(function (t) { body[t.key] = want; });
          all.disabled = true;
          sec.classList.add("is-busy");
          send(API + "/share", { shares: body }).then(function (r) {
            if (!r.ok) { all.disabled = false; sec.classList.remove("is-busy"); msg(r.error || "That could not be changed.", true); return; }
            draw(r);
          });
        });
        head.appendChild(all);
      }
      sec.appendChild(head);
      var grid = el("ul", "sh-tiles");
      mine.forEach(function (t) {
        var li = el("li", "sh-tile-c");
        var lab = el("label", "sh-tool sh-tool--" + t.slug + (t.on ? " is-on" : ""));
        var chk = el("input", "sh-tool-in");
        chk.type = "checkbox";
        chk.checked = !!t.on;
        chk.disabled = !can;
        chk.setAttribute("aria-label", t.label);
        var ico = el("span", "sh-tool-ico");
        var svg = icon(t.slug);
        if (svg) ico.appendChild(svg);
        var tx = el("span", "sh-tool-t");
        tx.appendChild(el("b", "", t.label));
        tx.appendChild(el("small", "", t.about));
        var tick = el("span", "sh-tool-tick");
        tick.appendChild(svgTick());
        lab.appendChild(chk);
        lab.appendChild(ico);
        lab.appendChild(tx);
        lab.appendChild(tick);
        chk.addEventListener("change", function () {
          lab.classList.toggle("is-on", chk.checked);
          chk.disabled = true;
          send(API + "/share", { share: t.key, on: chk.checked }).then(function (r) {
            if (!r.ok) { chk.checked = !chk.checked; lab.classList.toggle("is-on", chk.checked); chk.disabled = false;
                         msg(r.error || "That could not be changed.", true); return; }
            draw(r);
          });
        });
        li.appendChild(lab);
        grid.appendChild(li);
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    });
  }
  function svgTick() {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    p.setAttribute("d", "m5 12.5 4.5 4.5L19 7.5");
    svg.appendChild(p);
    return svg;
  }

  /* Runs a month: a stepper, saved a moment after the last change. */
  var limitTimer = null;
  function drawLimit(d, can) {
    var inp = $("sh-limit");
    if (document.activeElement !== inp) inp.value = d.limit;
    inp.disabled = !can;
    inp.max = d.limit_max;
    $("sh-limit-dn").disabled = $("sh-limit-up").disabled = !can;
    var pct = d.limit ? Math.min(100, Math.round(100 * d.used / d.limit)) : (d.used ? 100 : 0);
    var bar = $("sh-meter");
    bar.style.width = pct + "%";
    bar.classList.toggle("is-full", d.limit > 0 ? d.used >= d.limit : true);
    $("sh-used").textContent = d.limit === 0 ? "Running is off: they can look, not start anything." :
      d.used + " of " + d.limit + " used this month" + (d.used >= d.limit ? ". They cannot start more until the 1st." : ".");
  }
  function setLimit(n) {
    var inp = $("sh-limit"), max = (state && state.limit_max) || 500;
    n = Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
    inp.value = n;
    clearTimeout(limitTimer);
    limitTimer = setTimeout(function () {
      send(API + "/limit", { limit: n }).then(function (r) {
        if (!r.ok) { msg(r.error || "That could not be saved.", true); return; }
        draw(r);
        msg("Saved: " + n + " runs a month.");
      });
    }, 450);
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
  $("sh-limit-dn").addEventListener("click", function () { setLimit(Number($("sh-limit").value) - 5); });
  $("sh-limit-up").addEventListener("click", function () { setLimit(Number($("sh-limit").value) + 5); });
  $("sh-limit").addEventListener("change", function () { setLimit($("sh-limit").value); });
})();
