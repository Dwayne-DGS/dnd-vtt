// Turn timer. DM starts a countdown; everyone sees the same clock (driven locally
// from the shared end-time so it stays smooth without per-second network traffic).
export function initTimer(socket) {
  const box = document.getElementById("turn-timer");
  const clock = document.getElementById("timer-clock");
  const labelEl = document.getElementById("timer-label");
  let state = { running: false, endsAt: 0, duration: 60, label: "" };
  let tick = null;

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function paint() {
    labelEl.textContent = state.label || "";
    if (state.running) {
      const left = state.endsAt - Date.now();
      clock.textContent = fmt(left);
      box.classList.toggle("timer-warn", left <= 10000 && left > 0);
      box.classList.toggle("timer-done", left <= 0);
    } else {
      clock.textContent = "0:00";
      box.classList.remove("timer-warn", "timer-done");
    }
  }
  function show() {
    // DM always sees it (to start/stop); players only while a timer is running.
    const visible = window.isDM || state.running;
    box.classList.toggle("hidden", !visible);
  }
  function loop() {
    clearInterval(tick);
    if (state.running) tick = setInterval(paint, 250);
    paint();
  }

  document.getElementById("timer-start")?.addEventListener("click", () => {
    socket.emit("startTimer", {
      duration: Number(document.getElementById("timer-secs").value) || 60,
      label: document.getElementById("timer-label-in").value.trim(),
    });
  });
  document.getElementById("timer-stop")?.addEventListener("click", () => socket.emit("stopTimer"));

  function apply(t) { state = t || state; show(); loop(); }
  socket.on("state", (s) => apply(s.timer));
  socket.on("timer", apply);
  socket.on("role", () => show());
}
