// Initiative tracker. Shared live: everyone sees the same turn order, current
// turn, and round. Entries can be PCs, monsters, or anything you type in.

export function initInitiative(socket) {
  const list = document.getElementById("init-list");
  const roundEl = document.getElementById("init-round");
  const nameI = document.getElementById("init-name");
  const rollI = document.getElementById("init-roll");
  const hpI = document.getElementById("init-hp");

  function add() {
    const name = nameI.value.trim();
    if (!name) return;
    socket.emit("initAdd", { name, init: rollI.value, hp: hpI.value });
    nameI.value = ""; rollI.value = ""; hpI.value = "";
    nameI.focus();
  }

  document.getElementById("init-add-btn").addEventListener("click", add);
  [nameI, rollI, hpI].forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); })
  );
  document.getElementById("init-next").addEventListener("click", () =>
    socket.emit("initNext")
  );
  document.getElementById("init-clear").addEventListener("click", () => {
    if (confirm("Clear the initiative order?")) socket.emit("initClear");
  });

  function render(state) {
    roundEl.textContent = "Round " + state.round;
    list.innerHTML = "";
    state.entries.forEach((e, i) => {
      const row = document.createElement("div");
      row.className = "init-row" + (i === state.turn ? " current" : "");
      row.innerHTML = `
        <input class="init-val" data-f="init" value="${attr(e.init)}" type="number" title="Initiative"/>
        <span class="init-nm">${esc(e.name)}</span>
        <input class="init-hp" data-f="hp" value="${attr(e.hp)}" placeholder="HP" title="Hit points"/>
        <button class="del" title="Remove">✕</button>`;
      if (window.isDM) {
        row.querySelectorAll("input").forEach((inp) =>
          inp.addEventListener("change", () =>
            socket.emit("initUpdate", { id: e.id, field: inp.dataset.f, value: inp.value })
          )
        );
        row.querySelector(".del").addEventListener("click", () =>
          socket.emit("initRemove", e.id)
        );
      } else {
        // Players see the order but can't change it.
        row.querySelectorAll("input").forEach((inp) => (inp.disabled = true));
        row.querySelector(".del").style.display = "none";
      }
      list.appendChild(row);
    });
  }

  socket.on("state", (s) => render(s.initiative || { round: 1, turn: 0, entries: [] }));
  socket.on("initState", render);

  // Let other modules drop combatants in (e.g. bestiary "Add to initiative").
  window.addToInitiative = (name, init, hp) =>
    socket.emit("initAdd", { name, init, hp });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function attr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }
