// Animated weather overlay (rain / snow / fog) over the map. DM-toggled and
// synced to the whole table. Lightweight canvas particle loop.

export function initWeather(socket) {
  const cv = document.getElementById("weather-canvas");
  const ctx = cv.getContext("2d");
  let mode = "none", particles = [], raf = null;

  function resize() { const r = cv.parentElement.getBoundingClientRect(); cv.width = r.width; cv.height = r.height; }
  window.addEventListener("resize", resize);

  function seed() {
    particles = [];
    const n = mode === "fog" ? 14 : 220;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * cv.width, y: Math.random() * cv.height,
        s: Math.random() * 0.6 + 0.4, r: Math.random() * 30 + 30,
        vx: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  function frame() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (mode === "rain") {
      ctx.strokeStyle = "rgba(170,200,255,0.5)"; ctx.lineWidth = 1.2;
      for (const p of particles) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 1, p.y + 14 * p.s); ctx.stroke();
        p.y += 13 * p.s + 6; p.x += 1.2;
        if (p.y > cv.height) { p.y = -10; p.x = Math.random() * cv.width; }
      }
    } else if (mode === "snow") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const p of particles) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * p.s, 0, Math.PI * 2); ctx.fill();
        p.y += 1.1 * p.s + 0.4; p.x += Math.sin(p.y / 40) * 0.6;
        if (p.y > cv.height) { p.y = -6; p.x = Math.random() * cv.width; }
      }
    } else if (mode === "fog") {
      for (const p of particles) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g.addColorStop(0, "rgba(200,205,215,0.10)"); g.addColorStop(1, "rgba(200,205,215,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
        p.x += p.vx + 0.15; if (p.x > cv.width + 100) p.x = -100;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function setWeather(w) {
    mode = w || "none";
    cancelAnimationFrame(raf); raf = null;
    if (mode === "none") { cv.classList.add("hidden"); ctx.clearRect(0, 0, cv.width, cv.height); return; }
    cv.classList.remove("hidden"); resize(); seed(); frame();
  }
  window._setWeather = setWeather; // map.js calls this from the room state

  socket.on("weather", setWeather);
  document.getElementById("weather-select")?.addEventListener("change", (e) => socket.emit("setWeather", e.target.value));
}
