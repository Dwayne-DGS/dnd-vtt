// Asset finder: search Creative-Commons maps & audio, preview, and add them.
// The server queries Openverse; "Add" reuses the existing saveMap / saveSound /
// setMap events. DM-only (the launch buttons live in DM-only UI).
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initFinder(socket) {
  const overlay = document.getElementById("finder-overlay");
  const title = document.getElementById("finder-title");
  const input = document.getElementById("finder-q");
  const results = document.getElementById("finder-results");
  const aiBtn = document.getElementById("finder-ai");
  const note = document.getElementById("finder-note");
  if (!overlay) return;
  let kind = "maps";
  let pending = null; // safety timeout so the spinner never hangs forever

  function open(k) {
    kind = k;
    title.textContent = k === "sounds" ? "Find music & sound effects" : "Find maps";
    results.innerHTML = '<p class="muted">Describe what you want, then Search. Results are Creative-Commons licensed.</p>';
    // AI map generation only makes sense for maps.
    if (aiBtn) aiBtn.classList.toggle("hidden", k !== "maps");
    if (note) {
      note.textContent = k === "maps"
        ? "Search free Creative-Commons maps, or use “Generate with AI” to create a brand-new map from your description (counts toward your AI budget)."
        : "Results come from Creative-Commons libraries (Openverse). Each shows its license — some require crediting the creator. Preview, then add to your table.";
    }
    overlay.classList.remove("hidden");
    input.value = ""; input.focus();
  }
  const close = () => { overlay.classList.add("hidden"); results.innerHTML = ""; };
  function search() {
    const q = input.value.trim();
    if (!q) return;
    results.innerHTML = '<p class="muted">Searching Creative-Commons libraries…</p>';
    socket.emit("findAssets", { kind, query: q });
    clearTimeout(pending);
    pending = setTimeout(() => {
      results.innerHTML = '<p class="muted">The search service is taking too long to respond. Try again, or try shorter words.</p>';
    }, 20000);
  }

  function generate() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    clearTimeout(pending);
    results.innerHTML = '<p class="muted">✨ Generating your map with AI — this can take 20–40 seconds…</p>';
    socket.emit("generateMap", { prompt: q, use: false });
    pending = setTimeout(() => {
      results.innerHTML = '<p class="muted">Still working… if nothing appears, the image service may be slow. Try again in a moment.</p>';
    }, 90000);
  }
  aiBtn?.addEventListener("click", generate);

  document.getElementById("find-maps")?.addEventListener("click", () => open("maps"));
  document.getElementById("find-sounds")?.addEventListener("click", () => open("sounds"));
  document.getElementById("finder-maps-tab")?.addEventListener("click", () => open("maps"));
  document.getElementById("finder-sounds-tab")?.addEventListener("click", () => open("sounds"));
  document.getElementById("finder-go")?.addEventListener("click", search);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  document.getElementById("finder-close")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  socket.on("assetResults", ({ kind: k, items, error }) => {
    if (k !== kind) return;
    clearTimeout(pending);
    if (error) { results.innerHTML = `<p class="muted">${esc(error)}</p>`; return; }
    if (!items || !items.length) { results.innerHTML = '<p class="muted">No results — try different words.</p>'; return; }
    results.innerHTML = "";
    items.forEach((it) => {
      const card = document.createElement("div");
      card.className = "finder-card";
      const attr = `<div class="finder-meta">${esc(it.by || "unknown")}${it.license ? " · " + esc(it.license) : ""}${it.source ? ` · <a href="${esc(it.source)}" target="_blank" rel="noopener">source ↗</a>` : ""}</div>`;
      if (kind === "maps") {
        card.innerHTML =
          `<img class="finder-thumb" loading="lazy" src="${esc(it.thumb)}" alt="" />` +
          `<div class="finder-info"><div class="finder-title-t">${esc(it.title)}</div>${attr}` +
          `<div class="finder-acts"><button class="fa-add">＋ Add to maps</button><button class="fa-use btn-secondary">Use now</button></div></div>`;
        card.querySelector(".fa-add").addEventListener("click", (ev) => { socket.emit("saveMap", { name: it.title, url: it.media }); ev.target.textContent = "Added ✓"; ev.target.disabled = true; });
        card.querySelector(".fa-use").addEventListener("click", () => { socket.emit("saveMap", { name: it.title, url: it.media }); socket.emit("setMap", it.media); });
      } else {
        const dur = it.duration ? ` · ${it.duration}s` : "";
        card.innerHTML =
          `<div class="finder-info"><div class="finder-title-t">${esc(it.title)}${dur}</div>${attr}` +
          `<audio controls preload="none" src="${esc(it.media)}"></audio>` +
          `<div class="finder-acts"><select class="fa-kind"><option value="sfx">Sound FX</option><option value="ambient">Ambient (loops)</option></select>` +
          `<button class="fa-add">＋ Add to soundboard</button></div></div>`;
        card.querySelector(".fa-add").addEventListener("click", (ev) => { socket.emit("saveSound", { name: it.title, url: it.media, kind: card.querySelector(".fa-kind").value }); ev.target.textContent = "Added ✓"; ev.target.disabled = true; });
      }
      results.appendChild(card);
    });
  });

  // --- AI map generation results ---
  socket.on("mapGenBusy", () => { /* spinner already shown by generate() */ });
  socket.on("mapGenError", (msg) => { clearTimeout(pending); results.innerHTML = `<p class="muted">${esc(msg || "Map generation failed.")}</p>`; });
  socket.on("mapGenDone", ({ url, name }) => {
    clearTimeout(pending);
    if (kind !== "maps") return;
    results.innerHTML = "";
    const card = document.createElement("div");
    card.className = "finder-card";
    card.innerHTML =
      `<img class="finder-thumb" src="${esc(url)}" alt="" />` +
      `<div class="finder-info"><div class="finder-title-t">${esc(name || "AI map")}</div>` +
      `<div class="finder-meta">Generated with AI · already saved to your map library</div>` +
      `<div class="finder-acts"><button class="fa-use">Use now</button><button class="fa-again btn-secondary">Generate another</button></div></div>`;
    card.querySelector(".fa-use").addEventListener("click", () => { socket.emit("setMap", url); });
    card.querySelector(".fa-again").addEventListener("click", generate);
    results.appendChild(card);
  });
}
