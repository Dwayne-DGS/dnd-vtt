// Lightweight styled tooltips. Upgrades every native `title` into a nicer hover
// bubble (and suppresses the slow browser default), supports `data-tip` on any
// element, and exposes window.tipShow/tipHide so the canvas can show tips for
// map objects like tokens. Uses event delegation, so dynamically-added buttons
// get tooltips automatically.

let tipEl = null;

function ensure() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "tooltip hidden";
  document.body.appendChild(tipEl);
  return tipEl;
}

// Show near a point. Prefers above the point; flips below if it would clip.
function showAt(text, x, y, anchorH = 0) {
  if (!text) return;
  const el = ensure();
  el.textContent = text;
  el.classList.remove("hidden");
  const r = el.getBoundingClientRect();
  let left = x - r.width / 2;
  let top = y - r.height - 10;
  if (top < 6) top = y + anchorH + 12;            // flip below if no room above
  left = Math.max(6, Math.min(left, window.innerWidth - r.width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - r.height - 6));
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function hide() { if (tipEl) tipEl.classList.add("hidden"); }

export function initTooltips() {
  ensure();
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip],[title]");
    if (!t) return;
    // Move any native title onto data-tip once, so the browser's own tooltip
    // never appears and we control the styling.
    if (t.hasAttribute("title")) {
      const v = t.getAttribute("title");
      if (v) t.setAttribute("data-tip", v);
      t.removeAttribute("title");
    }
    const text = t.getAttribute("data-tip");
    if (!text) return;
    const r = t.getBoundingClientRect();
    showAt(text, r.left + r.width / 2, r.top, r.height);
  });
  document.addEventListener("mouseout", (e) => {
    const from = e.target.closest && e.target.closest("[data-tip]");
    if (!from) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]");
    if (to === from) return; // moving within the same element — keep it shown
    hide();
  });
  // Don't let a tip linger over a click or while scrolling.
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("scroll", hide, true);

  // For canvas-drawn objects (tokens, etc.).
  window.tipShow = (text, x, y) => showAt(text, x, y, 14);
  window.tipHide = hide;
}
