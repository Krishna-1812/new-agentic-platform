/* ════════════════════════════════════════════════════════════════════════
   ACCOUNT PICKER — one client account at a time, from anywhere

   Anything with [data-acct-picker] opens it: the switch in every page's top
   bar, the hub's headline, an account's own title. Picking an account goes to
   /<account>/<page>, where <page> is the trigger's data-acct-page: the same
   page for the other account ("google-ads" on the Google Ads dashboard), or
   the account's home (""). "All accounts" goes to the global page that
   mirrors it (data from the server: ACCT_GLOBAL in app.py).

   The list is the page's own (#acct-data, embedded by the hub and the
   account pages) or /api/accounts, fetched the first time the picker or the
   command palette opens. Rows are real links, so a middle click opens a tab,
   and hovering one lets the browser prerender it (the speculation rules
   below), so the account opens at once. Its name and mark carry across to
   the next page (view-transition-name), so the row you picked becomes the
   page's title rather than the page being replaced under you.

   Built with textContent only; nothing from the data is parsed as HTML.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  if (window.__acctPicker) return;
  window.__acctPicker = 1;

  var DATA = null, LOADING = null, layer = null, panel = null, input = null, list = null, here = null;
  var opts = [], active = -1, trigger = null, lastFocus = null;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var RECENT_KEY = "acct.recent";

  /* ── Data ─────────────────────────────────────────────────────────── */
  function embedded() {
    var el = document.getElementById("acct-data");
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (LOADING) return LOADING;
    var own = embedded();
    if (own && own.accounts) { DATA = own; return Promise.resolve(DATA); }
    LOADING = fetch("/api/accounts", { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { DATA = d && d.accounts ? d : { accounts: [], global: {}, error: (d && d.error) || "" }; return DATA; })
      .catch(function () { LOADING = null; return { accounts: [], global: {}, error: "The accounts could not be loaded. Check your connection." }; });
    return LOADING;
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 4); } catch (e) { return []; }
  }

  function remember(slug) {
    if (!slug) return;
    try {
      var r = recent().filter(function (s) { return s !== slug; });
      r.unshift(slug);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 4)));
    } catch (e) { /* private window: nothing to remember */ }
  }

  /* ── Small builders ───────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(paths, cls) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    paths.forEach(function (d) {
      var p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }
  var ICON_ALL = ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"];
  var ICON_SEARCH = ["M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z", "m20 20-3.5-3.5"];

  function avatar(a, cls) {
    var av = el("span", "ap-av" + (cls ? " " + cls : ""));
    if (a) {
      av.textContent = a.avatar.initials;
      av.style.setProperty("--av-bg", a.avatar.bg);
      av.style.setProperty("--av-fg", a.avatar.fg);
    } else {
      av.classList.add("ap-av--all");
      av.appendChild(svg(ICON_ALL));
    }
    return av;
  }

  function spark(values) {
    var w = 64, h = 22, s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("class", "ap-spark");
    s.setAttribute("aria-hidden", "true");
    if (!values || values.length < 2) return s;
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values), span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      return [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)];
    });
    var line = document.createElementNS(SVGNS, "path");
    line.setAttribute("d", pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(""));
    s.appendChild(line);
    return s;
  }

  /* Text with the matched words marked, as nodes. */
  function marked(text, q) {
    var frag = document.createDocumentFragment();
    if (!q) { frag.appendChild(document.createTextNode(text)); return frag; }
    var low = text.toLowerCase(), i = 0, words = q.split(/\s+/).filter(Boolean), spans = [];
    words.forEach(function (w) {
      var at = low.indexOf(w);
      if (at >= 0) spans.push([at, at + w.length]);
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    spans.forEach(function (sp) {
      if (sp[0] < i) return;
      frag.appendChild(document.createTextNode(text.slice(i, sp[0])));
      frag.appendChild(el("mark", "", text.slice(sp[0], sp[1])));
      i = sp[1];
    });
    frag.appendChild(document.createTextNode(text.slice(i)));
    return frag;
  }

  function matches(a, q) {
    if (!q) return true;
    var hay = [a.name, a.domain, a.industry, (a.locations || []).join(" "), a.slug].join(" ").toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function hrefFor(a, page) {
    var has = (a.pages || []).some(function (p) { return p.page === page; });
    return "/" + a.slug + (page && has ? "/" + page : "");
  }

  /* The account this page is for: the top bar's switch says (data-acct-current). */
  function pill() { return document.querySelector(".ap-pill[data-acct-picker]"); }
  function currentSlug() { var p = pill(); return (p && p.getAttribute("data-acct-current")) || ""; }
  function currentPage() { var p = pill(); return (p && p.getAttribute("data-acct-page")) || ""; }

  /* ── The panel ────────────────────────────────────────────────────── */
  function build() {
    layer = el("div", "ap-layer");
    layer.hidden = true;
    panel = el("div", "ap-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Switch account");
    var head = el("div", "ap-head");
    head.appendChild(svg(ICON_SEARCH, "ap-head-ic"));
    input = el("input", "ap-input");
    input.type = "text";
    input.placeholder = "Find an account";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "ap-list");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-label", "Find an account");
    head.appendChild(input);
    var close = el("button", "ap-esc", "esc");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", hide);
    head.appendChild(close);
    here = el("div", "ap-here");
    list = el("div", "ap-list");
    list.id = "ap-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Accounts");
    var foot = el("div", "ap-foot");
    [["↑↓", "move"], ["↵", "open"], ["esc", "close"]].forEach(function (k) {
      var s = el("span");
      s.appendChild(el("kbd", "", k[0]));
      s.appendChild(document.createTextNode(" " + k[1]));
      foot.appendChild(s);
    });
    panel.appendChild(head);
    panel.appendChild(here);
    panel.appendChild(list);
    panel.appendChild(foot);
    layer.appendChild(panel);
    document.body.appendChild(layer);

    input.addEventListener("input", function () { draw(); });
    input.addEventListener("keydown", onKey);
    layer.addEventListener("mousedown", function (e) { if (e.target === layer) hide(); });
    list.addEventListener("mousemove", function (e) {
      var o = e.target.closest(".ap-opt");
      if (o) setActive(opts.indexOf(o), true);
    });
    list.addEventListener("click", function (e) {
      var o = e.target.closest(".ap-opt");
      if (o && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) choose(o, e);
    });
  }

  function option(href, a, sub, extra) {
    var o = el("a", "ap-opt");
    o.href = href;
    o.id = "ap-o-" + opts.length;
    o.setAttribute("role", "option");
    o.setAttribute("aria-selected", "false");
    o.setAttribute("data-acct-go", a ? (href === "/" + a.slug ? "home" : "page") : "all");
    if (a) o.setAttribute("data-slug", a.slug);
    o.appendChild(avatar(a));
    var t = el("span", "ap-opt-t");
    var name = el("span", "ap-opt-name");
    name.appendChild(marked(a ? a.name : "All accounts", input.value.trim().toLowerCase()));
    t.appendChild(name);
    if (sub) t.appendChild(el("span", "ap-opt-sub", sub));
    o.appendChild(t);
    if (extra) o.appendChild(extra);
    opts.push(o);
    return o;
  }

  function figure(a) {
    var box = el("span", "ap-fig");
    if (a.spend_fmt) {
      box.appendChild(spark(a.spark));
      var v = el("span", "ap-fig-v");
      v.appendChild(el("b", "", a.spend_fmt));
      v.appendChild(el("small", "", "30 days"));
      box.appendChild(v);
    } else {
      box.appendChild(el("span", "ap-fig-none", a.has_ads ? "No spend" : "No Google Ads"));
    }
    return box;
  }

  function subline(a) {
    return [a.domain, a.industry].filter(Boolean).join(" · ") || (a.has_ads ? "Google Ads" : "From the master doc");
  }

  function group(label) {
    var g = el("div", "ap-group", label);
    g.setAttribute("role", "presentation");
    list.appendChild(g);
  }

  function draw() {
    var q = input.value.trim().toLowerCase(), page = trigger ? (trigger.getAttribute("data-acct-page") || "") : "";
    opts = [];
    while (list.firstChild) list.removeChild(list.firstChild);
    var accts = (DATA && DATA.accounts) || [], cur = currentSlug();
    var global = (DATA && DATA.global) || {};

    if (!q && !(DATA && DATA.client)) {   // a client has no "all accounts": only their own
      var allHref = global[page] || "/hub";
      list.appendChild(option(allHref, null, "Every client, across the workspace"));
    }
    var seen = {};
    var rec = q ? [] : recent().map(function (s) {
      return accts.filter(function (a) { return a.slug === s; })[0];
    }).filter(function (a) { return a && a.slug !== cur; }).slice(0, 3);
    if (rec.length) {
      group("Recent");
      rec.forEach(function (a) { seen[a.slug] = 1; list.appendChild(option(hrefFor(a, page), a, subline(a), figure(a))); });
    }
    var rest = accts.filter(function (a) { return !seen[a.slug] && matches(a, q); });
    if (accts.length && (!q || rest.length)) group(q ? rest.length + (rest.length === 1 ? " match" : " matches") : "Accounts · " + accts.length);
    rest.forEach(function (a) {
      var o = option(hrefFor(a, page), a, subline(a), figure(a));
      if (a.slug === cur) { o.classList.add("is-current"); o.setAttribute("aria-current", "page"); }
      list.appendChild(o);
    });
    if (q && !rest.length) {
      var empty = el("div", "ap-empty");
      empty.appendChild(el("b", "", "No account matches “" + input.value.trim() + "”"));
      empty.appendChild(el("span", "", "Accounts come from Google Ads and the master doc's tabs."));
      list.appendChild(empty);
    }
    if (DATA && DATA.error) list.appendChild(el("div", "ap-empty", DATA.error));
    if (!DATA) {
      for (var i = 0; i < 5; i++) list.appendChild(el("div", "ap-skel"));
    }
    /* Start on the first account that is not this one: you opened the switch to go somewhere else. */
    var start = -1;
    for (var k = 0; k < opts.length; k++) {
      if ((q || opts[k].getAttribute("data-slug")) && !opts[k].classList.contains("is-current")) { start = k; break; }
    }
    setActive(start >= 0 ? start : (opts.length ? 0 : -1));
  }

  function drawHere() {
    while (here.firstChild) here.removeChild(here.firstChild);
    var cur = currentSlug(), a = DATA && (DATA.accounts || []).filter(function (x) { return x.slug === cur; })[0];
    here.hidden = !a;
    if (!a) return;
    var page = currentPage();
    here.appendChild(el("span", "ap-here-l", "In " + a.name));
    var nav = el("span", "ap-here-pages");
    (a.pages || []).forEach(function (p) {
      var l = el("a", "ap-chip" + (p.page === page ? " is-on" : ""), p.label);
      l.href = "/" + a.slug + (p.page ? "/" + p.page : "");
      if (p.page === page) l.setAttribute("aria-current", "page");
      nav.appendChild(l);
    });
    here.appendChild(nav);
  }

  function setActive(i, fromMouse) {
    if (active >= 0 && opts[active]) { opts[active].classList.remove("is-active"); opts[active].setAttribute("aria-selected", "false"); }
    active = i;
    if (i >= 0 && opts[i]) {
      opts[i].classList.add("is-active");
      opts[i].setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", opts[i].id);
      if (!fromMouse) opts[i].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active + 1, opts.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === "Home" && !input.value) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && !input.value) { e.preventDefault(); setActive(opts.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (opts[active]) choose(opts[active], e); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
    else if (e.key === "Tab") { e.preventDefault(); setActive(e.shiftKey ? Math.max(active - 1, 0) : Math.min(active + 1, opts.length - 1)); }
  }

  /* The chosen row's name and mark become the next page's title and mark. */
  function choose(o, e) {
    if (e) e.preventDefault();
    var href = o.getAttribute("href");
    if (href === location.pathname) { hide(); return; }
    carry(o.querySelector(".ap-opt-name"), o.querySelector(".ap-av"));
    remember(o.getAttribute("data-slug"));
    o.classList.add("is-going");
    location.href = href;
  }

  function carry(nameEl, avEl) {
    document.querySelectorAll("[data-vt-name]").forEach(function (n) { n.style.viewTransitionName = "none"; });
    if (nameEl) nameEl.style.viewTransitionName = "acct-name";
    if (avEl) avEl.style.viewTransitionName = "acct-av";
  }
  window.acctCarry = carry;

  /* ── Open and close ───────────────────────────────────────────────── */
  function place() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (vw <= 640 || !trigger) { panel.classList.add("is-sheet"); panel.style.cssText = ""; return; }
    panel.classList.remove("is-sheet");
    var r = trigger.getBoundingClientRect(), w = Math.min(460, vw - 32);
    var left = Math.max(16, Math.min(r.left, vw - w - 16)), top = Math.min(r.bottom + 10, vh - 260);
    panel.style.width = w + "px";
    panel.style.left = left + "px";
    panel.style.top = Math.max(16, top) + "px";
    panel.style.maxHeight = Math.max(240, vh - Math.max(16, top) - 16) + "px";
    panel.style.transformOrigin = Math.max(0, Math.min(w, r.left + r.width / 2 - left)) + "px -8px";
  }

  function show(t) {
    if (!layer) build();
    trigger = t || pill();
    lastFocus = document.activeElement;
    input.value = "";
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    place();
    layer.hidden = false;
    document.documentElement.classList.add("ap-open");
    requestAnimationFrame(function () { layer.classList.add("is-on"); });
    draw();
    if (DATA) drawHere(); else here.hidden = true;
    load().then(function () { if (!layer.hidden) { draw(); drawHere(); } });
    setTimeout(function () { input.focus(); }, REDUCED ? 0 : 20);
  }

  function hide() {
    if (!layer || layer.hidden) return;
    layer.classList.remove("is-on");
    document.documentElement.classList.remove("ap-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    setTimeout(function () { if (!layer.classList.contains("is-on")) layer.hidden = true; }, REDUCED ? 0 : 160);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  window.acctPicker = { open: show, close: hide, load: load };

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-acct-picker]");
    if (!t) return;
    e.preventDefault();
    if (layer && !layer.hidden && trigger === t) hide(); else show(t);
  });
  /* Warm the list as soon as a hand heads for the switch. */
  document.addEventListener("pointerover", function (e) {
    if (e.target.closest && e.target.closest("[data-acct-picker]")) load();
  }, { passive: true });
  document.addEventListener("focusin", function (e) {
    if (e.target.closest && e.target.closest("[data-acct-picker]")) load();
  });
  window.addEventListener("resize", function () { if (layer && !layer.hidden) place(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && layer && !layer.hidden) hide();
  });

  /* Account links elsewhere on the page (the hub's cards) carry their name across too. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-acct-card]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    carry(a.querySelector("[data-card-name]"), a.querySelector(".ap-av"));
    remember(a.getAttribute("data-acct-card"));
  });

  /* The command palette lists the accounts too. */
  document.addEventListener("bn:palette-open", function () {
    load().then(function (d) {
      if (!window.bentoPaletteAdd || !d || !d.accounts) return;
      window.bentoPaletteAdd(d.accounts.map(function (a) {
        return { t: a.name, d: "Account" + (a.domain ? " · " + a.domain : ""), u: "/" + a.slug, k: a.avatar.initials.charAt(0) };
      }));
    });
  });

  /* An account page remembers itself as recent. */
  document.addEventListener("DOMContentLoaded", function () { remember(currentSlug()); });
})();
