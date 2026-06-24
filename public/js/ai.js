// AI assistant tab. Sends the prompt to the server, which calls Claude and
// either saves a character/creature (appears in its tab) or returns text.

export function initAI(socket) {
  const promptEl = document.getElementById("ai-prompt");
  const out = document.getElementById("ai-output");

  document.querySelectorAll("[data-ai]").forEach((b) =>
    b.addEventListener("click", () => {
      const prompt = promptEl.value.trim();
      if (!prompt) { out.textContent = "Type a description or question first."; return; }
      out.textContent = "✨ Thinking…";
      socket.emit("aiRequest", { mode: b.dataset.ai, prompt });
    })
  );

  socket.on("aiBusy", () => { out.textContent = "✨ Working on it… (a few seconds)"; });
  socket.on("aiDone", ({ message }) => { out.textContent = "✅ " + message; });
  socket.on("aiAnswer", ({ text }) => { out.textContent = text; }); // textContent = no HTML injection
  socket.on("aiError", (msg) => { out.textContent = "⚠️ " + msg; });
}
