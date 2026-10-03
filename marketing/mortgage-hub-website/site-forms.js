/**
 * Introducer enquiry and careers application forms.
 *
 * Each form posts JSON to Mortgage Hub at its data-hub-endpoint once data-live="true".
 * The Hub endpoints do not exist yet, so forms stay in preview mode: they validate and
 * confirm locally but send nothing.
 */
(function () {
  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "form-message " + (type || "");
    el.hidden = !text;
  }

  function collect(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "submit") return;
      data[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    return data;
  }

  function firstInvalid(form) {
    var fields = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (el.type === "checkbox") {
        if (el.required && !el.checked) return el;
      } else if (el.required && !el.value.trim()) {
        return el;
      } else if (el.type === "email" && el.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim())) {
        return el;
      }
    }
    return null;
  }

  function wire(form) {
    var messageEl = form.querySelector(".form-message");
    var submitBtn = form.querySelector("[type=submit]");
    var submitLabel = submitBtn.textContent;

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var invalid = firstInvalid(form);
      if (invalid) {
        showMessage(messageEl, invalid.getAttribute("data-error") || "Please complete the required fields.", "error");
        invalid.focus();
        return;
      }

      var payload = collect(form);
      payload.form = form.getAttribute("data-form-type");
      payload.tenant = "mortgageeasy";
      payload.introducerRef = window.MORTGAGEEASY_INTRODUCER_REF ? window.MORTGAGEEASY_INTRODUCER_REF() : "";

      if (form.getAttribute("data-live") !== "true") {
        showMessage(
          messageEl,
          "Thank you. Online submissions are not connected yet — in this preview your details have not been sent.",
          "success"
        );
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      showMessage(messageEl, "", "");

      fetch((window.MORTGAGE_HUB_API_URL || "") + form.getAttribute("data-hub-endpoint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            showMessage(messageEl, result.data.message || "Thank you — we'll be in touch shortly.", "success");
            form.reset();
          } else {
            showMessage(messageEl, result.data.error || "Something went wrong. Please try again.", "error");
          }
        })
        .catch(function () {
          showMessage(messageEl, "We couldn't send your details just now. Please try again shortly.", "error");
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = submitLabel;
        });
    });
  }

  // Pages serves /careers rather than /careers.html, so plain anchor links would reload the page.
  function wireScrollLinks() {
    document.querySelectorAll("[data-scroll-to]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var section = document.getElementById(btn.getAttribute("data-scroll-to"));
        if (!section) return;
        e.preventDefault();
        var role = btn.getAttribute("data-apply-role");
        var select = document.getElementById("apply-role");
        if (role && select) select.value = role;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        var first = section.querySelector("input:not([type=checkbox]), select, textarea");
        if (first) first.focus({ preventScroll: true });
      });
    });
  }

  function init() {
    document.querySelectorAll("form[data-form-type]").forEach(wire);
    wireScrollLinks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
