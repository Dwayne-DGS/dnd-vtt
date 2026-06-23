// Canvas map + draggable tokens, grid snapping, and fog of war.
// Movement, fog reveals, etc. are broadcast live via the socket.

export function initMap(socket) {
  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");

  let tokens = [];            // {id,label,color,img,x,y}
  let mapImg = null;
  let dragging = null;        // token being dragged
  let offset = { x: 0, y: 0 };

  let snapEnabled = false;    // snap tokens to grid on drop
  let fog = { enabled: false, revealed: new Set() };
  let revealMode = false;     // DM is painting revealed area
  let painting = false;

  const TOKEN_R = 22;
  const GRID = 50;            // visible grid + snap cell size (screen px)
  const FOG_COLS = 24, FOG_ROWS = 16; // normalized fog grid over the map rect

  const imgCache = new Map();
  function getImg(url) {
    if (imgCache.has(url)) return imgCache.get(url);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = draw;
    im.src = url;
    imgCache.set(url, im);
    return im;
  }

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    draw();
  }
  window.addEventListener("resize", resize);

  // The rectangle the map (or grid) occupies on screen — fog cells map onto this.
  function mapRect() {
    if (mapImg && mapImg.complete && mapImg.naturalWidth) {
      const scale = Math.min(canvas.width / mapImg.width, canvas.height / mapImg.height);
      const w = mapImg.width * scale, h = mapImg.height * scale;
      return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
    }
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rect = mapRect();
    if (mapImg && mapImg.complete) ctx.drawImage(mapImg, rect.x, rect.y, rect.w, rect.h);
    else drawGrid();

    for (const t of tokens) drawToken(t);

    if (fog.enabled) drawFog(rect);
  }

  function drawToken(t) {
    const im = t.img ? getImg(t.img) : null;
    if (im && im.complete && im.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOKEN_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(im, t.x - TOKEN_R, t.y - TOKEN_R, TOKEN_R * 2, TOKEN_R * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOKEN_R, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = t.color || "rgba(0,0,0,0.5)";
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOKEN_R, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.label.slice(0, 3), t.x, t.y);
    }
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let x = 0; x < canvas.width; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }

  // Hidden cells are opaque for players, semi-transparent for the DM (so the DM
  // can still see the whole map and knows what's hidden).
  function drawFog(rect) {
    const cw = rect.w / FOG_COLS, ch = rect.h / FOG_ROWS;
    ctx.fillStyle = window.isDM ? "rgba(10,8,6,0.55)" : "rgba(8,6,4,1)";
    for (let c = 0; c < FOG_COLS; c++) {
      for (let r = 0; r < FOG_ROWS; r++) {
        if (fog.revealed.has(c + "," + r)) continue;
        ctx.fillRect(rect.x + c * cw, rect.y + r * ch, cw + 1, ch + 1);
      }
    }
  }

  function cellAt(p) {
    const rect = mapRect();
    if (p.x < rect.x || p.y < rect.y || p.x > rect.x + rect.w || p.y > rect.y + rect.h) return null;
    const c = Math.floor((p.x - rect.x) / (rect.w / FOG_COLS));
    const r = Math.floor((p.y - rect.y) / (rect.h / FOG_ROWS));
    return c + "," + r;
  }

  function snap(v) { return Math.floor(v / GRID) * GRID + GRID / 2; }

  function tokenAt(x, y) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (Math.hypot(t.x - x, t.y - y) <= TOKEN_R) return t;
    }
    return null;
  }
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("mousedown", (e) => {
    const p = pos(e);
    if (revealMode && window.isDM) { painting = true; paint(p); return; }
    const t = tokenAt(p.x, p.y);
    if (t) { dragging = t; offset = { x: t.x - p.x, y: t.y - p.y }; }
  });
  canvas.addEventListener("mousemove", (e) => {
    const p = pos(e);
    if (painting) { paint(p); return; }
    if (!dragging) return;
    dragging.x = p.x + offset.x;
    dragging.y = p.y + offset.y;
    draw();
    socket.emit("moveToken", { id: dragging.id, x: dragging.x, y: dragging.y });
  });
  window.addEventListener("mouseup", () => {
    painting = false;
    if (dragging) {
      if (snapEnabled) { dragging.x = snap(dragging.x); dragging.y = snap(dragging.y); }
      socket.emit("moveToken", { id: dragging.id, x: dragging.x, y: dragging.y });
      draw();
      dragging = null;
    }
  });
  canvas.addEventListener("dblclick", (e) => {
    if (!window.isDM || revealMode) return;
    const p = pos(e);
    const t = tokenAt(p.x, p.y);
    if (t && confirm(`Remove token "${t.label}"?`)) socket.emit("deleteToken", t.id);
  });

  function paint(p) {
    const key = cellAt(p);
    if (!key || fog.revealed.has(key)) return;
    fog.revealed.add(key);
    draw();
    socket.emit("fogReveal", [key]);
  }

  function setMap(url) {
    if (!url) { mapImg = null; draw(); return; }
    mapImg = new Image();
    mapImg.crossOrigin = "anonymous";
    mapImg.onload = draw;
    mapImg.onerror = () => { mapImg = null; draw(); };
    mapImg.src = url;
  }

  // --- Controls ------------------------------------------------------------
  const snapBtn = document.getElementById("snap-toggle");
  const fogBtn = document.getElementById("fog-toggle");
  const revealBtn = document.getElementById("fog-reveal");
  snapBtn?.addEventListener("click", () => {
    snapEnabled = !snapEnabled;
    snapBtn.classList.toggle("active", snapEnabled);
  });
  fogBtn?.addEventListener("click", () => socket.emit("fogSet", !fog.enabled));
  revealBtn?.addEventListener("click", () => {
    revealMode = !revealMode;
    revealBtn.classList.toggle("active", revealMode);
    canvas.style.cursor = revealMode ? "crosshair" : "default";
  });
  document.getElementById("fog-reset")?.addEventListener("click", () => socket.emit("fogReset"));

  function applyFog(f) {
    fog = { enabled: !!f.enabled, revealed: new Set(f.revealed || []) };
    fogBtn?.classList.toggle("active", fog.enabled);
    draw();
  }

  // --- Socket events -------------------------------------------------------
  socket.on("state", (s) => { tokens = s.tokens || []; setMap(s.mapUrl); applyFog(s.fog || {}); });
  socket.on("mapUrl", setMap);
  socket.on("fogState", applyFog);
  socket.on("tokenAdded", (t) => { tokens.push(t); draw(); });
  socket.on("tokenMoved", ({ id, x, y }) => {
    const t = tokens.find((t) => t.id === id);
    if (t) { t.x = x; t.y = y; draw(); }
  });
  socket.on("tokenDeleted", (id) => { tokens = tokens.filter((t) => t.id !== id); draw(); });

  resize();
}
