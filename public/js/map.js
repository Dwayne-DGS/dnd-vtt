// Canvas battle map: zoom/pan camera, draggable tokens (labels, HP bars, size),
// grid overlay, fog of war, measurement ruler, combat highlight, and pings.
//
// Coordinate spaces:
//   screen  = pixels in the canvas element (what the mouse reports)
//   world   = the base fit space (token x/y live here, independent of zoom/pan)
// The camera (cam.scale + cam.x/y) maps world -> screen. Zoom/pan are LOCAL to
// each viewer (not synced); tokens, fog, grid, pings are shared.

export function initMap(socket) {
  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");

  let tokens = [];
  let mapImg = null;
  let rotation = 0;
  let grid = { on: false, size: 64 };
  let fog = { enabled: false, revealed: new Set() };

  const cam = { x: 0, y: 0, scale: 1 };
  let dragging = null, dragOffset = { x: 0, y: 0 };
  let panning = false, panStart = null;
  let revealMode = false, painting = false;
  let snapEnabled = false;
  let measureMode = false, ruler = null; // ruler in screen coords {x1,y1,x2,y2}
  let currentName = null;                 // active initiative combatant
  let pings = [];                         // {nx,ny,t}

  const TOKEN_R = 22;
  const GRID = 50;
  const FOG_COLS = 24, FOG_ROWS = 16;
  const imgCache = new Map();
  function getImg(url) {
    if (imgCache.has(url)) return imgCache.get(url);
    const im = new Image(); im.crossOrigin = "anonymous"; im.onload = draw; im.src = url;
    imgCache.set(url, im); return im;
  }

  function resize() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; draw(); }
  window.addEventListener("resize", resize);

  // --- coordinate helpers --------------------------------------------------
  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function toWorld(p) { return { x: (p.x - cam.x) / cam.scale, y: (p.y - cam.y) / cam.scale }; }
  function worldToScreen(w) { return { x: w.x * cam.scale + cam.x, y: w.y * cam.scale + cam.y }; }

  // The map's footprint in WORLD space (fit to the base canvas, unaffected by cam).
  function mapRect() {
    if (mapImg && mapImg.complete && mapImg.naturalWidth) {
      const iw = mapImg.width, ih = mapImg.height;
      const swapped = rotation === 90 || rotation === 270;
      const scale = swapped
        ? Math.min(canvas.width / ih, canvas.height / iw)
        : Math.min(canvas.width / iw, canvas.height / ih);
      const fw = (swapped ? ih : iw) * scale, fh = (swapped ? iw : ih) * scale;
      return { x: (canvas.width - fw) / 2, y: (canvas.height - fh) / 2, w: fw, h: fh, scale, iw, ih };
    }
    return { x: 0, y: 0, w: canvas.width, h: canvas.height, scale: 1 };
  }

  // --- drawing -------------------------------------------------------------
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);
    const rect = mapRect();
    if (mapImg && mapImg.complete) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      const dw = rect.iw * rect.scale, dh = rect.ih * rect.scale;
      ctx.drawImage(mapImg, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      if (grid.on) drawOverlayGrid(rect);
    } else drawGrid();

    for (const t of tokens) drawToken(t);
    if (fog.enabled) drawFog(rect);
    ctx.restore();

    // Screen-space overlays
    drawPings(rect);
    if (ruler) drawRuler(rect);
  }

  function drawToken(t) {
    const r = TOKEN_R * (t.size || 1);
    const im = t.img ? getImg(t.img) : null;
    if (im && im.complete && im.naturalWidth) {
      ctx.save(); ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(im, t.x - r, t.y - r, r * 2, r * 2); ctx.restore();
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = t.color || "rgba(0,0,0,0.5)"; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(13 * (t.size || 1))}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((t.label || "?").slice(0, 3), t.x, t.y);
    }
    // Active-combatant highlight ring
    if (currentName && (t.label || "").toLowerCase() === currentName.toLowerCase()) {
      ctx.beginPath(); ctx.arc(t.x, t.y, r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = "#e4c884"; ctx.stroke();
    }
    // Name label
    if (t.label) {
      ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const ty = t.y + r + 3;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = ctx.measureText(t.label).width + 8;
      ctx.fillRect(t.x - w / 2, ty, w, 14);
      ctx.fillStyle = "#f1e8d8"; ctx.fillText(t.label, t.x, ty + 1);
    }
    // HP bar
    if (t.hp_max > 0) {
      const bw = r * 2, bx = t.x - r, by = t.y - r - 8;
      const frac = Math.max(0, Math.min(1, (t.hp || 0) / t.hp_max));
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = frac > 0.5 ? "#6fbf73" : frac > 0.25 ? "#d8a93a" : "#c0392b";
      ctx.fillRect(bx, by, bw * frac, 5);
    }
  }

  function drawOverlayGrid(rect) {
    const cell = Math.max(4, grid.size * (rect.scale || 1));
    ctx.save(); ctx.strokeStyle = "rgba(20,16,12,0.45)"; ctx.lineWidth = 1 / cam.scale;
    for (let x = rect.x; x <= rect.x + rect.w + 0.5; x += cell) { ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); }
    for (let y = rect.y; y <= rect.y + rect.h + 0.5; y += cell) { ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1 / cam.scale;
    for (let x = 0; x < canvas.width; x += GRID) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 0; y < canvas.height; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  }

  function drawFog(rect) {
    const cw = rect.w / FOG_COLS, ch = rect.h / FOG_ROWS;
    ctx.fillStyle = window.isDM ? "rgba(10,8,6,0.55)" : "rgba(8,6,4,1)";
    for (let c = 0; c < FOG_COLS; c++) for (let r = 0; r < FOG_ROWS; r++) {
      if (fog.revealed.has(c + "," + r)) continue;
      ctx.fillRect(rect.x + c * cw, rect.y + r * ch, cw + 1, ch + 1);
    }
  }

  function drawPings(rect) {
    const now = Date.now();
    pings = pings.filter((p) => now - p.t < 1500);
    for (const p of pings) {
      const age = (now - p.t) / 1500;
      const w = worldToScreen({ x: rect.x + p.nx * rect.w, y: rect.y + p.ny * rect.h });
      ctx.beginPath(); ctx.arc(w.x, w.y, 8 + age * 34, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(228,200,132,${1 - age})`; ctx.lineWidth = 3; ctx.stroke();
    }
    if (pings.length) requestAnimationFrame(draw);
  }

  function drawRuler() {
    ctx.strokeStyle = "#e4c884"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(ruler.x1, ruler.y1); ctx.lineTo(ruler.x2, ruler.y2); ctx.stroke();
    ctx.setLineDash([]);
    const rect = mapRect();
    const cellWorld = (grid.size || 64) * (rect.scale || 1);
    const worldLen = Math.hypot(ruler.x2 - ruler.x1, ruler.y2 - ruler.y1) / cam.scale;
    const cells = cellWorld > 0 ? worldLen / cellWorld : 0;
    const label = `${Math.round(cells) * 5} ft  (${Math.round(cells)} sq)`;
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    const w = ctx.measureText(label).width + 10;
    ctx.fillRect(ruler.x2 + 8, ruler.y2 - 20, w, 18);
    ctx.fillStyle = "#e4c884"; ctx.fillText(label, ruler.x2 + 13, ruler.y2 - 4);
  }

  // --- hit testing ---------------------------------------------------------
  function tokenAt(w) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (Math.hypot(t.x - w.x, t.y - w.y) <= TOKEN_R * (t.size || 1)) return t;
    }
    return null;
  }
  function cellAt(w) {
    const rect = mapRect();
    if (w.x < rect.x || w.y < rect.y || w.x > rect.x + rect.w || w.y > rect.y + rect.h) return null;
    return Math.floor((w.x - rect.x) / (rect.w / FOG_COLS)) + "," + Math.floor((w.y - rect.y) / (rect.h / FOG_ROWS));
  }
  const snap = (v) => Math.floor(v / GRID) * GRID + GRID / 2;

  // --- interaction ---------------------------------------------------------
  canvas.addEventListener("mousedown", (e) => {
    const p = pos(e), w = toWorld(p);
    if (measureMode) { ruler = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; return; }
    if (e.altKey) { sendPing(w); return; }
    if (revealMode && window.isDM) { painting = true; paint(w); return; }
    const t = tokenAt(w);
    if (t) { dragging = t; dragOffset = { x: t.x - w.x, y: t.y - w.y }; }
    else { panning = true; panStart = p; }
  });
  canvas.addEventListener("mousemove", (e) => {
    const p = pos(e);
    if (ruler && measureMode) { ruler.x2 = p.x; ruler.y2 = p.y; draw(); return; }
    if (painting) { paint(toWorld(p)); return; }
    if (panning) { cam.x += p.x - panStart.x; cam.y += p.y - panStart.y; panStart = p; draw(); return; }
    if (dragging) {
      const w = toWorld(p); dragging.x = w.x + dragOffset.x; dragging.y = w.y + dragOffset.y;
      draw(); socket.emit("moveToken", { id: dragging.id, x: dragging.x, y: dragging.y });
    }
  });
  window.addEventListener("mouseup", () => {
    if (ruler && measureMode) { ruler = null; draw(); }
    painting = false; panning = false;
    if (dragging) {
      if (snapEnabled) { dragging.x = snap(dragging.x); dragging.y = snap(dragging.y); }
      socket.emit("moveToken", { id: dragging.id, x: dragging.x, y: dragging.y });
      draw(); dragging = null;
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = pos(e); const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(0.25, Math.min(5, cam.scale * factor));
    const f = ns / cam.scale;
    cam.x = p.x - (p.x - cam.x) * f; cam.y = p.y - (p.y - cam.y) * f; cam.scale = ns;
    draw();
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    if (!window.isDM || revealMode || measureMode) return;
    const t = tokenAt(toWorld(pos(e)));
    if (t && confirm(`Remove token "${t.label}"?`)) socket.emit("deleteToken", t.id);
  });
  canvas.addEventListener("contextmenu", (e) => {
    if (!window.isDM) return;
    const t = tokenAt(toWorld(pos(e)));
    if (!t) return;
    e.preventDefault();
    showTokenMenu(e.clientX, e.clientY, t);
  });

  function sendPing(w) {
    const rect = mapRect();
    socket.emit("ping", { nx: (w.x - rect.x) / rect.w, ny: (w.y - rect.y) / rect.h });
  }
  function paint(w) {
    const key = cellAt(w);
    if (!key || fog.revealed.has(key)) return;
    fog.revealed.add(key); draw(); socket.emit("fogReveal", [key]);
  }

  // --- token context menu (DM) --------------------------------------------
  const menu = document.getElementById("token-menu");
  function showTokenMenu(x, y, t) {
    menu.innerHTML = "";
    const item = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { menu.classList.add("hidden"); fn(); }; menu.appendChild(b); };
    item("✏️ Rename", () => { const n = prompt("Token label:", t.label); if (n !== null) socket.emit("updateToken", { id: t.id, label: n }); });
    item("❤️ Set HP", () => {
      const cur = t.hp_max ? `${t.hp}/${t.hp_max}` : "";
      const v = prompt("HP as current/max (e.g. 18/24):", cur);
      if (v === null) return;
      const m = v.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) socket.emit("updateToken", { id: t.id, hp: +m[1], hpMax: +m[2] });
    });
    item("◻︎ Size 1×1", () => socket.emit("updateToken", { id: t.id, size: 1 }));
    item("◼︎ Size 2×2", () => socket.emit("updateToken", { id: t.id, size: 2 }));
    item("⬛ Size 3×3", () => socket.emit("updateToken", { id: t.id, size: 3 }));
    item("🗑 Remove", () => socket.emit("deleteToken", t.id));
    menu.style.left = x + "px"; menu.style.top = y + "px";
    menu.classList.remove("hidden");
  }
  document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target)) menu.classList.add("hidden"); });

  function setMap(url) {
    if (!url) { mapImg = null; draw(); return; }
    mapImg = new Image(); mapImg.crossOrigin = "anonymous";
    mapImg.onload = draw; mapImg.onerror = () => { mapImg = null; draw(); };
    mapImg.src = url;
  }

  // --- toolbar controls ----------------------------------------------------
  const snapBtn = document.getElementById("snap-toggle");
  const gridBtn = document.getElementById("grid-toggle");
  const fogBtn = document.getElementById("fog-toggle");
  const revealBtn = document.getElementById("fog-reveal");
  const measureBtn = document.getElementById("measure-toggle");
  snapBtn?.addEventListener("click", () => { snapEnabled = !snapEnabled; snapBtn.classList.toggle("active", snapEnabled); });
  document.getElementById("map-rotate")?.addEventListener("click", () => socket.emit("setMapRotation", (rotation + 90) % 360));
  fogBtn?.addEventListener("click", () => socket.emit("fogSet", !fog.enabled));
  revealBtn?.addEventListener("click", () => { revealMode = !revealMode; revealBtn.classList.toggle("active", revealMode); canvas.style.cursor = revealMode ? "crosshair" : "default"; });
  document.getElementById("fog-reset")?.addEventListener("click", () => socket.emit("fogReset"));
  gridBtn?.addEventListener("click", () => socket.emit("setGrid", { on: !grid.on, size: grid.size }));
  document.getElementById("grid-minus")?.addEventListener("click", () => socket.emit("setGrid", { on: true, size: grid.size - 4 }));
  document.getElementById("grid-plus")?.addEventListener("click", () => socket.emit("setGrid", { on: true, size: grid.size + 4 }));
  measureBtn?.addEventListener("click", () => { measureMode = !measureMode; measureBtn.classList.toggle("active", measureMode); canvas.style.cursor = measureMode ? "crosshair" : "default"; });
  document.getElementById("view-reset")?.addEventListener("click", () => { cam.x = 0; cam.y = 0; cam.scale = 1; draw(); });

  function applyGrid(g) { grid = { on: !!g.on, size: g.size || 64 }; gridBtn?.classList.toggle("active", grid.on); draw(); }
  function applyFog(f) { fog = { enabled: !!f.enabled, revealed: new Set(f.revealed || []) }; fogBtn?.classList.toggle("active", fog.enabled); draw(); }

  // --- socket events -------------------------------------------------------
  socket.on("state", (s) => {
    tokens = s.tokens || [];
    rotation = s.mapRotation || 0;
    grid = { on: !!s.gridOn, size: s.gridSize || 64 };
    gridBtn?.classList.toggle("active", grid.on);
    setMap(s.mapUrl);
    applyFog(s.fog || {});
  });
  socket.on("mapUrl", setMap);
  socket.on("mapRotation", (deg) => { rotation = deg || 0; draw(); });
  socket.on("gridState", applyGrid);
  socket.on("fogState", applyFog);
  socket.on("tokenAdded", (t) => { tokens.push(t); draw(); });
  socket.on("tokenMoved", ({ id, x, y }) => { const t = tokens.find((t) => t.id === id); if (t) { t.x = x; t.y = y; draw(); } });
  socket.on("tokenUpdated", (u) => {
    const t = tokens.find((t) => t.id === u.id);
    if (t) { Object.assign(t, u); draw(); }
  });
  socket.on("tokenDeleted", (id) => { tokens = tokens.filter((t) => t.id !== id); draw(); });
  socket.on("ping", ({ nx, ny }) => { pings.push({ nx, ny, t: Date.now() }); draw(); });

  // Highlight the active combatant's token (match by name).
  function setCurrent(state) {
    const e = state && state.entries ? state.entries[state.turn] : null;
    currentName = e ? e.name : null; draw();
  }
  socket.on("initState", setCurrent);
  socket.on("state", (s) => setCurrent(s.initiative));

  resize();
}
