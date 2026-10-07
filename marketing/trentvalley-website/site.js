(function () {
  var year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  // Portrait: if image fails, show empty slot copy
  document.querySelectorAll(".portrait-slot").forEach(function (slot) {
    var img = slot.querySelector(".portrait-img");
    if (!img) {
      slot.classList.add("is-empty");
      return;
    }
    if (img.complete && img.naturalWidth === 0) {
      img.remove();
      slot.classList.add("is-empty");
    } else {
      img.addEventListener("error", function () {
        img.remove();
        slot.classList.add("is-empty");
      });
    }
  });

  // Site menu dropdowns (each toggle opens the menu named in aria-controls)
  var navToggles = Array.prototype.filter.call(
    document.querySelectorAll("[data-nav-toggle]"),
    function (t) { return document.getElementById(t.getAttribute("aria-controls")); }
  );
  var menuFor = function (toggle) {
    return document.getElementById(toggle.getAttribute("aria-controls"));
  };
  var setMenuOpen = function (toggle, open) {
    menuFor(toggle).hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close site menu" : "Open site menu");
    toggle.classList.toggle("is-open", open);
  };
  var closeMenus = function (except) {
    navToggles.forEach(function (t) {
      if (t !== except) setMenuOpen(t, false);
    });
  };
  navToggles.forEach(function (toggle) {
    var menu = menuFor(toggle);
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      closeMenus(toggle);
      setMenuOpen(toggle, open);
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenuOpen(toggle, false);
    });
  });
  if (navToggles.length) {
    document.addEventListener("click", function (e) {
      if (!e.target.closest("[data-menu-wrap], .site-header")) closeMenus();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      navToggles.forEach(function (t) {
        if (!menuFor(t).hidden) {
          setMenuOpen(t, false);
          t.focus();
        }
      });
    });
  }

  // Homepage: compact bar appears once the hero logo has scrolled away
  var scrollBar = document.querySelector("[data-scroll-bar]");
  var heroBrand = document.querySelector(".hero-brand");
  if (scrollBar && heroBrand && "IntersectionObserver" in window) {
    var setBarVisible = function (show) {
      scrollBar.classList.toggle("is-visible", show);
      scrollBar.setAttribute("aria-hidden", show ? "false" : "true");
      if (show) {
        scrollBar.removeAttribute("inert");
      } else {
        scrollBar.setAttribute("inert", "");
        navToggles.forEach(function (t) {
          if (scrollBar.contains(t)) setMenuOpen(t, false);
        });
      }
    };
    new IntersectionObserver(function (entries) {
      var entry = entries[0];
      setBarVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }).observe(heroBrand);
  }

  // Template forms: never submit.
  document.querySelectorAll("[data-template-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
    });
  });

  var nodes = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
    );
    nodes.forEach(function (node) {
      io.observe(node);
    });
  } else {
    nodes.forEach(function (node) {
      node.classList.add("is-in");
    });
  }
})();
