// Bestiary: build & save monsters and NPCs with 5e stat blocks. Saved per room
// and synced. Each creature can be rolled for initiative or dropped straight
// into the initiative tracker. NPCs use the same form (kind = "NPC") so the
// panel doubles as a DM quick-reference.

const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

// A few SRD monsters as starting templates (abbreviated stat blocks).
const TEMPLATES = {
  Goblin: { kind: "Monster", type: "Small humanoid", ac: 15, hp: 7, speed: "30 ft",
    abilities: { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 },
    actions: "Scimitar: +4 to hit, 1d6+2 slashing.\nShortbow: +4 to hit, range 80/320, 1d6+2 piercing.\nNimble Escape: Disengage or Hide as a bonus action." },
  Orc: { kind: "Monster", type: "Medium humanoid", ac: 13, hp: 15, speed: "30 ft",
    abilities: { STR: 16, DEX: 12, CON: 16, INT: 7, WIS: 11, CHA: 10 },
    actions: "Greataxe: +5 to hit, 1d12+3 slashing.\nJavelin: +5 to hit, 1d6+3 piercing.\nAggressive: bonus action move toward a hostile." },
  Skeleton: { kind: "Monster", type: "Medium undead", ac: 13, hp: 13, speed: "30 ft",
    abilities: { STR: 10, DEX: 14, CON: 15, INT: 6, WIS: 8, CHA: 5 },
    actions: "Shortsword: +4 to hit, 1d6+2 piercing.\nShortbow: +4 to hit, 1d6+2 piercing.\nVulnerable to bludgeoning." },
  Wolf: { kind: "Monster", type: "Medium beast", ac: 13, hp: 11, speed: "40 ft",
    abilities: { STR: 12, DEX: 15, CON: 12, INT: 3, WIS: 12, CHA: 6 },
    actions: "Bite: +4 to hit, 2d4+2 piercing; DC 11 STR save or knocked prone.\nPack Tactics: advantage if an ally is near the target." },
  Bandit: { kind: "Monster", type: "Medium humanoid", ac: 12, hp: 11, speed: "30 ft",
    abilities: { STR: 11, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
    actions: "Scimitar: +3 to hit, 1d6+1 slashing.\nLight Crossbow: +3 to hit, 1d8+1 piercing." },
  "Generic NPC": { kind: "NPC", type: "Commoner / townsfolk", ac: 10, hp: 4, speed: "30 ft",
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    actions: "Role:\nWants:\nSecret:\nVoice / mannerism:" },
};

export function initBestiary(socket) {
  const list = document.getElementById("creature-list");
  const newBtn = document.getElementById("new-creature");
  const tmplSel = document.getElementById("creature-template");
  let creatures = [];

  Object.keys(TEMPLATES).forEach((name) => {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    tmplSel.appendChild(o);
  });

  function mod(score) {
    const m = Math.floor((Number(score || 10) - 10) / 2);
    return (m >= 0 ? "+" : "") + m;
  }
  function blank(t) {
    return {
      id: null, name: t ? t : "New Creature", kind: t ? TEMPLATES[t].kind : "Monster",
      type: t ? TEMPLATES[t].type : "", ac: t ? TEMPLATES[t].ac : 10,
      hp: t ? TEMPLATES[t].hp : 10, speed: t ? TEMPLATES[t].speed : "30 ft",
      abilities: t ? { ...TEMPLATES[t].abilities } : { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      actions: t ? TEMPLATES[t].actions : "",
    };
  }

  function render() {
    list.innerHTML = "";
    for (const c of creatures) list.appendChild(card(c));
  }

  function card(c) {
    const el = document.createElement("div");
    el.className = "char-card";
    el.innerHTML = `
      <div class="creature-kind">
        <select data-f="kind">
          <option ${c.kind === "Monster" ? "selected" : ""}>Monster</option>
          <option ${c.kind === "NPC" ? "selected" : ""}>NPC</option>
        </select>
        <input data-f="type" placeholder="type (e.g. Medium humanoid)" value="${attr(c.type)}"/>
      </div>
      <div class="char-row"><label>Name<input data-f="name" value="${attr(c.name)}"/></label></div>
      <div class="char-row">
        <label>AC<input data-f="ac" type="number" value="${attr(c.ac)}"/></label>
        <label>HP<input data-f="hp" type="number" value="${attr(c.hp)}"/></label>
        <label>Speed<input data-f="speed" value="${attr(c.speed)}"/></label>
      </div>
      <div class="abilities">
        ${ABILITIES.map((a) => `
          <div class="ability">
            <label>${a} (<span data-mod="${a}">${mod(c.abilities[a])}</span>)</label>
            <input data-ability="${a}" type="number" value="${attr(c.abilities[a])}"/>
          </div>`).join("")}
      </div>
      <div class="creature-actions">
        <label style="font-size:12px;color:var(--muted)">Actions / notes</label>
        <textarea data-f="actions">${esc(c.actions || "")}</textarea>
      </div>
      <div class="char-actions">
        <button data-act="save">Save</button>
        <button class="btn-secondary" data-act="init">→ Initiative</button>
        <button class="btn-secondary" data-act="map">→ Map</button>
        <button class="btn-secondary" data-act="del">Delete</button>
      </div>`;

    el.querySelectorAll("[data-ability]").forEach((inp) =>
      inp.addEventListener("input", () => {
        el.querySelector(`[data-mod="${inp.dataset.ability}"]`).textContent = mod(inp.value);
      })
    );

    function collect() {
      const d = { ...c };
      el.querySelectorAll("[data-f]").forEach((i) => (d[i.dataset.f] = i.value));
      d.abilities = {};
      el.querySelectorAll("[data-ability]").forEach((i) => (d.abilities[i.dataset.ability] = Number(i.value)));
      return d;
    }

    el.querySelector('[data-act="save"]').addEventListener("click", () =>
      socket.emit("saveCreature", { id: c.id, data: collect() })
    );
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (c.id && confirm(`Delete ${c.name}?`)) socket.emit("deleteCreature", c.id);
      else if (!c.id) { creatures = creatures.filter((x) => x !== c); render(); }
    });
    el.querySelector('[data-act="init"]').addEventListener("click", () => {
      const d = collect();
      // Roll initiative = d20 + DEX modifier.
      const dexMod = Math.floor((Number(d.abilities.DEX || 10) - 10) / 2);
      const roll = 1 + Math.floor(Math.random() * 20) + dexMod;
      if (window.addToInitiative) window.addToInitiative(d.name, roll, d.hp);
    });
    el.querySelector('[data-act="map"]').addEventListener("click", () => {
      const d = collect();
      // Place as a token. Monsters get a red disc, NPCs a gold one, labeled
      // with the first letters of the name.
      const color = d.kind === "NPC" ? "#b8860b" : "#7d2e2e";
      socket.emit("addToken", { label: d.name, color, img: d.img || null });
    });

    // Players get a read-only view of the bestiary (no editing/deleting/adding).
    if (!window.isDM) {
      el.querySelectorAll("input, textarea, select").forEach((i) => (i.disabled = true));
      el.querySelector(".char-actions").style.display = "none";
    }
    return el;
  }

  newBtn.addEventListener("click", () => { creatures.push(blank()); render(); });
  tmplSel.addEventListener("change", () => {
    if (tmplSel.value) { creatures.push(blank(tmplSel.value)); tmplSel.value = ""; render(); }
  });

  socket.on("state", (s) => { creatures = s.creatures || []; render(); });
  socket.on("creatureSaved", (c) => {
    const i = creatures.findIndex((x) => x.id === c.id);
    if (i >= 0) creatures[i] = c;
    else {
      const b = creatures.findIndex((x) => x.id === null);
      if (b >= 0) creatures[b] = c; else creatures.push(c);
    }
    render();
  });
  socket.on("creatureDeleted", (id) => {
    creatures = creatures.filter((c) => c.id !== id);
    render();
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function attr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }
