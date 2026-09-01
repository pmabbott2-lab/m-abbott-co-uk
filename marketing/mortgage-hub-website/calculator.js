/**
 * MortgageEasy calculator — LTV-based rate estimate, callback leads, broker journey links.
 */
(function () {
  "use strict";

  var rateFetchTimer = null;
  var rateFetchSeq = 0;
  var currentRatePct = 4.75;

  function monthlyPayment(principal, annualRatePct, years) {
    var r = annualRatePct / 100 / 12;
    var n = years * 12;
    if (r === 0) return principal / n;
    return (principal * r) / (1 - Math.pow(1 + r, -n));
  }

  function formatGbp(value) {
    if (!Number.isFinite(value)) return "—";
    return "£" + Math.round(value).toLocaleString("en-GB");
  }

  function parseMoney(str) {
    var n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function getIntroducerSlug() {
    var params = new URLSearchParams(window.location.search);
    return (params.get("ref") || params.get("introducer") || "").trim().toLowerCase();
  }

  function resolveHubApiOrigin() {
    if (window.MORTGAGE_HUB_API_URL) {
      return String(window.MORTGAGE_HUB_API_URL).replace(/\/$/, "");
    }
    if (window.MORTGAGE_HUB_PATH) {
      return window.MORTGAGE_HUB_PATH("/").replace(/\/$/, "");
    }
    return "http://127.0.0.1:8080";
  }

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
    };
  }

  function updateCalculatorDisplay(calc) {
    document.getElementById("calc-ltv").textContent =
      calc.ltvPct > 0 ? calc.ltvPct.toFixed(1) + "%" : "—";
    document.getElementById("calc-monthly").textContent =
      calc.loanAmount > 0 ? formatGbp(calc.monthlyPayment) : "—";
    document.getElementById("calc-rate-display").textContent =
      calc.loanAmount > 0 && calc.ratePct > 0 ? calc.ratePct.toFixed(2) + "%" : "—";
  }

  function formatGbpInput(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    return Math.round(value).toLocaleString("en-GB");
  }

  function syncLoanFromDeposit() {
    var priceEl = document.getElementById("calc-price");
    var depositEl = document.getElementById("calc-deposit");
    var loanEl = document.getElementById("calc-loan");
    if (!priceEl || !depositEl || !loanEl) return;

    var price = parseMoney(priceEl.value);
    var deposit = parseMoney(depositEl.value);
    if (price > 0 && deposit > price) {
      deposit = price;
      depositEl.value = formatGbpInput(deposit);
    }
    var loan = price > 0 ? Math.max(0, price - deposit) : 0;
    loanEl.value = loan > 0 ? formatGbpInput(loan) : "";
  }

  function readCalculatorInputs() {
    syncLoanFromDeposit();
    var price = parseMoney(document.getElementById("calc-price").value);
    var deposit = parseMoney(document.getElementById("calc-deposit").value);
    var loan = parseMoney(document.getElementById("calc-loan").value);
    var term = parseInt(document.getElementById("calc-term").value, 10) || 25;
    if (loan > price && price > 0) loan = price;
    var ltvPct = price > 0 ? (loan / price) * 100 : 0;
    var monthly =
      loan > 0 && currentRatePct > 0 ? monthlyPayment(loan, currentRatePct, term) : 0;

    return {
      propertyPrice: price,
      loanAmount: loan,
      deposit: Math.max(price - loan, 0),
      termYears: term,
      ltvPct: ltvPct,
      ratePct: currentRatePct,
      monthlyPayment: monthly,
    };
  }

  function scheduleRateFetch(calc) {
    if (rateFetchTimer) clearTimeout(rateFetchTimer);
    var statusEl = document.getElementById("rate-status");
    if (calc.loanAmount <= 0 || calc.propertyPrice <= 0) {
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = "Updating illustrative rate…";
    rateFetchTimer = setTimeout(function () {
      void fetchEstimatedRate(calc);
    }, 450);
  }

  function fetchEstimatedRate(calc) {
    var seq = ++rateFetchSeq;
    var apiUrl = resolveHubApiOrigin() + "/api/calculator/estimate-rate";
    return fetch(apiUrl, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        ltv: calc.ltvPct,
        loanAmount: calc.loanAmount,
        termYears: calc.termYears,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (seq !== rateFetchSeq) return;
        var statusEl = document.getElementById("rate-status");
        var disclaimerEl = document.getElementById("rate-disclaimer");
        if (result.ok && result.data.ok && typeof result.data.ratePct === "number") {
          currentRatePct = result.data.ratePct;
          if (result.data.disclaimer) disclaimerEl.textContent = result.data.disclaimer;
          statusEl.textContent =
            result.data.source === "openai"
              ? "Rate estimated from current UK market context (AI model)."
              : "Rate estimated from illustrative LTV band (static fallback).";
          var updated = readCalculatorInputs();
          updateCalculatorDisplay(updated);
        } else {
          statusEl.textContent = "";
        }
      })
      .catch(function () {
        if (seq !== rateFetchSeq) return;
        document.getElementById("rate-status").textContent =
          "Could not refresh rate — using last estimate.";
      });
  }

  function onCalculatorInput() {
    var calc = readCalculatorInputs();
    updateCalculatorDisplay(calc);
    scheduleRateFetch(calc);
  }

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "form-message " + (type || "");
    el.hidden = !text;
  }

  function init() {
    var slug = getIntroducerSlug();
    var slugBanner = document.getElementById("introducer-banner");
    var slugMissing = document.getElementById("slug-missing");
    var form = document.getElementById("callback-form");
    var messageEl = document.getElementById("form-message");
    var submitBtn = document.getElementById("submit-btn");

    if (slug) {
      slugBanner.textContent = "Referred by partner: " + slug;
      slugBanner.hidden = false;
      slugMissing.hidden = true;
    } else {
      slugMissing.hidden = false;
    }

    ["calc-price", "calc-deposit", "calc-term"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", onCalculatorInput);
    });

    onCalculatorInput();

    if (window.location.hash === "#callback") {
      var section = document.getElementById("callback-section");
      if (section) section.scrollIntoView({ behavior: "smooth" });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = document.getElementById("customer-name").value.trim();
      var email = document.getElementById("customer-email").value.trim();
      var phone = document.getElementById("customer-phone").value.trim();
      var consent = document.getElementById("gdpr-consent");

      if (!name || name.length < 2) {
        showMessage(messageEl, "Please enter your full name.", "error");
        return;
      }
      if (!email) {
        showMessage(messageEl, "Please enter your email address.", "error");
        return;
      }
      if (!phone) {
        showMessage(messageEl, "Please enter your telephone number.", "error");
        return;
      }
      if (!consent.checked) {
        showMessage(messageEl, "Please confirm GDPR consent before submitting.", "error");
        return;
      }
      if (!slug) {
        showMessage(messageEl, "Callback requires a partner referral link (?ref=slug).", "error");
        return;
      }

      var calc = readCalculatorInputs();
      var payload = {
        slug: slug,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        consentGiven: true,
        calculator: calc,
      };

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      showMessage(messageEl, "", "");

      var apiUrl = resolveHubApiOrigin() + "/api/introducer/calculator-lead";
      fetch(apiUrl, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            showMessage(messageEl, result.data.message, "success");
            form.reset();
            consent.checked = false;
          } else {
            showMessage(messageEl, result.data.error || "Something went wrong. Please try again.", "error");
          }
        })
        .catch(function () {
          showMessage(messageEl, "Could not reach Mortgage Hub. Please try again shortly.", "error");
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Request a callback";
          onCalculatorInput();
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
