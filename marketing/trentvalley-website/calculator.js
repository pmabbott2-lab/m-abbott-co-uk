/**
 * Trent Valley mortgage calculator: purchase or remortgage repayment estimate.
 *
 * The illustrative rate comes from Mortgage Hub when TVFS.HUB_LIVE is true; otherwise
 * from the same LTV bands the Hub uses as its static fallback.
 */
(function () {
  "use strict";

  var STATIC_DISCLAIMER =
    "Illustrative average market rates by LTV band, not advice. Your actual rate depends on your circumstances, credit profile and lender criteria.";

  var mode = "purchase";
  var ratePct = 4.45;
  var rateTimer = null;
  var rateSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function parseMoney(str) {
    var n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatGbp(value) {
    return "£" + (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString("en-GB");
  }

  function formatInput(value) {
    return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString("en-GB") : "";
  }

  function monthlyPayment(principal, annualPct, years) {
    var r = annualPct / 100 / 12;
    var n = years * 12;
    if (r === 0) return principal / n;
    return (principal * r) / (1 - Math.pow(1 + r, -n));
  }

  function staticRateForLtv(ltv) {
    if (ltv <= 60) return 4.15;
    if (ltv <= 75) return 4.45;
    if (ltv <= 85) return 4.85;
    if (ltv <= 90) return 5.35;
    return 5.85;
  }

  function read() {
    var price = parseMoney($("calc-price").value);
    var loan;
    if (mode === "remortgage") {
      var outstanding = parseMoney($("calc-outstanding").value);
      if (price > 0 && outstanding > price) {
        outstanding = price;
        $("calc-outstanding").value = formatInput(outstanding);
      }
      loan = outstanding;
    } else {
      var deposit = parseMoney($("calc-deposit").value);
      if (price > 0 && deposit > price) {
        deposit = price;
        $("calc-deposit").value = formatInput(deposit);
      }
      loan = price > 0 ? Math.max(0, price - deposit) : 0;
    }
    $("calc-loan").value = formatInput(loan);

    var term = Math.min(40, Math.max(1, parseInt($("calc-term").value, 10) || 25));
    var ltv = price > 0 ? (loan / price) * 100 : 0;
    var monthly = loan > 0 ? monthlyPayment(loan, ratePct, term) : 0;
    return { price: price, loan: loan, term: term, ltv: ltv, monthly: monthly, total: monthly * term * 12 };
  }

  function render(calc) {
    var has = calc.loan > 0 && calc.price > 0;
    setText("calc-ltv", has ? calc.ltv.toFixed(1) + "%" : "0%");
    setText("calc-rate", has ? ratePct.toFixed(2) + "%" : "0%");
    setText("calc-monthly", formatGbp(has ? calc.monthly : 0));
    setText("calc-total", formatGbp(has ? calc.total : 0));
    setText("calc-interest", formatGbp(has ? calc.total - calc.loan : 0));
  }

  function applyRate(pct, disclaimer, status) {
    ratePct = pct;
    if (disclaimer) setText("rate-disclaimer", disclaimer);
    setText("rate-status", status || "");
    render(read());
  }

  function refreshRate(calc) {
    var config = window.TVFS || {};
    if (!(calc.loan > 0 && calc.price > 0)) {
      setText("rate-status", "");
      return;
    }
    if (!config.HUB_LIVE) {
      applyRate(staticRateForLtv(calc.ltv), STATIC_DISCLAIMER, "Rate based on an illustrative LTV band.");
      return;
    }

    if (rateTimer) clearTimeout(rateTimer);
    setText("rate-status", "Updating illustrative rate…");
    rateTimer = setTimeout(function () {
      var seq = ++rateSeq;
      fetch(config.HUB_ORIGIN.replace(/\/$/, "") + config.ENDPOINTS.estimateRate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ltv: calc.ltv, loanAmount: calc.loan, termYears: calc.term }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (seq !== rateSeq) return;
          if (result.ok && result.data.ok && typeof result.data.ratePct === "number") {
            applyRate(
              result.data.ratePct,
              result.data.disclaimer,
              result.data.source === "openai"
                ? "Rate estimated from current UK market context (AI model)."
                : "Rate based on an illustrative LTV band."
            );
          } else {
            applyRate(staticRateForLtv(calc.ltv), STATIC_DISCLAIMER, "Rate based on an illustrative LTV band.");
          }
        })
        .catch(function () {
          if (seq !== rateSeq) return;
          applyRate(staticRateForLtv(calc.ltv), STATIC_DISCLAIMER, "Rate based on an illustrative LTV band.");
        });
    }, 450);
  }

  function onInput() {
    var calc = read();
    render(calc);
    refreshRate(calc);
  }

  function setMode(next) {
    mode = next === "remortgage" ? "remortgage" : "purchase";
    $("field-deposit").hidden = mode !== "purchase";
    $("field-outstanding").hidden = mode !== "remortgage";
    document.querySelectorAll("[data-calc-mode]").forEach(function (btn) {
      var active = btn.getAttribute("data-calc-mode") === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    onInput();
  }

  function loadBankRate() {
    fetch("/api/bank-rate", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.baseRate) throw new Error("No rate");
        var base = data.baseRate;
        setText("bank-rate-value", Number(base.ratePct).toFixed(2) + "%");
        var asOf = base.attribution && base.attribution.asOf ? " · as at " + base.attribution.asOf : "";
        setText("bank-rate-source", "Bank of England" + asOf);
        var link = $("bank-rate-link");
        if (link && base.attribution && base.attribution.sourceUrl) {
          link.href = base.attribution.sourceUrl;
          link.hidden = false;
        }
      })
      .catch(function () {
        setText("bank-rate-value", "Unavailable");
        setText("bank-rate-source", "Bank Rate unavailable right now");
      });
  }

  function init() {
    if (!$("calc-price")) return;
    document.querySelectorAll("[data-calc-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-calc-mode"));
      });
    });
    ["calc-price", "calc-deposit", "calc-outstanding", "calc-term"].forEach(function (id) {
      $(id).addEventListener("input", onInput);
    });
    ["calc-price", "calc-deposit", "calc-outstanding"].forEach(function (id) {
      $(id).addEventListener("blur", function () {
        this.value = formatInput(parseMoney(this.value));
      });
    });
    setMode("purchase");
    loadBankRate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
