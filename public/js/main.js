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
socket.on("role", ({ isDM, name, dmDenied }) => {
  window.isDM = !!isDM;
  window.playerName = name;
  document.body.classList.toggle("is-player", !isDM);
  const badge = document.getElementById("role-badge");
  badge.textContent = isDM ? "DM" : "Player";
  badge.className = "role-badge " + (isDM ? "dm" : "player");
  if (dmDenied) {
    alert("That DM password didn't match this room — you've joined as a player.");
  }
});

document.getElementById("join-btn").addEventListener("click", join);
document.getElementById("join-room").addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});

function join() {
  const name = document.getElementById("join-name").value.trim() || "Player";
  const room = document.getElementById("join-room").value.trim() || "lobby";
  const dmPassword = document.getElementById("join-dm").value;

  socket.connect();
  socket.emit("join", { name, room, dmPassword });

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

  // --- Map library ---------------------------------------------------------
  document.getElementById("map-save").addEventListener("click", () => {
    const url = mapUrl.value.trim();
    if (!url) { alert("Paste a map image URL first, then click ★ to save it."); return; }
    const name = prompt("Name this map:", "New map");
    if (name === null) return;
    socket.emit("saveMap", { name, url });
  });
  mapPicker.addEventListener("change", () => {
    if (!mapPicker.value) return;
    mapUrl.value = mapPicker.value;
    socket.emit("setMap", mapPicker.value);
  });

  function refreshMaps(maps) {
    mapPicker.innerHTML = '<option value="">— saved maps —</option>';
    (maps || []).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.url; o.textContent = m.name;
      mapPicker.appendChild(o);
    });
  }
  let savedMaps = [];
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
