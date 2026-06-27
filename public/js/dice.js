// Animated dice with selectable skins. SVG die icons in the dice bar; clicking
// one spins an on-screen die that settles on the server's real result (which also
// lands in chat). Skins are cosmetic and chosen in Settings (saved per account).

const DICE = [["d20", 20], ["d12", 12], ["d10", 10], ["d8", 8], ["d6", 6], ["d4", 4]];

const SHAPES = {
  d4: "50,10 90,82 10,82",
  d6: "18,18 82,18 82,82 18,82",
  d8: "50,8 90,50 50,92 10,50",
  d10: "50,8 84,40 70,90 30,90 16,40",
  d12: "50,6 79,24 88,58 67,86 33,86 12,58 21,24",
  d20: "50,6 86,27 86,73 50,94 14,73 14,27",
};

// Each skin: gradient stops [offset, color], number fill + outline.
export const SKINS = {
  galaxy:   { name: "Galaxy",   stops: [[0, "#2a4bd0"], [0.45, "#6a27c9"], [1, "#a01ca0"]], num: "#ecd089", numStroke: "#4a3310" },
  crimson:  { name: "Crimson",  stops: [[0, "#e8775f"], [0.5, "#c0392b"], [1, "#741c12"]], num: "#ecd089", numStroke: "#4a3310" },
  emerald:  { name: "Emerald",  stops: [[0, "#5fe0a0"], [0.5, "#1f9d57"], [1, "#0c5a30"]], num: "#fff4d6", numStroke: "#0c3a20" },
  amber:    { name: "Amber",    stops: [[0, "#ffe1a0"], [0.5, "#e0a72e"], [1, "#9c6a12"]], num: "#3a2606", numStroke: "#ffeec4" },
  frost:    { name: "Frost",    stops: [[0, "#cdecff"], [0.5, "#5aa0e6"], [1, "#244e8c"]], num: "#ffffff", numStroke: "#173a66" },
  obsidian: { name: "Obsidian", stops: [[0, "#5a5a68"], [0.5, "#26262f"], [1, "#0c0c12"]], num: "#e8eaf0", numStroke: "#000000" },
};
const SIDES_TO_TYPE = { 4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12", 20: "d20", 100: "d10" };

let active = "galaxy";
let gid = 0;
let barEl = null;

function skin() { return SKINS[active] || SKINS.galaxy; }

function buildDie(type, content, cls) {
  const sk = skin();
  const pts = SHAPES[type].trim().split(/\s+/).map((p) => p.split(",").map(Number));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const n = gid++; const gradId = "dg" + n; const clipId = "dc" + n;
  const facets = pts.map((p) => `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${p[0]}" y2="${p[1]}" class="die-edge"/>`).join("");
  const inner = pts.map((p) => `${(cx + (p[0] - cx) * 0.5).toFixed(1)},${(cy + (p[1] - cy) * 0.5).toFixed(1)}`).join(" ");
  let sparkle = "";
  for (let i = 0; i < 16; i++) {
    sparkle += `<circle cx="${(Math.random() * 100).toFixed(1)}" cy="${(Math.random() * 100).toFixed(1)}" r="${(Math.random() * 1.1 + 0.4).toFixed(2)}" fill="#fff" opacity="${(Math.random() * 0.5 + 0.2).toFixed(2)}"/>`;
  }
  const stops = sk.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
  const ty = (cy + (type === "d4" ? 11 : 7)).toFixed(1);
  const txt = content != null ? `<text x="${cx.toFixed(1)}" y="${ty}" text-anchor="middle" class="die-num" style="fill:${sk.num};stroke:${sk.numStroke}">${content}</text>` : "";
  return `<svg viewBox="0 0 100 100" class="${cls}">
    <defs>
      <linearGradient id="${gradId}" x1="0.15" y1="0" x2="0.65" y2="1">${stops}</linearGradient>
      <clipPath id="${clipId}"><polygon points="${SHAPES[type]}"/></clipPath>
    </defs>
    <polygon points="${SHAPES[type]}" fill="url(#${gradId})" class="die-body"/>
    <g clip-path="url(#${clipId})">${sparkle}${facets}</g>
    <polygon points="${inner}" class="die-face"/>
    ${txt}
  </svg>`;
}

export function dieIconHTML(sides) { return buildDie(SIDES_TO_TYPE[sides] || "d20", null, "die-mini"); }
export function previewDie(skinId) { const prev = active; active = skinId; const svg = buildDie("d20", 20, "die-svg"); active = prev; return svg; }
export function currentSkin() { return active; }

function renderBar(socket) {
  if (!barEl) return;
  barEl.innerHTML = "";
  DICE.forEach(([type, sides]) => {
    const b = document.createElement("button");
    b.className = "die-btn"; b.title = `Roll a ${type}`;
    b.innerHTML = buildDie(type, sides, "die-svg");
    b.addEventListener("click", () => { socket.emit("roll", type, window.rollOpts || {}); startAnim(type); });
    barEl.appendChild(b);
  });
}

// Let Settings re-skin the dice live.
export function applySkin(skinId) {
  if (!SKINS[skinId]) return;
  active = skinId;
  if (window._diceSocket) renderBar(window._diceSocket);
}

// --- on-screen roll animation -------------------------------------------
let overlay, animating = false, settled = false, startedAt = 0, cyc = null;
function startAnim(type) {
  const sides = DICE.find((d) => d[0] === type)[1];
  animating = true; settled = false; startedAt = Date.now();
  overlay.innerHTML = `<div class="die-roll spinning">${buildDie(type, "", "die-svg")}</div>`;
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

function wireRollMods() {
  window.rollOpts = { advantage: false, disadvantage: false, secret: false };
  const adv = document.getElementById("mod-adv");
  const dis = document.getElementById("mod-dis");
  const sec = document.getElementById("mod-secret");
  adv?.addEventListener("click", () => {
    window.rollOpts.advantage = !window.rollOpts.advantage;
    window.rollOpts.disadvantage = false;
    adv.classList.toggle("active", window.rollOpts.advantage); dis.classList.remove("active");
  });
  dis?.addEventListener("click", () => {
    window.rollOpts.disadvantage = !window.rollOpts.disadvantage;
    window.rollOpts.advantage = false;
    dis.classList.toggle("active", window.rollOpts.disadvantage); adv.classList.remove("active");
  });
  sec?.addEventListener("click", () => {
    window.rollOpts.secret = !window.rollOpts.secret;
    sec.classList.toggle("active", window.rollOpts.secret);
  });
}

// Saved dice macros (per account) — quick buttons like "Longsword: 1d20+5".
function renderMacros(socket) {
  const bar = document.getElementById("macro-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const macros = (window.account && window.account.macros) || [];
  macros.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "macro-btn"; b.textContent = m.name; b.title = m.notation + " (right-click to delete)";
    b.addEventListener("click", () => socket.emit("roll", m.notation, window.rollOpts || {}));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (confirm(`Delete macro "${m.name}"?`)) { macros.splice(i, 1); saveMacros(socket, macros); } });
    bar.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "macro-add"; add.textContent = "＋ macro"; add.title = "Save a roll as a button";
  add.addEventListener("click", () => {
    const name = prompt("Macro name (e.g. Longsword):"); if (!name) return;
    const notation = prompt("Roll (e.g. 1d20+5, or 2d6+3):"); if (!notation) return;
    macros.push({ name: name.trim().slice(0, 24), notation: notation.trim() });
    saveMacros(socket, macros);
  });
  bar.appendChild(add);
}
function saveMacros(socket, macros) {
  if (window.account) window.account.macros = macros;
  socket.emit("setMacros", macros);
  renderMacros(socket);
}

export function initDice(socket) {
  window._diceSocket = socket;
  barEl = document.getElementById("dice-bar");
  overlay = document.getElementById("dice-anim");
  wireRollMods();
  renderMacros(socket);
  if (window.account && window.account.diceSkin && SKINS[window.account.diceSkin]) active = window.account.diceSkin;
  renderBar(socket);
  socket.on("chat", (m) => {
    if (m.type === "roll" && m.who === window.playerName && animating && !settled) {
      settled = true; settle((m.text.split("=").pop() || "").trim());
    }
  });
}
