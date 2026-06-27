// Party loot tracker. Everyone sees the hoard; the DM adds/edits/removes items and sets gold.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initLoot(socket) {
  const list = document.getElementById("loot-list");
  const goldVal = document.getElementById("loot-gold-val");
  const totalEl = document.getElementById("loot-total");
  let items = [];

  function render() {
    if (!list) return;
    let total = 0;
    if (!items.length) { list.innerHTML = '<p class="muted">No loot yet.</p>'; }
    else {
      list.innerHTML = "";
      for (const it of items) {
        total += (it.qty || 1) * (it.value || 0);
        const row = document.createElement("div");
        row.className = "loot-row";
        row.innerHTML =
          `<span class="loot-q">${it.qty || 1}×</span>` +
          `<span class="loot-n">${esc(it.name)}</span>` +
          `<span class="loot-v">${it.value ? it.value + " gp ea" : ""}</span>` +
          `<span class="loot-h">${it.holder ? "→ " + esc(it.holder) : ""}</span>`;
        if (window.isDM) {
          const del = document.createElement("button");
          del.className = "loot-del"; del.textContent = "✕"; del.title = "Remove";
          del.addEventListener("click", () => socket.emit("deleteLoot", it.id));
          row.appendChild(del);
          row.style.cursor = "pointer"; row.title = "Click to edit qty/value/holder";
          row.addEventListener("click", (ev) => {
            if (ev.target === del) return;
            const qty = Number(prompt("Quantity", it.qty || 1));
            if (Number.isNaN(qty)) return;
            const value = Number(prompt("Value (gp each)", it.value || 0));
            const holder = prompt("Held by", it.holder || "");
            socket.emit("saveLoot", { id: it.id, name: it.name, qty, value, holder, notes: it.notes });
          });
        }
        list.appendChild(row);
      }
    }
    if (totalEl) totalEl.textContent = total;
  }

  document.getElementById("loot-add-btn")?.addEventListener("click", () => {
    const name = document.getElementById("loot-name");
    if (!name.value.trim()) return;
    socket.emit("saveLoot", {
      name: name.value.trim(),
      qty: Number(document.getElementById("loot-qty").value) || 1,
      value: Number(document.getElementById("loot-value").value) || 0,
      holder: document.getElementById("loot-holder").value.trim(),
    });
    name.value = ""; document.getElementById("loot-holder").value = "";
    document.getElementById("loot-qty").value = "1"; document.getElementById("loot-value").value = "0";
  });
  document.getElementById("loot-gold-set")?.addEventListener("click", () => {
    socket.emit("setGold", Number(document.getElementById("loot-gold-input").value) || 0);
  });

  function setGold(n) { if (goldVal) goldVal.textContent = n || 0; }
  socket.on("state", (s) => { items = s.loot || []; setGold(s.gold); render(); });
  socket.on("loot", (l) => { items = l || []; render(); });
  socket.on("gold", setGold);
}
