/**
 * Trent Valley Financial Services: Mortgage Hub connection settings.
 *
 * While HUB_LIVE is false the site works on its own: the calculator uses local
 * illustrative rates, forms validate but send nothing, and Hub links stay hidden.
 * Switch HUB_LIVE to true once the Hub allows this site's origin in CORS and the
 * tenant endpoints below exist.
 */
(function () {
  var config = {
    HUB_LIVE: false,
    HUB_ORIGIN: "https://mymortgagehub.uk",
    TENANT: "trentvalleyfs",
    ENDPOINTS: {
      estimateRate: "/api/calculator/estimate-rate",
      introducerEnquiry: "/api/trentvalleyfs/introducer-enquiry",
      careersApplication: "/api/trentvalleyfs/careers-application",
    },
  };

  var REF_KEY = "trentvalleyfs_introducer_ref";

  function introducerRef() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = (params.get("ref") || params.get("introducer") || "").trim().toLowerCase();
    try {
      if (fromUrl) sessionStorage.setItem(REF_KEY, fromUrl);
      return fromUrl || (sessionStorage.getItem(REF_KEY) || "").trim().toLowerCase();
    } catch (e) {
      return fromUrl;
    }
  }

  function hubUrl(path) {
    var p = path || "/" + config.TENANT + "/login";
    if (p.charAt(0) !== "/") p = "/" + p;
    var ref = introducerRef();
    if (ref) p += (p.indexOf("?") >= 0 ? "&" : "?") + "ref=" + encodeURIComponent(ref);
    return config.HUB_ORIGIN.replace(/\/$/, "") + p;
  }

  config.introducerRef = introducerRef;
  config.hubUrl = hubUrl;
  window.TVFS = config;

  function wire() {
    introducerRef();
    document.querySelectorAll("[data-hub-link]").forEach(function (el) {
      if (!config.HUB_LIVE) return;
      var path = el.getAttribute("data-hub-link") || "/" + config.TENANT + "/login";
      el.setAttribute("href", hubUrl(path.replace("{tenant}", config.TENANT)));
      el.hidden = false;
    });
    document.querySelectorAll("[data-hub-off]").forEach(function (el) {
      el.hidden = config.HUB_LIVE;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
