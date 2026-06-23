// Orchestrator: handles the join screen, connects the socket, wires tabs,
// and boots the map / chat / character modules.

import { initMap } from "./map.js";
import { initChat } from "./chat.js";
import { initCharacters } from "./character.js";
import { initInitiative } from "./initiative.js";
import { initBestiary } from "./bestiary.js";
import { initReference } from "./reference.js";
import { initVoice } from "./voice.js";

const socket = io({ autoConnect: false });

const joinScreen = document.getElementById("join-screen");
const app = document.getElementById("app");

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
  const name = document.getElementById("join-name").value.trim() || "Player";
  const room = document.getElementById("join-room").value.trim();
  const password = document.getElementById("join-pw").value;
  if (!room) { alert("Enter the table (room) name."); return; }
  socket.connect();
  socket.emit("join", { name, room, password });
}
function doCreate() {
  const name = document.getElementById("create-name").value.trim() || "DM";
  const room = document.getElementById("create-room").value.trim();
  const dmPassword = document.getElementById("create-dm").value;
  const playerPassword = document.getElementById("create-player").value;
  if (!room) { alert("Enter a room name."); return; }
  if (!dmPassword) { alert("Set a DM password to create a table."); return; }
  socket.connect();
  socket.emit("createRoom", { name, room, dmPassword, playerPassword });
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
