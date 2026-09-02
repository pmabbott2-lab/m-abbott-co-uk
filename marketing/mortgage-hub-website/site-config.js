/**
 * Wire mock-up links to the live Mortgage Hub app and propagate introducer ?ref= attribution.
 */
(function () {
  var HUB_PUBLIC_ORIGIN = "https://another-selector-ranged.ngrok-free.dev";
  var INTRODUCER_REF_KEY = "mortgageeasy_introducer_ref";

  function resolveHubOrigin() {
    var configured = (window.MORTGAGE_HUB_APP_URL || "").replace(/\/$/, "");
    if (configured) {
      return configured.replace(/\/auth\/?$/, "");
    }

    var host = window.location.hostname;
    if (host.indexOf("ngrok") !== -1) {
      return window.location.origin.replace(/\/$/, "");
    }

    if (host === "localhost" || host === "127.0.0.1") {
      var params = new URLSearchParams(window.location.search);
      if (params.get("hub") === "public") {
        return HUB_PUBLIC_ORIGIN;
      }
      return "http://127.0.0.1:8080";
    }

    return window.location.origin;
  }

  function readRefFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return (params.get("ref") || params.get("introducer") || "").trim().toLowerCase();
  }

  function getIntroducerRef() {
    var fromUrl = readRefFromUrl();
    if (fromUrl) {
      try {
        sessionStorage.setItem(INTRODUCER_REF_KEY, fromUrl);
      } catch (e) {}
      return fromUrl;
    }
    try {
      var stored = sessionStorage.getItem(INTRODUCER_REF_KEY);
      return stored ? stored.trim().toLowerCase() : "";
    } catch (e) {
      return "";
    }
  }

  function appendQuery(href, key, value) {
    if (!value) return href;
    var hash = "";
    var path = href;
    var hashIdx = path.indexOf("#");
    if (hashIdx >= 0) {
      hash = path.slice(hashIdx);
      path = path.slice(0, hashIdx);
    }
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    return path + sep + encodeURIComponent(key) + "=" + encodeURIComponent(value) + hash;
  }

  function withRef(href) {
    if (!href || href.indexOf("http") === 0 && href.indexOf(window.location.origin) < 0) {
      return href;
    }
    var ref = getIntroducerRef();
    if (!ref) return href;
    return appendQuery(href, "ref", ref);
  }

  function appendRefToHubPath(path) {
    var ref = getIntroducerRef();
    if (!ref) return path;
    return appendQuery(path, "ref", ref);
  }

  var origin = resolveHubOrigin();
  window.MORTGAGE_HUB_API_URL = origin;
  window.MORTGAGEEASY_INTRODUCER_REF = getIntroducerRef;
  window.MORTGAGEEASY_WITH_REF = withRef;

  function hubPath(path) {
    var p = path || "/auth?from=broker&join=1";
    if (!p.startsWith("/")) p = "/" + p;
    p = appendRefToHubPath(p);
    return origin ? origin + p : p;
  }

  window.MORTGAGE_HUB_PATH = hubPath;

  function wire() {
    document.querySelectorAll("[data-hub-auth]").forEach(function (el) {
      var path = el.getAttribute("data-hub-path") || "/auth?from=broker&join=1";
      el.setAttribute("href", hubPath(path));
    });
    document.querySelectorAll("[data-hub-path]:not([data-hub-auth])").forEach(function (el) {
      el.setAttribute("href", hubPath(el.getAttribute("data-hub-path")));
    });
    document.querySelectorAll("[data-ref-link]").forEach(function (el) {
      var href = el.getAttribute("href");
      if (href) el.setAttribute("href", withRef(href));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
