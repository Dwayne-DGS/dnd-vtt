// Soundboard: the DM plays ambient loops and one-shot sound effects that the
// whole table hears. Everyone gets a local mute toggle. Sounds are a shared
// library (upload audio or paste a URL).

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function uploadAudio(file) {
  const r = await fetch("/upload", { method: "POST", headers: { "content-type": file.type }, body: file });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Upload failed"); }
  return (await r.json()).url;
}

export function initSound(socket) {
  const ambient = document.getElementById("ambient");
  let muted = false;

  // Playback — everyone.
  socket.on("sound", ({ url, kind }) => {
    if (muted) return;
    if (kind === "ambient") { ambient.src = url; ambient.volume = 0.5; ambient.play().catch(() => {}); }
    else { const a = new Audio(url); a.volume = 0.75; a.play().catch(() => {}); }
  });
  socket.on("stopAmbient", () => ambient.pause());

  const muteBtn = document.getElementById("mute-btn");
  muteBtn?.addEventListener("click", () => {
    muted = !muted; ambient.muted = muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
  });

  // DM controls.
  const file = document.getElementById("snd-file");
  document.getElementById("snd-upload")?.addEventListener("click", () => file.click());
  file?.addEventListener("change", async () => {
    const f = file.files[0]; file.value = "";
    if (!f) return;
    try { document.getElementById("snd-url").value = await uploadAudio(f); } catch (e) { alert(e.message); }
  });
  document.getElementById("snd-save")?.addEventListener("click", () => {
    const name = document.getElementById("snd-name").value.trim();
    const url = document.getElementById("snd-url").value.trim();
    const kind = document.getElementById("snd-kind").value;
    if (!url) { alert("Upload an audio file or paste a URL first."); return; }
    socket.emit("saveSound", { name, url, kind });
    document.getElementById("snd-name").value = ""; document.getElementById("snd-url").value = "";
  });
  document.getElementById("snd-stop")?.addEventListener("click", () => socket.emit("stopAmbient"));

  socket.on("soundList", (sounds) => {
    const box = document.getElementById("snd-list");
    if (!box) return;
    box.innerHTML = "";
    sounds.forEach((s) => {
      const row = document.createElement("div");
      row.className = "snd-row";
      row.innerHTML = `<span class="snd-nm">${esc(s.name)} <em>${s.kind}</em></span><button data-a="play" title="Play for everyone">▶</button><button class="btn-secondary" data-a="del" title="Remove">✕</button>`;
      row.querySelector('[data-a="play"]').addEventListener("click", () => socket.emit("playSound", { url: s.url, kind: s.kind }));
      row.querySelector('[data-a="del"]').addEventListener("click", () => { if (confirm(`Remove "${s.name}"?`)) socket.emit("deleteSound", s.id); });
      box.appendChild(row);
    });
  });
  socket.emit("listSounds");
}
