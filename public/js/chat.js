// Chat log + dice. Typing something like "2d6+3" in the box rolls it;
// anything else is sent as a chat message. The quick-dice buttons roll a single die.

import { dieIconHTML } from "./dice.js";

export function initChat(socket) {
  const log = document.getElementById("chat-log");
  const input = document.getElementById("chat-text");
  const send = document.getElementById("chat-send");

  // Detect dice notation, e.g. d20, 2d6+3, 1d8-1, 3d6+2d4
  const DICE_RE = /^\s*\d*d\d+([+-]\d*d?\d+)*\s*$/i;

  function append(m) {
    const div = document.createElement("div");
    if (m.type === "system") {
      div.className = "msg system";
      div.textContent = m.text;
    } else if (m.type === "roll") {
      div.className = "msg roll";
      // Pick the die icon from the rolled notation (first dN found; default d20).
      const note = (m.text.match(/rolled\s+(\S+)/) || [])[1] || "";
      const sides = parseInt((note.match(/d(\d+)/) || [])[1] || "20", 10);
      div.innerHTML =
        dieIconHTML(sides) +
        `<div class="roll-body"><span class="who">${esc(m.who)}</span> ${esc(m.text.split("=")[0])}` +
        `= <span class="total">${esc(m.text.split("=")[1] || "")}</span>` +
        `<div class="detail">${esc(m.detail || "")}</div></div>`;
    } else {
      div.className = "msg";
      div.innerHTML = `<span class="who">${esc(m.who)}:</span> ${esc(m.text)}`;
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    if (DICE_RE.test(text)) socket.emit("roll", text, window.rollOpts || {});
    else socket.emit("chat", text);
    input.value = "";
  }

  send.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  // (Dice-bar buttons + their roll animation are handled in dice.js.)

  socket.on("chat", append);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
