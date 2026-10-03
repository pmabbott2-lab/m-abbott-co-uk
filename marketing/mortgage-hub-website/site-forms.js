/**
 * Introducer enquiry and careers application forms.
 *
 * Each form posts to Mortgage Hub at its data-hub-endpoint once data-live="true": JSON,
 * or multipart/form-data when a file (e.g. a CV) is attached.
 * The Hub endpoints do not exist yet, so forms stay in preview mode: they validate and
 * confirm locally but send nothing.
 */
(function () {
  var FILE_TYPES = /\.(pdf|doc|docx)$/i;

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "form-message " + (type || "");
    el.hidden = !text;
  }

  function collect(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "submit" || el.type === "file") return;
      data[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    return data;
  }

  function attachedFiles(form) {
    var files = [];
    form.querySelectorAll("input[type=file]").forEach(function (el) {
      if (el.name && el.files && el.files[0]) files.push({ name: el.name, file: el.files[0] });
    });
    return files;
  }

  function fileProblem(el) {
    var file = el.files && el.files[0];
    if (!file) return el.required ? el.getAttribute("data-error") || "Please attach a file." : "";
    if (!FILE_TYPES.test(file.name)) return "Please upload your CV as a PDF or Word document.";
    var maxMb = parseFloat(el.getAttribute("data-max-mb") || "5");
    if (file.size > maxMb * 1024 * 1024) return "Your CV must be " + maxMb + "MB or smaller.";
    return "";
  }

  function firstInvalid(form) {
    var fields = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (el.type === "file") {
        var problem = fileProblem(el);
        if (problem) return { el: el, message: problem };
      } else if (el.type === "checkbox") {
        if (el.required && !el.checked) return { el: el };
      } else if (el.required && !el.value.trim()) {
        return { el: el };
      } else if (el.type === "email" && el.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim())) {
        return { el: el };
      }
    }
    return null;
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + "KB" : (bytes / (1024 * 1024)).toFixed(1) + "MB";
  }

  function wireFileInputs(form, messageEl) {
    form.querySelectorAll(".file-upload").forEach(function (wrap) {
      var input = wrap.querySelector("input[type=file]");
      var nameEl = wrap.querySelector("[data-file-name]");
      var clearBtn = wrap.querySelector("[data-file-clear]");
      var emptyText = nameEl.textContent;

      function refresh() {
        var file = input.files && input.files[0];
        nameEl.textContent = file ? file.name + " (" + formatSize(file.size) + ")" : emptyText;
        wrap.classList.toggle("has-file", !!file);
        clearBtn.hidden = !file;
      }

      input.addEventListener("change", function () {
        refresh();
        var problem = fileProblem(input);
        showMessage(messageEl, problem, problem ? "error" : "");
        if (problem) {
          input.value = "";
          refresh();
        }
      });
      clearBtn.addEventListener("click", function () {
        input.value = "";
        refresh();
        input.focus();
      });
      form.addEventListener("reset", function () {
        setTimeout(refresh, 0);
      });
    });
  }

  function wire(form) {
    var messageEl = form.querySelector(".form-message");
    var submitBtn = form.querySelector("[type=submit]");
    var submitLabel = submitBtn.textContent;
    wireFileInputs(form, messageEl);

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var invalid = firstInvalid(form);
      if (invalid) {
        showMessage(
          messageEl,
          invalid.message || invalid.el.getAttribute("data-error") || "Please complete the required fields.",
          "error"
        );
        invalid.el.focus();
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

      var files = attachedFiles(form);
      var request = { method: "POST" };
      if (files.length) {
        var body = new FormData();
        Object.keys(payload).forEach(function (key) {
          body.append(key, String(payload[key]));
        });
        files.forEach(function (f) {
          body.append(f.name, f.file, f.file.name);
        });
        request.body = body;
      } else {
        request.headers = { "Content-Type": "application/json" };
        request.body = JSON.stringify(payload);
      }

      fetch((window.MORTGAGE_HUB_API_URL || "") + form.getAttribute("data-hub-endpoint"), request)
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
