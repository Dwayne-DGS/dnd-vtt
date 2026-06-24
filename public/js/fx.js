// Lighting effects (DM). Buttons fire a named effect to the room; everyone's
// screen flashes the effect color, and any running Hue helper drives the lights.
// The effect NAMES here must match the helper's light mapping.

export const EFFECTS = [
  { id: "fire", label: "🔥 Fire", css: "#ff5a1f" },
  { id: "fireball", label: "💥 Fireball", css: "#ff3b1f" },
  { id: "lightning", label: "⚡ Lightning", css: "#eaf2ff" },
  { id: "healing", label: "💚 Healing", css: "#3ad17a" },
  { id: "frost", label: "❄️ Frost", css: "#5ab0ff" },
  { id: "necrotic", label: "💜 Necrotic", css: "#9b59ff" },
  { id: "radiant", label: "✨ Radiant", css: "#fff2a8" },
  { id: "poison", label: "🟢 Poison", css: "#7fff3a" },
  { id: "darkness", label: "🌑 Darkness", css: "#11121a" },
  { id: "reset", label: "💡 Lights normal", css: "#e8c98a" },
];

export function initFX(socket) {
  const wrap = document.getElementById("fx-buttons");
  const flash = document.getElementById("fx-flash");

  EFFECTS.forEach((e) => {
    const b = document.createElement("button");
    b.textContent = e.label;
    b.addEventListener("click", () => socket.emit("castEffect", e.id));
    wrap.appendChild(b);
  });

  // Brief full-screen color flash when any effect fires (works without Hue).
  socket.on("spellEffect", (id) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e || e.id === "reset") return;
    flash.style.background = e.css;
    flash.style.opacity = "0.5";
    setTimeout(() => { flash.style.opacity = "0"; }, 350);
  });
}
