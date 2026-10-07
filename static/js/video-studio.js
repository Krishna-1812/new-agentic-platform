/* ════════════════════════════════════════════════════════════════════════
   VIDEO STUDIO: the start page and library, one video's page, the brands.

   One script for the three pages; each part starts only when its root is on
   the page (#vs-home, #vs-video, #vs-brands). Every piece of text that came
   from a person, a website or Claude is set with textContent, never as HTML.

   Writes are JSON only (the server refuses anything else). Pictures are
   uploaded one per request, so no request is large.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var BASE = "/strategic-agents/video-studio";

  // ── Small helpers ─────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function btn(text, cls, onClick) {
    var b = el("button", cls, text); b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", cache: "no-store", headers: {} };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var e = new Error(data.error || (r.status === 413 ? "That file is too large." : "Something went wrong (" + r.status + "). Try again."));
          e.field = data.field; e.status = r.status; throw e;
        }
        return data;
      });
    });
  }
  function data() { try { return JSON.parse($("#vs-data").textContent); } catch (e) { return {}; } }
  function words(t) { return (String(t || "").toLowerCase().match(/[\w%$€£₹¥]+(?:[.,'’]\w+)*/g) || []).length; }
  function secs(x) { var n = Math.round(Number(x || 0) * 10) / 10; return (n % 1 ? n.toFixed(1) : String(n)) + " s"; }
  function money(x) { return "$" + Number(x || 0).toFixed(2); }
  function stamp(iso) {
    var d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return "";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function readFile(file, asText) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { bad(new Error(file.name + " could not be read.")); };
      if (asText) r.readAsText(file); else r.readAsDataURL(file);
    });
  }
  function showError(text) {
    var n = $("#vs-error"); if (!n) return;
    n.textContent = text || ""; n.hidden = !text;
    if (text) n.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function seg(options, value, onPick, label) {
    var g = el("div", "pw-seg"); g.setAttribute("role", "group"); if (label) g.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var b = btn(o[1], null, function () {
        $$("button", g).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        onPick(o[0]);
      });
      b.setAttribute("aria-pressed", String(o[0] === value));
      g.appendChild(b);
    });
    return g;
  }
  function shapeIcon(w, h) {
    var i = el("i", "vs-shape-i"); var s = 22 / Math.max(w, h);
    i.style.width = Math.round(w * s) + "px"; i.style.height = Math.round(h * s) + "px";
    return i;
  }
  var STATUS_CLASS = { reading: "pending", making: "pending", planned: "changed", ready: "ok", failed: "error", draft: "paused" };

  // ════════════════════════════════════════════════════════════════════════
  // THE START PAGE AND THE LIBRARY
  // ════════════════════════════════════════════════════════════════════════
  function Home(root) {
    var D = data(), L = D.limits || {};
    var st = { kind: "custom", shape: "landscape", seconds: 20, style: "", words: "write", images: [], blocks: [], logo: null };

    // Starting points
    var starts = $("#vs-starts"), hint = $("#vs-start-hint");
    function pickStart(s) {
      st.kind = s.key; st.shape = s.shape; st.seconds = s.seconds; st.style = s.style || "";
      $$("button", starts).forEach(function (b) { var on = b.dataset.key === s.key; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      hint.textContent = s.outline && s.outline.length ? s.use + ". Suggests: " + s.outline.join(" · ") + ". Change anything." : "Anything else. The brief alone is enough.";
      syncChoices();
    }
    (D.starts || []).forEach(function (s) {
      var b = btn(s.label, "vs-start", function () { pickStart(s); });
      b.dataset.key = s.key; b.setAttribute("role", "radio"); b.title = s.use;
      starts.appendChild(b);
    });

    // Shape, length, style, words
    var shapeBox = $("#vs-shape");
    (D.shapes || []).forEach(function (s) {
      var b = btn("", "vs-shape", function () { st.shape = s.key; syncChoices(); });
      b.dataset.shape = s.key; b.setAttribute("role", "radio");
      b.appendChild(shapeIcon(s.w, s.h)); b.appendChild(el("span", null, s.label));
      shapeBox.appendChild(b);
    });
    var secIn = $("#vs-seconds"), secR = $("#vs-seconds-r");
    secIn.addEventListener("input", function () { st.seconds = secIn.value; secR.value = secIn.value; });
    secR.addEventListener("input", function () { st.seconds = secR.value; secIn.value = secR.value; });
    var styles = $("#vs-styles"), styleIn = $("#vs-style");
    (D.styles || []).forEach(function (name) {
      var b = btn(name, null, function () { st.style = st.style === name ? "" : name; styleIn.value = ""; syncChoices(); });
      b.dataset.style = name; styles.appendChild(b);
    });
    styleIn.addEventListener("input", function () { st.style = styleIn.value; syncChoices(true); });
    var script = $("#vs-script");
    $$("#vs-words button").forEach(function (b) {
      b.addEventListener("click", function () {
        st.words = b.dataset.words;
        $$("#vs-words button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        script.hidden = st.words !== "exact";
        if (!script.hidden) script.focus();
      });
    });
    function syncChoices(keepStyleText) {
      $$("button", shapeBox).forEach(function (b) { var on = b.dataset.shape === st.shape; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      secIn.value = st.seconds; secR.value = st.seconds;
      $$("button", styles).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.style === st.style)); b.classList.toggle("is-on", b.dataset.style === st.style); });
      if (!keepStyleText && (D.styles || []).indexOf(st.style) < 0) styleIn.value = st.style;
    }
    pickStart((D.starts || []).filter(function (s) { return s.key === "custom"; })[0] || D.starts[0]);

    // Pictures
    var files = $("#vs-files"), thumbs = $("#vs-thumbs"), count = $("#vs-img-count");
    function drawThumbs() {
      thumbs.textContent = "";
      st.images.forEach(function (im, i) {
        var li = el("li", "vs-thumb");
        var img = el("img"); img.alt = ""; img.src = im.preview; li.appendChild(img);
        var meta = el("div");
        meta.appendChild(el("b", null, im.file.name));
        var sel = el("select"); sel.setAttribute("aria-label", "What " + im.file.name + " is");
        [["image", "Picture"], ["screenshot", "Screenshot"], ["logo", "Logo"]].forEach(function (o) {
          var opt = el("option", null, o[1]); opt.value = o[0]; sel.appendChild(opt);
        });
        sel.value = im.kind; sel.addEventListener("change", function () { im.kind = sel.value; });
        meta.appendChild(sel); li.appendChild(meta);
        li.appendChild(btn("×", "vs-x", function () { URL.revokeObjectURL(im.preview); st.images.splice(i, 1); drawThumbs(); }));
        thumbs.appendChild(li);
      });
      count.textContent = st.images.length ? st.images.length + " of " + L.images : "";
    }
    function addFiles(list) {
      showError("");
      Array.prototype.forEach.call(list, function (f) {
        if (st.images.length >= L.images) { showError("A video can use at most " + L.images + " pictures."); return; }
        if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { showError(f.name + " is not a PNG, JPEG, WebP or GIF image."); return; }
        if (f.size > L.image_mb * 1024 * 1024) { showError(f.name + " is larger than " + L.image_mb + " MB."); return; }
        var guess = /logo/i.test(f.name) ? "logo" : /screen|shot|capture|page/i.test(f.name) ? "screenshot" : "image";
        st.images.push({ file: f, kind: guess, preview: URL.createObjectURL(f) });
      });
      drawThumbs();
    }
    files.addEventListener("change", function () { addFiles(files.files); files.value = ""; });
    var drop = $("#vs-drop");
    ["dragenter", "dragover"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function () { drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (ev) { ev.preventDefault(); if (ev.dataTransfer) addFiles(ev.dataTransfer.files); });

    // Text and numbers
    var blocks = $("#vs-blocks");
    function addBlock(kind) {
      var max = kind === "text" ? L.texts : L.tables;
      if (st.blocks.filter(function (b) { return b.kind === kind; }).length >= max) {
        showError("At most " + max + (kind === "text" ? " texts." : " tables of numbers.")); return;
      }
      var b = { kind: kind, name: kind === "text" ? "Text" : "Numbers", text: "" };
      st.blocks.push(b);
      var box = el("div", "vs-block");
      var head = el("div", "vs-block-head");
      var name = el("input"); name.value = b.name; name.maxLength = 80; name.setAttribute("aria-label", "Name");
      name.addEventListener("input", function () { b.name = name.value; });
      head.appendChild(name);
      if (kind === "table") {
        var lab = el("label", "vs-csv", "Load a CSV");
        var f = el("input"); f.type = "file"; f.accept = ".csv,text/csv,text/plain";
        f.addEventListener("change", function () {
          if (!f.files[0]) return;
          readFile(f.files[0], true).then(function (t) { ta.value = t; b.text = t; if (b.name === "Numbers") { b.name = f.files[0].name; name.value = b.name; } });
        });
        lab.appendChild(f); head.appendChild(lab);
      }
      head.appendChild(btn("×", "vs-x", function () { st.blocks.splice(st.blocks.indexOf(b), 1); box.remove(); }));
      box.appendChild(head);
      var ta = el("textarea"); ta.rows = kind === "text" ? 4 : 5;
      ta.placeholder = kind === "text" ? "A script, bullet points, a press release, a quote or a client's email."
        : "Paste from a spreadsheet: a header row, then up to " + L.rows + " rows.\nMonth\tLeads\nJuly\t420\nAugust\t515";
      ta.addEventListener("input", function () { b.text = ta.value; });
      box.appendChild(ta);
      blocks.appendChild(box);
      ta.focus();
    }
    $("#vs-add-text").addEventListener("click", function () { addBlock("text"); });
    $("#vs-add-table").addEventListener("click", function () { addBlock("table"); });

    // Client and brand. On a client account's own Video Studio (/<account>/video-studio, app.py) the
    // client is the account, the website is its own, and its brand comes from the master doc's profile
    // unless a brand was saved for it already.
    var ACCT = D.account || null;
    if (ACCT && ACCT.website && !$("#vs-website").value) $("#vs-website").value = ACCT.website;
    var client = $("#vs-client"), dl = $("#vs-clients"), note = $("#vs-brand-note");
    (D.brands || []).forEach(function (b) { var o = el("option"); o.value = b.client; dl.appendChild(o); });
    function brandFor(name) {
      var k = String(name || "").trim().toLowerCase();
      return (D.brands || []).filter(function (b) { return b.key === k || b.client.toLowerCase() === k; })[0];
    }
    function syncBrandNote() {
      var b = brandFor(client.value);
      note.textContent = "";
      if (b) {
        note.appendChild(document.createTextNode("Uses the saved brand for " + b.client + " "));
        ["background", "text", "accent"].forEach(function (k) { var i = el("i", "vs-sw"); i.style.background = b.colors[k] || "#fff"; i.title = k; note.appendChild(i); });
        note.appendChild(document.createTextNode(" " + (b.fonts.heading || "") + ". Set it by hand to change it."));
      } else if (ACCT && ACCT.brand && (ACCT.brand.accent || ACCT.brand.heading_font)) {
        note.textContent = "Uses " + ACCT.name + "'s brand from the master doc. Set it by hand to change it.";
      } else {
        note.textContent = client.value.trim() ? "A new client: the brand found for this video is saved for next time."
          : "The brand comes from the website when there is one. Set it here to choose it yourself.";
      }
    }
    client.addEventListener("input", syncBrandNote);
    var colours = $("#vs-colours"), hand = {};
    [["background", "Background"], ["text", "Text"], ["accent", "Accent"]].forEach(function (c) {
      var f = el("label", "pw-field vs-colour"); f.appendChild(el("span", null, c[1]));
      var row = el("div", "vs-colour-row");
      var pick = el("input"); pick.type = "color"; pick.value = c[0] === "background" ? "#ffffff" : c[0] === "text" ? "#111111" : "#2f5bea";
      pick.setAttribute("aria-label", c[1] + " colour picker");
      var txt = el("input"); txt.placeholder = "Auto"; txt.maxLength = 7; txt.setAttribute("aria-label", c[1] + " colour");
      pick.addEventListener("input", function () { txt.value = pick.value; });
      txt.addEventListener("input", function () { if (/^#?[0-9a-f]{6}$/i.test(txt.value)) pick.value = txt.value.charAt(0) === "#" ? txt.value : "#" + txt.value; });
      hand[c[0]] = txt;
      row.appendChild(pick); row.appendChild(txt); f.appendChild(row); colours.appendChild(f);
    });
    [["#vs-head-font", "heading_font"], ["#vs-body-font", "body_font"]].forEach(function (p) {
      var s = $(p[0]); var o = el("option", null, "Auto"); o.value = ""; s.appendChild(o);
      (D.fonts || []).forEach(function (f) { var x = el("option", null, f); x.value = f; s.appendChild(x); });
      hand[p[1]] = s;
    });
    var logoIn = $("#vs-logo");
    if (ACCT && ACCT.brand && !brandFor(ACCT.name)) {
      ["background", "text", "accent", "heading_font", "body_font"].forEach(function (k) {
        if (ACCT.brand[k]) hand[k].value = ACCT.brand[k];
      });
      ["background", "text", "accent"].forEach(function (k) { if (ACCT.brand[k]) hand[k].dispatchEvent(new Event("input")); });
    }
    syncBrandNote();

    // Make a plan
    var go = $("#vs-go"), progress = $("#vs-progress");
    function fieldError(field, text) {
      $$(".vs-field-err").forEach(function (n) { n.hidden = true; });
      var n = field && $('.vs-field-err[data-err="' + field + '"]');
      if (n) { n.textContent = text; n.hidden = false; n.scrollIntoView({ block: "center", behavior: "smooth" }); }
      else showError(text);
    }
    go.addEventListener("click", function () {
      showError(""); fieldError(null, "");
      var brand = {};
      ["background", "text", "accent", "heading_font", "body_font"].forEach(function (k) { if (hand[k].value) brand[k] = hand[k].value; });
      var body = {
        brief: $("#vs-brief").value, kind: st.kind, shape: st.shape, seconds: st.seconds, style: st.style,
        words: st.words, script: script.value, website: $("#vs-website").value, client: client.value, brand: brand,
        texts: st.blocks.filter(function (b) { return b.kind === "text" && b.text.trim(); }).map(function (b) { return { name: b.name, text: b.text }; }),
        tables: st.blocks.filter(function (b) { return b.kind === "table" && b.text.trim(); }).map(function (b) { return { name: b.name, text: b.text }; })
      };
      var uploads = st.images.slice();
      if (logoIn.files[0]) uploads.push({ file: logoIn.files[0], kind: "logo" });
      go.disabled = true; progress.textContent = "Saving the brief…";
      var pid = null;
      if (ACCT) body.account = ACCT.slug;   // saved to the client account, for the whole team
      api("POST", BASE + "/api/videos", body).then(function (r) {
        pid = r.project;
        var chain = Promise.resolve();
        uploads.forEach(function (im, i) {
          chain = chain.then(function () {
            progress.textContent = "Uploading picture " + (i + 1) + " of " + uploads.length + "…";
            return readFile(im.file).then(function (dataUrl) {
              return api("POST", BASE + "/api/videos/" + pid + "/images", { name: im.file.name, data: dataUrl, kind: im.kind });
            });
          });
        });
        return chain;
      }).then(function () {
        progress.textContent = "Starting…";
        return api("POST", BASE + "/api/videos/" + pid + "/start", {});
      }).then(function (r) {
        window.location.href = r.url;
      }).catch(function (e) {
        go.disabled = false; progress.textContent = "";
        if (pid) api("POST", BASE + "/api/videos/" + pid + "/discard", {}).catch(function () {});
        fieldError(e.field, e.message);
      });
    });

    Library(D.library || [], ACCT);
  }

  function Library(items, acct) {
    var grid = $("#vs-lib"), empty = $("#vs-lib-empty"), kinds = $("#vs-kinds"), clientSel = $("#vs-lib-client"), find = $("#vs-lib-find");
    /* Inside a client account the library is the account's (app.py: everyone's videos for it, each
       with its maker, opened inside the account); elsewhere it is your own General videos. */
    var LIB = BASE + "/api/library" + (acct ? "?account=" + encodeURIComponent(acct.slug) : "");
    var filter = { kind: "", client: "", q: "" };
    function chips() {
      kinds.textContent = "";
      var seen = {};
      items.forEach(function (v) { seen[v.kind] = v.kind_label; });
      var opts = [["", "All"]].concat(Object.keys(seen).map(function (k) { return [k, seen[k]]; }));
      opts.forEach(function (o) {
        var n = items.filter(function (v) { return !o[0] || v.kind === o[0]; }).length;
        var b = btn("", "sa-chip" + (filter.kind === o[0] ? " is-on" : ""), function () { filter.kind = o[0]; chips(); draw(); });
        b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(filter.kind === o[0]));
        b.appendChild(document.createTextNode(o[1] + " ")); b.appendChild(el("em", null, n));
        kinds.appendChild(b);
      });
      var clients = {};
      items.forEach(function (v) { if (v.client) clients[v.client] = 1; });
      var cur = clientSel.value;
      clientSel.textContent = ""; var all = el("option", null, "Every client"); all.value = ""; clientSel.appendChild(all);
      Object.keys(clients).sort().forEach(function (c) { var o = el("option", null, c); o.value = c; clientSel.appendChild(o); });
      clientSel.value = clients[cur] ? cur : "";
    }
    function card(v) {
      var c = el("article", "pw-card vs-card");
      var a = el("a", "pw-thumb vs-cover"); a.href = v.url; a.setAttribute("aria-label", "Open: " + v.brief.slice(0, 80));
      if (v.cover) { var img = el("img"); img.src = v.cover; img.alt = ""; img.loading = "lazy"; a.appendChild(img); }
      else a.appendChild(el("span", "pw-thumb-empty", v.status === "failed" ? "No video" : v.status === "ready" ? "" : "Not made yet"));
      var s = el("span", "pw-state pw-state--" + (STATUS_CLASS[v.status] || "ok")); s.appendChild(el("i")); s.appendChild(document.createTextNode(v.status_label));
      a.appendChild(s); c.appendChild(a);
      var body = el("div", "pw-card-body");
      var t = el("a", "vs-card-brief", v.brief); t.href = v.url; body.appendChild(t);
      var meta = el("div", "pw-card-site");
      if (v.client && !acct) meta.appendChild(el("span", "pw-client", v.client));
      meta.appendChild(el("span", null, [v.kind_label, v.shape_label, v.seconds ? secs(v.seconds) : "", v.versions + (v.versions === 1 ? " version" : " versions")].filter(Boolean).join(" · ")));
      body.appendChild(meta);
      var foot = el("div", "pw-card-foot");
      foot.appendChild(el("span", null, stamp(v.created_at) + (acct && v.by ? " · by " + v.by : "")));
      foot.appendChild(btn("Duplicate", "pw-link-btn vs-dup", function () { duplicate(v.id); }));
      body.appendChild(foot);
      c.appendChild(body);
      return c;
    }
    function draw() {
      var q = filter.q.toLowerCase();
      var shown = items.filter(function (v) {
        return (!filter.kind || v.kind === filter.kind) && (!filter.client || v.client === filter.client) &&
          (!q || (v.brief + " " + v.client + " " + v.idea).toLowerCase().indexOf(q) >= 0);
      });
      grid.textContent = "";
      shown.forEach(function (v) { grid.appendChild(card(v)); });
      empty.hidden = items.length > 0;
      if (items.length && !shown.length) grid.appendChild(el("p", "pw-quiet", "No video matches."));
    }
    clientSel.addEventListener("change", function () { filter.client = clientSel.value; draw(); });
    find.addEventListener("input", function () { filter.q = find.value; draw(); });
    chips(); draw();
    function busy() { return items.some(function (v) { return v.status === "reading" || v.status === "making"; }); }
    (function poll() {
      if (!busy()) return setTimeout(poll, 15000);
      setTimeout(function () {
        api("GET", LIB).then(function (r) { items = r.library || []; chips(); draw(); }).catch(function () {}).then(poll);
      }, 5000);
    })();
  }

  function duplicate(pid) {
    showError("");
    api("POST", BASE + "/api/videos/" + pid + "/duplicate", {}).then(function (r) { window.location.href = r.url; })
      .catch(function (e) { showError(e.message); });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ONE VIDEO
  // ════════════════════════════════════════════════════════════════════════
  function Video(root) {
    var D = data(), V = D.video, MENU = D.menu || [], FIELDS = D.fields || {}, FONTS = D.fonts || [];
    var stage = $("#vs-stage"), shownKey = "", editor = null, timer = null;

    $("#vs-dup").addEventListener("click", function () { duplicate(V.id); });

    function facts() {
      var f = $("#vs-facts"); f.textContent = "";
      var c = V.choices, v = V.version;
      [["Shape", v ? v.shape_label : c.shape_label], ["Length", secs(v && v.seconds ? v.seconds : c.seconds)],
        ["Style", c.style || "Chosen to suit"], ["Words", c.words === "exact" ? "Your script, exactly" : "Written for you"],
        ["Website", c.website || "None"], ["Pictures", String(V.pictures.filter(function (p) { return p.kind !== "frame"; }).length)]]
        .forEach(function (x) { var li = el("li"); li.appendChild(el("b", null, x[0] + " ")); li.appendChild(document.createTextNode(x[1])); f.appendChild(li); });
    }
    function versions() {
      var nav = $("#vs-versions"); nav.textContent = "";
      if (!V.versions.length) return;
      V.versions.slice().reverse().forEach(function (r) {
        var b = btn("", "vs-ver" + (V.version && r.id === V.version.id ? " is-on" : ""), function () { open(r.id); });
        b.appendChild(el("b", null, "Version " + r.number));
        var s = el("span", "vs-ver-st vs-st--" + r.status, r.status_label); b.appendChild(s);
        if (r.change) b.appendChild(el("small", null, r.change));
        else if (r.idea) b.appendChild(el("small", null, r.idea));
        if (V.version && r.id === V.version.id) b.setAttribute("aria-current", "true");
        nav.appendChild(b);
      });
    }
    function open(vid) {
      showError("");
      api("GET", BASE + "/api/videos/" + V.id + "?v=" + vid).then(function (r) { set(r.video, true); }).catch(function (e) { showError(e.message); });
    }
    function set(view, force) {
      V = view;
      if (V.version && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + "?v=" + V.version.id);   // stays inside the account
      facts(); versions();
      var v = V.version;
      var key = v ? v.id + ":" + v.phase : "none";
      if (force || key !== shownKey || (v && (v.phase === "reading" || v.phase === "making"))) {
        // The plan editor is drawn once per version, so polling never clobbers typing.
        if (!(v && v.phase === "plan" && key === shownKey && !force)) draw();
      }
      shownKey = key;
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (V.busy) timer = setTimeout(function () {
        api("GET", BASE + "/api/videos/" + V.id + "?v=" + (V.version ? V.version.id : "")).then(function (r) { set(r.video, false); })
          .catch(function () { schedule(); });
      }, 2500);
    }
    function act(action, body, vid) {
      showError("");
      return api("POST", BASE + "/api/versions/" + (vid || V.version.id) + "/" + action, Object.assign({ view: "video" }, body || {}))
        .then(function (r) { set(r.video, true); window.scrollTo({ top: $("#vs-versions").offsetTop - 80, behavior: "smooth" }); return r; })
        .catch(function (e) { showError(e.message); throw e; });
    }

    function draw() {
      stage.textContent = ""; editor = null;
      var v = V.version;
      if (!v) { stage.appendChild(el("p", "pw-quiet", "This video has not started.")); return; }
      if (V.claude && V.claude.state === "capped" && (v.phase === "plan" || v.phase === "result" || v.phase === "failed")) {
        stage.appendChild(el("div", "vs-note vs-note--warn", "This month's Video Studio budget is used up. Approving plans, another shape and downloads still work; changes in words and new ideas wait until the 1st."));
      }
      if (v.phase === "reading") return drawReading(v);
      if (v.phase === "plan") return drawPlan(v);
      if (v.phase === "making") return drawMaking(v);
      if (v.phase === "result") return drawResult(v);
      return drawFailed(v);
    }

    function stepList(steps) {
      var ol = el("ol", "pw-phases vs-steps");
      steps.forEach(function (s) {
        var li = el("li", s.state === "on" ? "is-on" : s.state === "done" ? "is-done" : "is-" + s.state);
        li.appendChild(el("span", null, s.label));
        if (s.detail) li.appendChild(el("small", null, s.detail));
        else if (s.state === "blocked") li.appendChild(el("small", null, "Could not be read"));
        else if (s.state === "skipped") li.appendChild(el("small", null, "Not needed"));
        ol.appendChild(li);
      });
      return ol;
    }
    function panel(title, cls) {
      var p = el("div", "vs-panel" + (cls ? " " + cls : ""));
      if (title) p.appendChild(el("h2", "vs-h3", title));
      return p;
    }

    // ── Reading ───────────────────────────────────────────────────────────
    function drawReading(v) {
      var p = panel("Reading the sources", "vs-reading");
      var wrap = el("div", "pw-reading");
      var ghost = el("div", "pw-ghost"); ghost.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 6; i++) ghost.appendChild(el("i"));
      wrap.appendChild(ghost); wrap.appendChild(stepList(v.reading.steps));
      p.appendChild(wrap);
      if (v.reading.blocked) p.appendChild(blockedNote(v.reading.blocked, "The plan carries on without the website."));
      p.appendChild(el("p", "vs-small", "This takes about 10 to 60 seconds. You can leave the page; the plan waits in your library."));
      stage.appendChild(p);
    }
    function blockedNote(message, after) {
      var n = el("div", "vs-note vs-note--warn");
      n.appendChild(el("p", null, message + " " + (after || "")));
      var lab = el("label", "sa-btn sa-btn--line vs-upbtn", "Use my own screenshots instead");
      var f = el("input"); f.type = "file"; f.accept = "image/png,image/jpeg,image/webp"; f.multiple = true;
      f.addEventListener("change", function () { upload(f.files, "screenshot").then(function () { f.value = ""; }); });
      lab.appendChild(f); n.appendChild(lab);
      return n;
    }
    function upload(list, kind) {
      var chain = Promise.resolve(), done = [];
      Array.prototype.forEach.call(list, function (file) {
        chain = chain.then(function () {
          return readFile(file).then(function (d) { return api("POST", BASE + "/api/videos/" + V.id + "/images", { name: file.name, data: d, kind: kind }); })
            .then(function (r) { V.pictures.push(r.picture); done.push(r.picture); });
        });
      });
      return chain.then(function () {
        if (done.length && V.version && V.version.phase === "plan") {
          toast(done.length + " picture" + (done.length > 1 ? "s" : "") + " added. Use them in a scene, or choose Try another idea to plan with them.");
        } else if (done.length) toast(done.length + " picture" + (done.length > 1 ? "s" : "") + " added.");
        return done;
      }).catch(function (e) { showError(e.message); return done; });
    }
    function toast(text) {
      var t = el("div", "vs-toast", text); document.body.appendChild(t);
      setTimeout(function () { t.classList.add("is-out"); setTimeout(function () { t.remove(); }, 400); }, 4200);
    }

    // ── The plan editor ───────────────────────────────────────────────────
    function drawPlan(v) {
      var plan = JSON.parse(JSON.stringify(v.plan));
      var target = Number(v.target_s || v.seconds || 0);
      var saving = null, dirty = false, lastSaved = JSON.stringify(plan);
      var brand = plan.brand ? { background: plan.brand.colors.background, text: plan.brand.colors.text, accent: plan.brand.colors.accent,
        heading: plan.brand.fonts.heading, body: plan.brand.fonts.body, logo_asset: plan.brand.logo_asset } : null;

      var top = panel(null, "vs-idea");
      top.appendChild(el("span", "sa-lbl", "The idea"));
      top.appendChild(el("p", "vs-idea-t", plan.idea || "The plan"));
      if (plan.hook) { var h = el("p", "vs-hook"); h.appendChild(el("b", null, "First seconds: ")); h.appendChild(document.createTextNode(plan.hook)); top.appendChild(h); }
      stage.appendChild(top);
      if (v.blocked) stage.appendChild(blockedNote(v.blocked, "This plan was made without it."));
      var notes = el("div", "vs-notes"); stage.appendChild(notes);
      function drawNotes() {
        notes.textContent = "";
        if (plan.problems && plan.problems.length) {
          var p = el("div", "vs-note vs-note--bad");
          p.appendChild(el("b", null, "Fix these before making the video:"));
          var ul = el("ul"); plan.problems.forEach(function (x) { ul.appendChild(el("li", null, x)); }); p.appendChild(ul);
          notes.appendChild(p);
        }
        if (plan.notes && plan.notes.length) {
          var n = el("div", "vs-note");
          n.appendChild(el("b", null, "Notes"));
          var ul2 = el("ul"); plan.notes.forEach(function (x) { ul2.appendChild(el("li", null, x)); }); n.appendChild(ul2);
          notes.appendChild(n);
        }
        if (plan.earlier && plan.earlier.length) {
          var m = el("details", "vs-note vs-note--earlier");
          m.appendChild(el("summary", null, "Planned knowing the " + plan.earlier.length + " video" +
                                            (plan.earlier.length === 1 ? " already made for this client, so it does not repeat it"
                                                                              : "s already made for this client, so it does not repeat them")));
          var ul3 = el("ul"); plan.earlier.forEach(function (x) { ul3.appendChild(el("li", null, x)); }); m.appendChild(ul3);
          notes.appendChild(m);
        }
      }

      // The timeline: every scene as a block as wide as its seconds.
      var tl = el("div", "vs-timeline"), tlBar = el("div", "vs-tl-bar"), tlInfo = el("div", "vs-tl-info");
      tl.appendChild(tlBar); tl.appendChild(tlInfo); stage.appendChild(tl);
      function total() { return plan.scenes.reduce(function (a, s) { return a + Number(s.seconds || 0); }, 0); }
      function drawTimeline() {
        tlBar.textContent = "";
        var t = total();
        plan.scenes.forEach(function (s, i) {
          var b = el("span", "vs-tl-s" + (i === plan.cover_scene ? " is-cover" : ""));
          b.style.flexGrow = String(Math.max(0.2, Number(s.seconds || 0)));
          b.title = (i + 1) + ". " + ((FIELDS[s.type] || {}).label || s.type) + ", " + secs(s.seconds);
          b.textContent = String(i + 1);
          tlBar.appendChild(b);
        });
        tlInfo.textContent = "";
        var ok = Math.abs(t - target) <= 0.5;
        var tot = el("b", ok ? "vs-ok" : "vs-bad", secs(t) + " of " + secs(target));
        tlInfo.appendChild(tot);
        tlInfo.appendChild(el("span", null, plan.scenes.length + " scenes"));
        if (!ok) tlInfo.appendChild(btn("Fit to " + secs(target), "pw-link-btn vs-fit", function () {
          var k = target / (t || 1);
          plan.scenes.forEach(function (s) { s.seconds = Math.max(1.5, Math.min(15, Math.round(Number(s.seconds) * k * 10) / 10)); });
          var diff = Math.round((target - total()) * 10) / 10;
          if (plan.scenes.length) plan.scenes[plan.scenes.length - 1].seconds = Math.round((Number(plan.scenes[plan.scenes.length - 1].seconds) + diff) * 10) / 10;
          drawScenes(); changed();
        }));
      }

      var list = el("div", "vs-scenes"); stage.appendChild(list);
      function wordHint(input, max) {
        var n = el("small", "vs-wc");
        function upd() { var w = words(input.value); n.textContent = w + " / " + max + " words"; n.classList.toggle("vs-bad", w > max); }
        input.addEventListener("input", upd); upd();
        return n;
      }
      function textField(label, value, max, onInput, long) {
        var f = el("label", "pw-field vs-tf");
        var head = el("span", null, label); f.appendChild(head);
        var input = long ? el("textarea") : el("input");
        if (long) input.rows = 2;
        input.value = value || "";
        input.addEventListener("input", function () { onInput(input.value); changed(); });
        f.appendChild(input);
        if (max) f.appendChild(wordHint(input, max));
        return f;
      }
      function picFor(id) { return V.pictures.filter(function (p) { return p.id === id; })[0]; }
      function drawScene(s, i) {
        var F = FIELDS[s.type] || FIELDS.words;
        var card = el("article", "vs-scene");
        var head = el("div", "vs-scene-head");
        head.appendChild(el("span", "vs-scene-n", String(i + 1)));
        head.appendChild(el("b", null, F.label || s.type));
        var sec = el("input", "vs-sec"); sec.type = "number"; sec.min = "1.5"; sec.max = "15"; sec.step = "0.5"; sec.value = s.seconds;
        sec.setAttribute("aria-label", "Seconds for scene " + (i + 1));
        sec.addEventListener("input", function () { s.seconds = Number(sec.value || 0); drawTimeline(); changed(); });
        var secWrap = el("label", "vs-sec-l"); secWrap.appendChild(sec); secWrap.appendChild(document.createTextNode(" s"));
        head.appendChild(secWrap);
        var tools = el("div", "vs-scene-tools");
        var cover = btn(i === plan.cover_scene ? "Cover" : "Make cover", "vs-tool" + (i === plan.cover_scene ? " is-on" : ""), function () { plan.cover_scene = i; drawScenes(); changed(); });
        cover.setAttribute("aria-pressed", String(i === plan.cover_scene));
        tools.appendChild(cover);
        var up = btn("↑", "vs-tool", function () { move(i, -1); }); up.setAttribute("aria-label", "Move scene " + (i + 1) + " up"); up.disabled = i === 0;
        var dn = btn("↓", "vs-tool", function () { move(i, 1); }); dn.setAttribute("aria-label", "Move scene " + (i + 1) + " down"); dn.disabled = i === plan.scenes.length - 1;
        var del = btn("Delete", "vs-tool vs-tool--del", function () {
          plan.scenes.splice(i, 1);
          if (plan.cover_scene >= plan.scenes.length) plan.cover_scene = Math.max(0, plan.scenes.length - 1);
          drawScenes(); changed();
        });
        tools.appendChild(up); tools.appendChild(dn); tools.appendChild(del);
        head.appendChild(tools);
        card.appendChild(head);
        if (s.purpose) card.appendChild(el("p", "vs-purpose", s.purpose));
        var body = el("div", "vs-scene-body");
        var fields = el("div", "vs-scene-fields");
        if (F.headline) fields.appendChild(textField(F.head_words[0], s.headline, F.headline, function (x) { s.headline = x; }, s.type === "quote"));
        if (F.emphasis) fields.appendChild(textField("Words to highlight (copied from the headline)", s.emphasis, F.emphasis, function (x) { s.emphasis = x; }));
        if (F.number) fields.appendChild(textField("The number, as shown", s.number, 0, function (x) { s.number = x; }));
        if (F.subline) fields.appendChild(textField(F.head_words[1] || "Subline", s.subline, F.subline, function (x) { s.subline = x; }));
        if (F.attribution) fields.appendChild(textField("Who said it (name, role)", s.attribution, 0, function (x) { s.attribution = x; }));
        if (F.items) fields.appendChild(itemsEditor(s, F));
        if (F.chart) fields.appendChild(chartEditor(s));
        body.appendChild(fields);
        if (F.pictures && F.pictures.max) body.appendChild(picsEditor(s, F));
        card.appendChild(body);
        return card;
      }
      function itemsEditor(s, F) {
        var box = el("div", "pw-field vs-items");
        box.appendChild(el("span", null, F.item_words[0] + "s (up to " + F.items + ")"));
        s.items = s.items || [];
        s.items.forEach(function (it, j) {
          var row = el("div", "vs-item");
          var a = el("input"); a.value = it.label || ""; a.placeholder = F.item_words[0]; a.setAttribute("aria-label", F.item_words[0] + " " + (j + 1));
          a.addEventListener("input", function () { it.label = a.value; changed(); });
          row.appendChild(a);
          if (F.item_words[1]) {
            var b = el("input"); b.value = it.detail || ""; b.placeholder = F.item_words[1]; b.setAttribute("aria-label", F.item_words[1] + " " + (j + 1));
            b.addEventListener("input", function () { it.detail = b.value; changed(); });
            row.appendChild(b);
          }
          row.appendChild(btn("×", "vs-x", function () { s.items.splice(j, 1); drawScenes(); changed(); }));
          box.appendChild(row);
        });
        if (s.items.length < F.items) box.appendChild(btn("+ Add a " + F.item_words[0].toLowerCase(), "vs-add", function () { s.items.push({ label: "", detail: "" }); drawScenes(); changed(); }));
        return box;
      }
      function chartEditor(s) {
        var box = el("div", "pw-field vs-chart");
        box.appendChild(el("span", null, "Chart"));
        s.chart = s.chart || { asset_id: 0, label_column: "", value_column: "", kind: "none" };
        if (!V.tables.length) { box.appendChild(el("p", "pw-quiet", "This video has no numbers. Make a new video with a table to chart.")); return box; }
        var t = el("select"); t.setAttribute("aria-label", "Numbers");
        V.tables.forEach(function (x) { var o = el("option", null, x.name); o.value = x.id; t.appendChild(o); });
        if (!s.chart.asset_id) s.chart.asset_id = V.tables[0].id;
        t.value = s.chart.asset_id;
        var tab = function () { return V.tables.filter(function (x) { return x.id === Number(t.value); })[0] || V.tables[0]; };
        var lc = el("select"), vc = el("select"), kind = el("select");
        lc.setAttribute("aria-label", "Label column"); vc.setAttribute("aria-label", "Value column"); kind.setAttribute("aria-label", "Chart kind");
        function cols() {
          lc.textContent = ""; vc.textContent = "";
          tab().columns.forEach(function (c) { var o = el("option", null, c); o.value = c; lc.appendChild(o); });
          tab().numeric.forEach(function (c) { var o = el("option", null, c); o.value = c; vc.appendChild(o); });
          if (tab().columns.indexOf(s.chart.label_column) < 0) s.chart.label_column = tab().columns[0] || "";
          if (tab().numeric.indexOf(s.chart.value_column) < 0) s.chart.value_column = tab().numeric[0] || "";
          lc.value = s.chart.label_column; vc.value = s.chart.value_column;
        }
        [["bar", "Bars"], ["line", "Line"], ["donut", "Donut"]].forEach(function (k) { var o = el("option", null, k[1]); o.value = k[0]; kind.appendChild(o); });
        if (s.chart.kind === "none") s.chart.kind = "bar";
        kind.value = s.chart.kind;
        t.addEventListener("change", function () { s.chart.asset_id = Number(t.value); cols(); changed(); });
        lc.addEventListener("change", function () { s.chart.label_column = lc.value; changed(); });
        vc.addEventListener("change", function () { s.chart.value_column = vc.value; changed(); });
        kind.addEventListener("change", function () { s.chart.kind = kind.value; changed(); });
        cols();
        var row = el("div", "vs-chart-row"); [t, lc, vc, kind].forEach(function (x) { row.appendChild(x); });
        box.appendChild(row);
        return box;
      }
      function picsEditor(s, F) {
        var box = el("div", "vs-pics");
        s.asset_ids = s.asset_ids || [];
        s.asset_ids.forEach(function (id, j) {
          var p = picFor(id);
          var b = btn("", "vs-pic", function () { pickPicture(F, function (nid) { s.asset_ids[j] = nid; drawScenes(); changed(); }); });
          b.setAttribute("aria-label", "Swap picture " + (j + 1));
          if (p) { var img = el("img"); img.src = p.url; img.alt = p.name; b.appendChild(img); }
          else b.appendChild(el("span", null, "Missing"));
          b.appendChild(el("em", null, "Swap"));
          box.appendChild(b);
          if (s.asset_ids.length > F.pictures.min) box.appendChild(btn("×", "vs-x vs-pic-x", function () { s.asset_ids.splice(j, 1); drawScenes(); changed(); }));
        });
        if (s.asset_ids.length < F.pictures.max) {
          box.appendChild(btn("+ Picture", "vs-pic vs-pic--add", function () { pickPicture(F, function (nid) { s.asset_ids.push(nid); drawScenes(); changed(); }); }));
        }
        return box;
      }
      function pickPicture(F, done, title) {
        var kinds = F.pictures.kinds;
        var body = el("div");
        var grid = el("div", "vs-picker");
        var usable = V.pictures.filter(function (p) { return kinds.indexOf(p.kind) >= 0; });
        if (!usable.length) grid.appendChild(el("p", "pw-quiet", "No picture of this video fits this scene yet. Upload one."));
        usable.forEach(function (p) {
          var b = btn("", "vs-pick", function () { closeModal(); done(p.id); });
          var img = el("img"); img.src = p.url; img.alt = ""; b.appendChild(img);
          b.appendChild(el("span", null, (p.kind === "screenshot" ? "Screenshot" : p.kind === "crop" ? "Part of a page" : p.kind === "logo" ? "Logo" : "Picture") + (p.name ? ": " + p.name : "")));
          grid.appendChild(b);
        });
        body.appendChild(grid);
        var lab = el("label", "sa-btn sa-btn--line vs-upbtn", "Upload a picture");
        var f = el("input"); f.type = "file"; f.accept = "image/png,image/jpeg,image/webp";
        var kind = kinds.indexOf("image") >= 0 ? "image" : kinds[0];
        f.addEventListener("change", function () {
          upload(f.files, kind).then(function (got) { if (got.length) { closeModal(); done(got[0].id); } });
        });
        lab.appendChild(f); body.appendChild(lab);
        openModal(title || "Choose a picture", body);
      }
      function move(i, d) {
        var j = i + d; if (j < 0 || j >= plan.scenes.length) return;
        var s = plan.scenes.splice(i, 1)[0]; plan.scenes.splice(j, 0, s);
        if (plan.cover_scene === i) plan.cover_scene = j; else if (plan.cover_scene === j) plan.cover_scene = i;
        drawScenes(); changed();
      }
      function drawScenes() {
        list.textContent = "";
        plan.scenes.forEach(function (s, i) { list.appendChild(drawScene(s, i)); });
        var add = btn("+ Add a scene", "vs-add vs-add-scene", function () {
          var body = el("div", "vs-menu");
          MENU.forEach(function (m) {
            var b = btn("", "vs-menu-i", function () {
              closeModal();
              var F = FIELDS[m.type];
              var s = { type: m.type, seconds: 3, purpose: "", headline: "", emphasis: "", subline: "", items: [], number: "", attribution: "",
                asset_ids: [], chart: { asset_id: 0, label_column: "", value_column: "", kind: "none" }, motion: "" };
              if (F.items) { for (var k = 0; k < Math.min(F.items, m.type === "comparison" ? 2 : 3); k++) s.items.push({ label: "", detail: "" }); }
              var end = plan.scenes.length && plan.scenes[plan.scenes.length - 1].type === "end_card" ? plan.scenes.length - 1 : plan.scenes.length;
              plan.scenes.splice(end, 0, s);
              if (plan.cover_scene >= end && end < plan.scenes.length - 1) plan.cover_scene += 1;
              drawScenes(); changed();
              var cards = $$(".vs-scene", list); if (cards[end]) cards[end].scrollIntoView({ block: "center", behavior: "smooth" });
            });
            b.appendChild(el("b", null, m.label)); b.appendChild(el("span", null, m.hint));
            body.appendChild(b);
          });
          openModal("Add a scene", body);
        });
        add.disabled = plan.scenes.length >= 12;
        list.appendChild(add);
        drawTimeline();
      }

      // Brand and share copy
      var side = el("div", "vs-plan-side"); stage.appendChild(side);
      function drawBrand() {
        side.textContent = "";
        if (brand) {
          var p = panel("The brand", "vs-brand");
          var prev = el("div", "vs-brand-prev");
          prev.style.background = brand.background; prev.style.color = brand.text;
          var logoP = picFor(brand.logo_asset);
          if (logoP) { var li = el("img"); li.src = logoP.url; li.alt = "Logo"; prev.appendChild(li); }
          prev.appendChild(el("b", null, (plan.scenes[0] && plan.scenes[0].headline) || "Headline"));
          var pill = el("span", null, "Action"); pill.style.background = brand.accent; pill.style.color = plan.brand.colors.on_accent || "#fff"; prev.appendChild(pill);
          prev.appendChild(el("small", null, brand.heading + " · " + brand.body));
          p.appendChild(prev);
          var row = el("div", "vs-colour-set");
          [["background", "Background"], ["text", "Text"], ["accent", "Accent"]].forEach(function (c) {
            var f = el("label", "vs-colour-pick");
            var i = el("input"); i.type = "color"; i.value = brand[c[0]]; i.setAttribute("aria-label", c[1] + " colour");
            i.addEventListener("change", function () { brand[c[0]] = i.value; drawBrand(); changed(); });
            f.appendChild(i); f.appendChild(el("span", null, c[1])); row.appendChild(f);
          });
          p.appendChild(row);
          [["heading", "Heading font"], ["body", "Body font"]].forEach(function (r) {
            var f = el("label", "pw-field"); f.appendChild(el("span", null, r[1]));
            var s = el("select"); FONTS.forEach(function (x) { var o = el("option", null, x); o.value = x; s.appendChild(o); });
            s.value = brand[r[0]]; s.addEventListener("change", function () { brand[r[0]] = s.value; drawBrand(); changed(); });
            f.appendChild(s); p.appendChild(f);
          });
          var lrow = el("div", "vs-logo-row");
          lrow.appendChild(btn(logoP ? "Change the logo" : "Choose a logo", "pw-link-btn", function () {
            pickPicture({ pictures: { kinds: ["logo", "image", "crop"] } }, function (id) { brand.logo_asset = id; drawBrand(); changed(); }, "Choose the logo");
          }));
          if (logoP) lrow.appendChild(btn("No logo", "pw-link-btn", function () { brand.logo_asset = null; drawBrand(); changed(); }));
          p.appendChild(lrow);
          if (plan.brand.swaps && plan.brand.swaps.length) p.appendChild(el("p", "vs-small", "Fonts the video cannot use were swapped: " +
            plan.brand.swaps.map(function (x) { return x.asked + " became " + x.used; }).join("; ") + "."));
          if (V.client) p.appendChild(el("p", "vs-small", "Changes are saved for " + V.client + "'s next video too."));
          side.appendChild(p);
        }
        var mp = panel("Music", "vs-music");
        var mf = el("label", "pw-field"); mf.appendChild(el("span", null, "Music bed"));
        var ms = el("select"); ms.setAttribute("aria-label", "Music");
        (plan.music_menu || []).concat([{ key: "none", label: "No music", suits: "" }]).forEach(function (m) {
          var o = el("option", null, m.label); o.value = m.key; ms.appendChild(o);
        });
        ms.value = plan.music || "none";
        var hint = el("p", "vs-small");
        var player = el("audio"); player.controls = true; player.preload = "none"; player.className = "vs-music-play";
        function showMusic() {
          var m = (plan.music_menu || []).filter(function (x) { return x.key === ms.value; })[0];
          hint.textContent = m ? m.suits : "The video will be silent.";
          player.hidden = !m;
          if (m) player.src = BASE + "/music/" + m.key + ".mp3";
        }
        ms.addEventListener("change", function () { plan.music = ms.value; showMusic(); changed(); });
        mf.appendChild(ms); mp.appendChild(mf); mp.appendChild(hint); mp.appendChild(player);
        showMusic();
        side.appendChild(mp);
        var sp = panel("Share copy", "vs-share");
        (plan.share_suits || []).forEach(function (k) {
          var label = { linkedin: "LinkedIn", x: "X", instagram: "Instagram" }[k];
          sp.appendChild(textField(label, plan.share_copy[k], 0, function (x) { plan.share_copy[k] = x; }, true));
        });
        side.appendChild(sp);
      }

      // Saving and approving
      var bar = el("div", "vs-approve");
      var status = el("span", "vs-save", "All changes saved");
      var approve = btn("Approve and make the video", "sa-btn sa-btn--dark", function () {
        flush().then(function () {
          if (plan.problems && plan.problems.length) { showError("Fix the problems listed at the top first."); return; }
          approve.disabled = true;
          act("approve", {}).catch(function () { approve.disabled = false; });
        });
      });
      var other = btn("Try another idea", "sa-btn sa-btn--line", function () {
        other.disabled = true;
        flush().then(function () { return act("idea", {}); }).catch(function () { other.disabled = false; });
      });
      bar.appendChild(status); bar.appendChild(other); bar.appendChild(approve);
      stage.appendChild(bar);
      stage.appendChild(el("p", "vs-small vs-approve-note", "Approving starts the video: about 3 to 8 minutes. Try another idea makes a new plan, as a new version."));

      function payload() {
        var body = { scenes: plan.scenes, share_copy: plan.share_copy, cover_scene: plan.cover_scene, music: plan.music || "none" };
        if (brand) body.brand = brand;
        return body;
      }
      function changed() {
        dirty = true; status.textContent = "Saving…"; status.className = "vs-save";
        clearTimeout(saving); saving = setTimeout(save, 700);
      }
      function save() {
        if (!dirty) return Promise.resolve();
        dirty = false;
        var body = payload(), snap = JSON.stringify(body);
        if (snap === lastSaved) { status.textContent = "All changes saved"; return Promise.resolve(); }
        return api("POST", BASE + "/api/versions/" + v.id + "/plan", body).then(function (r) {
          lastSaved = snap;
          plan.problems = r.plan.problems; plan.notes = r.plan.notes;
          if (r.plan.brand) plan.brand = r.plan.brand;
          drawNotes();
          status.textContent = plan.problems.length ? plan.problems.length + " thing" + (plan.problems.length > 1 ? "s" : "") + " to fix" : "All changes saved";
          status.className = "vs-save" + (plan.problems.length ? " vs-bad" : "");
          approve.disabled = !!plan.problems.length;
        }).catch(function (e) { status.textContent = "Not saved"; status.className = "vs-save vs-bad"; showError(e.message); });
      }
      function flush() { clearTimeout(saving); return dirty ? save() : Promise.resolve(); }
      editor = { flush: flush };
      window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

      drawNotes(); drawScenes(); drawBrand();
      approve.disabled = !!(plan.problems && plan.problems.length);
      if (approve.disabled) status.textContent = plan.problems.length + " thing" + (plan.problems.length > 1 ? "s" : "") + " to fix";
    }

    // ── Making ────────────────────────────────────────────────────────────
    function drawMaking(v) {
      var p = panel(v.change ? "Making your change" : "Making the video", "vs-making");
      if (v.change) p.appendChild(el("p", "vs-change-q", "“" + v.change + "”"));
      var wrap = el("div", "vs-make");
      wrap.appendChild(stepList(v.making.steps));
      var frames = el("div", "vs-frames");
      if (v.making.frames.length) {
        v.making.frames.forEach(function (f) {
          var fig = el("figure"); var img = el("img"); img.src = f.url; img.alt = "Frame at " + secs(f.at); fig.appendChild(img);
          fig.appendChild(el("figcaption", null, secs(f.at))); frames.appendChild(fig);
        });
      } else {
        frames.appendChild(el("p", "pw-quiet", "Key frames appear here as they are checked."));
      }
      wrap.appendChild(frames);
      p.appendChild(wrap);
      p.appendChild(el("p", "vs-small", "About 3 to 8 minutes, longer for a 60-second video. You can leave this page: the video carries on and waits in your library."));
      stage.appendChild(p);
    }

    // ── The result ────────────────────────────────────────────────────────
    function drawResult(v) {
      var r = v.result;
      if (r.expired) {
        var gone = panel("This video's file was removed", "vs-failed");
        gone.appendChild(el("p", "vs-fail-msg", "Videos are kept for " + r.keep_days + " days. Its plan and layout are kept, so it can be made again in a few minutes."));
        var row0 = el("div", "vs-approve");
        var again0 = btn("Make it again", "sa-btn sa-btn--dark", function () { again0.disabled = true; act("retry", {}).catch(function () { again0.disabled = false; }); });
        row0.appendChild(again0); gone.appendChild(row0); stage.appendChild(gone);
        return;
      }
      var grid = el("div", "vs-result");
      var left = el("div", "vs-player vs-player--" + v.shape);
      var vid = el("video"); vid.controls = true; vid.playsInline = true; vid.preload = "metadata"; vid.src = r.mp4;
      if (r.cover) vid.poster = r.cover;
      left.appendChild(vid);
      grid.appendChild(left);
      var right = el("div", "vs-result-side");
      var dl = el("a", "sa-btn sa-btn--dark", "Download MP4"); dl.href = r.download; dl.setAttribute("download", "");
      var acts = el("div", "vs-result-acts"); acts.appendChild(dl);
      acts.appendChild(el("span", "vs-small", [v.shape_label, secs(v.seconds), r.mb + " MB", v.minutes ? v.minutes + " min to make" : "", v.cost_usd != null ? money(v.cost_usd) : ""].filter(Boolean).join(" · ")));
      right.appendChild(acts);
      if (r.music) {
        var credit = el("p", "vs-small vs-music-credit");
        credit.appendChild(document.createTextNode("Music: " + r.music.label + ". Credit line, optional to add to your post: "));
        var ml = el("a", null, r.music.credit); ml.href = r.music.url; ml.target = "_blank"; ml.rel = "noopener";
        credit.appendChild(ml);
        right.appendChild(credit);
      }
      if (r.share.length) {
        var sp = panel("Share text", "vs-share-out");
        r.share.forEach(function (s) {
          var row = el("div", "vs-share-row");
          var h = el("div", "vs-share-h"); h.appendChild(el("b", null, s.label));
          var copy = btn("Copy", "vs-tool", function () {
            (navigator.clipboard ? navigator.clipboard.writeText(s.text) : Promise.reject()).then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1600); })
              .catch(function () { var ta = el("textarea"); ta.value = s.text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); copy.textContent = "Copied"; } catch (e) {} ta.remove(); });
          });
          h.appendChild(copy); row.appendChild(h); row.appendChild(el("p", null, s.text)); sp.appendChild(row);
        });
        right.appendChild(sp);
      }
      var ch = panel("Make changes", "vs-changes");
      var ta = el("textarea"); ta.rows = 3; ta.maxLength = 1000; ta.placeholder = "Slower. Bigger logo. Swap scenes 2 and 3. End on 'Start free'.";
      ta.setAttribute("aria-label", "What to change");
      var ex = el("div", "pw-examples");
      ["Slower", "Bigger logo", "Swap scenes 2 and 3", "Shorter headlines", "End on the free trial"].forEach(function (x) {
        ex.appendChild(btn(x, null, function () { ta.value = ta.value ? ta.value.replace(/\.?\s*$/, ". ") + x : x; ta.focus(); }));
      });
      var go = btn("Make the change", "sa-btn sa-btn--dark", function () {
        go.disabled = true; act("change", { request: ta.value }).catch(function () { go.disabled = false; });
      });
      ch.appendChild(ta); ch.appendChild(ex); ch.appendChild(go);
      ch.appendChild(el("p", "vs-small", "A change makes a new version and keeps this one. Changes to words only take about 2 minutes."));
      right.appendChild(ch);
      var sh = panel("Make another shape", "vs-shapes-out");
      var row = el("div", "vs-shape-btns");
      r.other_shapes.forEach(function (s) {
        var b = btn(s.label, "sa-btn sa-btn--line", function () { b.disabled = true; act("shape", { shape: s.key }).catch(function () { b.disabled = false; }); });
        row.appendChild(b);
      });
      sh.appendChild(row);
      sh.appendChild(el("p", "vs-small", "The same video, laid out again for the new shape, not cropped."));
      right.appendChild(sh);
      grid.appendChild(right);
      stage.appendChild(grid);
    }

    // ── Failed ────────────────────────────────────────────────────────────
    function drawFailed(v) {
      var p = panel(v.plan ? "The video could not be made" : "The plan could not be made", "vs-failed");
      p.appendChild(el("p", "vs-fail-msg", v.error || "Something went wrong."));
      if (v.reading) p.appendChild(stepList(v.reading.steps));
      if (v.making) p.appendChild(stepList(v.making.steps));
      var row = el("div", "vs-approve");
      var again = btn("Try again", "sa-btn sa-btn--dark", function () { again.disabled = true; act("retry", {}).catch(function () { again.disabled = false; }); });
      row.appendChild(again);
      if (v.plan) row.appendChild(btn("Try another idea", "sa-btn sa-btn--line", function () { act("idea", {}); }));
      p.appendChild(row);
      stage.appendChild(p);
    }

    // ── The modal ─────────────────────────────────────────────────────────
    var modal = $("#vs-modal"), lastFocus = null;
    function openModal(title, body) {
      lastFocus = document.activeElement;
      $("#vs-modal-h").textContent = title;
      var b = $("#vs-modal-body"); b.textContent = ""; b.appendChild(body);
      modal.hidden = false; document.body.classList.add("vs-locked");
      var first = $("button, input, select", b) || $("[data-close]", modal); if (first) first.focus();
    }
    function closeModal() {
      modal.hidden = true; document.body.classList.remove("vs-locked");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    modal.addEventListener("click", function (e) { if (e.target === modal || e.target.hasAttribute("data-close")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });

    set(V, true);
  }

  // ════════════════════════════════════════════════════════════════════════
  // SAVED BRANDS
  // ════════════════════════════════════════════════════════════════════════
  function Brands(root) {
    var D = data(), grid = $("#vs-brand-grid"), FONTS = D.fonts || [];
    function form(b) {
      var isNew = !b;
      b = b || { client: "", colors: { background: "#ffffff", text: "#111111", accent: "#2f5bea" }, fonts: { heading: "Inter", body: "Inter" }, logo: null };
      var card = el("form", "vs-panel vs-brand-card"); card.noValidate = true;
      card.appendChild(el("h2", "vs-h3", isNew ? "Add a brand" : b.client));
      var name = null;
      if (isNew) {
        var nf = el("label", "pw-field"); nf.appendChild(el("span", null, "Client"));
        name = el("input"); name.maxLength = 120; name.placeholder = "Acme"; nf.appendChild(name); card.appendChild(nf);
      }
      var vals = { background: b.colors.background || "#ffffff", text: b.colors.text || "#111111", accent: b.colors.accent || "#2f5bea" };
      var prev = el("div", "vs-brand-prev");
      function paint() { prev.style.background = vals.background; prev.style.color = vals.text; pill.style.background = vals.accent; }
      var logoImg = el("img"); logoImg.alt = "Logo"; if (b.logo) logoImg.src = b.logo + "&t=" + Date.now(); else logoImg.hidden = true;
      prev.appendChild(logoImg); prev.appendChild(el("b", null, "Headline")); var pill = el("span", null, "Action"); prev.appendChild(pill);
      card.appendChild(prev);
      var row = el("div", "vs-colour-set");
      [["background", "Background"], ["text", "Text"], ["accent", "Accent"]].forEach(function (c) {
        var f = el("label", "vs-colour-pick");
        var i = el("input"); i.type = "color"; i.value = vals[c[0]]; i.setAttribute("aria-label", c[1] + " colour");
        i.addEventListener("input", function () { vals[c[0]] = i.value; paint(); });
        f.appendChild(i); f.appendChild(el("span", null, c[1])); row.appendChild(f);
      });
      card.appendChild(row);
      var fonts = {};
      [["heading_font", "Heading font", b.fonts.heading], ["body_font", "Body font", b.fonts.body]].forEach(function (r) {
        var f = el("label", "pw-field"); f.appendChild(el("span", null, r[1]));
        var s = el("select"); FONTS.forEach(function (x) { var o = el("option", null, x); o.value = x; s.appendChild(o); });
        s.value = FONTS.indexOf(r[2]) >= 0 ? r[2] : "Inter"; fonts[r[0]] = s; f.appendChild(s); card.appendChild(f);
      });
      var sf = el("label", "pw-field"); sf.appendChild(el("span", null, "Slack channel for finished videos"));
      var slack = el("input"); slack.maxLength = 81; slack.placeholder = "#client-videos (optional)"; slack.value = b.slack_channel ? "#" + b.slack_channel : "";
      sf.appendChild(slack); card.appendChild(sf);
      var lf = el("label", "pw-field"); lf.appendChild(el("span", null, b.logo ? "Replace the logo" : "Logo"));
      var logo = el("input"); logo.type = "file"; logo.accept = "image/png,image/jpeg,image/webp"; lf.appendChild(logo); card.appendChild(lf);
      var removeLogo = false;
      var acts = el("div", "vs-approve");
      if (b.logo) acts.appendChild(btn("Remove the logo", "pw-link-btn", function () { removeLogo = true; logoImg.hidden = true; }));
      if (!isNew) acts.appendChild(btn("Delete", "pw-link-btn", function () {
        if (!window.confirm("Delete the saved brand for " + b.client + "?")) return;
        api("POST", BASE + "/api/brands", { delete: true, client: b.client }).then(function (r) { D.brands = r.brands; draw(); }).catch(function (e) { showError(e.message); });
      }));
      var save = btn(isNew ? "Save the brand" : "Save", "sa-btn sa-btn--dark", function () {
        showError("");
        var body = { client: isNew ? name.value : b.client, background: vals.background, text: vals.text, accent: vals.accent,
          heading_font: fonts.heading_font.value, body_font: fonts.body_font.value, remove_logo: removeLogo,
          slack_channel: slack.value };
        var p = logo.files[0] ? readFile(logo.files[0]).then(function (d) { body.logo = d; }) : Promise.resolve();
        save.disabled = true;
        p.then(function () { return api("POST", BASE + "/api/brands", body); })
          .then(function (r) { D.brands = r.brands; draw(); toastB("Saved."); })
          .catch(function (e) { save.disabled = false; showError(e.message); });
      });
      acts.appendChild(save);
      card.appendChild(acts);
      paint();
      return card;
    }
    function toastB(text) {
      var t = el("div", "vs-toast", text); document.body.appendChild(t);
      setTimeout(function () { t.classList.add("is-out"); setTimeout(function () { t.remove(); }, 400); }, 2400);
    }
    function draw() {
      grid.textContent = "";
      (D.brands || []).forEach(function (b) { grid.appendChild(form(b)); });
      grid.appendChild(form(null));
    }
    draw();
  }

  function boot() {
    if ($("#vs-home")) Home($("#vs-home"));
    if ($("#vs-video")) Video($("#vs-video"));
    if ($("#vs-brands")) Brands($("#vs-brands"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
