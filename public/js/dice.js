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
function dieSVG(type, content) {
  return `<svg viewBox="0 0 100 100" class="die-svg"><polygon points="${SHAPES[type]}"/><text x="50" y="58" text-anchor="middle" class="die-num">${content}</text></svg>`;
}

export function initDice(socket) {
  const bar = document.getElementById("dice-bar");
  const overlay = document.getElementById("dice-anim");
  bar.innerHTML = "";

  let animating = false, settled = false, startedAt = 0, cyc = null;

  DICE.forEach(([type]) => {
    const b = document.createElement("button");
    b.className = "die-btn";
    b.title = `Roll a ${type}`;
    b.innerHTML = dieSVG(type, type);
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
