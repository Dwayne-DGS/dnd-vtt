// SQLite persistence layer.
// One file (vtt.db) holds everything: rooms, tokens, characters.
// Swap to Postgres later by replacing this module — the rest of the app
// only calls the exported functions below.

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "vtt.db"));
db.pragma("journal_mode = WAL");

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
const tokenCols = db.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name);
if (!tokenCols.includes("img")) {
  db.exec("ALTER TABLE tokens ADD COLUMN img TEXT");
}

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
const _listRooms = db.prepare("SELECT id, created_at, last_active FROM rooms ORDER BY last_active DESC, created_at DESC");
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
  // Saved maps are a shared library, so they are intentionally NOT deleted here.
  _delRoom.run(roomId);
});

// --- Tokens ----------------------------------------------------------------
const _getTokens = db.prepare("SELECT * FROM tokens WHERE room_id = ?");
const _upsertToken = db.prepare(`
  INSERT INTO tokens (id, room_id, label, color, img, x, y)
  VALUES (@id, @room_id, @label, @color, @img, @x, @y)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label, color = excluded.color, img = excluded.img,
    x = excluded.x, y = excluded.y
`);
const _moveToken = db.prepare("UPDATE tokens SET x = ?, y = ? WHERE id = ?");
const _deleteToken = db.prepare("DELETE FROM tokens WHERE id = ?");

export function getTokens(roomId) {
  return _getTokens.all(roomId);
}
export function upsertToken(t) {
  _upsertToken.run(t);
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

export default db;
