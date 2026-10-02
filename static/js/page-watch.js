/* ════════════════════════════════════════════════════════════════════════
   PAGE WATCH — the agent page, a watch's page and a change's page.

   One script for the three pages; each part starts only when its root is
   on the page (#pw, #pw-watch, #pw-change). Every piece of text that came
   from a user or a watched web page is set with textContent, never as HTML.

   The parts shared by the add flow and a watch's page:
     Picker   the first reading's picture, with "pick an area" and "ignore
              an area" drawn by dragging (coordinates are page pixels)
     Form     name, client, schedule, the note for Claude, channel, what to
              compare; saves with PATCH
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var BASE = "/strategic-agents/page-watch";

  // ── Small helpers ─────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", cache: "no-store", headers: {} };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || ("The server said " + r.status + ".")); e.field = data.field; e.status = r.status; throw e; }
        return data;
      });
    });
  }
  function when(iso) { return iso ? new Date(iso) : null; }
  function rel(iso, future) {
    var d = when(iso); if (!d || isNaN(d)) return "";
    var s = Math.round((d - new Date()) / 1000), past = s < 0; s = Math.abs(s);
    var t = s < 45 ? "moments" : s < 5400 ? Math.round(s / 60) + " min" : s < 129600 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " days";
    if (t === "1 days") t = "1 day";
    if (t === "moments") return past ? "just now" : "any moment";
    return past ? t + " ago" : "in " + t;
  }
  function stamp(iso) {
    var d = when(iso); if (!d || isNaN(d)) return "";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function looksLikeLink(q) { return /^\S+\.\S+$/.test(q) && !/\s/.test(q); }
  function data() { try { return JSON.parse($("#pw-data").textContent); } catch (e) { return {}; } }

  // ── The settings form (add flow and a watch's page) ───────────────────
  var EVERY = [["hourly", "Every hour"], ["6h", "Every 6 hours"], ["daily", "Daily"], ["weekly", "Weekly"]];
  var NOTES = ["Only prices and plans matter.", "Tell me about new features or launches.",
    "Ignore blog and news updates.", "Any change to the headline or the offer."];

  function Form(root, values, opts) {
    var v = Object.assign({ schedule: { every: "daily", at: "09:00" }, watch_text: true, watch_visual: true }, values || {});
    var d = data(), days = d.days || ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    var names = d.dayNames || days;
    root.textContent = "";
    function field(label, input) { var f = el("label", "pw-field"); f.appendChild(el("span", null, label)); f.appendChild(input); root.appendChild(f); return input; }
    var name = field("Name", el("input")); name.value = v.name || ""; name.maxLength = 120; name.placeholder = "Vercel pricing";
    var client = field("Client or group", el("input")); client.value = v.client || ""; client.maxLength = 80; client.placeholder = "Optional";

    var sched = el("div", "pw-field"); sched.appendChild(el("span", null, "How often"));
    var seg = el("div", "pw-seg"); seg.setAttribute("role", "group");
    var row = el("div", "pw-row");
    var at = el("input"); at.type = "time"; at.value = (v.schedule && v.schedule.at) || "09:00"; at.setAttribute("aria-label", "Time, India");
    var day = el("select"); day.setAttribute("aria-label", "Day");
    days.forEach(function (k, i) { var o = el("option", null, names[i]); o.value = k; day.appendChild(o); });
    day.value = (v.schedule && v.schedule.day) || "mon";
    var tz = el("small", null, "India time");
    var every = (v.schedule && v.schedule.every) || "daily";
    EVERY.forEach(function (e) {
      var b = el("button", null, e[1]); b.type = "button"; b.dataset.every = e[0];
      b.setAttribute("aria-pressed", String(e[0] === every));
      b.addEventListener("click", function () { every = e[0]; $$("button", seg).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); sync(); });
      seg.appendChild(b);
    });
    row.appendChild(day); row.appendChild(at); row.appendChild(tz);
    function sync() { row.hidden = !(every === "daily" || every === "weekly"); day.hidden = every !== "weekly"; }
    sync(); sched.appendChild(seg); sched.appendChild(row); root.appendChild(sched);

    var note = field("What matters (Claude reads this)", el("textarea"));
    note.value = v.instructions || ""; note.maxLength = 1000; note.placeholder = "For example: only tell me about price or plan changes.";
    var ex = el("div", "pw-examples");
    NOTES.forEach(function (t) { var b = el("button", null, t); b.type = "button"; b.addEventListener("click", function () { note.value = t; note.focus(); }); ex.appendChild(b); });
    root.appendChild(ex);
    var channel = field("Slack channel for alerts", el("input")); channel.value = v.channel || ""; channel.placeholder = "#competitor-watch"; channel.maxLength = 80;

    var cmp = el("div", "pw-field"); cmp.appendChild(el("span", null, "Compare"));
    var crow = el("div", "pw-row");
    function check(label, on) { var l = el("label", "pw-check"); var i = el("input"); i.type = "checkbox"; i.checked = on; l.appendChild(i); l.appendChild(document.createTextNode(label)); crow.appendChild(l); return i; }
    var wt = check("The words", v.watch_text !== false), wv = check("How it looks", v.watch_visual !== false);
    cmp.appendChild(crow); root.appendChild(cmp);

    var err = el("p", "pw-form-err"); err.hidden = true; err.setAttribute("role", "alert"); root.appendChild(err);
    var actions = el("div", "pw-actions");
    var save = el("button", "sa-btn sa-btn--dark", opts.saveLabel || "Save"); save.type = "submit";
    actions.appendChild(save);
    if (opts.onDelete) {
      var del = el("button", "pw-link-btn", opts.deleteLabel || "Stop watching"); del.type = "button";
      del.addEventListener("click", opts.onDelete); actions.appendChild(del);
    }
    root.appendChild(actions);

    function collect() {
      var s = { every: every };
      if (every === "daily" || every === "weekly") s.at = at.value || "09:00";
      if (every === "weekly") s.day = day.value;
      return { name: name.value.trim(), client: client.value.trim(), schedule: s, instructions: note.value.trim(),
        channel: channel.value.trim(), watch_text: wt.checked, watch_visual: wv.checked };
    }
    root.addEventListener("submit", function (e) {
      e.preventDefault(); err.hidden = true;
      if (!wt.checked && !wv.checked) { err.textContent = "Compare the words, how it looks, or both."; err.hidden = false; return; }
      save.disabled = true;
      Promise.resolve(opts.onSave(collect())).catch(function (x) { err.textContent = x.message; err.hidden = false; })
        .then(function () { save.disabled = false; });
    });
    return { values: collect, error: function (m) { err.textContent = m; err.hidden = !m; } };
  }

  // ── The picker: area and ignored areas on the first reading ───────────
  function Picker(canvas, preview, opts) {
    var state = { mode: "all", area: null, ignore: (opts.ignore || []).map(function (r) { return r.slice(); }) };
    var pageW = preview.width || 1440;
    canvas.textContent = "";
    var img = el("img"); img.alt = "The page as it was read"; img.src = preview.shot; img.draggable = false;
    canvas.appendChild(img);
    var layer = el("div"); layer.style.position = "absolute"; layer.style.inset = "0"; canvas.appendChild(layer);
    if (opts.areaSelector && preview.area_box) {
      state.area = { selector: opts.areaSelector, box: preview.area_box, label: opts.areaLabel || "The watched area" };
    }
    function scale() { return canvas.clientWidth / pageW; }
    function place(n, r) {
      var k = scale();
      n.style.left = (r[0] * k) + "px"; n.style.top = (r[1] * k) + "px";
      n.style.width = Math.max(2, r[2] * k) + "px"; n.style.height = Math.max(2, r[3] * k) + "px";
    }
    function draw() {
      layer.textContent = "";
      if (state.area) {
        var a = el("div", "pw-rect pw-rect--area"); place(a, state.area.box);
        a.appendChild(el("b", null, state.area.label || "The watched area")); layer.appendChild(a);
      }
      state.ignore.forEach(function (r, i) {
        var n = el("div", "pw-rect pw-rect--ignore"); n.title = "Click to stop ignoring this area"; place(n, r);
        n.addEventListener("click", function (e) { e.stopPropagation(); state.ignore.splice(i, 1); draw(); emit(); });
        layer.appendChild(n);
      });
    }
    function emit() { if (opts.onChange) opts.onChange(state); }
    img.addEventListener("load", draw);
    window.addEventListener("resize", draw);

    var start = null, draft = null;
    function pt(e) { var b = canvas.getBoundingClientRect(), k = scale(); return [(e.clientX - b.left) / k, (e.clientY - b.top) / k]; }
    canvas.addEventListener("pointerdown", function (e) {
      if (state.mode === "all" || e.button !== 0) return;
      start = pt(e); draft = el("div", "pw-rect pw-rect--draft"); layer.appendChild(draft);
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!start) return; var p = pt(e);
      place(draft, [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.abs(p[0] - start[0]), Math.abs(p[1] - start[1])]);
    });
    canvas.addEventListener("pointerup", function (e) {
      if (!start) return; var p = pt(e);
      var r = [Math.round(Math.min(start[0], p[0])), Math.round(Math.min(start[1], p[1])),
        Math.round(Math.abs(p[0] - start[0])), Math.round(Math.abs(p[1] - start[1]))];
      start = null; if (draft) draft.remove(); draft = null;
      if (r[2] < 12 || r[3] < 12) return;
      if (state.mode === "ignore") { state.ignore.push(r); draw(); emit(); return; }
      if (opts.help) opts.help("Finding the part of the page you drew round…");
      api("POST", BASE + "/api/watches/" + opts.id + "/area", { rect: r }).then(function (res) {
        state.area = res.area; draw(); emit();
        if (opts.help) opts.help("Watching “" + (res.area.label || "this area") + "” (" + res.area.blocks + " lines of text). Drag again to change it.");
      }).catch(function (x) { if (opts.help) opts.help(x.message); });
    });
    return {
      mode: function (m) {
        state.mode = m; canvas.classList.toggle("is-drawing", m !== "all");
        if (m === "all") { state.area = null; draw(); emit(); }
      },
      state: state
    };
  }

  function bindTools(root, picker, help) {
    var texts = {
      all: "Watching everything on the page. To watch one part, choose Pick an area and drag a box round it.",
      area: "Drag a box round the part to watch, such as the pricing table. It is found again on every visit, even if it moves.",
      ignore: "Drag a box round anything to leave out: a rotating banner, a live counter. Click a red box to remove it."
    };
    $$("[data-pw-mode]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-pw-mode]", root).forEach(function (x) { x.classList.toggle("is-on", x === b); });
        picker.mode(b.dataset.pwMode); help(texts[b.dataset.pwMode]);
      });
    });
  }

  function facts(list, p) {
    list.textContent = "";
    function add(label, value) { var li = el("li"); li.appendChild(document.createTextNode(label + " ")); li.appendChild(el("b", null, value)); list.appendChild(li); }
    if (p.title) add("Title", p.title);
    add("Read", (p.words || 0).toLocaleString() + " words");
    if (p.final_url && p.final_url !== p.url) add("Ends up at", p.final_url);
    if (p.engine === "http") add("Read", "without a browser (text only)");
    (p.hidden || []).slice(0, 3).forEach(function (h) { add("Hidden", h); });
  }

  // ═════════════════════════════════════════════════════════════════════
  // THE AGENT PAGE
  // ═════════════════════════════════════════════════════════════════════
  function agentPage() {
    var root = $("#pw"); if (!root) return;
    var D = data(), board = D.board || { watches: [], counts: {} }, status = D.status || {};
    var filter = "all", grid = $("#pw-grid"), empty = $("#pw-empty");

    // ── Dashboard ──
    var CLASS = { ok: "ok", changed: "changed", error: "error", blocked: "blocked", pending: "pending", paused: "paused" };
    function card(w) {
      var a = el("a", "pw-card"); a.href = w.url_page; a.dataset.id = w.id;
      var th = el("div", "pw-thumb");
      if (w.thumb) { var im = el("img"); im.src = w.thumb; im.alt = ""; im.loading = "lazy"; th.appendChild(im); }
      else th.appendChild(el("span", "pw-thumb-empty", w.state === "pending" ? "Reading the page…" : "No picture yet"));
      var st = el("span", "pw-state pw-state--" + (CLASS[w.state] || "ok")); st.appendChild(el("i")); st.appendChild(document.createTextNode(w.state_label));
      th.appendChild(st);
      if (w.pending) th.appendChild(el("span", "pw-pending", "Checking again"));
      a.appendChild(th);
      var body = el("div", "pw-card-body");
      body.appendChild(el("div", "pw-card-name", w.name));
      var site = el("div", "pw-card-site");
      if (w.client) site.appendChild(el("span", "pw-client", w.client));
      site.appendChild(el("span", null, w.site));
      if (w.area) site.appendChild(el("span", null, "· " + w.area));
      body.appendChild(site);
      if (w.problem) body.appendChild(el("p", "pw-problem", w.state === "blocked" ? "The site shows a bot check." : "The page could not be read (" + w.problem + ")."));
      if (w.latest) {
        var v = el("div", "pw-verdict");
        var imp = el("span", "pw-imp pw-imp--" + (w.latest.muted ? "muted" : w.latest.importance), w.latest.importance_label);
        v.appendChild(imp); v.appendChild(el("p", null, w.latest.summary)); body.appendChild(v);
      } else if (w.state !== "pending") {
        body.appendChild(el("p", "pw-quiet", "No changes since it was added."));
      }
      var strip = el("div", "pw-strip"); strip.setAttribute("role", "img");
      strip.setAttribute("aria-label", "Last " + w.strip.length + " checks");
      for (var i = 0; i < 30 - w.strip.length; i++) strip.appendChild(el("i"));
      w.strip.forEach(function (c) { var t = el("i", "o-" + c.o); t.title = c.label + (c.at ? " · " + stamp(c.at) : ""); strip.appendChild(t); });
      body.appendChild(strip);
      var foot = el("div", "pw-card-foot");
      foot.appendChild(el("span", null, w.schedule));
      foot.appendChild(el("span", null, w.state === "paused" ? "Paused" : (w.last_check_at ? "Checked " + rel(w.last_check_at) : "Not checked yet")));
      body.appendChild(foot);
      a.appendChild(body);
      return a;
    }
    function matches(w) {
      var q = ($("#pw-find").value || "").trim().toLowerCase(), c = $("#pw-client").value;
      if (filter === "problem" && !(w.state === "error" || w.state === "blocked")) return false;
      if (filter !== "all" && filter !== "problem" && w.state !== filter) return false;
      if (c && w.client !== c) return false;
      if (q && (w.name + " " + w.url + " " + w.client + " " + (w.latest ? w.latest.summary : "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }
    function render(highlight) {
      grid.textContent = "";
      var shown = board.watches.filter(matches);
      shown.forEach(function (w) { var c = card(w); if (w.id === highlight) c.classList.add("is-new"); grid.appendChild(c); });
      empty.hidden = shown.length > 0;
      if (!board.watches.length) { $("#pw-empty-h").textContent = "Nothing watched yet."; }
      else if (!shown.length) { $("#pw-empty-h").textContent = "No watches match."; $("#pw-empty-p").textContent = "Try another filter or search."; }
      var n = board.counts || {};
      $$("[data-n]").forEach(function (b) {
        var k = b.dataset.n;
        b.textContent = String(k === "problem" ? (n.error || 0) + (n.blocked || 0) : (n[k] || 0));
      });
      $("#pw-f-watching").textContent = String(n.all || 0);
      $("#pw-f-changed").textContent = String(n.changed || 0);
      $("#pw-f-errors").textContent = String((n.error || 0) + (n.blocked || 0));
    }
    $$("[data-pw-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.pwFilter;
        $$("[data-pw-filter]").forEach(function (x) { x.classList.toggle("is-on", x === b); x.setAttribute("aria-checked", String(x === b)); });
        render();
      });
    });
    $("#pw-find").addEventListener("input", function () { render(); });
    $("#pw-client").addEventListener("change", function () { render(); });
    function refresh(highlight) {
      return api("GET", BASE + "/api/watches").then(function (b) { board = b; render(highlight); }).catch(function () {});
    }
    render();
    // Keep the cards current: faster while something is being read.
    (function tick() {
      var busy = board.watches.some(function (w) { return w.state === "pending" || w.pending; });
      setTimeout(function () { if (!document.hidden) refresh(); tick(); }, busy ? 8000 : 30000);
    })();

    // ── Adding a page ──
    var add = $("#pw-add"), errBox = $("#pw-error"), current = null, poll = null;
    function step(name, heading, label) {
      add.hidden = false;
      ["find", "read", "set"].forEach(function (s) { $("#pw-step-" + s).hidden = s !== name; });
      var order = ["find", "read", "set"], at = order.indexOf(name);
      $$(".pw-steps li").forEach(function (li) {
        var i = order.indexOf(li.dataset.step);
        li.classList.toggle("is-on", i === at); li.classList.toggle("is-done", i < at);
      });
      $("#pw-add-h").textContent = heading; if (label) $("#pw-add-lbl").textContent = label;
    }
    function fail(m) { errBox.textContent = m; errBox.hidden = !m; }
    $("#pw-ask").addEventListener("submit", function (e) {
      e.preventDefault(); fail("");
      var q = $("#pw-q").value.trim(); if (!q) { fail("Paste a link or type the name of a page."); return; }
      var go = $("#pw-go"); go.disabled = true;
      var done = function () { go.disabled = false; };
      if (looksLikeLink(q)) { create({ url: q }).then(done, done); return; }
      step("find", "Looking for “" + q + "”…", "New watch");
      $("#pw-cands").textContent = "";
      add.scrollIntoView({ behavior: "smooth", block: "start" });
      api("POST", BASE + "/api/find", { query: q }).then(function (r) {
        done();
        if (r.error && !(r.candidates || []).length) { add.hidden = true; fail(r.error); return; }
        $("#pw-add-h").textContent = "Which of these is it?";
        r.candidates.forEach(function (c) {
          var b = el("button", "pw-cand"); b.type = "button";
          b.appendChild(el("b", null, c.title || c.url)); b.appendChild(el("code", null, c.url)); if (c.why) b.appendChild(el("span", null, c.why));
          b.addEventListener("click", function () { create({ url: c.url, name: c.title || "" }); });
          $("#pw-cands").appendChild(b);
        });
      }).catch(function (x) { done(); add.hidden = true; fail(x.message); });
    });

    function create(body) {
      return api("POST", BASE + "/api/watches", body).then(function (r) {
        current = r.id; $("#pw-q").value = "";
        reading(r.id); refresh(r.id);
      }).catch(function (x) { add.hidden = true; fail(x.message); });
    }

    function reading(id) {
      step("read", "Reading the page…", "New watch");
      add.scrollIntoView({ behavior: "smooth", block: "start" });
      var phases = $$("#pw-phases li"), t0 = Date.now(), note = $("#pw-wait-note");
      note.hidden = true;
      clearInterval(poll);
      poll = setInterval(function () {
        var s = (Date.now() - t0) / 1000;
        var at = Math.min(phases.length - 1, Math.floor(s / 6));
        phases.forEach(function (li, i) { li.classList.toggle("is-on", i === at); li.classList.toggle("is-done", i < at); });
        if (s > 12 && ["ok", "idle", "behind"].indexOf((status || {}).worker) < 0) {
          note.textContent = "The checker is not running yet, so the page cannot be read now. The watch is saved and will be read as soon as the worker service starts (setup: docs/page-watch-plan.md, section 6).";
          note.hidden = false;
        }
        if (Math.round(s) % 2 !== 0) return;
        api("GET", BASE + "/api/watches/" + id + "/preview").then(function (p) {
          if (p.error) { clearInterval(poll); problem(id, p.error); return; }
          if (p.ready) { clearInterval(poll); setup(id, p); }
        }).catch(function () {});
      }, 1000);
    }

    function problem(id, e) {
      step("read", e.kind === "blocked" ? "The site showed a bot check." : "The page could not be read.", "New watch");
      var note = $("#pw-wait-note");
      note.textContent = (e.detail || "") + " You can try again, or remove this watch.";
      note.hidden = false;
      var row = el("div", "pw-actions");
      var again = el("button", "sa-btn sa-btn--dark", "Try again"); again.type = "button";
      again.addEventListener("click", function () { api("POST", BASE + "/api/watches/" + id + "/check", {}).then(function () { row.remove(); reading(id); }); });
      var drop = el("button", "pw-link-btn", "Remove it"); drop.type = "button";
      drop.addEventListener("click", function () { api("DELETE", BASE + "/api/watches/" + id, {}).then(function () { add.hidden = true; refresh(); }); });
      row.appendChild(again); row.appendChild(drop); note.after(row);
    }

    function setup(id, p) {
      step("set", "Is this the page?", "Looks right?");
      facts($("#pw-facts"), p);
      var help = function (m) { $("#pw-tool-help").textContent = m; };
      var picker = Picker($("#pw-canvas"), p, { id: id, ignore: [], help: help });
      bindTools($("#pw-step-set"), picker, help);
      Form($("#pw-form"), { name: p.name || p.title || "" }, {
        saveLabel: "Start watching",
        deleteLabel: "Not this page, remove it",
        onSave: function (vals) {
          var s = picker.state;
          vals.area_selector = s.area ? s.area.selector : "";
          vals.area_label = s.area ? s.area.label : "";
          vals.ignore = s.ignore;
          return api("PATCH", BASE + "/api/watches/" + id, vals).then(function (r) {
            add.hidden = true; current = null;
            fail(""); refresh(id);
            $("#pw-grid").scrollIntoView({ behavior: "smooth", block: "start" });
            if (r.restarted) { /* the chosen area is read afresh by the worker */ }
          });
        },
        onDelete: function () {
          api("DELETE", BASE + "/api/watches/" + id, {}).then(function () { add.hidden = true; current = null; refresh(); });
        }
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // A WATCH'S PAGE
  // ═════════════════════════════════════════════════════════════════════
  function watchPage() {
    var root = $("#pw-watch"); if (!root) return;
    var w = data().watch || {};
    var id = w.id;
    function note(m) { var n = $("#pw-watch-msg"); n.textContent = m; n.hidden = !m; }
    $("#pw-check-now") && $("#pw-check-now").addEventListener("click", function () {
      api("POST", BASE + "/api/watches/" + id + "/check", {}).then(function () { note("Checking now. Refresh in a minute to see the result."); }).catch(function (x) { note(x.message); });
    });
    $("#pw-pause") && $("#pw-pause").addEventListener("click", function () {
      var on = w.status === "paused";
      api("PATCH", BASE + "/api/watches/" + id, { status: on ? "active" : "paused" }).then(function () { location.reload(); }).catch(function (x) { note(x.message); });
    });
    $$("[data-pw-mute]").forEach(function (b) {
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") !== "true";
        api("POST", BASE + "/api/watches/" + id + "/mute", { category: b.dataset.pwMute, on: on }).then(function () { b.setAttribute("aria-pressed", String(on)); }).catch(function (x) { note(x.message); });
      });
    });
    var form = $("#pw-watch-form");
    if (form) {
      var picker = null;
      Form(form, w, {
        saveLabel: "Save changes",
        onSave: function (vals) {
          if (picker) {
            vals.area_selector = picker.state.area ? picker.state.area.selector : "";
            vals.area_label = picker.state.area ? picker.state.area.label : "";
            vals.ignore = picker.state.ignore;
          }
          return api("PATCH", BASE + "/api/watches/" + id, vals).then(function (r) {
            note(r.restarted ? "Saved. What is watched changed, so it starts again from a new first look." : "Saved.");
          });
        },
        onDelete: function () {
          if (!window.confirm("Stop watching this page and delete its history?")) return;
          api("DELETE", BASE + "/api/watches/" + id, {}).then(function () { location.href = BASE; });
        }
      });
      var open = $("#pw-open-picker");
      if (open) open.addEventListener("click", function () {
        open.disabled = true;
        api("GET", BASE + "/api/watches/" + id + "/preview").then(function (p) {
          if (!p.ready) { note(p.reading ? "The page is being read right now. Try again in a few seconds." : "The page has not been read yet."); open.disabled = false; return; }
          $("#pw-picker").hidden = false;
          facts($("#pw-facts"), p);
          var help = function (m) { $("#pw-tool-help").textContent = m; };
          picker = Picker($("#pw-canvas"), p, { id: id, ignore: w.ignore || [], areaSelector: w.area_selector,
            areaLabel: w.area, help: help });
          bindTools($("#pw-picker"), picker, help);
          if (w.area_selector) $$("[data-pw-mode]").forEach(function (x) { x.classList.toggle("is-on", x.dataset.pwMode === "area"); });
          open.hidden = true;
        });
      });
    }
    $$("time[data-rel]").forEach(function (t) { t.textContent = rel(t.getAttribute("datetime")); t.title = stamp(t.getAttribute("datetime")); });
  }

  // ═════════════════════════════════════════════════════════════════════
  // A CHANGE'S PAGE
  // ═════════════════════════════════════════════════════════════════════
  function changePage() {
    var root = $("#pw-change"); if (!root) return;
    var c = data().change || {};
    // Feedback
    $$("[data-pw-fb]").forEach(function (b) {
      b.addEventListener("click", function () {
        api("POST", BASE + "/api/changes/" + c.id + "/feedback", { kind: b.dataset.pwFb }).then(function () {
          $$("[data-pw-fb]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          $("#pw-fb-msg").textContent = b.dataset.pwFb === "mute" ? "Muted: changes of this kind on this page will not be alerted." : "Thanks. Claude will take this into account next time.";
        }).catch(function (x) { $("#pw-fb-msg").textContent = x.message; });
      });
    });
    // Boxes on a layer
    function boxes(layer, list, w) {
      list.forEach(function (r) {
        var n = el("div", "pw-rect pw-rect--change");
        n.style.left = (100 * r[0] / w) + "%"; n.style.width = (100 * r[2] / w) + "%";
        n.dataset.y = r[1]; n.dataset.h = r[3]; layer.appendChild(n);
      });
    }
    function placeY(layer, img) {
      var k = img.clientWidth / (img.naturalWidth || 1);
      $$(".pw-rect--change", layer).forEach(function (n) { n.style.top = (n.dataset.y * k) + "px"; n.style.height = Math.max(4, n.dataset.h * k) + "px"; });
    }
    // Slider
    var slider = $("#pw-slider");
    if (slider && c.before.shot && c.after.shot) {
      var inner = $(".pw-slider-in", slider), lb = $(".pw-layer--before", slider), la = $(".pw-layer--after", slider);
      var ib = $("img", lb), ia = $("img", la);
      boxes(lb, c.boxes_before, c.before.width || 1440); boxes(la, c.boxes_after, c.after.width || 1440);
      function size() {
        inner.style.height = Math.max(ib.clientHeight, ia.clientHeight) + "px";
        placeY(lb, ib); placeY(la, ia);
      }
      ib.addEventListener("load", size); ia.addEventListener("load", size); window.addEventListener("resize", size);
      var grip = $(".pw-grip", slider), dragging = false;
      function setCut(x) { var b = inner.getBoundingClientRect(); var p = Math.max(0, Math.min(100, 100 * (x - b.left) / b.width)); inner.style.setProperty("--cut", p + "%"); grip.setAttribute("aria-valuenow", String(Math.round(p))); }
      grip.addEventListener("pointerdown", function (e) { dragging = true; grip.setPointerCapture(e.pointerId); });
      grip.addEventListener("pointermove", function (e) { if (dragging) setCut(e.clientX); });
      grip.addEventListener("pointerup", function () { dragging = false; });
      inner.addEventListener("click", function (e) { if (e.target !== grip) setCut(e.clientX); });
      grip.addEventListener("keydown", function (e) {
        var now = parseFloat(inner.style.getPropertyValue("--cut")) || 50;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); inner.style.setProperty("--cut", Math.max(0, Math.min(100, now + (e.key === "ArrowLeft" ? -5 : 5))) + "%"); }
      });
      // Open at the first change.
      var first = (c.boxes_after[0] || c.boxes_before[0]);
      if (first) ia.addEventListener("load", function () { slider.scrollTop = Math.max(0, first[1] * ia.clientWidth / (ia.naturalWidth || 1) - 120); }, { once: true });
    }
    // Side by side
    $$(".pw-side figure").forEach(function (f) {
      var img = $("img", f), layer = $(".pw-side-layer", f), which = f.dataset.side;
      if (!img || !layer) return;
      boxes(layer, which === "before" ? c.boxes_before : c.boxes_after, (which === "before" ? c.before.width : c.after.width) || 1440);
      var fit = function () { placeY(layer, img); };
      img.addEventListener("load", fit); window.addEventListener("resize", fit);
    });
    // View switch
    $$("[data-pw-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-pw-view]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        $$("[data-pw-pane]").forEach(function (p) { p.hidden = p.dataset.pwPane !== b.dataset.pwView; });
        window.dispatchEvent(new Event("resize"));
      });
    });
    $$("time[data-rel]").forEach(function (t) { t.textContent = rel(t.getAttribute("datetime")); t.title = stamp(t.getAttribute("datetime")); });
  }

  function start() { agentPage(); watchPage(); changePage(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
