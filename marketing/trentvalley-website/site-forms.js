/**
 * Introducer enquiry and careers forms.
 *
 * Each form names its Hub endpoint in data-endpoint (a key of TVFS.ENDPOINTS). Until
 * TVFS.HUB_LIVE is true, forms validate and confirm locally but send nothing. When live
 * they post JSON, or multipart/form-data when a CV is attached.
 */
(function () {
  var FILE_TYPES = /\.(pdf|doc|docx)$/i;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "form-message" + (type ? " " + type : "");
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
      } else if (el.type === "email" && el.value.trim() && !EMAIL.test(el.value.trim())) {
        return { el: el };
      }
    }
    return null;
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024
      ? Math.max(1, Math.round(bytes / 1024)) + "KB"
      : (bytes / (1024 * 1024)).toFixed(1) + "MB";
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
        var problem = fileProblem(input);
        if (problem) input.value = "";
        refresh();
        showMessage(messageEl, problem, problem ? "error" : "");
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
    var config = window.TVFS || {};
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
      payload.tenant = config.TENANT || "trentvalleyfs";
      payload.introducerRef = config.introducerRef ? config.introducerRef() : "";

      var endpoint = config.ENDPOINTS && config.ENDPOINTS[form.getAttribute("data-endpoint")];
      if (!config.HUB_LIVE || !endpoint) {
        showMessage(
          messageEl,
          "Thank you. Online submissions are not connected yet, so in this preview your details have not been sent.",
          "success"
        );
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      showMessage(messageEl, "", "");

      var request = { method: "POST" };
      var files = [];
      form.querySelectorAll("input[type=file]").forEach(function (el) {
        if (el.name && el.files && el.files[0]) files.push({ name: el.name, file: el.files[0] });
      });
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

      fetch(config.HUB_ORIGIN.replace(/\/$/, "") + endpoint, request)
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            showMessage(messageEl, result.data.message || "Thank you. We'll be in touch shortly.", "success");
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

  function init() {
    document.querySelectorAll("form[data-form-type]").forEach(wire);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
