/**
 * Shared Bank of England base rate — hero pill + optional full strip.
 */
(function () {
  "use strict";

  function resolveHubApiOrigin() {
    if (window.MORTGAGE_HUB_API_URL) {
      return String(window.MORTGAGE_HUB_API_URL).replace(/\/$/, "");
    }
    if (window.MORTGAGE_HUB_PATH) {
      return window.MORTGAGE_HUB_PATH("/").replace(/\/$/, "");
    }
    return "http://127.0.0.1:8080";
  }

  function formatPct(n) {
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(2) + "%";
  }

  function setText(id, text) {
    if (!text) return;
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatAttribution(attr) {
    if (!attr) return "";
    var parts = [];
    if (attr.sourceName) parts.push(attr.sourceName);
    if (attr.asOf) parts.push("as at " + attr.asOf);
    return parts.join(" · ");
  }

  function setAttribution(id, attr, urlId) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatAttribution(attr);
    if (urlId && attr && attr.sourceUrl) {
      var link = document.getElementById(urlId);
      if (link) {
        link.href = attr.sourceUrl;
        link.hidden = false;
      }
    }
  }

  function applyBaseRate(data) {
    var pct = formatPct(data.baseRate.ratePct);
    setText("rate-base-value", pct);
    setText("rate-base-value-inline", pct);
    setText("rate-base-label", data.baseRate.label || "Bank of England Bank Rate");
    setAttribution("rate-base-source", data.baseRate.attribution, "rate-base-source-link");
    setAttribution("rate-base-source-inline", data.baseRate.attribution, "rate-base-source-inline-link");
    setText("rates-as-of", "Page snapshot · " + data.asOf);
    setText("rates-disclaimer", data.disclaimer);
  }

  function loadMarketRatesStrip() {
    var status = document.getElementById("rates-status");
    var api = resolveHubApiOrigin() + "/api/calculator/market-rates";

    if (status) status.textContent = "Loading Bank Rate…";

    fetch(api, {
      method: "GET",
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error(data && data.error ? data.error : "Could not load rates");
        }
        applyBaseRate(data);
        if (status) status.textContent = "Official Bank of England Bank Rate.";
      })
      .catch(function () {
        if (status) status.textContent = "Bank Rate unavailable right now.";
      });
  }

  window.MORTGAGEEASY_LOAD_MARKET_RATES = loadMarketRatesStrip;

  if (
    document.getElementById("rate-base-value") ||
    document.getElementById("rate-base-value-inline")
  ) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadMarketRatesStrip);
    } else {
      loadMarketRatesStrip();
    }
  }
})();
