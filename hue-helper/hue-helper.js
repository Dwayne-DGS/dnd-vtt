// D&D VTT — Philips Hue helper.
// Runs on a computer on the same network as your Hue Bridge (Mac now, Raspberry
// Pi later). It:
//   1) serves a small web UI at http://localhost:8765 to set everything up,
//   2) connects to your game server and listens for spell effects,
//   3) flashes your chosen Hue lights to match.
//
// Talks to the bridge over local HTTPS (self-signed cert is expected for a local
// device, so certificate checks are disabled — safe on your own network).

import express from "express";
import http from "http";
import https from "https";
import { io } from "socket.io-client";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, "config.json");
const UI_PORT = 8765;

let config = {
  serverUrl: "https://warcrimes.us",
  room: "",
  bridgeIp: "",
  apiKey: "",
  scheme: "https",      // "https" (modern bridges) or "http" (old)
  lights: [],            // light ids to control; empty = all
};
if (existsSync(CONFIG_FILE)) {
  try { config = { ...config, ...JSON.parse(readFileSync(CONFIG_FILE, "utf8")) }; } catch {}
}
function saveConfig() { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Bridge communication --------------------------------------------------
function bridgeRequest(method, path, body, scheme = config.scheme) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const lib = scheme === "http" ? http : https;
    const opts = {
      method, host: config.bridgeIp, path,
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    };
    if (lib === https) opts.rejectUnauthorized = false;
    if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = lib.request(opts, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b || "null")); } catch { resolve(b); } });
    });
    req.on("timeout", () => req.destroy(new Error("Bridge timed out")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
// Try the configured scheme, falling back to the other one (and remembering it).
async function bridge(method, path, body) {
  try {
    return await bridgeRequest(method, path, body);
  } catch (e) {
    const other = config.scheme === "https" ? "http" : "https";
    const res = await bridgeRequest(method, path, body, other);
    config.scheme = other; saveConfig();
    return res;
  }
}

const api = (p) => `/api/${config.apiKey}${p}`;
const getLights = () => bridge("GET", api("/lights"));
const setLight = (id, state) => bridge("PUT", api(`/lights/${id}/state`), state);

async function controlledIds() {
  if (config.lights.length) return config.lights;
  const lights = await getLights().catch(() => ({}));
  return Object.keys(lights || {});
}

// Baseline ("normal") light state, captured so effects can return to it.
let baseline = {};
async function captureBaseline() {
  const lights = await getLights().catch(() => null);
  if (!lights) return;
  baseline = {};
  for (const [id, l] of Object.entries(lights)) {
    const s = l.state || {};
    baseline[id] = { on: s.on, bri: s.bri, hue: s.hue, sat: s.sat, ct: s.ct, colormode: s.colormode };
  }
}
async function restore(ids) {
  for (const id of ids) {
    const b = baseline[id];
    if (!b) { await setLight(id, { on: true, bri: 200, ct: 366, transitiontime: 4 }); continue; }
    const state = { on: b.on, bri: b.bri, transitiontime: 4 };
    if (b.colormode === "ct" && b.ct != null) state.ct = b.ct;
    else if (b.hue != null) { state.hue = b.hue; state.sat = b.sat; }
    await setLight(id, state);
  }
}

// --- Effect definitions (names must match the game's FX buttons) -----------
const FX = {
  fire:      { hue: 5000,  sat: 254, bri: 254, ms: 2500, flicker: true },
  fireball:  { hue: 1000,  sat: 254, bri: 254, ms: 1600 },
  lightning: { strobe: 4, ms: 1200 },
  healing:   { hue: 25500, sat: 200, bri: 200, ms: 3000 },
  frost:     { hue: 46920, sat: 254, bri: 200, ms: 3000 },
  necrotic:  { hue: 50000, sat: 254, bri: 130, ms: 3000 },
  radiant:   { hue: 10000, sat: 120, bri: 254, ms: 2500 },
  poison:    { hue: 23000, sat: 254, bri: 200, ms: 3000 },
  darkness:  { off: true },
  reset:     { reset: true },
};

let busy = false;
async function applyEffect(id) {
  if (!config.apiKey || !config.bridgeIp) return;
  const fx = FX[id];
  if (!fx) return;
  if (busy && !fx.reset) return; // ignore overlapping effects except reset
  busy = true;
  try {
    const ids = await controlledIds();
    if (fx.reset) { await restore(ids); return; }
    if (fx.off) { for (const i of ids) await setLight(i, { on: false, transitiontime: 3 }); return; }
    if (fx.strobe) {
      for (let n = 0; n < fx.strobe; n++) {
        for (const i of ids) await setLight(i, { on: true, sat: 0, bri: 254, transitiontime: 0 });
        await wait(80);
        for (const i of ids) await setLight(i, { on: false, transitiontime: 0 });
        await wait(80);
      }
      await restore(ids);
      return;
    }
    for (const i of ids) await setLight(i, { on: true, hue: fx.hue, sat: fx.sat, bri: fx.bri, transitiontime: 1 });
    if (fx.flicker) {
      const end = Date.now() + fx.ms;
      while (Date.now() < end) {
        await wait(180);
        for (const i of ids) await setLight(i, { bri: 130 + Math.floor(Math.random() * 124), transitiontime: 1 });
      }
    } else {
      await wait(fx.ms);
    }
    await restore(ids);
  } catch (e) {
    console.error("Effect error:", e.message);
  } finally {
    busy = false;
  }
}

// --- Connection to the game server -----------------------------------------
let socket = null;
let serverConnected = false;
function connectServer() {
  if (socket) { socket.removeAllListeners(); socket.close(); }
  if (!config.serverUrl || !config.room) return;
  socket = io(config.serverUrl, { transports: ["websocket", "polling"] });
  socket.on("connect", () => { serverConnected = true; socket.emit("hueSubscribe", config.room); console.log("Connected to game server, listening in room:", config.room); });
  socket.on("disconnect", () => { serverConnected = false; });
  socket.on("spellEffect", (id) => { console.log("Effect:", id); applyEffect(id); });
}

// --- Web UI + local API ----------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/api/status", async (_req, res) => {
  let lights = [];
  if (config.apiKey && config.bridgeIp) {
    try {
      const data = await getLights();
      lights = Object.entries(data || {}).map(([id, l]) => ({
        id, name: l.name, on: l.state?.on, selected: config.lights.includes(id),
      }));
    } catch {}
  }
  res.json({
    serverUrl: config.serverUrl, room: config.room, serverConnected,
    bridgeIp: config.bridgeIp, paired: !!config.apiKey,
    controllingAll: config.lights.length === 0, lights,
  });
});

app.post("/api/discover", async (_req, res) => {
  try {
    const r = await fetch("https://discovery.meethue.com");
    const list = await r.json();
    if (list[0]?.internalipaddress) {
      config.bridgeIp = list[0].internalipaddress; saveConfig();
      return res.json({ ip: config.bridgeIp });
    }
    res.status(404).json({ error: "No bridge found on your network." });
  } catch (e) { res.status(500).json({ error: "Discovery failed: " + e.message }); }
});

app.post("/api/bridge", (req, res) => {
  config.bridgeIp = (req.body.ip || "").trim(); saveConfig();
  res.json({ ok: true, bridgeIp: config.bridgeIp });
});

app.post("/api/pair", async (req, res) => {
  if (req.body.ip) { config.bridgeIp = req.body.ip.trim(); saveConfig(); }
  if (!config.bridgeIp) return res.status(400).json({ error: "Enter or discover the bridge IP first." });
  try {
    const result = await bridge("POST", "/api", { devicetype: "dnd_vtt_hue#helper" });
    const r0 = Array.isArray(result) ? result[0] : result;
    if (r0?.success?.username) {
      config.apiKey = r0.success.username; saveConfig();
      await captureBaseline();
      return res.json({ ok: true });
    }
    if (r0?.error?.type === 101) {
      return res.status(428).json({ error: "Press the round LINK button on top of your Hue Bridge, then click Pair again (within 30 seconds)." });
    }
    res.status(500).json({ error: "Pairing failed: " + JSON.stringify(result) });
  } catch (e) { res.status(500).json({ error: "Can't reach the bridge: " + e.message }); }
});

app.post("/api/select", (req, res) => {
  config.lights = Array.isArray(req.body.ids) ? req.body.ids : []; saveConfig();
  res.json({ ok: true });
});
app.post("/api/recapture", async (_req, res) => { await captureBaseline(); res.json({ ok: true }); });
app.post("/api/server", (req, res) => {
  config.serverUrl = (req.body.url || "").trim();
  config.room = (req.body.room || "").trim();
  saveConfig(); connectServer();
  res.json({ ok: true });
});
app.post("/api/effect", async (req, res) => { await applyEffect(req.body.id); res.json({ ok: true }); });

app.listen(UI_PORT, () => {
  console.log(`\n  D&D Hue helper running.`);
  console.log(`  Open the setup page:  http://localhost:${UI_PORT}\n`);
});

// Connect on startup if already configured.
if (config.apiKey) captureBaseline();
connectServer();
