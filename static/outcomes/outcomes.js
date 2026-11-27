/* Outcomes Digital (/outcomesdigital): the behaviour its pages add to the Northaxis site's (site.js,
   press-play.js). The menus open on a tap as well as on hover, and the two calculators move. Every page
   reads complete without this file: the calculators are set out with their starting numbers. */
(function () {
  "use strict";
  var doc = document;

  /* ── Services and Industries: a tap opens the menu, a tap elsewhere or Escape closes it ── */
  var menus = Array.prototype.slice.call(doc.querySelectorAll(".od-menu"));
  function close(except) {
    menus.forEach(function (m) {
      if (m === except) return;
      m.classList.remove("open");
      m.querySelector(".od-menu-btn").setAttribute("aria-expanded", "false");
    });
  }
  menus.forEach(function (m) {
    var b = m.querySelector(".od-menu-btn");
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !m.classList.contains("open");
      close(m);
      m.classList.toggle("open", open);
      b.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  doc.addEventListener("click", function () { close(null); });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape") close(null); });

  /* ── The slides at the top of the home page ──
     The track already scrolls and snaps on its own; this adds the tabs' progress, autoplay (held while
     the pointer or focus is on the slides or the tab is hidden, and never with reduced motion), the
     arrows and the keyboard, keeps the slides out of view out of the tab order, eases the track's
     height on narrow screens, and replays a slide's entrance each time it comes into view. */
  var slider = doc.getElementById("highlights");
  if (slider) {
    var track = doc.getElementById("odSlides");
    var slides = Array.prototype.slice.call(track.querySelectorAll(".od-slide"));
    var tabs = Array.prototype.slice.call(slider.querySelectorAll(".od-tab"));
    var playBtn = slider.querySelector(".od-ctl-play");
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var narrow = window.matchMedia ? matchMedia("(max-width: 1000px)") : { matches: false };
    var secs = +slider.getAttribute("data-seconds") || 8;
    var cur = 0, timer = null, stopped = still, held = false;
    slider.style.setProperty("--secs", secs + "s");

    var fit = function () {
      track.style.height = narrow.matches ? slides[cur].offsetHeight + "px" : "";
    };
    /* The figures count up from nought: only a plain number with a sign or unit ("$1,000", "74%+", "2x",
       "29th"), never a time, a range or a word. The words stay in the page for anyone without the script. */
    var count = function (slide) {
      Array.prototype.forEach.call(slide.querySelectorAll(".od-proof-row dd, .od-board-out b, .od-board-sum b"), function (el) {
        var txt = el.getAttribute("data-n") || el.textContent;
        el.setAttribute("data-n", txt);
        var m = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(txt);
        if (!m || /[A-Za-z]/.test(m[1]) || /\d/.test(m[3])) return;
        var end = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length, comma = m[2].indexOf(",") > -1;
        var run = (el._odRun || 0) + 1, t0 = 0;
        el._odRun = run;
        var fmt = function (v) {
          var n = comma ? Math.round(v).toLocaleString("en-US") : v.toFixed(dec);
          return m[1] + n + m[3];
        };
        var step = function (ts) {
          if (el._odRun !== run) return;
          if (!t0) t0 = ts;
          var p = Math.min(1, (ts - t0) / 1400);
          el.textContent = p < 1 ? fmt(end * (1 - Math.pow(1 - p, 3))) : txt;
          if (p < 1) requestAnimationFrame(step);
        };
        el.textContent = fmt(0);
        setTimeout(function () { requestAnimationFrame(step); }, 350);
      });
    };
    var replay = function (slide) {
      /* The headline rises, the highlighter sweeps, the card's rows arrive and the figures count, each time
         the slide comes into view. The reset itself is instant (.od-replay turns transitions off), so nothing
         is seen easing back out. */
      var rv = slide.querySelectorAll(".rv");
      slide.classList.add("od-replay");
      Array.prototype.forEach.call(rv, function (el) { el.classList.remove("in"); });
      void slide.offsetWidth;
      slide.classList.remove("od-replay");
      void slide.offsetWidth;
      Array.prototype.forEach.call(rv, function (el) { el.classList.add("in"); });
      count(slide);
    };
    var mark = function (i, fromScroll) {
      if (i === cur && slides[i].classList.contains("is-on")) return;
      cur = i;
      slides.forEach(function (s, k) {
        var on = k === i;
        s.classList.toggle("is-on", on);
        if ("inert" in s) s.inert = !on;
        s.setAttribute("aria-hidden", on ? "false" : "true");
      });
      tabs.forEach(function (t, k) {
        t.classList.toggle("on", k === i);
        if (k === i) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current");
        /* Restart the progress bar for the tab now showing. */
        var bar = t.querySelector(".od-tab-bar i");
        bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
      });
      if (!still) replay(slides[i]);
      /* On narrow screens the track takes the new slide's height once the scroll has landed: changing it
         mid-scroll makes the browser snap back to the slide it left. */
      if (fromScroll || !narrow.matches) fit();
      if (!fromScroll) restart();
    };
    var go = function (i) {
      i = (i + slides.length) % slides.length;
      track.scrollTo({ left: i * track.clientWidth, behavior: still ? "auto" : "smooth" });
      mark(i, false);
    };
    var restart = function () {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(function () { if (!held && !doc.hidden) go(cur + 1); else restart(); }, secs * 1000);
    };
    var setPlaying = function () {
      slider.classList.toggle("is-playing", !stopped);
      slider.classList.toggle("is-held", held);
      track.setAttribute("aria-live", stopped ? "polite" : "off");
      if (playBtn) {
        playBtn.setAttribute("aria-pressed", stopped ? "true" : "false");
        playBtn.setAttribute("aria-label", stopped ? "Play the slides" : "Pause the slides");
      }
    };

    /* Swipes and trackpad scrolls land on a slide: follow them. */
    var settle = null;
    track.addEventListener("scroll", function () {
      clearTimeout(settle);
      settle = setTimeout(function () {
        var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (i !== cur) { mark(i, true); restart(); } else fit();
      }, 90);
    }, { passive: true });
    tabs.forEach(function (t, k) {
      t.addEventListener("click", function (e) { e.preventDefault(); go(k); });
    });
    Array.prototype.forEach.call(slider.querySelectorAll("[data-step]"), function (b) {
      b.addEventListener("click", function () { go(cur + (+b.getAttribute("data-step"))); });
    });
    slider.addEventListener("keydown", function (e) {
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); }
    });
    var hold = function (v) { held = v; setPlaying(); };
    slider.addEventListener("mouseenter", function () { hold(true); });
    slider.addEventListener("mouseleave", function () { hold(false); });
    slider.addEventListener("focusin", function () { hold(true); });
    slider.addEventListener("focusout", function (e) { if (!slider.contains(e.relatedTarget)) hold(false); });
    if (playBtn) {
      if (!still) playBtn.hidden = false;
      playBtn.addEventListener("click", function () { stopped = !stopped; setPlaying(); restart(); });
    }
    window.addEventListener("resize", function () {
      track.scrollTo({ left: cur * track.clientWidth, behavior: "auto" }); fit();
    });
    if (narrow.addEventListener) narrow.addEventListener("change", fit);
    window.addEventListener("load", fit);

    slides.forEach(function (s, k) { if (k) { s.classList.remove("is-on"); if ("inert" in s) s.inert = true; s.setAttribute("aria-hidden", "true"); } });
    slides[0].classList.add("is-on"); slides[0].setAttribute("aria-hidden", "false");
    setPlaying(); fit(); restart();
    if (!still) count(slides[0]);
  }

  /* ── Rupees, as the live estimator writes them ── */
  function short(t) {
    if (t >= 1e7) { var c = t / 1e7; return "₹" + (c % 1 === 0 ? c.toFixed(0) : c.toFixed(2)) + "Cr"; }
    if (t >= 1e5) { var l = t / 1e5; return "₹" + (l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)) + "L"; }
    return t >= 1e3 ? "₹" + (t / 1e3).toFixed(t >= 1e4 ? 0 : 1) + "k" : "₹" + t.toLocaleString("en-IN");
  }
  function full(t) { return "₹" + Math.round(t).toLocaleString("en-IN"); }

  /* ── The revenue leak estimator (eCommerce): the live page's model, from data-cfg ── */
  var leak = doc.getElementById("leakCalc");
  if (leak) {
    var cfg = JSON.parse(leak.getAttribute("data-cfg")), range = doc.getElementById("leakSpend");
    var stage = "running", out = function (k) { return leak.querySelector('[data-leak="' + k + '"]'); };
    var paint = function () {
      var st = cfg.stages[stage], spend = +range.value;
      var month = Math.round(spend * st.rate), year = Math.round(month * 12 * st.years);
      out("spend").textContent = short(spend) + "/mo";
      out("tag").textContent = st.tag;
      cfg.split.forEach(function (p, i) { out("part" + i).textContent = short(Math.round(month * p[1])); });
      out("month").textContent = full(month);
      out("year").textContent = full(year);
    };
    range.addEventListener("input", paint);
    leak.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = +range.value + (+b.getAttribute("data-step")) * cfg.step * 4;
        range.value = Math.max(cfg.min, Math.min(cfg.max, v)); paint();
      });
    });
    doc.querySelectorAll("[data-stage]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        doc.querySelectorAll("[data-stage]").forEach(function (c) { c.classList.remove("on"); c.setAttribute("aria-pressed", "false"); });
        chip.classList.add("on"); chip.setAttribute("aria-pressed", "true");
        stage = chip.getAttribute("data-stage");
        range.value = cfg.stages[stage].spend;
        var sel = doc.getElementById("in-stage");
        if (sel) sel.selectedIndex = stage === "new" ? 1 : 2;
        paint();
      });
    });
  }

  /* ── The enrolment leak calculator (Education): seats short of the benchmark rate ── */
  var seat = doc.getElementById("seatCalc");
  if (seat) {
    var sc = JSON.parse(seat.getAttribute("data-cfg"));
    var enq = doc.getElementById("seatEnq"), rate = doc.getElementById("seatRate");
    var o = function (k) { return seat.querySelector('[data-seat="' + k + '"]'); };
    var calc = function () {
      var n = +enq.value, r = +rate.value;
      var now = Math.round(n * r / 100), reach = Math.round(n * sc.benchmark / 100), gap = Math.max(0, reach - now);
      o("enq").textContent = n; o("rate").textContent = r + "%";
      o("gap").textContent = gap; o("gap2").textContent = gap; o("now").textContent = now; o("reach").textContent = reach;
    };
    enq.addEventListener("input", calc); rate.addEventListener("input", calc);
  }
})();
