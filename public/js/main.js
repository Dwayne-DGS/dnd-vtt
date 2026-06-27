// Orchestrator: handles the join screen, connects the socket, wires tabs,
// and boots the map / chat / character modules.

import { initMap } from "./map.js";
import { initChat } from "./chat.js";
import { initCharacters } from "./character.js";
import { initInitiative } from "./initiative.js";
import { initBestiary } from "./bestiary.js";
import { initReference } from "./reference.js";
import { initVoice } from "./voice.js";
import { initFX } from "./fx.js";
import { initAI } from "./ai.js";
import { initDice, SKINS, previewDie, applySkin, currentSkin } from "./dice.js";
import { initSound } from "./sound.js";
import { initWeather } from "./weather.js";
import { initJournal } from "./journal.js";
import { initLoot } from "./loot.js";
import { initTimer } from "./timer.js";

const socket = io({ autoConnect: false });

const authScreen = document.getElementById("auth-screen");
const joinScreen = document.getElementById("join-screen");
const app = document.getElementById("app");

// --- Account gate --------------------------------------------------------
window.account = null;

function showAuth() {
  authScreen.classList.remove("hidden");
  joinScreen.classList.add("hidden");
  app.classList.add("hidden");
}
function showLanding(user) {
  window.account = user;
  authScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  document.getElementById("welcome").textContent = "⚔️ Welcome, " + (user.name || user.username);
  // Only GMs / admins may create tables.
  const canCreate = user.role === "gm" || user.role === "admin";
  document.getElementById("mode-create").classList.toggle("hidden", !canCreate);
  if (!canCreate) document.getElementById("mode-join").click();
  document.getElementById("accounts-link").classList.toggle("hidden", user.role !== "admin");
  // Players can request GM access (hidden once they're GM/admin).
  const reqBtn = document.getElementById("request-gm");
  reqBtn.classList.toggle("hidden", user.role !== "player");
  if (user.gmRequested) { reqBtn.textContent = "Game Master access requested ✓"; reqBtn.disabled = true; }
  // Load this account's tables for the dashboard list.
  socket.connect();
  socket.emit("myTables");
  if (user.role === "admin") socket.emit("adminUsers"); // refreshes the pending badge (won't open the panel)
}

// --- Settings (dice skins) ----------------------------------------------
const settingsOverlay = document.getElementById("settings-overlay");
const skinGrid = document.getElementById("skin-grid");
document.getElementById("settings-link").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", () => settingsOverlay.classList.add("hidden"));
function openSettings() {
  const cur = (window.account && window.account.diceSkin) || currentSkin();
  skinGrid.innerHTML = "";
  Object.entries(SKINS).forEach(([id, sk]) => {
    const card = document.createElement("button");
    card.className = "skin-card" + (id === cur ? " selected" : "");
    card.innerHTML = previewDie(id) + `<span>${sk.name}</span>`;
    card.addEventListener("click", () => {
      applySkin(id);
      if (window.account) window.account.diceSkin = id;
      socket.connect();
      socket.emit("setDiceSkin", id);
      openSettings();
    });
    skinGrid.appendChild(card);
  });
  settingsOverlay.classList.remove("hidden");
}

document.getElementById("request-gm").addEventListener("click", () => { socket.connect(); socket.emit("requestGm"); });
socket.on("gmRequested", () => {
  const b = document.getElementById("request-gm");
  b.textContent = "Game Master access requested ✓"; b.disabled = true;
});

// Render the "Your tables" list; click one to jump straight in.
socket.on("myTablesList", (tables) => {
  const box = document.getElementById("my-tables");
  box.innerHTML = "";
  if (!tables.length) { box.innerHTML = "<p class='join-hint' style='margin:0 0 8px'>No tables yet. Create one below, or join a friend's with its name + invite password.</p>"; return; }
  tables.forEach((t) => {
    const b = document.createElement("button");
    b.className = "table-row";
    b.innerHTML = `<span>${escAcct(t.id)}</span><span class="table-role">${t.role === "gm" ? "GM" : "Player"}</span>`;
    b.addEventListener("click", () => { socket.connect(); socket.emit("enterTable", { room: t.id }); });
    box.appendChild(b);
  });
});
async function authPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}
function logout() { fetch("/auth/logout", { method: "POST" }).then(() => location.reload()); }

// Auth screen tabs
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const authErr = document.getElementById("auth-error");
document.getElementById("auth-mode-login").addEventListener("click", (e) => {
  e.target.classList.add("active"); document.getElementById("auth-mode-signup").classList.remove("active");
  loginForm.classList.remove("hidden"); signupForm.classList.add("hidden"); authErr.textContent = "";
});
document.getElementById("auth-mode-signup").addEventListener("click", (e) => {
  e.target.classList.add("active"); document.getElementById("auth-mode-login").classList.remove("active");
  signupForm.classList.remove("hidden"); loginForm.classList.add("hidden"); authErr.textContent = "";
});
document.getElementById("login-btn").addEventListener("click", async () => {
  authErr.textContent = "";
  try {
    const { user } = await authPost("/auth/login", {
      username: document.getElementById("login-user").value,
      password: document.getElementById("login-pass").value,
    });
    showLanding(user);
  } catch (e) { authErr.textContent = e.message; }
});
document.getElementById("signup-btn").addEventListener("click", async () => {
  authErr.textContent = "";
  try {
    const { user } = await authPost("/auth/signup", {
      name: document.getElementById("signup-name").value,
      email: document.getElementById("signup-email").value,
      username: document.getElementById("signup-user").value,
      password: document.getElementById("signup-pass").value,
    });
    showLanding(user);
  } catch (e) { authErr.textContent = e.message; }
});
document.getElementById("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("login-btn").click(); });
document.getElementById("logout-join").addEventListener("click", logout);
document.getElementById("logout-btn").addEventListener("click", logout);

// --- Account management (admin) -----------------------------------------
const accountsOverlay = document.getElementById("accounts-overlay");
const accountsListEl = document.getElementById("accounts-list");
let openAccounts = false;
document.getElementById("accounts-link").addEventListener("click", () => { openAccounts = true; socket.connect(); socket.emit("adminUsers"); });
document.getElementById("accounts-close").addEventListener("click", () => accountsOverlay.classList.add("hidden"));
socket.on("adminUserList", (users) => {
  // Update the pending-request badge on the link (in-app notification).
  const pending = users.filter((u) => u.gm_requested).length;
  const link = document.getElementById("accounts-link");
  link.textContent = "Manage accounts (admin)" + (pending ? `  •  ${pending} GM request${pending > 1 ? "s" : ""}` : "");
  if (!openAccounts) return; // landing refresh only updates the badge
  openAccounts = false;
  accountsListEl.innerHTML = "";
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString() : "—");
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "acct-card";
    const tables = (u.tables || []).map((t) => `${escAcct(t.id)} (${t.role === "gm" ? "GM" : "P"})`).join(", ") || "none";
    const reqBadge = u.gm_requested ? ` <span class="req-badge">wants GM</span>` : "";
    row.innerHTML = `
      <div class="acct-info">
        <div class="ar-name">${escAcct(u.name || u.username)} <span class="ar-meta">@${escAcct(u.username)}</span>${reqBadge}</div>
        <div class="ar-meta">${escAcct(u.email || "no email")} · joined ${fmtDate(u.created_at)}</div>
        <div class="ar-meta">tables: ${tables}</div>
      </div>
      <div class="acct-controls">
        ${u.gm_requested ? '<button class="acct-approve">✓ Make GM</button><button class="acct-deny btn-secondary">Deny</button>' : ""}
        <select class="acct-role">
          <option value="player"${u.role === "player" ? " selected" : ""}>Player</option>
          <option value="gm"${u.role === "gm" ? " selected" : ""}>Game Master</option>
          <option value="admin"${u.role === "admin" ? " selected" : ""}>Admin</option>
        </select>
        <button class="acct-reset btn-secondary">Reset password</button>
        <button class="acct-del">Delete</button>
      </div>`;
    row.querySelector(".acct-role").addEventListener("change", (e) => socket.emit("adminSetRole", { id: u.id, role: e.target.value }));
    row.querySelector(".acct-reset").addEventListener("click", () => {
      const np = prompt(`New password for "${u.username}" (at least 6 characters):`);
      if (np) socket.emit("adminResetPassword", { id: u.id, newPassword: np });
    });
    row.querySelector(".acct-del").addEventListener("click", () => { if (confirm(`Delete account "${u.username}"?`)) socket.emit("adminDeleteUser", u.id); });
    row.querySelector(".acct-approve")?.addEventListener("click", () => socket.emit("adminSetRole", { id: u.id, role: "gm" }));
    row.querySelector(".acct-deny")?.addEventListener("click", () => socket.emit("adminDenyGm", u.id));
    accountsListEl.appendChild(row);
  });
  accountsOverlay.classList.remove("hidden");
});
socket.on("adminNotice", (m) => alert(m));

// --- DM: manage allowed player emails for the current table --------------
const playersOverlay = document.getElementById("players-overlay");
const allowListEl = document.getElementById("allow-list");
document.getElementById("players-btn")?.addEventListener("click", () => { socket.emit("listAllowed"); playersOverlay.classList.remove("hidden"); });
document.getElementById("players-close")?.addEventListener("click", () => playersOverlay.classList.add("hidden"));
document.getElementById("allow-add")?.addEventListener("click", () => {
  const inp = document.getElementById("allow-email");
  const email = inp.value.trim();
  if (email) { socket.emit("addAllowed", email); inp.value = ""; }
});
socket.on("allowedEmails", (emails) => {
  allowListEl.innerHTML = "";
  if (!emails.length) { allowListEl.innerHTML = "<p class='join-hint' style='margin:0'>No emails added yet. Players can still use the invite password if you set one.</p>"; return; }
  emails.forEach((em) => {
    const row = document.createElement("div");
    row.className = "admin-room";
    row.innerHTML = `<span class="ar-name" style="flex:1">${escAcct(em)}</span><button>Remove</button>`;
    row.querySelector("button").addEventListener("click", () => socket.emit("removeAllowed", em));
    allowListEl.appendChild(row);
  });
});
function escAcct(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// On load, find out if we're already logged in.
fetch("/auth/me").then((r) => r.json()).then(({ user }) => { if (user) showLanding(user); else showAuth(); }).catch(showAuth);

// Role is decided by the server from the DM password. We mirror it to the body
// class (CSS hides .dm-only controls for players) and to window.isDM /
// window.playerName for the feature modules to read. Registered before connect
// so we never miss the event.
window.isDM = false;
window.playerName = "Player";
let entered = false;

function setRole(isDM, name) {
  window.isDM = !!isDM;
  window.playerName = name;
  document.body.classList.toggle("is-player", !isDM);
  const badge = document.getElementById("role-badge");
  badge.textContent = isDM ? "DM" : "Player";
  badge.className = "role-badge " + (isDM ? "dm" : "player");
}

// Server confirms the join/create with a role; only then do we enter the app.
socket.on("role", ({ isDM, name, room }) => {
  setRole(isDM, name);
  if (!entered) { entered = true; enterApp(room); }
});
socket.on("joinError", (msg) => alert(msg || "Could not join that table."));

// Landing screen: toggle between Join and Create.
const joinForm = document.getElementById("join-form");
const createForm = document.getElementById("create-form");
const modeJoin = document.getElementById("mode-join");
const modeCreate = document.getElementById("mode-create");
modeJoin.addEventListener("click", () => {
  modeJoin.classList.add("active"); modeCreate.classList.remove("active");
  joinForm.classList.remove("hidden"); createForm.classList.add("hidden");
});
modeCreate.addEventListener("click", () => {
  modeCreate.classList.add("active"); modeJoin.classList.remove("active");
  createForm.classList.remove("hidden"); joinForm.classList.add("hidden");
});

function doJoin() {
  const room = document.getElementById("join-room").value.trim();
  const password = document.getElementById("join-pw").value;
  if (!room) { alert("Enter the table (room) name."); return; }
  socket.connect();
  socket.emit("join", { room, password });
}
function doCreate() {
  const room = document.getElementById("create-room").value.trim();
  const playerPassword = document.getElementById("create-player").value;
  if (!room) { alert("Enter a table name."); return; }
  socket.connect();
  socket.emit("createRoom", { room, playerPassword });
}
document.getElementById("join-btn").addEventListener("click", doJoin);
document.getElementById("join-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
document.getElementById("create-btn").addEventListener("click", doCreate);

// --- Owner room management ----------------------------------------------
let adminPw = null;
const adminOverlay = document.getElementById("admin-overlay");
const adminListEl = document.getElementById("admin-list");

document.getElementById("admin-link").addEventListener("click", () => {
  const pw = prompt("Owner/admin password:");
  if (!pw) return;
  adminPw = pw;
  socket.connect();
  socket.emit("adminList", pw);
});
document.getElementById("admin-close").addEventListener("click", () => adminOverlay.classList.add("hidden"));
socket.on("adminError", (msg) => alert(msg || "Admin error."));
socket.on("adminRooms", (rooms) => {
  adminListEl.innerHTML = "";
  if (!rooms.length) adminListEl.innerHTML = "<p class='join-hint'>No rooms yet.</p>";
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : "—";
  for (const r of rooms) {
    const row = document.createElement("div");
    row.className = "admin-room";
    row.innerHTML = `
      <div style="flex:1">
        <div class="ar-name">${escapeHtml(r.id)}</div>
        <div class="ar-meta">created ${fmtDate(r.created_at)} · last active ${fmtDate(r.last_active)} · ${r.characters} PCs, ${r.creatures} creatures</div>
      </div>
      <button>Delete</button>`;
    row.querySelector("button").addEventListener("click", () => {
      if (confirm(`Permanently delete room "${r.id}" and all its data?`)) {
        socket.emit("adminDelete", { password: adminPw, room: r.id });
      }
    });
    adminListEl.appendChild(row);
  }
  adminOverlay.classList.remove("hidden");
});
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function enterApp(room) {
  document.getElementById("room-label").textContent = `Room: ${room}`;
  joinScreen.classList.add("hidden");
  app.classList.remove("hidden");

  // Modules must init after the app is visible so the canvas has a size.
  initMap(socket);
  initChat(socket);
  initCharacters(socket);
  initInitiative(socket);
  initBestiary(socket);
  initReference();
  initVoice(socket);
  initFX(socket);
  initAI(socket);
  initDice(socket);
  initSound(socket);
  initWeather(socket);
  initJournal(socket);
  initLoot(socket);
  initTimer(socket);

  // Handouts — DM shows an image to everyone.
  const handoutOverlay = document.getElementById("handout-overlay");
  const handoutFile = document.getElementById("handout-file");
  document.getElementById("handout-btn")?.addEventListener("click", () => handoutFile.click());
  handoutFile?.addEventListener("change", async () => {
    const f = handoutFile.files[0]; handoutFile.value = "";
    if (!f) return;
    try { socket.emit("showHandout", await uploadImage(f)); } catch (e) { alert(e.message); }
  });
  socket.on("handout", (url) => { document.getElementById("handout-img").src = url; handoutOverlay.classList.remove("hidden"); });
  socket.on("handoutClear", () => handoutOverlay.classList.add("hidden"));
  document.getElementById("handout-close").addEventListener("click", () => {
    handoutOverlay.classList.add("hidden");
    if (window.isDM) socket.emit("clearHandout");
  });

  const mapUrl = document.getElementById("map-url");
  const mapPicker = document.getElementById("map-picker");

  // Map + token controls.
  document.getElementById("map-set").addEventListener("click", () => {
    socket.emit("setMap", mapUrl.value.trim());
  });
  document.getElementById("add-token").addEventListener("click", () => {
    const label = prompt("Token label (e.g. character initials):", "PC");
    if (label === null) return;
    const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    socket.emit("addToken", { label, color });
  });

  // --- Image uploads (DM) --------------------------------------------------
  // Streams a file to the server and returns its public URL.
  async function uploadImage(file) {
    const res = await fetch("/upload", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Upload failed");
    }
    return (await res.json()).url;
  }

  const mapFile = document.getElementById("map-file");
  const portraitFile = document.getElementById("portrait-file");

  document.getElementById("map-upload").addEventListener("click", () => mapFile.click());
  mapFile.addEventListener("change", async () => {
    const file = mapFile.files[0];
    mapFile.value = "";
    if (!file) return;
    try {
      const url = await uploadImage(file);
      mapUrl.value = url;
      socket.emit("setMap", url);
      const name = prompt("Save this map to the library as:", file.name.replace(/\.[^.]+$/, ""));
      if (name) socket.emit("saveMap", { name, url });
    } catch (e) { alert(e.message); }
  });

  document.getElementById("add-portrait").addEventListener("click", () => portraitFile.click());
  portraitFile.addEventListener("change", async () => {
    const file = portraitFile.files[0];
    portraitFile.value = "";
    if (!file) return;
    const label = prompt("Token label (e.g. character initials):", "PC");
    if (label === null) return;
    try {
      const img = await uploadImage(file);
      const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
      socket.emit("addToken", { label, color, img });
    } catch (e) { alert(e.message); }
  });

  // --- Map library ---------------------------------------------------------
  document.getElementById("map-save").addEventListener("click", () => {
    const url = mapUrl.value.trim();
    if (!url) { alert("Paste a map image URL first, then click ★ to save it."); return; }
    const name = prompt("Name this map:", "New map");
    if (name === null) return;
    socket.emit("saveMap", { name, url });
  });
  let savedMaps = [];
  mapPicker.addEventListener("change", () => {
    const m = savedMaps.find((x) => x.id === mapPicker.value);
    if (!m) return;
    mapUrl.value = m.url;
    socket.emit("setMap", m.url);
  });
  // Remove the selected map from the shared library (DM only).
  document.getElementById("map-remove")?.addEventListener("click", () => {
    const m = savedMaps.find((x) => x.id === mapPicker.value);
    if (!m) { alert("Pick a saved map from the dropdown first."); return; }
    if (confirm(`Remove "${m.name}" from the shared map library?`)) socket.emit("deleteMap", m.id);
  });

  function refreshMaps(maps) {
    mapPicker.innerHTML = '<option value="">— saved maps —</option>';
    (maps || []).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.name;
      mapPicker.appendChild(o);
    });
  }
  socket.on("state", (s) => { savedMaps = s.maps || []; refreshMaps(savedMaps); });
  socket.on("mapSaved", (m) => { savedMaps.push(m); refreshMaps(savedMaps); });
  socket.on("mapDeleted", (id) => {
    savedMaps = savedMaps.filter((m) => m.id !== id);
    refreshMaps(savedMaps);
  });
}

// Tab switching.
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});
