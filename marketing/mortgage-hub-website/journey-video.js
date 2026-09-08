/**
 * First-time buyer draft player: muted autoplay on scroll,
 * captions only while muted, end card back to #your-journey.
 */
(function () {
  "use strict";

  function parseTimestamp(value) {
    var parts = String(value).trim().split(":");
    if (parts.length < 2) return 0;
    var hours = 0;
    var minutes;
    var seconds;
    if (parts.length === 3) {
      hours = Number(parts[0]);
      minutes = Number(parts[1]);
      seconds = Number(parts[2]);
    } else {
      minutes = Number(parts[0]);
      seconds = Number(parts[1]);
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseVtt(text) {
    var cues = [];
    var blocks = text.replace(/\r/g, "").split(/\n\n+/);
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split("\n").filter(Boolean);
      if (!lines.length || lines[0].indexOf("WEBVTT") === 0) continue;
      var stamp = lines.find(function (line) { return line.indexOf("-->") !== -1; });
      if (!stamp) continue;
      var bits = stamp.split("-->");
      var start = parseTimestamp(bits[0]);
      var end = parseTimestamp(bits[1]);
      var payload = lines.slice(lines.indexOf(stamp) + 1).join(" ").trim();
      if (payload) cues.push({ start: start, end: end, text: payload });
    }
    return cues;
  }

  function bindPlayer(root) {
    var video = root.querySelector("[data-ftb-video]");
    var captions = root.querySelector("[data-ftb-captions]");
    var mute = root.querySelector("[data-ftb-mute]");
    var end = root.querySelector("[data-ftb-end]");
    if (!video || !captions || !mute || !end) return;

    var cues = [];
    var src = root.getAttribute("data-captions-src");
    if (src) {
      var resolved = src;
      try { resolved = new URL(src, document.baseURI).href; } catch (err) {}
      fetch(resolved).then(function (res) { return res.ok ? res.text() : ""; }).then(function (text) {
        cues = parseVtt(text || "");
        showCue();
      }).catch(function () { cues = []; });
    }

    function showCue() {
      if (!video.muted) {
        captions.hidden = true;
        return;
      }
      var t = video.currentTime || 0;
      var cue = cues.find(function (item) { return t >= item.start && t < item.end; });
      captions.textContent = cue ? cue.text : "";
      captions.hidden = !cue;
    }

    function playMuted() {
      video.muted = true;
      mute.setAttribute("aria-pressed", "true");
      mute.textContent = "Unmute";
      var play = video.play();
      if (play && play.catch) play.catch(function () {});
    }

    mute.addEventListener("click", function () {
      if (video.muted) {
        video.muted = false;
        mute.setAttribute("aria-pressed", "false");
        mute.textContent = "Mute";
        captions.hidden = true;
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
      } else {
        playMuted();
        showCue();
      }
    });

    video.addEventListener("timeupdate", showCue);
    video.addEventListener("play", showCue);
    video.addEventListener("seeked", showCue);
    video.addEventListener("ended", function () {
      end.hidden = false;
      captions.hidden = true;
    });

    if ("IntersectionObserver" in window) {
      var seen = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            end.hidden = true;
            playMuted();
          } else if (!entry.isIntersecting && !video.paused && video.muted) {
            video.pause();
          }
        });
      }, { threshold: 0.45 });
      io.observe(root);
    }
  }

  document.querySelectorAll("[data-ftb-player]").forEach(bindPlayer);
})();
