// D&D 5e character sheets. Shared per room: saving syncs to everyone.
// Ability modifiers are auto-computed. Clicking a saved sheet's roll buttons
// sends a check to the dice/chat panel.

const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

export function initCharacters(socket) {
  const list = document.getElementById("char-list");
  const newBtn = document.getElementById("new-char");
  let characters = []; // {id, name, class, level, ac, hp, abilities:{...}}

  function mod(score) {
    const m = Math.floor((Number(score || 10) - 10) / 2);
    return (m >= 0 ? "+" : "") + m;
  }

  function blank() {
    return {
      id: null, name: "New Character", cls: "", level: 1, ac: 10, hp: 10,
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    };
  }

  function render() {
    list.innerHTML = "";
    for (const c of characters) list.appendChild(card(c));
  }

  function card(c) {
    const el = document.createElement("div");
    el.className = "char-card";
    el.innerHTML = `
      <div class="char-row"><label>Name<input data-f="name" value="${attr(c.name)}"/></label></div>
      <div class="char-row">
        <label>Class<input data-f="cls" value="${attr(c.cls)}"/></label>
        <label>Level<input data-f="level" type="number" value="${attr(c.level)}"/></label>
      </div>
      <div class="char-row">
        <label>AC<input data-f="ac" type="number" value="${attr(c.ac)}"/></label>
        <label>HP<input data-f="hp" type="number" value="${attr(c.hp)}"/></label>
      </div>
      <div class="abilities">
        ${ABILITIES.map((a) => `
          <div class="ability">
            <label>${a} (<span data-mod="${a}">${mod(c.abilities[a])}</span>)</label>
            <input data-ability="${a}" type="number" value="${attr(c.abilities[a])}"/>
          </div>`).join("")}
      </div>
      <div class="char-actions">
        <button data-act="save">Save</button>
        <button class="btn-secondary" data-act="roll">Roll check</button>
        <button class="btn-secondary" data-act="del">Delete</button>
      </div>`;

    // Live-update modifier display as ability scores change.
    el.querySelectorAll("[data-ability]").forEach((inp) => {
      inp.addEventListener("input", () => {
        el.querySelector(`[data-mod="${inp.dataset.ability}"]`).textContent =
          mod(inp.value);
      });
    });

    function collect() {
      const data = { ...c };
      el.querySelectorAll("[data-f]").forEach((i) => (data[i.dataset.f] = i.value));
      data.abilities = {};
      el.querySelectorAll("[data-ability]").forEach(
        (i) => (data.abilities[i.dataset.ability] = Number(i.value))
      );
      return data;
    }

    el.querySelector('[data-act="save"]').addEventListener("click", () => {
      const data = collect();
      socket.emit("saveCharacter", { id: c.id, data });
    });
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (c.id && confirm(`Delete ${c.name}?`)) socket.emit("deleteCharacter", c.id);
      else if (!c.id) { characters = characters.filter((x) => x !== c); render(); }
    });
    el.querySelector('[data-act="roll"]').addEventListener("click", () => {
      const a = prompt("Which ability? (STR, DEX, CON, INT, WIS, CHA)", "DEX");
      if (!a || !ABILITIES.includes(a.toUpperCase())) return;
      const m = mod(collect().abilities[a.toUpperCase()]);
      socket.emit("roll", `1d20${m === "+0" ? "" : m}`);
    });
    return el;
  }

  newBtn.addEventListener("click", () => { characters.push(blank()); render(); });

  socket.on("state", (s) => { characters = s.characters || []; render(); });
  socket.on("characterSaved", (c) => {
    const i = characters.findIndex((x) => x.id === c.id);
    if (i >= 0) characters[i] = c;
    else {
      // Replace the unsaved blank if present, else append.
      const blankIdx = characters.findIndex((x) => x.id === null);
      if (blankIdx >= 0) characters[blankIdx] = c;
      else characters.push(c);
    }
    render();
  });
  socket.on("characterDeleted", (id) => {
    characters = characters.filter((c) => c.id !== id);
    render();
  });
}

function attr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}
