// Animated dice: SVG die icons in the dice bar; clicking one spins an on-screen
// die with cycling numbers, then settles on the server's actual result (which
// also lands in chat as usual). Purely visual — the roll itself is server-side.

const DICE = [["d20", 20], ["d12", 12], ["d10", 10], ["d8", 8], ["d6", 6], ["d4", 4]];

// Recognizable silhouettes for each die (polygon points in a 100×100 box).
const SHAPES = {
  d4: "50,10 90,82 10,82",
  d6: "18,18 82,18 82,82 18,82",
  d8: "50,8 90,50 50,92 10,50",
  d10: "50,8 84,40 70,90 30,90 16,40",
  d12: "50,6 79,24 88,58 67,86 33,86 12,58 21,24",
  d20: "50,6 86,27 86,73 50,94 14,73 14,27",
};
// Build a faceted, shaded die: gradient body + bevel facets from the centre to
// each vertex + a lighter front face holding an embossed number. Reads as 3D.
let gid = 0;
function buildDie(type, content, cls) {
  const pts = SHAPES[type].trim().split(/\s+/).map((p) => p.split(",").map(Number));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const n = gid++; const gradId = "dg" + n; const clipId = "dc" + n;
  const facets = pts.map((p) => `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${p[0]}" y2="${p[1]}" class="die-edge"/>`).join("");
  const inner = pts.map((p) => `${(cx + (p[0] - cx) * 0.5).toFixed(1)},${(cy + (p[1] - cy) * 0.5).toFixed(1)}`).join(" ");
  // Glitter speckle (clipped to the die shape).
  let sparkle = "";
  for (let i = 0; i < 16; i++) {
    sparkle += `<circle cx="${(Math.random() * 100).toFixed(1)}" cy="${(Math.random() * 100).toFixed(1)}" r="${(Math.random() * 1.1 + 0.4).toFixed(2)}" fill="#fff" opacity="${(Math.random() * 0.5 + 0.2).toFixed(2)}"/>`;
  }
  const ty = (cy + (type === "d4" ? 11 : 7)).toFixed(1);
  const txt = content != null ? `<text x="${cx.toFixed(1)}" y="${ty}" text-anchor="middle" class="die-num">${content}</text>` : "";
  return `<svg viewBox="0 0 100 100" class="${cls}">
    <defs>
      <linearGradient id="${gradId}" x1="0.15" y1="0" x2="0.65" y2="1">
        <stop offset="0" stop-color="#2a4bd0"/><stop offset="0.45" stop-color="#6a27c9"/><stop offset="1" stop-color="#a01ca0"/>
      </linearGradient>
      <clipPath id="${clipId}"><polygon points="${SHAPES[type]}"/></clipPath>
    </defs>
    <polygon points="${SHAPES[type]}" fill="url(#${gradId})" class="die-body"/>
    <g clip-path="url(#${clipId})">${sparkle}${facets}</g>
    <polygon points="${inner}" class="die-face"/>
    ${txt}
  </svg>`;
}
function dieSVG(type, content) { return buildDie(type, content, "die-svg"); }

// Small icon (no number) for chat — maps a die's sides to the right shape.
const SIDES_TO_TYPE = { 4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12", 20: "d20", 100: "d10" };
export function dieIconHTML(sides) { return buildDie(SIDES_TO_TYPE[sides] || "d20", null, "die-mini"); }

export function initDice(socket) {
  const bar = document.getElementById("dice-bar");
  const overlay = document.getElementById("dice-anim");
  bar.innerHTML = "";

  let animating = false, settled = false, startedAt = 0, cyc = null;

  DICE.forEach(([type, sides]) => {
    const b = document.createElement("button");
    b.className = "die-btn";
    b.title = `Roll a ${type}`;
    b.innerHTML = dieSVG(type, sides);
    b.addEventListener("click", () => roll(type));
    bar.appendChild(b);
  });

  function roll(type) {
    socket.emit("roll", type);
    startAnim(type);
  }

  function startAnim(type) {
    const sides = DICE.find((d) => d[0] === type)[1];
    animating = true; settled = false; startedAt = Date.now();
    overlay.innerHTML = `<div class="die-roll spinning">${dieSVG(type, "")}</div>`;
    overlay.classList.remove("hidden");
    const numEl = overlay.querySelector(".die-num");
    clearInterval(cyc);
    cyc = setInterval(() => { numEl.textContent = 1 + Math.floor(Math.random() * sides); }, 70);
  }

  function settle(total) {
    const finish = () => {
      clearInterval(cyc);
      const roll = overlay.querySelector(".die-roll");
      const numEl = overlay.querySelector(".die-num");
      if (numEl) numEl.textContent = total;
      if (roll) { roll.classList.remove("spinning"); roll.classList.add("settled"); }
      setTimeout(() => { overlay.classList.add("hidden"); animating = false; }, 900);
    };
    const elapsed = Date.now() - startedAt;
    if (elapsed < 650) setTimeout(finish, 650 - elapsed); else finish();
  }

  // When my own roll result comes back, land the animation on it.
  socket.on("chat", (m) => {
    if (m.type === "roll" && m.who === window.playerName && animating && !settled) {
      settled = true;
      settle((m.text.split("=").pop() || "").trim());
    }
  });
}
