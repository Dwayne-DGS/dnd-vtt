// Canvas map + draggable tokens. Movement is broadcast live via the socket.

export function initMap(socket) {
  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");

  let tokens = [];          // {id,label,color,x,y}
  let mapImg = null;
  let dragging = null;      // token being dragged
  let offset = { x: 0, y: 0 };

  const TOKEN_R = 22;

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    draw();
  }
  window.addEventListener("resize", resize);

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mapImg && mapImg.complete) {
      // Fit image while preserving aspect ratio.
      const scale = Math.min(canvas.width / mapImg.width, canvas.height / mapImg.height);
      const w = mapImg.width * scale, h = mapImg.height * scale;
      ctx.drawImage(mapImg, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    } else {
      drawGrid();
    }
    for (const t of tokens) {
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
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }

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
    const t = tokenAt(p.x, p.y);
    if (t) { dragging = t; offset = { x: t.x - p.x, y: t.y - p.y }; }
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const p = pos(e);
    dragging.x = p.x + offset.x;
    dragging.y = p.y + offset.y;
    draw();
    socket.emit("moveToken", { id: dragging.id, x: dragging.x, y: dragging.y });
  });
  window.addEventListener("mouseup", () => { dragging = null; });
  canvas.addEventListener("dblclick", (e) => {
    const p = pos(e);
    const t = tokenAt(p.x, p.y);
    if (t && confirm(`Remove token "${t.label}"?`)) socket.emit("deleteToken", t.id);
  });

  function setMap(url) {
    if (!url) { mapImg = null; draw(); return; }
    mapImg = new Image();
    mapImg.crossOrigin = "anonymous";
    mapImg.onload = draw;
    mapImg.onerror = () => { mapImg = null; draw(); };
    mapImg.src = url;
  }

  // --- Socket events -------------------------------------------------------
  socket.on("state", (s) => { tokens = s.tokens || []; setMap(s.mapUrl); });
  socket.on("mapUrl", setMap);
  socket.on("tokenAdded", (t) => { tokens.push(t); draw(); });
  socket.on("tokenMoved", ({ id, x, y }) => {
    const t = tokens.find((t) => t.id === id);
    if (t) { t.x = x; t.y = y; draw(); }
  });
  socket.on("tokenDeleted", (id) => { tokens = tokens.filter((t) => t.id !== id); draw(); });

  resize();
}
