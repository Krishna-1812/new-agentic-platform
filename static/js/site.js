/* The public site (templates/site/): the menu on phones, the header rule on
   scroll, and the booking form. Everything works without it except sending
   the form, which then tells the reader to email us instead. */
(function () {
  "use strict";
  var root = document.documentElement;

  var hd = document.getElementById("hd");
  if (hd) {
    var onScroll = function () { hd.classList.toggle("scrolled", window.scrollY > 4); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var burger = document.getElementById("burger");
  if (burger) {
    var setMenu = function (open) {
      root.classList.toggle("menu-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    };
    burger.addEventListener("click", function () { setMenu(!root.classList.contains("menu-open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
    window.addEventListener("resize", function () { if (window.innerWidth > 960) setMenu(false); });
  }

  // The booking form (/book). Posts to the same intake as before (Sheet, Slack, email).
  var form = document.getElementById("bookForm");
  if (!form) return;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var spendField = document.getElementById("f-spend");
  var showSpend = function () {
    var p = (form.querySelector("input[name=pillar]:checked") || {}).value || "";
    if (spendField) spendField.hidden = p.indexOf("Performance") === -1 && p !== "Both";
  };
  form.addEventListener("change", showSpend);
  showSpend();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = document.getElementById("formErr"), btn = document.getElementById("formSend");
    var val = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
    var name = val("name"), email = val("email");
    form.querySelector("#f-name").classList.toggle("bad", !name);
    form.querySelector("#f-email").classList.toggle("bad", !EMAIL.test(email));
    if (!name || !EMAIL.test(email)) { err.textContent = "Please enter your name and a valid work email."; return; }
    err.textContent = "";
    btn.disabled = true; btn.textContent = "Sending…";
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
        btn.disabled = false; btn.textContent = "Send";
        if (res.ok && res.d && res.d.ok) {
          form.hidden = true;
          document.getElementById("formDone").classList.add("on");
          try { if (window.track) window.track("lead_submit", { interest: val("pillar") }); } catch (_) {}
        } else {
          err.textContent = (res.d && res.d.error) || "Something went wrong. Please try again.";
        }
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = "Send";
        err.textContent = "We couldn’t send that just now. Please try again in a moment.";
      });
  });
})();
