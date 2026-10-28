/* The public site (templates/site/): the behaviour, and only the behaviour.
   The motion is press-play.js's, shared with the previous site; this file is
   the masthead, the phone menu, the reveals, the story steps, the agent
   filter and the booking form. Every page reads complete without it; the
   form then can't send, and says so. */
(function () {
  "use strict";
  var doc = document;

  /* ── The masthead and the reading rule ── */
  var nv = doc.getElementById("nv"), prog = doc.getElementById("prog");
  function onScroll() {
    var y = window.scrollY;
    if (nv) nv.classList.toggle("stuck", y > 8);
    if (prog) {
      var h = doc.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = (h > 0 ? (y / h * 100) : 0) + "%";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── The phone menu ── */
  var burger = doc.getElementById("burger"), sheet = doc.getElementById("sheet");
  function menu(open) {
    if (!sheet) return;
    sheet.classList.toggle("open", open);
    sheet.setAttribute("aria-hidden", open ? "false" : "true");
    doc.body.classList.toggle("menu-open", open);
    if (burger) burger.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (burger) burger.addEventListener("click", function () { menu(!sheet.classList.contains("open")); });
  if (sheet) sheet.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { menu(false); }); });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape") menu(false); });
  window.addEventListener("resize", function () { if (window.innerWidth > 1200) menu(false); });

  /* ── The reveal ──
     One observer, one class: .rv gets .in as it comes into view, and
     press.css decides whether a line rises, a rule draws or a paragraph
     fades. A colour block (.blk) gets .settled the same way. Nothing here
     gives any element a delay of its own. */
  function onView(sel, cls, opts) {
    var els = doc.querySelectorAll(sel);
    if (!("IntersectionObserver" in window)) { els.forEach(function (el) { el.classList.add(cls); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } });
    }, opts);
    els.forEach(function (el) { io.observe(el); });
  }
  onView(".rv", "in", { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  onView(".blk", "settled", { threshold: 0.12 });

  /* ── The story ──
     The figure is held by position:sticky; this marks the step being read,
     and lets a step change the figure's caption (data-tag) or light one of
     its rows (data-row). */
  var story = doc.getElementById("story");
  if (story && "IntersectionObserver" in window) {
    var steps = Array.prototype.slice.call(story.querySelectorAll(".story-step"));
    var tag = story.querySelector("[data-story-tag]"), rows = story.querySelectorAll("[data-plan-row]");
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = steps.indexOf(e.target), step = e.target;
        steps.forEach(function (s, j) { s.classList.toggle("on", j === i); });
        if (tag && step.getAttribute("data-tag")) tag.textContent = step.getAttribute("data-tag");
        var row = step.getAttribute("data-row");
        rows.forEach(function (r) { r.classList.toggle("on", r.getAttribute("data-plan-row") === row); });
      });
    }, { threshold: 0.6, rootMargin: "-25% 0px -25% 0px" });
    steps.forEach(function (s) { sio.observe(s); });
  }

  /* ── The directory filter: the agents, and the signal library ──
     The chips pick a group; on /signals a search box narrows it further
     (each card carries its words in data-q), a line under the chips says
     what the group is (data-note), and a note shows when nothing matches.
     press-play.js, when motion is on, glides the cards to their new places. */
  var grid = doc.getElementById("dirCards");
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".ag"));
    var chips = Array.prototype.slice.call(doc.querySelectorAll("#dirChips .chip"));
    var search = doc.getElementById("dirSearch"), note = doc.getElementById("dirNote"),
        empty = doc.getElementById("dirEmpty");
    var cat = "all", words = [];
    var apply = function () {
      var shown = 0;
      cards.forEach(function (c) {
        var q = c.getAttribute("data-q") || "";
        var ok = (cat === "all" || c.getAttribute("data-cat") === cat) &&
                 words.every(function (w) { return q.indexOf(w) !== -1; });
        c.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (empty) empty.style.display = shown ? "" : "block";
    };
    var run = function () { if (window.pressFlip) window.pressFlip(cards, apply); else apply(); };
    chips.forEach(function (ch) {
      ch.addEventListener("click", function () {
        chips.forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        ch.classList.add("on"); ch.setAttribute("aria-pressed", "true");
        cat = ch.getAttribute("data-cat") || "all";
        if (note && ch.getAttribute("data-note")) note.textContent = ch.getAttribute("data-note");
        run();
      });
    });
    if (search) {
      var timer;
      search.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
          run();
        }, 120);
      });
    }
  }

  /* ── The booking form (/book) ──
     Posts to the same intake as before (the Sheet, Slack and email). */
  var form = doc.getElementById("bookForm");
  if (!form) return;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var spendField = doc.getElementById("f-spend");
  var showSpend = function () {
    var p = (form.querySelector("input[name=pillar]:checked") || {}).value || "";
    if (spendField) spendField.hidden = p.indexOf("Performance") === -1 && p !== "Both";
  };
  form.addEventListener("change", showSpend);
  showSpend();
  var nameIn = form.elements.name, emailIn = form.elements.email;
  nameIn.addEventListener("input", function () { doc.getElementById("f-name").classList.toggle("ok", nameIn.value.trim().length > 1); });
  emailIn.addEventListener("input", function () {
    var ok = EMAIL.test(emailIn.value.trim()), f = doc.getElementById("f-email");
    f.classList.toggle("ok", ok); if (ok) f.classList.remove("bad");
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = doc.getElementById("formErr"), btn = doc.getElementById("formSend");
    var val = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
    var name = val("name"), email = val("email");
    doc.getElementById("f-name").classList.toggle("bad", !name);
    doc.getElementById("f-email").classList.toggle("bad", !EMAIL.test(email));
    if (!name || !EMAIL.test(email)) { err.textContent = "Please enter your name and a valid work email."; return; }
    err.textContent = "";
    btn.disabled = true; btn.classList.add("loading"); btn.textContent = "Sending…";
    var vid = ""; try { vid = localStorage.getItem("p2_vid") || ""; } catch (_) {}
    fetch("/api/demo-request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name, email: email, company: val("company"), website: val("website"),
        sells: val("sells"), meet: val("meet"), pillar: val("pillar"), spend: val("spend"),
        country: val("country"), message: val("message"), source: "book page", vid: vid
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false; btn.classList.remove("loading"); btn.textContent = "Send";
        if (res.ok && res.d && res.d.ok) {
          var box = btn.getBoundingClientRect();
          form.hidden = true;
          doc.getElementById("formDone").classList.add("on");
          if (window.pressBurst) window.pressBurst(box.left + box.width / 2, box.top + box.height / 2, 64);
          try { doc.dispatchEvent(new CustomEvent("p2:lead_submit", { detail: { interest: val("pillar") } })); } catch (_) {}
          try { if (window.track) window.track("lead_submit", { interest: val("pillar") }); } catch (_) {}
        } else {
          err.textContent = (res.d && res.d.error) || "Something went wrong. Please try again.";
        }
      })
      .catch(function () {
        btn.disabled = false; btn.classList.remove("loading"); btn.textContent = "Send";
        err.textContent = "We couldn’t send that just now. Please try again in a moment.";
      });
  });
})();
