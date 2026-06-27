// D&D VTT server: Express serves the static client; Socket.IO handles all
// realtime state (map, tokens, dice, chat, character sheets) per room.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID, randomBytes } from "crypto";
import { createWriteStream, mkdirSync, readFileSync, existsSync } from "fs";
import bcrypt from "bcryptjs";
import { rollDice } from "./dice.js";
import * as store from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Owner/admin password for room management. Read from an `admin.key` file in the
// app directory (kept out of git). If the file is absent, admin features are off.
const ADMIN_KEY_FILE = join(__dirname, "admin.key");
function adminPassword() {
  try {
    if (!existsSync(ADMIN_KEY_FILE)) return null;
    const pw = readFileSync(ADMIN_KEY_FILE, "utf8").trim();
    return pw || null;
  } catch { return null; }
}

app.use(express.json()); // parses application/json bodies (not the image uploads)
app.use(express.static(join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- Accounts (username/password, in-house) -------------------------------
function parseCookies(str) {
  const out = {};
  (str || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `vtt_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}
function userFromReq(req) { return store.getSessionUser(parseCookies(req.headers.cookie)["vtt_session"]); }
const pubUser = (u) => (u ? { username: u.username, role: u.role, name: u.name || null, gmRequested: !!u.gm_requested } : null);

app.post("/auth/signup", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 letters, numbers, or underscores." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (!name) return res.status(400).json({ error: "Please enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email." });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: "That username is taken." });
  // Everyone signs up as a player; an admin promotes to GM. First account = admin.
  const finalRole = store.countUsers() === 0 ? "admin" : "player";
  const id = randomUUID();
  store.createUser({ id, username, name, email, pass_hash: bcrypt.hashSync(password, 10), role: finalRole });
  const token = randomBytes(32).toString("hex");
  store.createSession(token, id);
  setSessionCookie(res, token);
  res.json({ user: { username, role: finalRole, name } });
});

app.post("/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const u = store.getUserByUsername(username);
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.pass_hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const token = randomBytes(32).toString("hex");
  store.createSession(token, u.id);
  setSessionCookie(res, token);
  res.json({ user: pubUser(u) });
});

app.post("/auth/logout", (req, res) => {
  const t = parseCookies(req.headers.cookie)["vtt_session"];
  if (t) store.deleteSession(t);
  res.setHeader("Set-Cookie", "vtt_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/auth/me", (req, res) => res.json({ user: pubUser(userFromReq(req)) }));

// Image upload (maps & token portraits). Streams the raw request body to a file
// under public/uploads and returns its public URL. Image types only, size-capped.
// Note: setting a map / placing a token is still DM-gated over the socket, so an
// uploaded image is inert until a DM actually uses it.
const UPLOAD_DIR = join(__dirname, "public", "uploads");
const MAX_UPLOAD = 30 * 1024 * 1024; // 30 MB
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
      res.status(413).json({ error: "File too large (max 30 MB)" });
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
  if (!initiatives.has(roomId)) {
    const raw = store.getInitState(roomId);
    initiatives.set(roomId, raw ? JSON.parse(raw) : { round: 1, turn: 0, started: false, entries: [] });
  }
  return initiatives.get(roomId);
}
function persistInit(roomId) {
  store.setInitState(roomId, JSON.stringify(getInit(roomId)));
}
// Who is currently in the voice call, per room.
const voiceRooms = new Map(); // roomId -> Set<socketId>

// Fog of war per room. revealed = Set of "col,row" cell keys in a normalized
// grid over the map. enabled=false means the whole map is visible.
const fogRooms = new Map(); // roomId -> { enabled, revealed:Set }
function getFog(roomId) {
  if (!fogRooms.has(roomId)) {
    const raw = store.getFogState(roomId);
    if (raw) {
      const o = JSON.parse(raw);
      fogRooms.set(roomId, { enabled: !!o.enabled, revealed: new Set(o.revealed || []) });
    } else {
      fogRooms.set(roomId, { enabled: false, revealed: new Set() });
    }
  }
  return fogRooms.get(roomId);
}
function fogPayload(roomId) {
  const f = getFog(roomId);
  return { enabled: f.enabled, revealed: [...f.revealed] };
}
function persistFog(roomId) {
  store.setFogState(roomId, JSON.stringify(fogPayload(roomId)));
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
  // Identify the logged-in account from the session cookie sent with the handshake.
  socket.user = store.getSessionUser(parseCookies(socket.handshake.headers.cookie)["vtt_session"]);

  function sendState() {
    socket.emit("state", {
      room: roomId,
      mapUrl: store.getRoom(roomId)?.map_url,
      mapRotation: store.getRoom(roomId)?.map_rotation || 0,
      gridOn: !!store.getRoom(roomId)?.grid_on,
      gridSize: store.getRoom(roomId)?.grid_size || 64,
      tokens: store.getTokens(roomId),
      characters: store.getCharacters(roomId),
      creatures: store.getCreatures(roomId),
      maps: store.getMaps(roomId),
      initiative: getInit(roomId),
      fog: fogPayload(roomId),
    });
  }

  function enterRoom(isDM) {
    const pname = socket.user.username;
    names.set(socket.id, pname);
    dmFlags.set(socket.id, isDM);
    socket.join(roomId);
    store.touchRoom(roomId);
    store.addMember(roomId, socket.user.id);
    socket.emit("role", { isDM, name: pname, room: roomId });
    sendState();
    io.to(roomId).emit("chat", sys(`${pname} joined${isDM ? " (DM)" : ""}`));
  }

  // A GM/admin creates a table — they become its owner and DM. Optional invite
  // password lets players join the first time.
  socket.on("createRoom", ({ room, playerPassword }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    if (!["gm", "admin"].includes(socket.user.role)) {
      return socket.emit("joinError", "Only Game Master accounts can create tables.");
    }
    roomId = (room || "").trim().toLowerCase();
    if (!roomId) return socket.emit("joinError", "Please enter a table name.");
    const existing = store.getRoom(roomId);
    if (existing && existing.owner_id && existing.owner_id !== socket.user.id) {
      return socket.emit("joinError", "That table name is already taken.");
    }
    store.ensureRoom(roomId);
    store.setRoomOwner(roomId, socket.user.id);
    store.setPlayerPassword(roomId, (playerPassword || "").trim() || null);
    enterRoom(true);
  });

  // Enter a table you already belong to (no password) — used by "Your tables".
  socket.on("enterTable", ({ room }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    roomId = (room || "").trim().toLowerCase();
    const r = store.getRoom(roomId);
    if (!r) return socket.emit("joinError", "That table no longer exists.");
    const owner = r.owner_id === socket.user.id;
    const allowed = owner || socket.user.role === "admin" ||
      store.isMember(roomId, socket.user.id) || store.isEmailAllowed(roomId, socket.user.email);
    if (!allowed) return socket.emit("joinError", "You're not on this table yet — ask your GM to add your email, or use the invite password.");
    enterRoom(owner);
  });

  // First-time join to someone else's table: by email allow-list OR invite password.
  socket.on("join", ({ room, password }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    roomId = (room || "").trim().toLowerCase();
    if (!roomId) return socket.emit("joinError", "Please enter a table name.");
    const r = store.getRoom(roomId);
    if (!r) return socket.emit("joinError", "No table with that name. Ask your GM for it.");
    if (r.owner_id === socket.user.id) return enterRoom(true);
    if (store.isEmailAllowed(roomId, socket.user.email)) return enterRoom(false); // on the allow-list
    const ppw = r.player_password || "";
    if (ppw) {
      if ((password || "").trim() === ppw) return enterRoom(false);
      return socket.emit("joinError", "Wrong invite password for this table.");
    }
    // No password set: open table only if it has no allow-list.
    if (store.listAllowedEmails(roomId).length === 0) return enterRoom(false);
    return socket.emit("joinError", "You're not on this table's player list. Ask your GM to add your email.");
  });

  // The tables this account owns, has joined, or is invited to (dashboard list).
  socket.on("myTables", () => {
    if (!socket.user) return;
    socket.emit("myTablesList", store.getUserTables(socket.user.id, socket.user.email));
  });

  // A player requests GM access (admins approve in their panel; email later).
  socket.on("requestGm", () => {
    if (!socket.user) return;
    store.setGmRequested(socket.user.id, 1);
    socket.emit("gmRequested");
  });

  // The owner (or admin) manages a table's allowed player emails while in it.
  function ownsRoom() {
    const r = store.getRoom(roomId);
    return r && socket.user && (r.owner_id === socket.user.id || socket.user.role === "admin");
  }
  socket.on("listAllowed", () => { if (roomId && ownsRoom()) socket.emit("allowedEmails", store.listAllowedEmails(roomId)); });
  socket.on("addAllowed", (email) => {
    if (!roomId || !ownsRoom() || !/^\S+@\S+\.\S+$/.test(String(email || ""))) return;
    store.addAllowedEmail(roomId, email);
    socket.emit("allowedEmails", store.listAllowedEmails(roomId));
  });
  socket.on("removeAllowed", (email) => {
    if (!roomId || !ownsRoom()) return;
    store.removeAllowedEmail(roomId, email);
    socket.emit("allowedEmails", store.listAllowedEmails(roomId));
  });

  // --- Spell lighting effects ----------------------------------------------
  // The DM fires an effect; it's broadcast to the room. Browsers flash the
  // screen, and any connected Hue helper drives the lights. The helper joins a
  // room purely to listen (no password needed — it can only receive).
  socket.on("hueSubscribe", (room) => {
    const r = (room || "").trim().toLowerCase();
    if (r) socket.join(r);
  });
  socket.on("castEffect", (effect) => {
    if (!roomId || !amDM() || !effect) return;
    io.to(roomId).emit("spellEffect", String(effect));
  });

  // --- AI assistant --------------------------------------------------------
  // Players can create their own characters and ask rules questions; the DM can
  // also generate creatures and story/encounter ideas. Rate-limited per socket.
  let aiLast = 0;
  socket.on("aiRequest", async ({ mode, prompt }) => {
    if (!roomId) return;
    if (!claudeKey()) return socket.emit("aiError", "The AI isn't set up on this server yet.");
    const text = String(prompt || "").trim();
    if (!text) return socket.emit("aiError", "Type a description or question first.");
    if ((mode === "creature" || mode === "story") && !amDM()) {
      return socket.emit("aiError", "Only the DM can use that.");
    }
    const now = Date.now();
    if (now - aiLast < 3000) return socket.emit("aiError", "Please wait a few seconds between AI requests.");
    aiLast = now;
    socket.emit("aiBusy", mode);
    try {
      if (mode === "character") {
        const data = mapCharacter(await callClaude({ system: AI_SYS.character, prompt: text, tool: CHARACTER_TOOL }), names.get(socket.id));
        const id = randomUUID();
        store.upsertCharacter(id, roomId, data);
        io.to(roomId).emit("characterSaved", { id, ...data });
        socket.emit("aiDone", { mode, message: `Created “${data.name}”. Open the PCs tab to see it.` });
      } else if (mode === "creature") {
        const data = mapCreature(await callClaude({ system: AI_SYS.creature, prompt: text, tool: CREATURE_TOOL }));
        const id = randomUUID();
        store.upsertCreature(id, roomId, data);
        io.to(roomId).emit("creatureSaved", { id, ...data });
        socket.emit("aiDone", { mode, message: `Added “${data.name}” to the Bestiary.` });
      } else if (mode === "rules" || mode === "story") {
        const answer = await callClaude({ system: AI_SYS[mode], prompt: text });
        socket.emit("aiAnswer", { mode, text: answer });
      } else {
        socket.emit("aiError", "Unknown AI action.");
      }
    } catch (e) {
      console.error("AI error:", e.message);
      socket.emit("aiError", e.message || "AI request failed.");
    }
  });

  // --- Account management (system admin role) ------------------------------
  const isAdmin = () => socket.user && socket.user.role === "admin";
  const adminCount = () => store.listUsers().filter((u) => u.role === "admin").length;
  const userListPayload = () => store.listUsers().map((u) => ({
    id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
    gm_requested: u.gm_requested, created_at: u.created_at,
    tables: store.getUserTables(u.id, u.email),
  }));
  socket.on("adminUsers", () => {
    if (!isAdmin()) return socket.emit("adminError", "Admins only.");
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminSetRole", ({ id, role }) => {
    if (!isAdmin() || !["player", "gm", "admin"].includes(role)) return;
    const target = store.getUserById(id);
    if (!target) return;
    if (target.role === "admin" && role !== "admin" && adminCount() <= 1)
      return socket.emit("adminError", "Can't remove the last admin.");
    store.setUserRole(id, role);
    store.setGmRequested(id, 0); // any pending GM request is now resolved
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminDenyGm", (id) => {
    if (!isAdmin()) return;
    store.setGmRequested(id, 0);
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminResetPassword", ({ id, newPassword }) => {
    if (!isAdmin()) return;
    if (!newPassword || String(newPassword).length < 6) return socket.emit("adminError", "New password must be at least 6 characters.");
    if (!store.getUserById(id)) return;
    store.setUserPassword(id, bcrypt.hashSync(String(newPassword), 10));
    socket.emit("adminNotice", "Password reset ✓");
  });
  socket.on("adminDeleteUser", (id) => {
    if (!isAdmin()) return;
    if (id === socket.user.id) return socket.emit("adminError", "You can't delete your own account here.");
    const target = store.getUserById(id);
    if (!target) return;
    if (target.role === "admin" && adminCount() <= 1)
      return socket.emit("adminError", "Can't delete the last admin.");
    store.deleteUser(id);
    socket.emit("adminUserList", userListPayload());
  });

  // --- Owner room management (admin.key password) --------------------------
  function checkAdmin(pw) {
    const real = adminPassword();
    return real && pw === real;
  }
  socket.on("adminList", (password) => {
    if (!adminPassword()) return socket.emit("adminError", "Admin isn't set up on this server yet.");
    if (!checkAdmin(password)) return socket.emit("adminError", "Wrong admin password.");
    socket.emit("adminRooms", store.listRooms());
  });
  socket.on("adminDelete", ({ password, room }) => {
    if (!checkAdmin(password)) return socket.emit("adminError", "Wrong admin password.");
    store.deleteRoom(room);
    // Drop any in-memory state for the deleted room and notify anyone still in it.
    initiatives.delete(room);
    fogRooms.delete(room);
    voiceRooms.delete(room);
    io.to(room).emit("chat", sys("This room was deleted by the owner."));
    socket.emit("adminRooms", store.listRooms());
  });

  // --- Map (DM only) -------------------------------------------------------
  socket.on("setMap", (url) => {
    if (!roomId || !amDM()) return;
    store.setMap(roomId, url);
    store.setMapRotation(roomId, 0); // new map starts unrotated
    io.to(roomId).emit("mapUrl", url);
    io.to(roomId).emit("mapRotation", 0);
    // A new map starts fully hidden again if fog was on.
    const f = getFog(roomId);
    f.revealed.clear();
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("setMapRotation", (deg) => {
    if (!roomId || !amDM()) return;
    const d = ((Number(deg) % 360) + 360) % 360; // normalize to 0/90/180/270
    store.setMapRotation(roomId, d);
    io.to(roomId).emit("mapRotation", d);
  });
  socket.on("setGrid", ({ on, size }) => {
    if (!roomId || !amDM()) return;
    const s = Math.max(16, Math.min(256, Number(size) || 64));
    store.setGrid(roomId, on, s);
    io.to(roomId).emit("gridState", { on: !!on, size: s });
  });

  // --- Fog of war (DM only) ------------------------------------------------
  socket.on("fogSet", (enabled) => {
    if (!roomId || !amDM()) return;
    getFog(roomId).enabled = !!enabled;
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReveal", (cells) => {
    if (!roomId || !amDM() || !Array.isArray(cells)) return;
    const f = getFog(roomId);
    cells.forEach((c) => f.revealed.add(c));
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReset", () => {
    if (!roomId || !amDM()) return;
    getFog(roomId).revealed.clear();
    persistFog(roomId);
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
      hp: null, hp_max: null, size: 1,
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

  socket.on("updateToken", ({ id, label, color, hp, hpMax, size }) => {
    if (!roomId || !amDM()) return;
    const cur = store.getToken(id);
    if (!cur) return;
    const row = {
      id,
      label: label ?? cur.label,
      color: color ?? cur.color,
      hp: hp === undefined ? cur.hp : hp,
      hp_max: hpMax === undefined ? cur.hp_max : hpMax,
      size: size ?? cur.size ?? 1,
    };
    store.updateTokenRow(row);
    io.to(roomId).emit("tokenUpdated", { id, label: row.label, color: row.color, hp: row.hp, hp_max: row.hp_max, size: row.size });
  });

  socket.on("deleteToken", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteToken(id);
    io.to(roomId).emit("tokenDeleted", id);
  });

  // Pings — anyone can drop a "look here" marker; coordinates are normalized to
  // the map so they land on the same spot for everyone regardless of zoom/screen.
  socket.on("ping", ({ nx, ny }) => {
    if (!roomId || typeof nx !== "number" || typeof ny !== "number") return;
    io.to(roomId).emit("ping", { nx, ny });
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

  // --- Saved maps — shared library, DM only --------------------------------
  // Broadcast library changes to ALL clients (every room) so the shared library
  // stays consistent everywhere.
  socket.on("saveMap", ({ name, url }) => {
    if (!roomId || !amDM() || !url) return;
    const id = randomUUID();
    store.saveMapEntry(id, roomId, name || "Map", url);
    io.emit("mapSaved", { id, name: name || "Map", url });
  });
  socket.on("deleteMap", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteMapEntry(id);
    io.emit("mapDeleted", id);
  });

  // --- Initiative tracker --------------------------------------------------
  function pushInit() {
    persistInit(roomId);
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

// ===========================================================================
//  AI assistant (Anthropic Claude). The API key lives in a `claude.key` file in
//  the app dir (kept out of git). If absent, AI features are simply disabled.
// ===========================================================================
const CLAUDE_KEY_FILE = join(__dirname, "claude.key");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
function claudeKey() {
  try { return existsSync(CLAUDE_KEY_FILE) ? readFileSync(CLAUDE_KEY_FILE, "utf8").trim() : null; }
  catch { return null; }
}

const ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const SKILL_NAMES = [
  "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History",
  "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception",
  "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival",
];
const abilityProps = {
  type: "object",
  properties: Object.fromEntries(ABILS.map((a) => [a, { type: "integer" }])),
  required: ABILS,
};

const CHARACTER_TOOL = {
  name: "save_character",
  description: "Save a complete, rules-legal D&D 5e (SRD) player character.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      class: { type: "string", description: "e.g. Barbarian, Wizard" },
      level: { type: "integer" },
      armor_class: { type: "integer" },
      hit_points: { type: "integer", description: "maximum HP for the class/level" },
      proficiency_bonus: { type: "integer" },
      abilities: abilityProps,
      saving_throw_proficiencies: { type: "array", items: { type: "string", enum: ABILS } },
      skill_proficiencies: { type: "array", items: { type: "string", enum: SKILL_NAMES } },
      spell_slots: {
        type: "array",
        items: { type: "object", properties: { level: { type: "integer" }, total: { type: "integer" } }, required: ["level", "total"] },
      },
      inventory_and_notes: { type: "string", description: "equipment, key features, and a one-line background" },
    },
    required: ["name", "class", "level", "armor_class", "hit_points", "proficiency_bonus", "abilities"],
  },
};
const CREATURE_TOOL = {
  name: "save_creature",
  description: "Save a D&D 5e (SRD) monster or NPC stat block.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["Monster", "NPC"] },
      type: { type: "string", description: "e.g. Medium humanoid, Large dragon" },
      armor_class: { type: "integer" },
      hit_points: { type: "integer" },
      speed: { type: "string", description: "e.g. 30 ft" },
      abilities: abilityProps,
      actions_and_notes: { type: "string", description: "attacks, special abilities, and notes" },
    },
    required: ["name", "kind", "armor_class", "hit_points", "abilities"],
  },
};

async function callClaude({ system, prompt, tool }) {
  const key = claudeKey();
  if (!key) throw new Error("The AI isn't set up on this server yet.");
  const body = { model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: prompt }] };
  if (tool) { body.tools = [tool]; body.tool_choice = { type: "tool", name: tool.name }; }

  // Give up after 30s instead of hanging forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The AI took too long (over 30s). Try again, or switch to the faster Haiku model.");
    throw new Error("Couldn't reach the AI service: " + e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (r.status === 401) throw new Error("AI key was rejected — check claude.key.");
    if (r.status === 429) throw new Error("AI is rate-limited or out of credit. Try again shortly.");
    throw new Error(`AI request failed (${r.status}). ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  if (tool) {
    const block = (data.content || []).find((c) => c.type === "tool_use");
    if (!block) throw new Error("AI did not return structured data.");
    return block.input;
  }
  return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

function mapCharacter(c, owner) {
  const ab = {}; ABILS.forEach((a) => (ab[a] = Number(c.abilities?.[a]) || 10));
  const saves = {}; (c.saving_throw_proficiencies || []).forEach((s) => { if (ABILS.includes(s)) saves[s] = true; });
  const skills = {}; (c.skill_proficiencies || []).forEach((s) => { if (SKILL_NAMES.includes(s)) skills[s] = true; });
  const slots = {};
  (c.spell_slots || []).forEach((s) => { if (s.level >= 1 && s.level <= 9 && s.total > 0) slots[s.level] = { used: 0, total: Number(s.total) }; });
  return {
    name: c.name || "Adventurer", cls: c.class || "", level: Number(c.level) || 1,
    ac: Number(c.armor_class) || 10, hp: Number(c.hit_points) || 10, hpMax: Number(c.hit_points) || 10,
    prof: Number(c.proficiency_bonus) || 2, abilities: ab, saves, skills, slots,
    inventory: c.inventory_and_notes || "", owner,
  };
}
function mapCreature(c) {
  const ab = {}; ABILS.forEach((a) => (ab[a] = Number(c.abilities?.[a]) || 10));
  return {
    name: c.name || "Creature", kind: c.kind === "NPC" ? "NPC" : "Monster", type: c.type || "",
    ac: Number(c.armor_class) || 10, hp: Number(c.hit_points) || 10, speed: c.speed || "30 ft",
    abilities: ab, actions: c.actions_and_notes || "",
  };
}

const AI_SYS = {
  character: "You build complete, rules-legal D&D 5e SRD player characters from a description. Pick sensible ability scores, compute AC and maximum HP appropriate to the class and level, set the proficiency bonus by level, choose class/background skill and saving-throw proficiencies, include spell slots for casters, and summarize equipment, key features and a one-line background. Use only SRD-safe content.",
  creature: "You build D&D 5e SRD monster or NPC stat blocks from a description. Provide sensible AC, HP, speed, ability scores, and a concise list of attacks/abilities. Use only SRD-safe content.",
  rules: "You are a concise D&D 5e rules assistant using the 5e SRD. Answer briefly and practically. When relevant, mention the matching page on dnd5e.wikidot.com. If something is homebrew or you're unsure, say so.",
  story: "You are a creative D&D 5e DM assistant. Produce vivid, ready-to-use encounters, loot, plot hooks, or descriptions. Keep it concise and usable at the table.",
};

httpServer.listen(PORT, () => {
  console.log(`D&D VTT running on http://localhost:${PORT}`);
});
