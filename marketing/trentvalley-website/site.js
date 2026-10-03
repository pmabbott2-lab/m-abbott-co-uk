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
