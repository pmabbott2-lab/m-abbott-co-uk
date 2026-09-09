/**
 * MortgageEasy site hamburger menu.
 */
(function () {
  "use strict";

  function init() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var menu = document.querySelector("[data-site-menu]");
    if (!toggle || !menu) return;

    function setOpen(open) {
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close site menu" : "Open site menu");
      toggle.classList.toggle("is-open", open);
      document.body.classList.toggle("site-menu-open", open);
    }

    function close() {
      setOpen(false);
    }

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(menu.hidden);
    });

    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) close();
    });

    document.addEventListener("click", function (e) {
      if (menu.hidden) return;
      if (e.target.closest(".site-header")) return;
      close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
