// Expanded, beginner-friendly pop-out character sheet. Opens in a big modal with
// plain-language descriptions of every stat and roll buttons throughout.
// Editable for the owner / DM; read-only (but still rollable) for others.

const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const ABILITY_INFO = {
  STR: ["Strength", "Raw physical power — melee attacks, lifting, and Athletics."],
  DEX: ["Dexterity", "Agility & reflexes — your AC, ranged attacks, Stealth, and initiative."],
  CON: ["Constitution", "Health & stamina — your hit points and holding concentration."],
  INT: ["Intelligence", "Reasoning & memory — Arcana, Investigation, and wizard spells."],
  WIS: ["Wisdom", "Awareness & intuition — Perception, Insight, and many saving throws."],
  CHA: ["Charisma", "Force of personality — Persuasion, Deception, and many spells."],
};
const SKILLS = [
  ["Acrobatics", "DEX", "Keep your balance, tumble, slip free of a grab."],
  ["Animal Handling", "WIS", "Calm, control, or read the intentions of animals."],
  ["Arcana", "INT", "Recall lore about spells, magic items, and planes."],
  ["Athletics", "STR", "Climb, jump, swim, and grapple."],
  ["Deception", "CHA", "Convincingly hide the truth or lie."],
  ["History", "INT", "Recall historical events, people, and kingdoms."],
  ["Insight", "WIS", "Sense someone's true feelings or motives."],
  ["Intimidation", "CHA", "Influence others through threats or menace."],
  ["Investigation", "INT", "Search for clues and deduce how things work."],
  ["Medicine", "WIS", "Stabilize a dying creature or diagnose illness."],
  ["Nature", "INT", "Recall lore about terrain, plants, animals, weather."],
  ["Perception", "WIS", "Notice things using your eyes, ears, and senses."],
  ["Performance", "CHA", "Entertain an audience with music, dance, acting."],
  ["Persuasion", "CHA", "Influence others with tact, charm, and good faith."],
  ["Religion", "INT", "Recall lore about gods, rites, and holy symbols."],
  ["Sleight of Hand", "DEX", "Pickpocket, palm an object, or plant something."],
  ["Stealth", "DEX", "Hide and move without being seen or heard."],
  ["Survival", "WIS", "Track creatures, forage, and navigate the wilds."],
];

const mod = (score) => Math.floor((Number(score || 10) - 10) / 2);
const fmt = (m) => (m >= 0 ? "+" : "") + m;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const attr = (s) => String(s ?? "").replace(/"/g, "&quot;");

export function openCharacterSheet(socket, c, canEdit) {
  const modal = document.getElementById("sheet-modal");

  const abilCards = ABILITIES.map((a) => {
    const [full, desc] = ABILITY_INFO[a];
    return `
      <div class="sh-abil">
        <div class="sh-abil-top">
          <span class="sh-abil-name">${full} <small>(${a})</small></span>
          <span class="sh-abil-mod" data-mod="${a}">${fmt(mod(c.abilities?.[a]))}</span>
        </div>
        <input data-ability="${a}" type="number" value="${attr(c.abilities?.[a] ?? 10)}"/>
        <p class="sh-desc">${desc}</p>
        <button class="sh-roll" data-roll="ability" data-ab="${a}">🎲 Roll ${a} check</button>
      </div>`;
  }).join("");

  const saveRows = ABILITIES.map((a) => `
    <div class="sh-row">
      <input type="checkbox" data-save="${a}" ${c.saves?.[a] ? "checked" : ""}/>
      <span class="sh-row-name">${ABILITY_INFO[a][0]}</span>
      <span class="sh-row-mod" data-savemod="${a}">+0</span>
      <button class="sh-roll sm" data-roll="save" data-ab="${a}">🎲</button>
    </div>`).join("");

  const skillRows = SKILLS.map(([s, ab, desc]) => `
    <div class="sh-row skill">
      <input type="checkbox" data-skill="${attr(s)}" ${c.skills?.[s] ? "checked" : ""}/>
      <div class="sh-row-main">
        <span class="sh-row-name">${s} <small>(${ab})</small></span>
        <span class="sh-desc">${desc}</span>
      </div>
      <span class="sh-row-mod" data-skillmod="${attr(s)}">+0</span>
      <button class="sh-roll sm" data-roll="skill" data-skill-name="${attr(s)}" data-ab="${ab}">🎲</button>
    </div>`).join("");

  const slotCells = [1,2,3,4,5,6,7,8,9].map((lv) => `
    <div class="sh-slot">
      <label>Lvl ${lv}</label>
      <div><input data-slot-used="${lv}" type="number" min="0" value="${attr(c.slots?.[lv]?.used ?? 0)}"/> / <input data-slot-total="${lv}" type="number" min="0" value="${attr(c.slots?.[lv]?.total ?? 0)}"/></div>
    </div>`).join("");

  modal.innerHTML = `
    <div class="sheet-card">
      <div class="sh-head">
        <input class="sh-name" data-f="name" value="${attr(c.name)}" placeholder="Name"/>
        <div class="sh-headbtns">
          ${canEdit ? '<button class="sh-save">Save</button>' : ""}
          <button class="sh-close btn-secondary">Close</button>
        </div>
      </div>
      ${canEdit ? "" : `<p class="sh-readonly">You're viewing ${esc(c.owner || "another player")}'s character — you can roll from it, but only the owner can edit.</p>`}
      <p class="sh-intro">New here? A <b>modifier</b> (like +3) is what you add to a d20 die roll. Tap any 🎲 to roll that check and show it in chat. Click a section to roll or edit.</p>

      <div class="sh-core">
        <label>Class<input data-f="cls" value="${attr(c.cls)}"/></label>
        <label>Level<input data-f="level" type="number" value="${attr(c.level)}"/></label>
        <label>Proficiency bonus<input data-f="prof" type="number" value="${attr(c.prof ?? 2)}"/><small>Added to things you're trained in.</small></label>
      </div>
      <div class="sh-core">
        <label>Armor Class (AC)<input data-f="ac" type="number" value="${attr(c.ac)}"/><small>How hard you are to hit.</small></label>
        <label>Hit Points (now)<input data-f="hp" type="number" value="${attr(c.hp)}"/><small>Your current health.</small></label>
        <label>Max HP<input data-f="hpMax" type="number" value="${attr(c.hpMax ?? c.hp)}"/><small>Full health.</small></label>
      </div>

      <h3>Abilities <small>the six core stats</small></h3>
      <div class="sh-abils">${abilCards}</div>

      <h3>Saving throws <small>resist effects (poison, fear, spells…). Checked = trained.</small></h3>
      <div class="sh-list">${saveRows}</div>

      <h3>Skills <small>checked = trained (adds your proficiency bonus)</small></h3>
      <div class="sh-list">${skillRows}</div>

      <h3>Spell slots <small>how many spells you can cast per level (used / total)</small></h3>
      <div class="sh-slots">${slotCells}</div>

      <h3>Inventory &amp; notes</h3>
      <textarea data-f="inventory" rows="5" placeholder="Equipment, features, backstory…">${esc(c.inventory || "")}</textarea>

      <div class="sh-savebar">${canEdit ? '<button class="sh-save">Save changes</button>' : ""}<span class="sh-saved"></span></div>
    </div>`;

  const el = modal.querySelector(".sheet-card");

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
  function recompute() {
    const d = collect();
    const prof = Number(d.prof) || 0;
    ABILITIES.forEach((a) => {
      el.querySelector(`[data-mod="${a}"]`).textContent = fmt(mod(d.abilities[a]));
      el.querySelector(`[data-savemod="${a}"]`).textContent = fmt(mod(d.abilities[a]) + (d.saves[a] ? prof : 0));
    });
    SKILLS.forEach(([s, ab]) => {
      el.querySelector(`[data-skillmod="${CSS.escape(s)}"]`).textContent = fmt(mod(d.abilities[ab]) + (d.skills[s] ? prof : 0));
    });
  }
  function roll(m) { socket.emit("roll", `1d20${m === 0 ? "" : fmt(m)}`); }

  el.querySelectorAll("[data-roll]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = collect(); const prof = Number(d.prof) || 0;
      if (b.dataset.roll === "ability") roll(mod(d.abilities[b.dataset.ab]));
      else if (b.dataset.roll === "save") roll(mod(d.abilities[b.dataset.ab]) + (d.saves[b.dataset.ab] ? prof : 0));
      else if (b.dataset.roll === "skill") {
        const s = b.dataset.skillName;
        roll(mod(d.abilities[b.dataset.ab]) + (d.skills[s] ? prof : 0));
      }
    })
  );

  if (canEdit) {
    el.querySelectorAll("input, textarea").forEach((i) => i.addEventListener("input", recompute));
    el.querySelectorAll(".sh-save").forEach((b) =>
      b.addEventListener("click", () => {
        socket.emit("saveCharacter", { id: c.id, data: collect() });
        const note = el.querySelector(".sh-saved");
        if (note) { note.textContent = "Saved ✓"; setTimeout(() => (note.textContent = ""), 2000); }
      })
    );
  } else {
    el.querySelectorAll("input, textarea").forEach((i) => (i.disabled = true));
  }

  el.querySelectorAll(".sh-close").forEach((b) => b.addEventListener("click", () => modal.classList.add("hidden")));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  recompute();
  modal.classList.remove("hidden");
}
