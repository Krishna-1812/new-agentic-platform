/* Google Ads AI review (/dashboards/google-ads/ai-review).
 *
 * Per account: the brief (edit, upload, save as a new version), the list of reviews, and one review at a
 * time, either in progress (polled every few seconds) or finished (drawn from its JSON report). Every
 * piece of text from the server or from Claude goes in with textContent, never as HTML.
 */
(function () {
  "use strict";
  var API = "/api/dashboards/google-ads/ai";
  var DATA = JSON.parse(document.getElementById("gar-data").textContent || "{}");
  var STAGES = [["pack", "Reading every campaign in the account"], ["targets", "Reading the brief"],
                ["checks", "Measuring the brief's targets"], ["analysis", "Writing the review (thinking; a few minutes)"]];
  var $ = function (id) { return document.getElementById(id); };
  var state = { account: $("gar-account") ? $("gar-account").value : "", brief: null, saved: "", reviews: [],
                shown: null, poll: null, seq: 0 };

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
    if (isNaN(d)) return iso;
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function day(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  function send(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-Requested-With": "fetch" }, opts.headers || {});
    opts.credentials = "same-origin";
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "The server did not answer properly (" + r.status + ")." }; })
        .then(function (j) { if (!r.ok && j.ok !== false) j.ok = false; return j; });
    });
  }
  function msg(text, bad) {
    var m = $("gar-brief-msg");
    m.textContent = text || "";
    m.classList.toggle("is-bad", !!bad);
  }

  // ── Status words and colours ───────────────────────────────────────────
  var TONE = {
    met: "good", followed: "good", scale: "good", keep: "good", on_track: "good", complete: "good",
    at_risk: "warn", partly: "warn", watch: "warn", fix: "warn", restructure: "warn", needs_attention: "warn",
    off_track: "bad", not_followed: "bad", pause: "bad", failed: "bad",
    running: "run", queued: "run"
  };
  var WORD = {
    met: "Met", at_risk: "At risk", off_track: "Off track", cannot_verify: "Cannot verify",
    followed: "Followed", partly: "Partly", not_followed: "Not followed",
    scale: "Scale", keep: "Keep", fix: "Fix", restructure: "Restructure", pause: "Pause", watch: "Watch",
    on_track: "On track", needs_attention: "Needs attention", complete: "Done", failed: "Failed",
    running: "Running", queued: "Queued"
  };
  function pill(key) {
    var p = el("span", "gar-pill" + (TONE[key] ? " is-" + TONE[key] : ""), WORD[key] || key || "");
    return p;
  }

  // ── Brief ──────────────────────────────────────────────────────────────
  function showBrief(b, history) {
    state.brief = b;
    var t = $("gar-brief");
    t.value = b ? b.text : "";
    state.saved = t.value;
    $("gar-brief-d").textContent = b ? "Saved " + when(b.created_at) + " by " + b.email + (b.filename ? " · from " + b.filename : "")
                                     : "No brief yet";
    var box = $("gar-versions-box"), list = $("gar-versions");
    clear(list);
    var older = (history || []).slice(1);
    box.hidden = !older.length;
    older.forEach(function (v) {
      var li = el("li");
      var btn = el("button", "", when(v.created_at) + " · " + v.email + (v.filename ? " · " + v.filename : ""));
      btn.type = "button";
      btn.addEventListener("click", function () {
        send(API + "/brief?id=" + v.id).then(function (j) {
          if (j.ok && j.brief) {
            $("gar-brief").value = j.brief.text;
            msg("Loaded the version of " + when(v.created_at) + ". Save it to make it the current brief.");
          }
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }
  function dirty() { return $("gar-brief").value.trim() !== (state.saved || "").trim(); }

  function saveBrief() {
    var text = $("gar-brief").value;
    if (!text.trim()) { msg("The brief is empty.", true); return; }
    msg("Saving…");
    send(API + "/brief", { method: "POST", headers: { "Content-Type": "application/json" },
                           body: JSON.stringify({ account: state.account, text: text }) })
      .then(function (j) {
        if (!j.ok) { msg(j.error || "The brief could not be saved.", true); return; }
        showBrief(j.brief, j.history);
        msg("Saved. The next review is judged against this version.");
        markBriefed();
      });
  }
  function upload(file) {
    if (!file) return;
    var fd = new FormData();
    fd.append("account", state.account);
    fd.append("file", file);
    msg("Reading " + file.name + "…");
    send(API + "/brief", { method: "POST", body: fd }).then(function (j) {
      $("gar-file").value = "";
      if (!j.ok) { msg(j.error || "That file could not be read.", true); return; }
      showBrief(j.brief, j.history);
      msg("Saved from " + file.name + ". Check the text below: tables and layout come through as plain text.");
      markBriefed();
    });
  }
  function markBriefed() {
    var opt = $("gar-account").selectedOptions[0];
    if (opt) opt.textContent = state.account;
  }

  // ── Reviews list ───────────────────────────────────────────────────────
  function showList() {
    var list = $("gar-list");
    clear(list);
    if (!state.reviews.length) {
      list.appendChild(el("li", "gar-list-empty", "No reviews yet."));
      return;
    }
    state.reviews.forEach(function (r) {
      var li = el("li"), b = el("button");
      b.type = "button";
      b.appendChild(el("span", "", when(r.created_at)));
      b.appendChild(pill(r.status));
      b.appendChild(el("small", "", (r.email || "") + (r.cost_usd != null ? " · US$" + r.cost_usd.toFixed(2) : "") +
        (r.period_from ? " · " + day(r.period_from) + " – " + day(r.period_to) : "")));
      if (state.shown === r.id) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () { openReview(r.id); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function loadAccount(account) {
    var my = ++state.seq;
    state.account = account;
    stopPoll();
    msg("");
    var box = $("gar-review");
    clear(box);
    box.appendChild(el("div", "gar-empty", "Loading…"));
    try { history.replaceState(null, "", "?account=" + encodeURIComponent(account)); } catch (e) { /* not essential */ }
    Promise.all([send(API + "/brief?account=" + encodeURIComponent(account)),
                 send(API + "/reviews?account=" + encodeURIComponent(account))]).then(function (res) {
      if (my !== state.seq) return;
      var b = res[0], r = res[1];
      showBrief(b.ok ? b.brief : null, b.ok ? b.history : []);
      if (!b.ok) msg(b.error || "The brief could not be read.", true);
      state.reviews = r.ok ? r.reviews : [];
      showList();
      var latest = state.reviews.find(function (x) { return x.status === "complete" || x.status === "running" || x.status === "queued"; })
                   || state.reviews[0];
      if (latest) openReview(latest.id);
      else { clear(box); box.appendChild(el("div", "gar-empty", "No review yet for this account. Save a brief, then run the review.")); }
    });
  }

  // ── One review ─────────────────────────────────────────────────────────
  function stopPoll() { if (state.poll) { clearTimeout(state.poll); state.poll = null; } }

  function openReview(id) {
    stopPoll();
    state.shown = id;
    showList();
    var my = state.seq;
    send(API + "/reviews/" + id).then(function (j) {
      if (my !== state.seq || state.shown !== id) return;
      if (!j.ok) { drawError(j.error || "The review could not be read."); return; }
      var r = j.review;
      var i = state.reviews.findIndex(function (x) { return x.id === r.id; });
      if (i >= 0) { state.reviews[i] = Object.assign(state.reviews[i], r, { report: undefined }); showList(); }
      if (r.status === "queued" || r.status === "running") {
        drawProgress(r);
        state.poll = setTimeout(function () { openReview(id); }, 5000);
      } else if (r.status === "failed") {
        drawFailed(r);
      } else {
        drawReport(r);
      }
      runButton();
    });
  }

  function drawError(text) {
    var box = $("gar-review");
    clear(box);
    box.appendChild(el("div", "gar-fail", text));
  }

  function drawProgress(r) {
    var box = $("gar-review");
    clear(box);
    var head = el("div", "gad-panel-head");
    var h = el("div");
    h.appendChild(el("span", "gad-lbl", "In progress"));
    h.appendChild(el("h2", "gad-h2", "Reviewing " + r.account));
    head.appendChild(h);
    head.appendChild(el("span", "gad-panel-d", "Started " + when(r.created_at) + " by " + r.email));
    box.appendChild(head);
    var at = STAGES.findIndex(function (s) { return s[0] === r.stage; });
    if (at < 0) at = 0;
    var ol = el("ol", "gar-steps");
    STAGES.forEach(function (s, i) {
      ol.appendChild(el("li", i < at ? "is-done" : (i === at ? "is-active" : ""), s[1]));
    });
    box.appendChild(ol);
    box.appendChild(el("p", "gad-note", "You can leave this page; the review carries on and appears here when it is done."));
  }

  function drawFailed(r) {
    var box = $("gar-review");
    clear(box);
    var head = el("div", "gad-panel-head");
    var h = el("div");
    h.appendChild(el("span", "gad-lbl", "Review of " + when(r.created_at)));
    h.appendChild(el("h2", "gad-h2", "The review did not finish"));
    head.appendChild(h);
    box.appendChild(head);
    box.appendChild(el("div", "gar-fail", r.error || "It failed without a reason."));
  }

  function section(box, title, sub) {
    var s = el("section", "gar-sec");
    s.appendChild(el("h3", "", title));
    if (sub) s.appendChild(el("p", "gar-sub", sub));
    box.appendChild(s);
    return s;
  }
  function para(parent, label, text) {
    if (!text) return;
    var p = el("p");
    if (label) { p.appendChild(el("b", "", label + " ")); }
    p.appendChild(document.createTextNode(text));
    parent.appendChild(p);
  }

  function drawReport(r) {
    var R = r.report || {}, box = $("gar-review");
    clear(box);
    var head = el("div", "gad-panel-head");
    var h = el("div");
    h.appendChild(el("span", "gad-lbl", "Review of " + when(r.finished_at || r.created_at)));
    h.appendChild(el("h2", "gad-h2", r.account));
    head.appendChild(h);
    var pr = el("button", "gad-btn gad-btn--line gar-print", "Print or save as PDF");
    pr.type = "button";
    pr.addEventListener("click", function () { window.print(); });
    head.appendChild(pr);
    box.appendChild(head);

    var top = el("div", "gar-head");
    top.appendChild(pill(R.overall));
    top.appendChild(el("p", "gar-headline", R.headline || ""));
    box.appendChild(top);
    var meta = el("p", "gar-meta");
    var per = R.period && R.period.last_30_days;
    meta.appendChild(document.createTextNode(
      (per ? "Last 30 days: " + day(per[0]) + " – " + day(per[1]) + (R.period.previous_30_days ? ", against the 30 before" : "") + ". " : "") +
      (R.currency ? "Money in " + R.currency + ". " : "") +
      (R.has_brief ? "Judged against the brief saved at the time. " : "No brief was saved: judged on the account's own numbers. ") +
      "Requested by " + r.email + (r.cost_usd != null ? " · Claude usage US$" + r.cost_usd.toFixed(2) : "") + "."));
    box.appendChild(meta);

    if ((R.scorecard || []).length) {
      var s1 = section(box, "Against the brief's targets", "Each target the brief sets, with what the account actually did.");
      var wrap = el("div", "gar-table-wrap"), t = el("table", "gar-table"), th = el("thead"), tr = el("tr");
      ["Objective", "Target", "Actual", "Status", "Evidence"].forEach(function (x) { tr.appendChild(el("th", "", x)); });
      th.appendChild(tr); t.appendChild(th);
      var tb = el("tbody");
      R.scorecard.forEach(function (x) {
        var row = el("tr");
        row.appendChild(el("td", "", x.objective));
        row.appendChild(el("td", "gar-dim", x.target));
        row.appendChild(el("td", "", x.actual));
        var c = el("td"); c.appendChild(pill(x.status)); row.appendChild(c);
        row.appendChild(el("td", "gar-dim", x.evidence));
        tb.appendChild(row);
      });
      t.appendChild(tb); wrap.appendChild(t); s1.appendChild(wrap);
    }

    if ((R.brief_compliance || []).length) {
      var s2 = section(box, "Is the account following the brief?", "Targeting, budgets, campaign mix, conversion setup and the account manager's agreed tasks.");
      var ul = el("ul", "gar-items");
      R.brief_compliance.forEach(function (x) {
        var li = el("li", "gar-item"), hh = el("div", "gar-item-h");
        hh.appendChild(pill(x.status));
        hh.appendChild(el("span", "", x.requirement));
        li.appendChild(hh);
        para(li, "", x.evidence);
        if (x.action && x.status !== "followed") para(li, "Do:", x.action);
        ul.appendChild(li);
      });
      s2.appendChild(ul);
    }

    if ((R.working || []).length || (R.not_working || []).length) {
      var s3 = section(box, "What is working, and what is not");
      var two = el("div", "gar-two");
      [["is-up", "Working", R.working || []], ["is-down", "Not working", R.not_working || []]].forEach(function (col) {
        var c = el("div", col[0]);
        c.appendChild(el("h4", "", col[1]));
        var list = el("ul", "gar-items");
        if (!col[2].length) list.appendChild(el("li", "gar-item", "Nothing stood out."));
        col[2].forEach(function (x) {
          var li = el("li", "gar-item");
          li.appendChild(el("div", "gar-item-h", x.title));
          para(li, "", x.evidence);
          para(li, "Cost of it:", x.impact);
          para(li, "Where:", x.where);
          list.appendChild(li);
        });
        c.appendChild(list);
        two.appendChild(c);
      });
      s3.appendChild(two);
    }

    if ((R.actions || []).length) {
      var s4 = section(box, "What to do", "P1: costing money or breaking the brief now. P2: clear gains. P3: the rest.");
      var al = el("ol", "gar-items gar-actions");
      R.actions.slice().sort(function (a, b) { return (a.priority || "P9").localeCompare(b.priority || "P9"); }).forEach(function (x) {
        var li = el("li", "gar-item gar-act is-" + (x.priority || "").toLowerCase());
        var hh = el("div", "gar-item-h");
        hh.appendChild(el("span", "gar-pill" + (x.priority === "P1" ? " is-bad" : x.priority === "P2" ? " is-warn" : ""), x.priority));
        hh.appendChild(el("span", "", x.title));
        hh.appendChild(el("span", "gar-pill", "Effort: " + (x.effort || "")));
        li.appendChild(hh);
        para(li, "Do:", x.what_to_do);
        para(li, "Why:", x.why);
        para(li, "Expected:", x.expected_impact);
        para(li, "Where:", x.where);
        al.appendChild(li);
      });
      s4.appendChild(al);
    }

    if ((R.campaigns || []).length) {
      var s5 = section(box, "Campaign by campaign");
      var grid = el("div", "gar-camps");
      R.campaigns.forEach(function (x) {
        var c = el("article", "gar-camp"), h4 = el("h4");
        h4.appendChild(el("span", "", x.campaign));
        h4.appendChild(pill(x.verdict));
        c.appendChild(h4);
        c.appendChild(el("p", "", x.summary));
        [["Issues", x.issues], ["Opportunities", x.opportunities]].forEach(function (g) {
          if (!(g[1] || []).length) return;
          c.appendChild(el("span", "gar-k", g[0]));
          var u = el("ul");
          g[1].forEach(function (i) { u.appendChild(el("li", "", i)); });
          c.appendChild(u);
        });
        grid.appendChild(c);
      });
      s5.appendChild(grid);
    }

    if ((R.brief_gaps || []).length) {
      var s6 = section(box, "What the brief should say", "Missing from the brief, and needed to judge the account properly.");
      var gl = el("ul", "gar-plain");
      R.brief_gaps.forEach(function (x) { gl.appendChild(el("li", "", x)); });
      s6.appendChild(gl);
    }

    if ((R.checks || []).length) {
      var s7 = section(box, "How the targets were measured", "Worked out from the account data by the system, before Claude wrote the review.");
      var w2 = el("div", "gar-table-wrap"), t2 = el("table", "gar-table"), th2 = el("thead"), tr2 = el("tr");
      ["Target", "Scope", "Measured", "Status", "From the brief"].forEach(function (x) { tr2.appendChild(el("th", "", x)); });
      th2.appendChild(tr2); t2.appendChild(th2);
      var tb2 = el("tbody");
      R.checks.forEach(function (x) {
        var row = el("tr");
        row.appendChild(el("td", "", x.target || x.metric));
        row.appendChild(el("td", "gar-dim", x.scope));
        row.appendChild(el("td", "", (x.actual || "") + (x.detail ? (x.actual ? " · " : "") + x.detail : "")));
        var c = el("td"); c.appendChild(pill(x.status)); row.appendChild(c);
        row.appendChild(el("td", "gar-dim", x.quote ? "“" + x.quote + "”" : ""));
        tb2.appendChild(row);
      });
      t2.appendChild(tb2); w2.appendChild(t2); s7.appendChild(w2);
    }

    if ((R.data_caveats || []).length) {
      var s8 = section(box, "Limits of the data");
      var cl = el("ul", "gar-plain");
      R.data_caveats.forEach(function (x) { cl.appendChild(el("li", "", x)); });
      s8.appendChild(cl);
    }
  }

  // ── Running a review ───────────────────────────────────────────────────
  function runButton() {
    var b = $("gar-run");
    if (!b) return;
    var busy = state.reviews.some(function (r) { return r.status === "queued" || r.status === "running"; });
    b.disabled = !DATA.configured || busy || !state.account;
    b.querySelector("span").textContent = busy ? "Review running…" : "Run the review";
  }
  function run() {
    if (dirty() && !window.confirm("The brief has unsaved changes. The review uses the saved brief. Run it anyway?")) return;
    var b = $("gar-run");
    b.disabled = true;
    send(API + "/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
                             body: JSON.stringify({ account: state.account }) })
      .then(function (j) {
        if (!j.ok) { drawError(j.error || "The review could not start."); runButton(); return; }
        var r = j.review;
        if (!state.reviews.some(function (x) { return x.id === r.id; })) state.reviews.unshift(r);
        openReview(r.id);
      });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  if (!$("gar-account")) return;
  $("gar-account").addEventListener("change", function (e) {
    if (dirty() && !window.confirm("The brief has unsaved changes. Leave them?")) { e.target.value = state.account; return; }
    loadAccount(e.target.value);
  });
  $("gar-save").addEventListener("click", saveBrief);
  $("gar-file").addEventListener("change", function (e) { upload(e.target.files[0]); });
  $("gar-template").addEventListener("click", function () {
    var t = $("gar-brief");
    if (t.value.trim() && !window.confirm("Replace the text in the box with the template?")) return;
    t.value = (DATA.template || "").replace("<account name>", state.account);
    t.focus();
    msg("Fill in the template, then save it.");
  });
  $("gar-run").addEventListener("click", run);
  window.addEventListener("beforeunload", function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
  if (state.account) loadAccount(state.account);
})();
