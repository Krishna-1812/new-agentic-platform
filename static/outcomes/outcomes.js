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
