// In-app Help & Guide. A searchable overlay that documents every screen, tab,
// and button in the tabletop. Content is authored as sections below; sections
// marked dm:true are tagged "DM" but shown to everyone so players understand
// what their Game Master can do.

const SECTIONS = [
  {
    id: "start", title: "Getting started", body: `
      <p>Welcome to your virtual tabletop! Here's the quick version:</p>
      <ul>
        <li><b>Create an account</b> and log in. Everyone starts as a <b>Player</b>.</li>
        <li>To run games, ask an admin for <b>Game Master</b> access (see Accounts &amp; roles).</li>
        <li>From the dashboard, <b>join a table</b> a friend shared, or <b>create</b> one if you're a GM.</li>
        <li>Inside a table you'll see the <b>map</b> in the middle, a <b>top toolbar</b>, the <b>dice bar</b> below the chat (lower-right), and the <b>sidebar tabs</b> on the right.</li>
      </ul>
      <p>Tip: hover almost any button in the app and a little tooltip tells you what it does.</p>` },

  {
    id: "roles", title: "Accounts & roles", body: `
      <p>There are three kinds of accounts:</p>
      <ul>
        <li><b>Player</b> — the default. Can join tables, roll dice, keep character sheets, chat, and use voice.</li>
        <li><b>Game Master (GM)</b> — everything a player can do, plus create and run tables (maps, fog, tokens, lighting, effects, etc.).</li>
        <li><b>Admin</b> — manages all accounts (the first account created is the admin).</li>
      </ul>
      <p>New here? Sign up with your name, email, and a username/password. To become a GM, click
      <b>"Request Game Master access"</b> on the dashboard — an admin approves it.</p>` },

  {
    id: "dashboard", title: "Your tables (dashboard)", body: `
      <p>After logging in you land on the dashboard:</p>
      <ul>
        <li><b>Your tables</b> — every game you own or have joined. Click one to jump straight in.</li>
        <li><b>Join a new table</b> — enter a table name and its invite password (ask your GM). After the first join it appears in "Your tables".</li>
        <li><b>Create a table</b> (GMs) — name it and optionally set an invite password to share with players.</li>
        <li><b>Delete a table</b> — on a table you own, click the 🗑 on its row in "Your tables" to remove it and all its data.</li>
        <li><b>⚙ Settings</b>, <b>Request GM access</b>, <b>Manage accounts</b> / <b>Manage all tables</b> (admin), and <b>Log out</b> live here too.</li>
      </ul>` },

  {
    id: "map", title: "The map: moving around", body: `
      <p>The map fills the center of the screen.</p>
      <ul>
        <li><b>Pan</b> — click and drag empty space.</li>
        <li><b>Zoom</b> — scroll the mouse wheel (zooms toward the cursor).</li>
        <li><b>⟲ View</b> — resets zoom and pan back to default.</li>
      </ul>
      <p>What you see stays in sync for everyone at the table in real time.</p>` },

  {
    id: "tokens", title: "Tokens", dm: true, body: `
      <p>Tokens are the figures on the map (characters, monsters, props).</p>
      <ul>
        <li><b>+ Token</b> — drop a new token. <b>+ 📷</b> adds one with a portrait image.</li>
        <li><b>Move</b> — drag a token. With <b>▦ Snap</b> on, it snaps to the grid when you drop it.</li>
        <li><b>Double-click</b> a token to edit it; <b>right-click</b> opens its menu (HP, size, delete, etc.).</li>
        <li>Tokens show a <b>name label</b> and an <b>HP bar</b> when set. You can also drag creatures from the <b>Bestiary</b> straight onto the map.</li>
      </ul>` },

  {
    id: "mapctl", title: "DM map controls (top-bar menus)", dm: true, body: `
      <p>Game Master tools are grouped into labeled dropdown menus in the top bar — click one to open it. Only one opens at a time; click a button to use it, or click away / press Esc to close.</p>
      <ul>
        <li><b>🗺 Map</b> — pick or remove a saved map; paste a map URL and <b>Set map</b>; <b>★ Save</b> to your library; <b>⬆ Upload</b> from your computer; <b>⟳ Rotate</b>; and the <b>⊞ Grid</b> toggle with <b>−</b>/<b>+</b> sizing.</li>
        <li><b>🧩 Tokens</b> — add a token, or one with a portrait image.</li>
        <li><b>🌫 Fog</b> — fog on/off, Reveal, Reset fog.</li>
        <li><b>🎨 Draw</b> — freehand draw, spell templates (shape + size), clear, and weather.</li>
        <li><b>💡 Lighting</b> — walls, light sources (radius), and the lighting toggle.</li>
        <li><b>🎭 Table</b> — manage players and show a handout.</li>
      </ul>
      <p>Always-visible (for everyone): <b>▦ Snap</b>, <b>📏 Measure</b>, and <b>⟲ View</b> (reset zoom/pan).</p>` },

  {
    id: "fog", title: "Fog of war", dm: true, body: `
      <p>Hide unexplored parts of the map from players:</p>
      <ul>
        <li><b>🌫 Fog</b> — turn fog on/off. With it on, players only see revealed areas.</li>
        <li><b>Reveal</b> — paint to uncover areas as the party explores (drag on the map).</li>
        <li><b>Reset fog</b> — hide the whole map again.</li>
      </ul>` },

  {
    id: "draw", title: "Drawing & spell templates", dm: true, body: `
      <p>Mark up the map on the fly:</p>
      <ul>
        <li><b>✏️ Draw</b> — freehand draw on the map.</li>
        <li><b>🔺 Template</b> — place a spell area. Choose the <b>shape</b> (circle or cone) and the <b>size in feet</b>, then click/drag on the map.</li>
        <li><b>🧹</b> — clear drawings, templates, walls, and lights.</li>
      </ul>` },

  {
    id: "lighting", title: "Dynamic lighting & line-of-sight", dm: true, body: `
      <p>Make light and shadow behave realistically:</p>
      <ul>
        <li><b>🧱 Walls</b> — drag to draw walls that block light.</li>
        <li><b>💡 Light</b> — click to drop a light source; the <b>ft</b> box sets its radius.</li>
        <li><b>🌑 Lighting</b> — toggles the whole system. Players see darkness with light pools shaped by your walls; you see a dimmer version plus the markers.</li>
      </ul>
      <p>Lighting is off by default so it never interferes with normal play.</p>` },

  {
    id: "weather", title: "Weather effects", dm: true, body: `
      <p>The <b>weather dropdown</b> overlays animated rain, snow, or mist on the map for everyone (or clear skies to turn it off).</p>` },

  {
    id: "players", title: "Players & handouts", dm: true, body: `
      <ul>
        <li><b>👥 Players</b> — manage who can join this table: add player emails to the allow-list or set an invite password.</li>
        <li><b>🖼 Show</b> — display an image (a map, a letter, a portrait) full-screen to everyone at the table.</li>
      </ul>` },

  {
    id: "dice", title: "Rolling dice", body: `
      <p>The <b>dice bar</b> sits just below the chat (lower-right). Click a die (d20, d12, d10, d8, d6, d4) to roll it — the result drops into chat and animates on screen.</p>
      <ul>
        <li><b>Advantage / Disadvantage</b> — toggle these before rolling to roll twice and keep the higher/lower.</li>
        <li><b>Secret</b> — a secret roll is shown only to you and the DM.</li>
        <li><b>Macros</b> — save frequent rolls as one-click buttons (e.g. "Longsword: 1d20+5"). Click <b>＋ macro</b> to add one; right-click a macro to delete it.</li>
        <li>You can type dice notation in chat too, like <code>2d6+3</code>.</li>
      </ul>
      <p>Dice come in <b>skins</b> and can roll as <b>true 3D physics dice</b> or a lighter 2D animation — both set in Settings.</p>` },

  {
    id: "chat", title: "Chat", body: `
      <p>The <b>Chat</b> tab is your table's message log — typed messages, dice results (with a matching mini-die icon), and system notices like who joined or left.</p>` },

  {
    id: "pcs", title: "Character sheets (PCs)", body: `
      <p>The <b>PCs</b> tab holds D&amp;D 5e character sheets.</p>
      <ul>
        <li>Create a character, fill in abilities, AC, HP, skills, spells and equipment.</li>
        <li>Open the <b>full sheet</b> for the complete layout.</li>
        <li>Sheets save to the table, so they're there next session.</li>
        <li>Short on time? The <b>✨ AI</b> tab can build a complete, rules-legal character from a description.</li>
      </ul>` },

  {
    id: "initiative", title: "Initiative tracker", body: `
      <p>The <b>Initiative</b> tab runs combat order. Add combatants, sort by initiative, and step through turns. GMs can <b>roll initiative for everyone</b> at once, and the active combatant's token is highlighted on the map.</p>` },

  {
    id: "bestiary", title: "Bestiary", body: `
      <p>The <b>Bestiary</b> tab is your monster/NPC reference. Keep stat blocks handy and <b>drag a creature onto the map</b> to drop it in as a token.</p>` },

  {
    id: "refs", title: "Quick reference (Refs)", body: `
      <p>The <b>Refs</b> tab looks up spells and magic items and opens the D&amp;D 5e wiki in a new tab, with quick links to spell lists, items, conditions, and more.</p>` },

  {
    id: "fx", title: "Lighting effects, soundboard & Hue (FX)", dm: true, body: `
      <p>The <b>FX</b> tab (GM only) is your atmosphere control:</p>
      <ul>
        <li><b>Lighting effects</b> — fire 🔥 Fire, ⚡ Lightning, 💚 Healing, etc. Everyone's screen flashes the effect color, and if the Philips Hue helper is running, your real lights react too.</li>
        <li><b>Philips Hue helper</b> — shows whether the helper is connected and gives an <b>Open setup</b> link to its config page. (See "Philips Hue lights".)</li>
        <li><b>Soundboard</b> — add ambient loops and sound effects (upload or paste a URL) and play them for the whole table; <b>⏹ Stop ambient</b> ends the loop.</li>
      </ul>` },

  {
    id: "ai", title: "AI assistant", body: `
      <p>The <b>✨ AI</b> tab is a built-in helper for D&amp;D 5e. Ask it to build characters, generate monsters/NPCs, answer rules questions, or brainstorm encounter ideas. (Requires the server's AI key to be set up.)</p>` },

  {
    id: "journal", title: "Journal & session notes", body: `
      <p>The <b>📖 Journal</b> tab keeps notes and lore. The GM writes notes, each with a <b>"Share with players"</b> toggle — players only see shared notes, while private GM notes stay hidden. Click a note to edit it.</p>` },

  {
    id: "loot", title: "Party loot", body: `
      <p>The <b>💰 Loot</b> tab tracks the party hoard: items with quantity, value, and who's carrying them, plus a running total and a party-gold field. Everyone sees it; the GM adds and edits entries.</p>` },

  {
    id: "timer", title: "Turn timer", body: `
      <p>The floating <b>turn timer</b> at the top keeps turns moving. The GM sets a number of seconds (and an optional label) and starts it; everyone sees the same countdown. It glows amber in the last 10 seconds and red at zero.</p>` },

  {
    id: "voice", title: "Voice & video", body: `
      <p>Use the <b>🎤 Join voice</b> controls to talk (and optionally share video) with your table right in the browser. Voice needs a secure (HTTPS) connection, which your table already uses.</p>` },

  {
    id: "settings", title: "Settings", body: `
      <p>Open <b>⚙ Settings</b> from the dashboard:</p>
      <ul>
        <li><b>Dice style</b> — pick a skin (Galaxy, Crimson, Emerald, Amber, Frost, Obsidian). Saved to your account and used wherever you roll.</li>
        <li><b>3D physics dice</b> — on for tumbling 3D dice, off for the lighter 2D animation (also auto-falls back if your device can't do 3D).</li>
      </ul>
      <p>The <b>🔊 mute</b> button in the top bar silences table sounds for you only.</p>` },

  {
    id: "hue", title: "Philips Hue lights", dm: true, body: `
      <p>The optional <b>Hue helper</b> runs on a small computer (like a Raspberry Pi) on the same network as your Hue Bridge and flashes your real lights to match spell effects.</p>
      <ul>
        <li>Open its setup page (the <b>Open setup</b> link in the FX tab, or <code>http://&lt;device-ip&gt;:8765</code>).</li>
        <li>Use its <b>Connection check</b> to confirm it's on the network and can reach the internet, the game, and the bridge.</li>
        <li>On a Pi it can <b>start automatically on boot</b> — run the included <code>install-service.sh</code> once.</li>
      </ul>` },

  {
    id: "admin", title: "Admin", dm: true, body: `
      <ul>
        <li><b>Manage accounts</b> (admin) — see all accounts, change roles (Player / Game Master / Admin), reset passwords, and approve Game Master requests.</li>
        <li><b>Manage all tables</b> (admin) — view every table with its owner and delete any of them.</li>
        <li><b>Owner account</b> — the first account created is the owner. Other admins can manage everyone else but can't change, reset, or delete the owner's account.</li>
      </ul>` },
];

export function initHelp() {
  const overlay = document.getElementById("help-overlay");
  const nav = document.getElementById("help-nav");
  const content = document.getElementById("help-content");
  const search = document.getElementById("help-search");
  if (!overlay || !nav || !content) return;

  // Build nav + content once.
  nav.innerHTML = "";
  content.innerHTML = "";
  SECTIONS.forEach((s) => {
    const link = document.createElement("button");
    link.className = "help-navlink";
    link.dataset.id = s.id;
    link.innerHTML = `${s.title}${s.dm ? ' <span class="help-dm">DM</span>' : ""}`;
    link.addEventListener("click", () => {
      const el = document.getElementById("help-sec-" + s.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(link);

    const sec = document.createElement("section");
    sec.className = "help-section";
    sec.id = "help-sec-" + s.id;
    sec.innerHTML = `<h3>${s.title}${s.dm ? ' <span class="help-dm">DM</span>' : ""}</h3>${s.body}`;
    content.appendChild(sec);
  });

  // Search filters both the nav and the sections by their text.
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    SECTIONS.forEach((s) => {
      const sec = document.getElementById("help-sec-" + s.id);
      const link = nav.querySelector(`.help-navlink[data-id="${s.id}"]`);
      const hit = !q || (s.title + " " + sec.textContent).toLowerCase().includes(q);
      sec.style.display = hit ? "" : "none";
      if (link) link.style.display = hit ? "" : "none";
    });
  });

  const open = () => { overlay.classList.remove("hidden"); content.scrollTop = 0; search && (search.value = "", search.dispatchEvent(new Event("input"))); };
  const close = () => overlay.classList.add("hidden");
  document.getElementById("help-btn")?.addEventListener("click", open);
  document.getElementById("help-link")?.addEventListener("click", open);
  document.getElementById("help-close")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) close(); });
}
