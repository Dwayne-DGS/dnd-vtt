// D&D 5e character sheets — shared per room. Players edit only their own;
// the DM edits anyone's (enforced server-side). Includes abilities, saving
// throws, all 18 skills, spell slots, and inventory, each with roll buttons.

const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const SKILLS = [
  ["Acrobatics", "DEX"], ["Animal Handling", "WIS"], ["Arcana", "INT"],
  ["Athletics", "STR"], ["Deception", "CHA"], ["History", "INT"],
  ["Insight", "WIS"], ["Intimidation", "CHA"], ["Investigation", "INT"],
  ["Medicine", "WIS"], ["Nature", "INT"], ["Perception", "WIS"],
  ["Performance", "CHA"], ["Persuasion", "CHA"], ["Religion", "INT"],
  ["Sleight of Hand", "DEX"], ["Stealth", "DEX"], ["Survival", "WIS"],
];

export function initCharacters(socket) {
  const list = document.getElementById("char-list");
  const newBtn = document.getElementById("new-char");
  let characters = [];

  const abilMod = (score) => Math.floor((Number(score || 10) - 10) / 2);
  const fmt = (m) => (m >= 0 ? "+" : "") + m;

  function blank() {
    return {
      id: null, name: "New Character", cls: "", level: 1, ac: 10,
      hp: 10, hpMax: 10, prof: 2,
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      saves: {}, skills: {},
      slots: {}, inventory: "",
    };
  }

  function render() {
    list.innerHTML = "";
    for (const c of characters) list.appendChild(card(c));
  }

  function card(c) {
    const canEdit = window.isDM || !c.owner || c.owner === window.playerName;
    const el = document.createElement("div");
    el.className = "char-card";

    const abilHTML = ABILITIES.map((a) => `
      <div class="ability">
        <label>${a} (<span data-mod="${a}">${fmt(abilMod(c.abilities[a]))}</span>)</label>
        <input data-ability="${a}" type="number" value="${attr(c.abilities[a])}"/>
      </div>`).join("");

    const saveHTML = ABILITIES.map((a) => `
      <div class="line">
        <input type="checkbox" data-save="${a}" ${c.saves?.[a] ? "checked" : ""}/>
        <span class="ln-name">${a} save</span>
        <span class="ln-mod" data-savemod="${a}">+0</span>
        <button class="mini" data-rollsave="${a}">🎲</button>
      </div>`).join("");

    const skillHTML = SKILLS.map(([s, ab]) => `
      <div class="line">
        <input type="checkbox" data-skill="${attr(s)}" ${c.skills?.[s] ? "checked" : ""}/>
        <span class="ln-name">${s} <em>(${ab})</em></span>
        <span class="ln-mod" data-skillmod="${attr(s)}">+0</span>
        <button class="mini" data-rollskill="${attr(s)}" data-ab="${ab}">🎲</button>
      </div>`).join("");

    const slotHTML = [1,2,3,4,5,6,7,8,9].map((lv) => `
      <div class="slot">
        <label>L${lv}</label>
        <input data-slot-used="${lv}" type="number" min="0" value="${attr(c.slots?.[lv]?.used ?? 0)}" title="used"/>
        <span>/</span>
        <input data-slot-total="${lv}" type="number" min="0" value="${attr(c.slots?.[lv]?.total ?? 0)}" title="total"/>
      </div>`).join("");

    el.innerHTML = `
      <div class="char-row"><label>Name<input data-f="name" value="${attr(c.name)}"/></label></div>
      <div class="char-row">
        <label>Class<input data-f="cls" value="${attr(c.cls)}"/></label>
        <label>Level<input data-f="level" type="number" value="${attr(c.level)}"/></label>
        <label>Prof<input data-f="prof" type="number" value="${attr(c.prof ?? 2)}"/></label>
      </div>
      <div class="char-row">
        <label>AC<input data-f="ac" type="number" value="${attr(c.ac)}"/></label>
        <label>HP<input data-f="hp" type="number" value="${attr(c.hp)}"/></label>
        <label>Max HP<input data-f="hpMax" type="number" value="${attr(c.hpMax ?? c.hp)}"/></label>
      </div>
      <div class="abilities">${abilHTML}</div>
      <details><summary>Saving throws</summary><div class="lines">${saveHTML}</div></details>
      <details><summary>Skills</summary><div class="lines">${skillHTML}</div></details>
      <details><summary>Spell slots</summary><div class="slots">${slotHTML}</div></details>
      <details><summary>Inventory &amp; notes</summary>
        <textarea data-f="inventory" rows="4">${esc(c.inventory || "")}</textarea>
      </details>
      <div class="char-actions">
        <button data-act="save">Save</button>
        <button class="btn-secondary" data-act="del">Delete</button>
      </div>`;

    function collect() {
      const d = { ...c };
      el.querySelectorAll("[data-f]").forEach((i) => (d[i.dataset.f] = i.value));
      d.abilities = {};
      el.querySelectorAll("[data-ability]").forEach((i) => (d.abilities[i.dataset.ability] = Number(i.value)));
      d.saves = {};
      el.querySelectorAll("[data-save]").forEach((i) => { if (i.checked) d.saves[i.dataset.save] = true; });
      d.skills = {};
      el.querySelectorAll("[data-skill]").forEach((i) => { if (i.checked) d.skills[i.dataset.skill] = true; });
      d.slots = {};
      [1,2,3,4,5,6,7,8,9].forEach((lv) => {
        const used = Number(el.querySelector(`[data-slot-used="${lv}"]`).value) || 0;
        const total = Number(el.querySelector(`[data-slot-total="${lv}"]`).value) || 0;
        if (total > 0 || used > 0) d.slots[lv] = { used, total };
      });
      return d;
    }

    // Live-recompute all displayed modifiers from the current field values.
    function recompute() {
      const d = collect();
      const prof = Number(d.prof) || 0;
      ABILITIES.forEach((a) => {
        el.querySelector(`[data-mod="${a}"]`).textContent = fmt(abilMod(d.abilities[a]));
        el.querySelector(`[data-savemod="${a}"]`).textContent =
          fmt(abilMod(d.abilities[a]) + (d.saves[a] ? prof : 0));
      });
      SKILLS.forEach(([s, ab]) => {
        el.querySelector(`[data-skillmod="${CSS.escape(s)}"]`).textContent =
          fmt(abilMod(d.abilities[ab]) + (d.skills[s] ? prof : 0));
      });
    }
    el.querySelectorAll("input").forEach((i) => i.addEventListener("input", recompute));
    el.querySelectorAll("input[type=checkbox]").forEach((i) => i.addEventListener("change", recompute));

    function roll(modifier) {
      const m = modifier === 0 ? "" : fmt(modifier);
      socket.emit("roll", `1d20${m}`);
    }
    el.querySelectorAll("[data-rollsave]").forEach((b) =>
      b.addEventListener("click", () => {
        const d = collect(); const a = b.dataset.rollsave;
        roll(abilMod(d.abilities[a]) + (d.saves[a] ? (Number(d.prof) || 0) : 0));
      })
    );
    el.querySelectorAll("[data-rollskill]").forEach((b) =>
      b.addEventListener("click", () => {
        const d = collect(); const s = b.dataset.rollskill; const ab = b.dataset.ab;
        roll(abilMod(d.abilities[ab]) + (d.skills[s] ? (Number(d.prof) || 0) : 0));
      })
    );

    el.querySelector('[data-act="save"]').addEventListener("click", () =>
      socket.emit("saveCharacter", { id: c.id, data: collect() })
    );
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (c.id && confirm(`Delete ${c.name}?`)) socket.emit("deleteCharacter", c.id);
      else if (!c.id) { characters = characters.filter((x) => x !== c); render(); }
    });

    recompute();

    if (!canEdit) {
      el.querySelectorAll("input, textarea").forEach((i) => (i.disabled = true));
      el.querySelector('[data-act="save"]').style.display = "none";
      el.querySelector('[data-act="del"]').style.display = "none";
      if (c.owner) {
        const tag = document.createElement("div");
        tag.style.cssText = "font-size:12px;color:var(--muted);margin-top:4px";
        tag.textContent = "Owned by " + c.owner;
        el.appendChild(tag);
      }
    }
    return el;
  }

  newBtn.addEventListener("click", () => { characters.push(blank()); render(); });

  socket.on("state", (s) => { characters = s.characters || []; render(); });
  socket.on("characterSaved", (c) => {
    const i = characters.findIndex((x) => x.id === c.id);
    if (i >= 0) characters[i] = c;
    else {
      const b = characters.findIndex((x) => x.id === null);
      if (b >= 0) characters[b] = c; else characters.push(c);
    }
    render();
  });
  socket.on("characterDeleted", (id) => {
    characters = characters.filter((c) => c.id !== id);
    render();
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function attr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }
