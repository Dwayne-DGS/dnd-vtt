// SQLite persistence layer.
// One file (vtt.db) holds everything: rooms, tokens, characters.
// Swap to Postgres later by replacing this module — the rest of the app
// only calls the exported functions below.

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "vtt.db"));
db.pragma("journal_mode = WAL");      // concurrent readers while a write is in progress
db.pragma("synchronous = NORMAL");    // safe with WAL, much faster than FULL
db.pragma("busy_timeout = 5000");     // wait up to 5s for a lock instead of erroring
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id        TEXT PRIMARY KEY,
    map_url   TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id      TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    label   TEXT,
    color   TEXT,
    x       REAL,
    y       REAL
  );

  CREATE TABLE IF NOT EXISTS characters (
    id      TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    data    TEXT NOT NULL  -- JSON blob of the 5e sheet
  );

  CREATE TABLE IF NOT EXISTS creatures (
    id      TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    data    TEXT NOT NULL  -- JSON stat block (monster or NPC)
  );

  CREATE TABLE IF NOT EXISTS maps (
    id      TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name    TEXT,
    url     TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    pass_hash  TEXT NOT NULL,
    role       TEXT NOT NULL,      -- 'admin' | 'gm' | 'player'
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id   TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    joined_at INTEGER,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS room_invites (
    room_id TEXT NOT NULL,
    email   TEXT NOT NULL,
    PRIMARY KEY (room_id, email)
  );

  CREATE TABLE IF NOT EXISTS sounds (
    id   TEXT PRIMARY KEY,
    name TEXT,
    url  TEXT,
    kind TEXT  -- 'ambient' | 'sfx'
  );
  CREATE TABLE IF NOT EXISTS journal (
    id         TEXT PRIMARY KEY,
    room_id    TEXT,
    title      TEXT,
    body       TEXT,
    shared     INTEGER DEFAULT 0,  -- 1 = visible to players
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS loot (
    id      TEXT PRIMARY KEY,
    room_id TEXT,
    name    TEXT,
    qty     INTEGER DEFAULT 1,
    value   INTEGER DEFAULT 0,  -- gp each
    holder  TEXT,
    notes   TEXT
  );
`);

// Migrations: add columns to existing databases that predate them.
const roomCols = db.prepare("PRAGMA table_info(rooms)").all().map((c) => c.name);
const addRoomCol = (name) => { if (!roomCols.includes(name)) db.exec(`ALTER TABLE rooms ADD COLUMN ${name} TEXT`); };
addRoomCol("dm_password");
addRoomCol("player_password");
addRoomCol("init_state");
addRoomCol("fog_state");
if (!roomCols.includes("last_active")) db.exec("ALTER TABLE rooms ADD COLUMN last_active INTEGER");
if (!roomCols.includes("map_rotation")) db.exec("ALTER TABLE rooms ADD COLUMN map_rotation INTEGER DEFAULT 0");
if (!roomCols.includes("grid_on")) db.exec("ALTER TABLE rooms ADD COLUMN grid_on INTEGER DEFAULT 0");
if (!roomCols.includes("grid_size")) db.exec("ALTER TABLE rooms ADD COLUMN grid_size INTEGER DEFAULT 64");
if (!roomCols.includes("owner_id")) db.exec("ALTER TABLE rooms ADD COLUMN owner_id TEXT");
if (!roomCols.includes("party_gold")) db.exec("ALTER TABLE rooms ADD COLUMN party_gold INTEGER DEFAULT 0");
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (userCols.length && !userCols.includes("name")) db.exec("ALTER TABLE users ADD COLUMN name TEXT");
if (userCols.length && !userCols.includes("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
if (userCols.length && !userCols.includes("gm_requested")) db.exec("ALTER TABLE users ADD COLUMN gm_requested INTEGER DEFAULT 0");
if (userCols.length && !userCols.includes("dice_skin")) db.exec("ALTER TABLE users ADD COLUMN dice_skin TEXT");
if (userCols.length && !userCols.includes("macros")) db.exec("ALTER TABLE users ADD COLUMN macros TEXT");
if (userCols.length && !userCols.includes("dice3d")) db.exec("ALTER TABLE users ADD COLUMN dice3d INTEGER DEFAULT 1");
// Billing/entitlements: plan ('gm' | 'gm_ai' | null), 30-day trial, monthly AI usage.
if (userCols.length && !userCols.includes("plan")) db.exec("ALTER TABLE users ADD COLUMN plan TEXT");
if (userCols.length && !userCols.includes("trial_start")) db.exec("ALTER TABLE users ADD COLUMN trial_start INTEGER");
if (userCols.length && !userCols.includes("ai_used")) db.exec("ALTER TABLE users ADD COLUMN ai_used INTEGER DEFAULT 0");
if (userCols.length && !userCols.includes("ai_period")) db.exec("ALTER TABLE users ADD COLUMN ai_period TEXT");
const tokenCols = db.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name);
if (!tokenCols.includes("img")) db.exec("ALTER TABLE tokens ADD COLUMN img TEXT");
if (!tokenCols.includes("hp")) db.exec("ALTER TABLE tokens ADD COLUMN hp INTEGER");
if (!tokenCols.includes("hp_max")) db.exec("ALTER TABLE tokens ADD COLUMN hp_max INTEGER");
if (!tokenCols.includes("size")) db.exec("ALTER TABLE tokens ADD COLUMN size REAL DEFAULT 1");

// --- Rooms -----------------------------------------------------------------
const _ensureRoom = db.prepare(
  "INSERT OR IGNORE INTO rooms (id, created_at) VALUES (?, ?)"
);
const _setMap = db.prepare("UPDATE rooms SET map_url = ? WHERE id = ?");
const _setRotation = db.prepare("UPDATE rooms SET map_rotation = ? WHERE id = ?");
const _setDm = db.prepare("UPDATE rooms SET dm_password = ? WHERE id = ?");
const _setPlayerPw = db.prepare("UPDATE rooms SET player_password = ? WHERE id = ?");
const _setInit = db.prepare("UPDATE rooms SET init_state = ? WHERE id = ?");
const _setFog = db.prepare("UPDATE rooms SET fog_state = ? WHERE id = ?");
const _getRoom = db.prepare("SELECT * FROM rooms WHERE id = ?");

export function ensureRoom(roomId) {
  _ensureRoom.run(roomId, Date.now());
  return _getRoom.get(roomId);
}
export function setMap(roomId, url) {
  _setMap.run(url, roomId);
}
export function setMapRotation(roomId, deg) {
  _setRotation.run(deg, roomId);
}
const _setGrid = db.prepare("UPDATE rooms SET grid_on = ?, grid_size = ? WHERE id = ?");
export function setGrid(roomId, on, size) {
  _setGrid.run(on ? 1 : 0, size, roomId);
}
export function getRoom(roomId) {
  return _getRoom.get(roomId);
}
export function setDmPassword(roomId, pw) {
  _setDm.run(pw, roomId);
}
export function setPlayerPassword(roomId, pw) {
  _setPlayerPw.run(pw, roomId);
}
export function setInitState(roomId, json) {
  _setInit.run(json, roomId);
}
export function getInitState(roomId) {
  return _getRoom.get(roomId)?.init_state || null;
}
export function setFogState(roomId, json) {
  _setFog.run(json, roomId);
}
export function getFogState(roomId) {
  return _getRoom.get(roomId)?.fog_state || null;
}

// --- Admin / room management ----------------------------------------------
const _touch = db.prepare("UPDATE rooms SET last_active = ? WHERE id = ?");
const _listRooms = db.prepare("SELECT id, owner_id, created_at, last_active FROM rooms ORDER BY last_active DESC, created_at DESC");
const _delRoom = db.prepare("DELETE FROM rooms WHERE id = ?");
const _delRoomTokens = db.prepare("DELETE FROM tokens WHERE room_id = ?");
const _delRoomChars = db.prepare("DELETE FROM characters WHERE room_id = ?");
const _delRoomCreatures = db.prepare("DELETE FROM creatures WHERE room_id = ?");
const _delRoomMaps = db.prepare("DELETE FROM maps WHERE room_id = ?");
const _countChars = db.prepare("SELECT COUNT(*) n FROM characters WHERE room_id = ?");
const _countCreatures = db.prepare("SELECT COUNT(*) n FROM creatures WHERE room_id = ?");

export function touchRoom(roomId) {
  _touch.run(Date.now(), roomId);
}
export function listRooms() {
  return _listRooms.all().map((r) => ({
    id: r.id,
    owner_id: r.owner_id || null,
    created_at: r.created_at,
    last_active: r.last_active,
    characters: _countChars.get(r.id).n,
    creatures: _countCreatures.get(r.id).n,
  }));
}
export const deleteRoom = db.transaction((roomId) => {
  _delRoomTokens.run(roomId);
  _delRoomChars.run(roomId);
  _delRoomCreatures.run(roomId);
  db.prepare("DELETE FROM room_members WHERE room_id = ?").run(roomId);
  db.prepare("DELETE FROM room_invites WHERE room_id = ?").run(roomId);
  // Saved maps are a shared library, so they are intentionally NOT deleted here.
  _delRoom.run(roomId);
});

// --- Tokens ----------------------------------------------------------------
const _getTokens = db.prepare("SELECT * FROM tokens WHERE room_id = ?");
const _upsertToken = db.prepare(`
  INSERT INTO tokens (id, room_id, label, color, img, hp, hp_max, size, x, y)
  VALUES (@id, @room_id, @label, @color, @img, @hp, @hp_max, @size, @x, @y)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label, color = excluded.color, img = excluded.img,
    hp = excluded.hp, hp_max = excluded.hp_max, size = excluded.size,
    x = excluded.x, y = excluded.y
`);
const _moveToken = db.prepare("UPDATE tokens SET x = ?, y = ? WHERE id = ?");
const _getToken = db.prepare("SELECT * FROM tokens WHERE id = ?");
const _updateToken = db.prepare("UPDATE tokens SET label=@label, color=@color, hp=@hp, hp_max=@hp_max, size=@size WHERE id=@id");
const _deleteToken = db.prepare("DELETE FROM tokens WHERE id = ?");

export function getTokens(roomId) {
  return _getTokens.all(roomId);
}
export function getToken(id) {
  return _getToken.get(id);
}
export function upsertToken(t) {
  _upsertToken.run(t);
}
export function updateTokenRow(t) {
  _updateToken.run(t);
}
export function moveToken(id, x, y) {
  _moveToken.run(x, y, id);
}
export function deleteToken(id) {
  _deleteToken.run(id);
}

// --- Characters ------------------------------------------------------------
const _getChars = db.prepare("SELECT * FROM characters WHERE room_id = ?");
const _upsertChar = db.prepare(`
  INSERT INTO characters (id, room_id, data) VALUES (@id, @room_id, @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`);
const _deleteChar = db.prepare("DELETE FROM characters WHERE id = ?");

export function getCharacters(roomId) {
  return _getChars.all(roomId).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
}
export function upsertCharacter(id, roomId, data) {
  _upsertChar.run({ id, room_id: roomId, data: JSON.stringify(data) });
}
export function deleteCharacter(id) {
  _deleteChar.run(id);
}

// --- Creatures (monsters / NPCs) ------------------------------------------
const _getCreatures = db.prepare("SELECT * FROM creatures WHERE room_id = ?");
const _upsertCreature = db.prepare(`
  INSERT INTO creatures (id, room_id, data) VALUES (@id, @room_id, @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`);
const _deleteCreature = db.prepare("DELETE FROM creatures WHERE id = ?");

export function getCreatures(roomId) {
  return _getCreatures.all(roomId).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
}
export function upsertCreature(id, roomId, data) {
  _upsertCreature.run({ id, room_id: roomId, data: JSON.stringify(data) });
}
export function deleteCreature(id) {
  _deleteCreature.run(id);
}

// --- Saved maps (shared library, visible in every room) --------------------
const _getMapsAll = db.prepare("SELECT * FROM maps ORDER BY name COLLATE NOCASE");
const _insertMap = db.prepare(
  "INSERT INTO maps (id, room_id, name, url) VALUES (?, ?, ?, ?)"
);
const _deleteMapRow = db.prepare("DELETE FROM maps WHERE id = ?");

// roomId is kept for record of origin but the library is shared system-wide.
export function getMaps() {
  return _getMapsAll.all();
}
export function saveMapEntry(id, roomId, name, url) {
  _insertMap.run(id, roomId, name, url);
}
export function deleteMapEntry(id) {
  _deleteMapRow.run(id);
}

// --- Users & sessions ------------------------------------------------------
const _createUser = db.prepare("INSERT INTO users (id, username, name, email, pass_hash, role, created_at) VALUES (@id, @username, @name, @email, @pass_hash, @role, @created_at)");
const _userByName = db.prepare("SELECT * FROM users WHERE username = ?");
const _userById = db.prepare("SELECT * FROM users WHERE id = ?");
const _countUsers = db.prepare("SELECT COUNT(*) n FROM users");
const _listUsers = db.prepare("SELECT id, username, name, email, role, gm_requested, created_at, plan, trial_start FROM users ORDER BY created_at");
const _setRole = db.prepare("UPDATE users SET role = ? WHERE id = ?");
const _setPass = db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?");
const _setGmReq = db.prepare("UPDATE users SET gm_requested = ? WHERE id = ?");
const _delUser = db.prepare("DELETE FROM users WHERE id = ?");
const _createSession = db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");
const _sessionUser = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?");
const _delSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const _delUserSessions = db.prepare("DELETE FROM sessions WHERE user_id = ?");

export function createUser(u) { _createUser.run({ name: null, email: null, ...u, created_at: Date.now() }); }
export function getUserByUsername(name) { return _userByName.get(name); }
export function getUserById(id) { return _userById.get(id); }
export function countUsers() { return _countUsers.get().n; }
export function listUsers() { return _listUsers.all(); }
export function setUserRole(id, role) { _setRole.run(role, id); }
export function setUserPassword(id, hash) { _setPass.run(hash, id); }
export function setGmRequested(id, v) { _setGmReq.run(v ? 1 : 0, id); }
const _setSkin = db.prepare("UPDATE users SET dice_skin = ? WHERE id = ?");
export function setDiceSkin(id, skin) { _setSkin.run(skin, id); }
const _setMacros = db.prepare("UPDATE users SET macros = ? WHERE id = ?");
export function setMacros(id, json) { _setMacros.run(json, id); }
const _setDice3d = db.prepare("UPDATE users SET dice3d = ? WHERE id = ?");
export function setDice3d(id, v) { _setDice3d.run(v ? 1 : 0, id); }

// --- Billing / entitlements ----------------------------------------------
const _setPlan = db.prepare("UPDATE users SET plan = ? WHERE id = ?");
const _startTrial = db.prepare("UPDATE users SET trial_start = ? WHERE id = ? AND trial_start IS NULL");
const _setAiUsage = db.prepare("UPDATE users SET ai_used = ?, ai_period = ? WHERE id = ?");
export function setPlan(id, plan) { _setPlan.run(plan || null, id); }
export function startTrial(id) { _startTrial.run(Date.now(), id); } // only sets if not already started
export function setAiUsage(id, used, period) { _setAiUsage.run(used, period, id); }

// --- Soundboard (shared library) ------------------------------------------
const _addSound = db.prepare("INSERT INTO sounds (id, name, url, kind) VALUES (?, ?, ?, ?)");
const _delSound = db.prepare("DELETE FROM sounds WHERE id = ?");
const _allSounds = db.prepare("SELECT * FROM sounds ORDER BY kind, name COLLATE NOCASE");
export function saveSound(id, name, url, kind) { _addSound.run(id, name, url, kind); }
export function deleteSound(id) { _delSound.run(id); }
export function listSounds() { return _allSounds.all(); }
export function deleteUser(id) { _delUserSessions.run(id); _delUser.run(id); }

// --- Room ownership & membership ------------------------------------------
const _setOwner = db.prepare("UPDATE rooms SET owner_id = ? WHERE id = ?");
const _addMember = db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)");
const _isMember = db.prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?");
const _delRoomMembers = db.prepare("DELETE FROM room_members WHERE room_id = ?");
const _membersOf = db.prepare("SELECT user_id FROM room_members WHERE room_id = ?");
const _userTables = db.prepare(`
  SELECT id, owner_id FROM rooms
  WHERE owner_id = @uid
     OR id IN (SELECT room_id FROM room_members WHERE user_id = @uid)
     OR id IN (SELECT room_id FROM room_invites WHERE email = @email)
  ORDER BY last_active DESC, created_at DESC
`);
const _ownedTables = db.prepare("SELECT id FROM rooms WHERE owner_id = ?");

export function setRoomOwner(roomId, uid) { _setOwner.run(uid, roomId); }
export function addMember(roomId, uid) { _addMember.run(roomId, uid, Date.now()); }
export function isMember(roomId, uid) { return !!_isMember.get(roomId, uid); }
export function membersOf(roomId) { return _membersOf.all(roomId).map((r) => r.user_id); }
export function getUserTables(uid, email) {
  return _userTables.all({ uid, email: (email || "").toLowerCase() }).map((r) => ({ id: r.id, role: r.owner_id === uid ? "gm" : "player" }));
}
export function ownedTableIds(uid) { return _ownedTables.all(uid).map((r) => r.id); }

// Per-table allowed player emails (an alternative to the invite password).
const _addInvite = db.prepare("INSERT OR IGNORE INTO room_invites (room_id, email) VALUES (?, ?)");
const _delInvite = db.prepare("DELETE FROM room_invites WHERE room_id = ? AND email = ?");
const _listInvites = db.prepare("SELECT email FROM room_invites WHERE room_id = ?");
const _isAllowed = db.prepare("SELECT 1 FROM room_invites WHERE room_id = ? AND email = ?");
export function addAllowedEmail(roomId, email) { _addInvite.run(roomId, String(email).toLowerCase()); }
export function removeAllowedEmail(roomId, email) { _delInvite.run(roomId, String(email).toLowerCase()); }
export function listAllowedEmails(roomId) { return _listInvites.all(roomId).map((r) => r.email); }
export function isEmailAllowed(roomId, email) { return email ? !!_isAllowed.get(roomId, String(email).toLowerCase()) : false; }
export function createSession(token, userId) { _createSession.run(token, userId, Date.now()); }
export function getSessionUser(token) { return token ? _sessionUser.get(token) : null; }
export function deleteSession(token) { _delSession.run(token); }

// --- Journal / session notes ----------------------------------------------
const _upsertJournal = db.prepare(`
  INSERT INTO journal (id, room_id, title, body, shared, updated_at)
  VALUES (@id, @room_id, @title, @body, @shared, @updated_at)
  ON CONFLICT(id) DO UPDATE SET title=@title, body=@body, shared=@shared, updated_at=@updated_at
`);
const _delJournal = db.prepare("DELETE FROM journal WHERE id = ?");
const _listJournal = db.prepare("SELECT * FROM journal WHERE room_id = ? ORDER BY updated_at DESC");
export function upsertJournal(e) {
  _upsertJournal.run({ id: e.id, room_id: e.roomId, title: e.title || "", body: e.body || "", shared: e.shared ? 1 : 0, updated_at: Date.now() });
}
export function deleteJournal(id) { _delJournal.run(id); }
export function listJournal(roomId) {
  return _listJournal.all(roomId).map((r) => ({ id: r.id, title: r.title, body: r.body, shared: !!r.shared, updatedAt: r.updated_at }));
}

// --- Party loot ------------------------------------------------------------
const _upsertLoot = db.prepare(`
  INSERT INTO loot (id, room_id, name, qty, value, holder, notes)
  VALUES (@id, @room_id, @name, @qty, @value, @holder, @notes)
  ON CONFLICT(id) DO UPDATE SET name=@name, qty=@qty, value=@value, holder=@holder, notes=@notes
`);
const _delLoot = db.prepare("DELETE FROM loot WHERE id = ?");
const _listLoot = db.prepare("SELECT * FROM loot WHERE room_id = ? ORDER BY name COLLATE NOCASE");
const _setGold = db.prepare("UPDATE rooms SET party_gold = ? WHERE id = ?");
const _getGold = db.prepare("SELECT party_gold FROM rooms WHERE id = ?");
export function upsertLoot(it) {
  _upsertLoot.run({ id: it.id, room_id: it.roomId, name: it.name || "", qty: it.qty || 1, value: it.value || 0, holder: it.holder || "", notes: it.notes || "" });
}
export function deleteLoot(id) { _delLoot.run(id); }
export function listLoot(roomId) {
  return _listLoot.all(roomId).map((r) => ({ id: r.id, name: r.name, qty: r.qty, value: r.value, holder: r.holder, notes: r.notes }));
}
export function setPartyGold(roomId, n) { _setGold.run(Math.max(0, Math.round(n) || 0), roomId); }
export function getPartyGold(roomId) { const r = _getGold.get(roomId); return r ? (r.party_gold || 0) : 0; }

export default db;
