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
if (!roomCols.includes("dm_password")) {
  db.exec("ALTER TABLE rooms ADD COLUMN dm_password TEXT");
}
const tokenCols = db.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name);
if (!tokenCols.includes("img")) {
  db.exec("ALTER TABLE tokens ADD COLUMN img TEXT");
}

// --- Rooms -----------------------------------------------------------------
const _ensureRoom = db.prepare(
  "INSERT OR IGNORE INTO rooms (id, created_at) VALUES (?, ?)"
);
const _setMap = db.prepare("UPDATE rooms SET map_url = ? WHERE id = ?");
const _setDm = db.prepare("UPDATE rooms SET dm_password = ? WHERE id = ?");
const _getRoom = db.prepare("SELECT * FROM rooms WHERE id = ?");

export function ensureRoom(roomId) {
  _ensureRoom.run(roomId, Date.now());
  return _getRoom.get(roomId);
}
export function setMap(roomId, url) {
  _setMap.run(url, roomId);
}
export function setDmPassword(roomId, pw) {
  _setDm.run(pw, roomId);
}

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

// --- Saved maps ------------------------------------------------------------
const _getMaps = db.prepare("SELECT * FROM maps WHERE room_id = ?");
const _insertMap = db.prepare(
  "INSERT INTO maps (id, room_id, name, url) VALUES (?, ?, ?, ?)"
);
const _deleteMapRow = db.prepare("DELETE FROM maps WHERE id = ?");

export function getMaps(roomId) {
  return _getMaps.all(roomId);
}
export function saveMapEntry(id, roomId, name, url) {
  _insertMap.run(id, roomId, name, url);
}
export function deleteMapEntry(id) {
  _deleteMapRow.run(id);
}

export default db;
