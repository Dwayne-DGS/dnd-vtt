// Journal / session notes. DM authors notes; players see only the "shared" ones.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initJournal(socket) {
  const list = document.getElementById("journal-list");
  const editor = document.getElementById("journal-editor");
  const eTitle = document.getElementById("je-title");
  const eBody = document.getElementById("je-body");
  const eShared = document.getElementById("je-shared");
  let entries = [];
  let editingId = null;

  function render() {
    if (!list) return;
    if (!entries.length) { list.innerHTML = '<p class="muted">No notes yet.</p>'; return; }
    list.innerHTML = "";
    for (const e of entries) {
      const card = document.createElement("div");
      card.className = "journal-card";
      const when = e.updatedAt ? new Date(e.updatedAt).toLocaleString() : "";
      card.innerHTML =
        `<div class="journal-head"><strong>${esc(e.title) || "(untitled)"}</strong>` +
        `${e.shared ? '<span class="badge-share">shared</span>' : ""}</div>` +
        `<div class="journal-body">${esc(e.body).replace(/\n/g, "<br>")}</div>` +
        `<div class="journal-meta">${when}</div>`;
      if (window.isDM) {
        card.style.cursor = "pointer";
        card.title = "Click to edit";
        card.addEventListener("click", () => openEditor(e));
      }
      list.appendChild(card);
    }
  }

  function openEditor(e) {
    editingId = e ? e.id : null;
    eTitle.value = e ? e.title : "";
    eBody.value = e ? e.body : "";
    eShared.checked = e ? !!e.shared : false;
    document.getElementById("je-delete").style.display = e ? "" : "none";
    editor.classList.remove("hidden");
    eTitle.focus();
  }
  function closeEditor() { editor.classList.add("hidden"); editingId = null; }

  document.getElementById("journal-new")?.addEventListener("click", () => openEditor(null));
  document.getElementById("je-cancel")?.addEventListener("click", closeEditor);
  document.getElementById("je-save")?.addEventListener("click", () => {
    socket.emit("saveJournal", { id: editingId, title: eTitle.value.trim(), body: eBody.value, shared: eShared.checked });
    closeEditor();
  });
  document.getElementById("je-delete")?.addEventListener("click", () => {
    if (editingId && confirm("Delete this note?")) socket.emit("deleteJournal", editingId);
    closeEditor();
  });

  socket.on("state", (s) => { entries = s.journal || []; render(); });
  socket.on("journal", (l) => { entries = l || []; render(); });
}
