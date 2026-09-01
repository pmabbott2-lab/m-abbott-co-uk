/**
 * MortgageEasy home — partner banner + market rates strip.
 */
(function () {
  "use strict";

  function showPartnerBanner() {
    var ref = window.MORTGAGEEASY_INTRODUCER_REF ? window.MORTGAGEEASY_INTRODUCER_REF() : "";
    var banner = document.getElementById("introducer-banner");
    if (!banner) return;
    if (ref) {
      banner.hidden = false;
      banner.textContent = "Referred by partner · ref " + ref;
    }
  }

  function init() {
    showPartnerBanner();
    if (window.MORTGAGEEASY_LOAD_MARKET_RATES) window.MORTGAGEEASY_LOAD_MARKET_RATES();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
