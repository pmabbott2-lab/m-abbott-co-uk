/**
 * MortgageEasy calculator — purchase / remortgage, LTV rate estimate, callback leads, journey links.
 */
(function () {
  "use strict";

  var rateFetchTimer = null;
  var rateFetchSeq = 0;
  var currentRatePct = 4.26;
  var calcMode = "purchase";

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

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateCalculatorDisplay(calc) {
    setText("calc-ltv", calc.ltvPct > 0 ? calc.ltvPct.toFixed(1) + "%" : "—");
    setText("calc-monthly", calc.loanAmount > 0 ? formatGbp(calc.monthlyPayment) : "—");
    setText(
      "calc-rate-display",
      calc.loanAmount > 0 && calc.ratePct > 0 ? calc.ratePct.toFixed(2) + "%" : "—",
    );
    setText("calc-total", calc.loanAmount > 0 ? formatGbp(calc.totalRepayable) : "—");
    updateGuideCopy(calc);
  }

  function updateGuideCopy(calc) {
    var price = calc.propertyPrice > 0 ? calc.propertyPrice : 335000;
    var deposit = calcMode === "purchase" ? Math.max(calc.deposit, 0) : Math.max(price - calc.loanAmount, 0);
    var loan = calc.loanAmount > 0 ? calc.loanAmount : 285000;
    var term = calc.termYears || 30;
    var rate = calc.ratePct > 0 ? calc.ratePct : currentRatePct;
    var monthly =
      calc.monthlyPayment > 0 ? calc.monthlyPayment : monthlyPayment(loan, rate, term);
    var total = monthly * term * 12;

    if (calcMode === "remortgage") {
      setText(
        "guide-example",
        "",
      );
      var exampleEl = document.getElementById("guide-example");
      if (exampleEl) {
        exampleEl.innerHTML =
          "If you're remortgaging a property worth <strong id=\"guide-price\">" +
          formatGbp(price) +
          "</strong> with an outstanding balance of <strong id=\"guide-deposit\">" +
          formatGbp(loan) +
          "</strong>, borrowing over <strong id=\"guide-term\">" +
          String(term) +
          "</strong> years at a <strong id=\"guide-rate\">" +
          rate.toFixed(2) +
          "%</strong> interest rate:";
      }
    } else {
      var purchaseEl = document.getElementById("guide-example");
      if (purchaseEl) {
        purchaseEl.innerHTML =
          "If you're buying a property worth <strong id=\"guide-price\">" +
          formatGbp(price) +
          "</strong>, put down a <strong id=\"guide-deposit\">" +
          formatGbp(deposit) +
          "</strong> deposit, and borrow over <strong id=\"guide-term\">" +
          String(term) +
          "</strong> years at a <strong id=\"guide-rate\">" +
          rate.toFixed(2) +
          "%</strong> interest rate:";
      }
    }

    setText("guide-monthly", formatGbp(monthly));
    setText("guide-loan", formatGbp(loan));
    setText("guide-term-2", String(term));
    setText("guide-total", formatGbp(total));
    setText("guide-compare-loan", formatGbp(Math.min(loan, 200000) || 200000));
    setText("guide-compare-rate", rate.toFixed(2) + "%");
  }

  function formatGbpInput(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    return Math.round(value).toLocaleString("en-GB");
  }

  function syncLoanFromInputs() {
    var priceEl = document.getElementById("calc-price");
    var depositEl = document.getElementById("calc-deposit");
    var outstandingEl = document.getElementById("calc-outstanding");
    var loanEl = document.getElementById("calc-loan");
    if (!priceEl || !loanEl) return;

    var price = parseMoney(priceEl.value);
    var loan = 0;

    if (calcMode === "remortgage") {
      var outstanding = parseMoney(outstandingEl ? outstandingEl.value : "0");
      if (price > 0 && outstanding > price) {
        outstanding = price;
        if (outstandingEl) outstandingEl.value = formatGbpInput(outstanding);
      }
      loan = Math.max(0, outstanding);
    } else {
      var deposit = parseMoney(depositEl ? depositEl.value : "0");
      if (price > 0 && deposit > price) {
        deposit = price;
        if (depositEl) depositEl.value = formatGbpInput(deposit);
      }
      loan = price > 0 ? Math.max(0, price - deposit) : 0;
    }

    loanEl.value = loan > 0 ? formatGbpInput(loan) : "";
  }

  function readCalculatorInputs() {
    syncLoanFromInputs();
    var price = parseMoney(document.getElementById("calc-price").value);
    var deposit =
      calcMode === "purchase"
        ? parseMoney(document.getElementById("calc-deposit").value)
        : 0;
    var outstanding =
      calcMode === "remortgage"
        ? parseMoney(document.getElementById("calc-outstanding").value)
        : 0;
    var loan = parseMoney(document.getElementById("calc-loan").value);
    var term = parseInt(document.getElementById("calc-term").value, 10) || 25;
    if (loan > price && price > 0) loan = price;
    var ltvPct = price > 0 ? (loan / price) * 100 : 0;
    var monthly =
      loan > 0 && currentRatePct > 0 ? monthlyPayment(loan, currentRatePct, term) : 0;
    var totalRepayable = monthly > 0 ? monthly * term * 12 : 0;

    return {
      mode: calcMode,
      propertyPrice: price,
      loanAmount: loan,
      deposit: calcMode === "purchase" ? Math.max(price - loan, 0) : Math.max(price - outstanding, 0),
      outstandingBalance: calcMode === "remortgage" ? outstanding : 0,
      termYears: term,
      ltvPct: ltvPct,
      ratePct: currentRatePct,
      monthlyPayment: monthly,
      totalRepayable: totalRepayable,
    };
  }

  function applyMode(mode) {
    calcMode = mode === "remortgage" ? "remortgage" : "purchase";
    var depositField = document.getElementById("field-deposit");
    var outstandingField = document.getElementById("field-outstanding");
    var purchaseBtn = document.getElementById("mode-purchase");
    var remortgageBtn = document.getElementById("mode-remortgage");
    if (depositField) depositField.hidden = calcMode !== "purchase";
    if (outstandingField) outstandingField.hidden = calcMode !== "remortgage";
    if (purchaseBtn) purchaseBtn.classList.toggle("is-active", calcMode === "purchase");
    if (remortgageBtn) remortgageBtn.classList.toggle("is-active", calcMode === "remortgage");
    onCalculatorInput();
  }

  function scheduleRateFetch(calc) {
    if (rateFetchTimer) clearTimeout(rateFetchTimer);
    var statusEl = document.getElementById("rate-status");
    if (calc.loanAmount <= 0 || calc.propertyPrice <= 0) {
      if (statusEl) statusEl.textContent = "";
      return;
    }
    if (statusEl) statusEl.textContent = "Updating illustrative rate…";
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
          if (result.data.disclaimer && disclaimerEl) disclaimerEl.textContent = result.data.disclaimer;
          if (statusEl) {
            statusEl.textContent =
              result.data.source === "openai"
                ? "Rate estimated from current UK market context (AI model)."
                : "Rate estimated from illustrative LTV band (static fallback).";
          }
          var updated = readCalculatorInputs();
          updateCalculatorDisplay(updated);
        } else if (statusEl) {
          statusEl.textContent = "";
        }
      })
      .catch(function () {
        if (seq !== rateFetchSeq) return;
        var statusEl = document.getElementById("rate-status");
        if (statusEl) statusEl.textContent = "Could not refresh rate — using last estimate.";
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

  function smoothScrollTo(id) {
    var section = document.getElementById(id);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
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

    document.querySelectorAll(".calc-mode-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyMode(btn.getAttribute("data-mode"));
      });
    });

    ["calc-price", "calc-deposit", "calc-outstanding", "calc-term"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", onCalculatorInput);
    });

    var scrollCallback = document.getElementById("scroll-callback");
    var scrollJourney = document.getElementById("scroll-journey");
    if (scrollCallback) {
      scrollCallback.addEventListener("click", function () {
        smoothScrollTo("callback-section");
      });
    }
    if (scrollJourney) {
      scrollJourney.addEventListener("click", function () {
        smoothScrollTo("journey-section");
      });
    }

    applyMode("purchase");

    if (window.location.hash === "#callback") {
      smoothScrollTo("callback-section");
    } else if (window.location.hash === "#journey") {
      smoothScrollTo("journey-section");
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
