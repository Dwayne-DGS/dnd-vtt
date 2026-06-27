// Seed a table with demo content for marketing screenshots.
//   node seed.js [roomName] [ownerUsername]
// Defaults: room "test", owner "iggy". Re-running is safe — it upserts the same
// seed records (ids are prefixed "seed-"), so it won't pile up duplicates.
// It does NOT change your map; set a map in the app first if you want one behind
// the tokens. Tokens are placed in a rough cluster — nudge them where you like.

import * as db from "./db.js";

const room = (process.argv[2] || "test").trim().toLowerCase();
const ownerName = (process.argv[3] || "iggy").trim();

const owner = db.getUserByUsername(ownerName);
if (!owner) { console.error(`No account named "${ownerName}". Create it first (sign up), then re-run.`); process.exit(1); }

db.ensureRoom(room);
db.setRoomOwner(room, owner.id);

const ab = (s, d, c, i, w, ch) => ({ STR: s, DEX: d, CON: c, INT: i, WIS: w, CHA: ch });
const sk = (...names) => Object.fromEntries(names.map((n) => [n, true]));

// --- Player characters ----------------------------------------------------
const chars = [
  { name: "Kaelen Stormrider", cls: "Barbarian", level: 5, ac: 15, hp: 52, hpMax: 58, prof: 3,
    abilities: ab(17, 14, 16, 8, 12, 10), saves: { STR: true, CON: true }, skills: sk("Athletics", "Intimidation"), slots: {},
    inventory: "Greataxe, 2 handaxes, explorer's pack. Rage 3/day, Reckless Attack, Danger Sense. Raised among the Frostmane clan." },
  { name: "Lyra Brightsong", cls: "Bard", level: 4, ac: 14, hp: 27, hpMax: 27, prof: 2,
    abilities: ab(10, 16, 12, 13, 11, 17), saves: { DEX: true, CHA: true }, skills: sk("Persuasion", "Performance", "Deception"),
    slots: { 1: { used: 1, total: 4 }, 2: { used: 0, total: 3 } },
    inventory: "Rapier, lute, dagger. Bardic Inspiration (d8), Cutting Words. Spy turned storyteller." },
  { name: "Thistlewick Glimmer", cls: "Wizard", level: 5, ac: 12, hp: 22, hpMax: 28, prof: 3,
    abilities: ab(8, 14, 12, 17, 13, 11), saves: { INT: true, WIS: true }, skills: sk("Arcana", "History", "Investigation"),
    slots: { 1: { used: 2, total: 4 }, 2: { used: 1, total: 3 }, 3: { used: 0, total: 2 } },
    inventory: "Quarterstaff, spellbook, component pouch. Knows Fireball, Misty Step, Counterspell. Endlessly curious gnome." },
  { name: "Sister Mara Vell", cls: "Cleric", level: 4, ac: 18, hp: 31, hpMax: 31, prof: 2,
    abilities: ab(13, 10, 14, 11, 17, 12), saves: { WIS: true, CHA: true }, skills: sk("Medicine", "Insight", "Religion"),
    slots: { 1: { used: 1, total: 4 }, 2: { used: 0, total: 3 } },
    inventory: "Mace, shield, chain mail, holy symbol. Channel Divinity, Cure Wounds, Spiritual Weapon. Tends the wounded after every fight." },
];
chars.forEach((c, i) => db.upsertCharacter(`seed-pc-${i}`, room, { ...c, owner: ownerName }));

// --- Bestiary -------------------------------------------------------------
const creatures = [
  { name: "Goblin Boss", kind: "Monster", type: "Small humanoid (goblinoid)", ac: 17, hp: 21, speed: "30 ft", abilities: ab(10, 14, 10, 10, 8, 10), actions: "Multiattack (2 scimitars). Redirect Attack: swap places with a nearby goblin to make it take the hit." },
  { name: "Dire Wolf", kind: "Monster", type: "Large beast", ac: 14, hp: 37, speed: "50 ft", abilities: ab(17, 15, 15, 3, 12, 7), actions: "Bite +5, 2d6+3 piercing; DC 13 STR save or knocked prone. Pack Tactics." },
  { name: "Giant Spider", kind: "Monster", type: "Large beast", ac: 14, hp: 26, speed: "30 ft, climb 30 ft", abilities: ab(14, 16, 12, 2, 11, 4), actions: "Bite + poison (DC 11 CON, 2d8). Web (recharge 5–6): restrains, DC 12 STR." },
  { name: "Cult Fanatic", kind: "Monster", type: "Medium humanoid", ac: 13, hp: 33, speed: "30 ft", abilities: ab(11, 14, 12, 10, 13, 14), actions: "Multiattack (2 daggers). Spells: Inflict Wounds, Hold Person, Command." },
  { name: "Grukk, the Smiling Orc", kind: "NPC", type: "Medium humanoid (orc) — barkeep", ac: 12, hp: 30, speed: "30 ft", abilities: ab(16, 11, 15, 9, 11, 13), actions: "Friendly tavern owner. Knows every rumor in town — for the price of a drink. Hides a wicked cleaver behind the bar." },
  { name: "Captain Sera Vane", kind: "NPC", type: "Medium humanoid — caravan guard captain", ac: 16, hp: 45, speed: "30 ft", abilities: ab(15, 14, 14, 12, 13, 14), actions: "Multiattack (longsword + shield bash). Rallying Cry: allies gain advantage on the next save. Hiring adventurers to find a lost caravan." },
];
creatures.forEach((c, i) => db.upsertCreature(`seed-mon-${i}`, room, c));

// --- Tokens on the map (rough cluster — drag to taste) --------------------
const tokens = [
  { label: "Kaelen", color: "#c0392b", x: 620, y: 520 },
  { label: "Lyra", color: "#8e44ad", x: 690, y: 560 },
  { label: "Thistle", color: "#2980b9", x: 600, y: 590 },
  { label: "Mara", color: "#d4af37", x: 670, y: 600 },
  { label: "Goblin", color: "#3a7d34", hp: 21, hp_max: 21, x: 940, y: 420 },
  { label: "Dire Wolf", color: "#6b4a2b", hp: 37, hp_max: 37, size: 1.3, x: 1000, y: 470 },
  { label: "Spider", color: "#444", hp: 26, hp_max: 26, size: 1.3, x: 1040, y: 380 },
];
tokens.forEach((t, i) => db.upsertToken({
  id: `seed-tok-${i}`, room_id: room, label: t.label, color: t.color, img: null,
  hp: t.hp ?? null, hp_max: t.hp_max ?? null, size: t.size ?? 1, x: t.x, y: t.y,
}));

// --- Journal --------------------------------------------------------------
db.upsertJournal({ id: "seed-j-1", roomId: room, shared: true, title: "The Smiling Orc",
  body: "A warm, lamplit tavern at the crossroads. Grukk the orc barkeep pours a mean honey ale and trades gossip for coin. Rooms upstairs, a card game in the back, and more than one patron who isn't what they seem." });
db.upsertJournal({ id: "seed-j-2", roomId: room, shared: true, title: "Tavern rumors",
  body: "• A merchant caravan never arrived from Thornic Vale.\n• Wolves have been bolder than usual on the north road.\n• Someone's been asking about the old shrine in the hills." });
db.upsertJournal({ id: "seed-j-3", roomId: room, shared: false, title: "DM — the missing caravan",
  body: "The caravan was ambushed by Goblin Boss Skitch's band, working for the Cult of the Hollow Star. Captain Sera Vane survived and is recruiting the party. The shrine hides the cult's real prize." });

// --- Party loot -----------------------------------------------------------
const loot = [
  { name: "Longsword +1", qty: 1, value: 500, holder: "Kaelen" },
  { name: "Potion of Healing", qty: 3, value: 50, holder: "Mara" },
  { name: "Bag of Holding", qty: 1, value: 400, holder: "Lyra" },
  { name: "Scroll of Fireball", qty: 1, value: 150, holder: "Thistlewick" },
  { name: "Silver caravan signet", qty: 1, value: 25, holder: "" },
];
loot.forEach((l, i) => db.upsertLoot({ id: `seed-loot-${i}`, roomId: room, ...l, notes: "" }));
db.setPartyGold(room, 1240);

console.log(`Seeded table "${room}" (owner ${ownerName}): ${chars.length} PCs, ${creatures.length} bestiary entries, ${tokens.length} tokens, 3 journal notes, ${loot.length} loot items + 1240 gp.`);
console.log("Open the table in the app to take screenshots. Re-running this script is safe.");
