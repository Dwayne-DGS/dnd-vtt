// D&D VTT server: Express serves the static client; Socket.IO handles all
// realtime state (map, tokens, dice, chat, character sheets) per room.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { createWriteStream, mkdirSync } from "fs";
import { rollDice } from "./dice.js";
import * as store from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Image upload (maps & token portraits). Streams the raw request body to a file
// under public/uploads and returns its public URL. Image types only, size-capped.
// Note: setting a map / placing a token is still DM-gated over the socket, so an
// uploaded image is inert until a DM actually uses it.
const UPLOAD_DIR = join(__dirname, "public", "uploads");
const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB
app.post("/upload", (req, res) => {
  const type = (req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("image/")) {
    return res.status(400).json({ error: "Images only" });
  }
  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const fname = `${randomUUID()}.${ext}`;
  const out = createWriteStream(join(UPLOAD_DIR, fname));
  let size = 0, aborted = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD && !aborted) {
      aborted = true;
      out.destroy();
      req.destroy();
      res.status(413).json({ error: "File too large (max 10 MB)" });
    }
  });
  req.pipe(out);
  out.on("finish", () => { if (!aborted) res.json({ url: `/uploads/${fname}` }); });
  out.on("error", () => { if (!aborted) res.status(500).json({ error: "Write failed" }); });
});

// Track display names and DM status in memory (cleared on restart).
const names = new Map(); // socket.id -> name
const dmFlags = new Map(); // socket.id -> boolean (is this socket the DM?)

// Initiative is live combat state — kept in memory per room and broadcast.
const initiatives = new Map(); // roomId -> { round, turn, started, entries:[] }
function getInit(roomId) {
  if (!initiatives.has(roomId))
    initiatives.set(roomId, { round: 1, turn: 0, started: false, entries: [] });
  return initiatives.get(roomId);
}
// Who is currently in the voice call, per room.
const voiceRooms = new Map(); // roomId -> Set<socketId>

// Fog of war per room. revealed = Set of "col,row" cell keys in a normalized
// grid over the map. enabled=false means the whole map is visible.
const fogRooms = new Map(); // roomId -> { enabled, revealed:Set }
function getFog(roomId) {
  if (!fogRooms.has(roomId)) fogRooms.set(roomId, { enabled: false, revealed: new Set() });
  return fogRooms.get(roomId);
}
function fogPayload(roomId) {
  const f = getFog(roomId);
  return { enabled: f.enabled, revealed: [...f.revealed] };
}

function sortInit(state) {
  // Highest initiative first. Before combat starts (no "Next turn" pressed yet),
  // the top of the order is "up first". Once combat is underway, keep the
  // highlight on whoever's turn it is even if a late arrival reshuffles the list.
  const currentId = state.entries[state.turn]?.id;
  state.entries.sort((a, b) => (b.init || 0) - (a.init || 0));
  if (!state.started) {
    state.turn = 0;
  } else {
    const idx = state.entries.findIndex((e) => e.id === currentId);
    state.turn = idx >= 0 ? idx : 0;
  }
}

io.on("connection", (socket) => {
  let roomId = null;
  const amDM = () => dmFlags.get(socket.id) === true;

  socket.on("join", ({ room, name, dmPassword }) => {
    roomId = (room || "lobby").trim().toLowerCase();
    const pname = (name || "Player").trim();
    names.set(socket.id, pname);
    socket.join(roomId);
    const roomRow = store.ensureRoom(roomId);

    // Determine role. A blank password = player. The first person to supply a
    // password claims the room as DM and sets it; later DMs must match it.
    let isDM = false, dmDenied = false;
    const pw = (dmPassword || "").trim();
    if (pw) {
      if (!roomRow.dm_password) { store.setDmPassword(roomId, pw); isDM = true; }
      else if (roomRow.dm_password === pw) { isDM = true; }
      else { dmDenied = true; }
    }
    dmFlags.set(socket.id, isDM);
    socket.emit("role", { isDM, name: pname, dmDenied });

    // Send the current room state to the new joiner.
    socket.emit("state", {
      room: roomId,
      mapUrl: store.ensureRoom(roomId).map_url,
      tokens: store.getTokens(roomId),
      characters: store.getCharacters(roomId),
      creatures: store.getCreatures(roomId),
      maps: store.getMaps(roomId),
      initiative: getInit(roomId),
      fog: fogPayload(roomId),
    });
    io.to(roomId).emit("chat", sys(`${pname} joined${isDM ? " (DM)" : ""}`));
  });

  // --- Map (DM only) -------------------------------------------------------
  socket.on("setMap", (url) => {
    if (!roomId || !amDM()) return;
    store.setMap(roomId, url);
    io.to(roomId).emit("mapUrl", url);
    // A new map starts fully hidden again if fog was on.
    const f = getFog(roomId);
    f.revealed.clear();
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });

  // --- Fog of war (DM only) ------------------------------------------------
  socket.on("fogSet", (enabled) => {
    if (!roomId || !amDM()) return;
    getFog(roomId).enabled = !!enabled;
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReveal", (cells) => {
    if (!roomId || !amDM() || !Array.isArray(cells)) return;
    const f = getFog(roomId);
    cells.forEach((c) => f.revealed.add(c));
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReset", () => {
    if (!roomId || !amDM()) return;
    getFog(roomId).revealed.clear();
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });

  // --- Tokens --------------------------------------------------------------
  socket.on("addToken", ({ label, color, img }) => {
    if (!roomId || !amDM()) return; // only the DM places tokens
    const token = {
      id: randomUUID(),
      room_id: roomId,
      label: label || "?",
      color: color || "#c0392b",
      img: img || null,
      x: 60,
      y: 60,
    };
    store.upsertToken(token);
    io.to(roomId).emit("tokenAdded", token);
  });

  socket.on("moveToken", ({ id, x, y }) => {
    if (!roomId) return;
    store.moveToken(id, x, y);
    // Broadcast to everyone else (the mover already sees it locally).
    socket.to(roomId).emit("tokenMoved", { id, x, y });
  });

  socket.on("deleteToken", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteToken(id);
    io.to(roomId).emit("tokenDeleted", id);
  });

  // --- Dice + chat ---------------------------------------------------------
  socket.on("roll", (notation) => {
    if (!roomId) return;
    const result = rollDice(notation);
    const who = names.get(socket.id) || "Player";
    if (result.error) {
      socket.emit("chat", sys(`Roll error: ${result.error}`));
      return;
    }
    io.to(roomId).emit("chat", {
      type: "roll",
      who,
      text: `rolled ${result.notation} = ${result.total}`,
      detail: result.breakdown,
      ts: Date.now(),
    });
  });

  socket.on("chat", (text) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("chat", {
      type: "msg",
      who: names.get(socket.id) || "Player",
      text: String(text).slice(0, 1000),
      ts: Date.now(),
    });
  });

  // --- Character sheets ----------------------------------------------------
  // Players may edit only their own sheets; the DM may edit anyone's. Sheets
  // created before roles existed have no owner and stay editable by all.
  function mayEditChar(id) {
    if (amDM() || !id) return true;
    const existing = store.getCharacters(roomId).find((c) => c.id === id);
    if (!existing || !existing.owner) return true;
    return existing.owner === names.get(socket.id);
  }
  socket.on("saveCharacter", ({ id, data }) => {
    if (!roomId || !mayEditChar(id)) return;
    const charId = id || randomUUID();
    if (!data.owner) data.owner = names.get(socket.id); // stamp creator
    store.upsertCharacter(charId, roomId, data);
    io.to(roomId).emit("characterSaved", { id: charId, ...data });
  });

  socket.on("deleteCharacter", (id) => {
    if (!roomId || !mayEditChar(id)) return;
    store.deleteCharacter(id);
    io.to(roomId).emit("characterDeleted", id);
  });

  // --- Creatures (monsters / NPCs) — DM only -------------------------------
  socket.on("saveCreature", ({ id, data }) => {
    if (!roomId || !amDM()) return;
    const cid = id || randomUUID();
    store.upsertCreature(cid, roomId, data);
    io.to(roomId).emit("creatureSaved", { id: cid, ...data });
  });
  socket.on("deleteCreature", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteCreature(id);
    io.to(roomId).emit("creatureDeleted", id);
  });

  // --- Saved maps — DM only ------------------------------------------------
  socket.on("saveMap", ({ name, url }) => {
    if (!roomId || !amDM() || !url) return;
    const id = randomUUID();
    store.saveMapEntry(id, roomId, name || "Map", url);
    io.to(roomId).emit("mapSaved", { id, name: name || "Map", url });
  });
  socket.on("deleteMap", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteMapEntry(id);
    io.to(roomId).emit("mapDeleted", id);
  });

  // --- Initiative tracker --------------------------------------------------
  function pushInit() {
    io.to(roomId).emit("initState", getInit(roomId));
  }
  socket.on("initAdd", ({ name, init, hp, ac }) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    state.entries.push({
      id: randomUUID(),
      name: name || "Combatant",
      init: Number(init) || 0,
      hp: hp ?? "",
      ac: ac ?? "",
    });
    sortInit(state);
    pushInit();
  });
  socket.on("initUpdate", ({ id, field, value }) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    e[field] = field === "init" ? Number(value) || 0 : value;
    if (field === "init") sortInit(state);
    pushInit();
  });
  socket.on("initRemove", (id) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    state.entries = state.entries.filter((e) => e.id !== id);
    if (state.turn >= state.entries.length) state.turn = 0;
    pushInit();
  });
  socket.on("initNext", () => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    if (!state.entries.length) return;
    state.started = true; // lock in the order so late arrivals don't move the highlight
    state.turn += 1;
    if (state.turn >= state.entries.length) { state.turn = 0; state.round += 1; }
    pushInit();
  });
  socket.on("initClear", () => {
    if (!roomId || !amDM()) return;
    initiatives.set(roomId, { round: 1, turn: 0, started: false, entries: [] });
    pushInit();
  });

  // --- Voice / video signaling (WebRTC mesh) -------------------------------
  // The server only relays signaling messages; audio/video flow peer-to-peer.
  // The newest peer to join initiates offers to everyone already in the call,
  // which avoids "glare" (both sides offering at once).
  socket.on("voiceJoin", () => {
    if (!roomId) return;
    const set = voiceRooms.get(roomId) || new Set();
    const existing = [...set];
    set.add(socket.id);
    voiceRooms.set(roomId, set);
    socket.emit("voicePeers", existing); // tell newcomer who to call
  });
  socket.on("voiceSignal", ({ to, signal }) => {
    io.to(to).emit("voiceSignal", { from: socket.id, signal });
  });
  socket.on("voiceLeave", () => leaveVoice());

  function leaveVoice() {
    if (!roomId) return;
    const set = voiceRooms.get(roomId);
    if (set && set.delete(socket.id)) {
      socket.to(roomId).emit("voicePeerLeft", socket.id);
    }
  }

  socket.on("disconnect", () => {
    leaveVoice();
    if (roomId && names.has(socket.id)) {
      io.to(roomId).emit("chat", sys(`${names.get(socket.id)} left`));
    }
    names.delete(socket.id);
    dmFlags.delete(socket.id);
  });
});

function sys(text) {
  return { type: "system", text, ts: Date.now() };
}

httpServer.listen(PORT, () => {
  console.log(`D&D VTT running on http://localhost:${PORT}`);
});
