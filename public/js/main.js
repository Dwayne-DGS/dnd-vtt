// Orchestrator: handles the join screen, connects the socket, wires tabs,
// and boots the map / chat / character modules.

import { initMap } from "./map.js";
import { initChat } from "./chat.js";
import { initCharacters } from "./character.js";
import { initInitiative } from "./initiative.js";
import { initBestiary } from "./bestiary.js";
import { initReference } from "./reference.js";
import { initVoice } from "./voice.js";
import { initFX } from "./fx.js";
import { initAI } from "./ai.js";
import { initDice, SKINS, previewDie, applySkin, currentSkin } from "./dice.js";
import { initSound } from "./sound.js";
import { initWeather } from "./weather.js";
import { initJournal } from "./journal.js";
import { initLoot } from "./loot.js";
import { initTimer } from "./timer.js";
import { initDice3d, setDice3dEnabled } from "./dice3d.js";
import { initHelp } from "./help.js";
import { initTooltips } from "./tooltip.js";
import { initFinder } from "./finder.js";

const socket = io({ autoConnect: false });

const authScreen = document.getElementById("auth-screen");
const joinScreen = document.getElementById("join-screen");
const app = document.getElementById("app");

// --- Account gate --------------------------------------------------------
window.account = null;

function showAuth() {
  authScreen.classList.remove("hidden");
  joinScreen.classList.add("hidden");
  app.classList.add("hidden");
}
function showLanding(user) {
  window.account = user;
  authScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  document.getElementById("welcome").textContent = "⚔️ Welcome, " + (user.name || user.username);
  // Only GMs / admins may create tables.
  const canCreate = user.role === "gm" || user.role === "admin";
  document.getElementById("mode-create").classList.toggle("hidden", !canCreate);
  if (!canCreate) document.getElementById("mode-join").click();
  const isAdmin = user.role === "admin";
  document.getElementById("accounts-link").classList.toggle("hidden", !isAdmin);
  document.getElementById("tables-admin-link").classList.toggle("hidden", !isAdmin);
  document.querySelector(".dash-admin").classList.toggle("hidden", !isAdmin); // hide the whole admin row for non-admins
  // Trial / subscription banner for Game Masters.
  renderTrialBanner(user);
  renderVerifyBanner(user);
  // Players can request GM access (hidden once they're GM/admin).
  const reqBtn = document.getElementById("request-gm");
  reqBtn.classList.toggle("hidden", user.role !== "player");
  if (user.gmRequested) { reqBtn.textContent = "Game Master access requested ✓"; reqBtn.disabled = true; }
  // Load this account's tables for the dashboard list.
  socket.connect();
  socket.emit("myTables");
  if (user.role === "admin") socket.emit("adminUsers"); // refreshes the pending badge (won't open the panel)
}

// --- Settings (dice skins) ----------------------------------------------
const settingsOverlay = document.getElementById("settings-overlay");
const skinGrid = document.getElementById("skin-grid");
document.getElementById("settings-link").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", () => settingsOverlay.classList.add("hidden"));
function openSettings() {
  const cur = (window.account && window.account.diceSkin) || currentSkin();
  skinGrid.innerHTML = "";
  Object.entries(SKINS).forEach(([id, sk]) => {
    const card = document.createElement("button");
    card.className = "skin-card" + (id === cur ? " selected" : "");
    card.innerHTML = previewDie(id) + `<span>${sk.name}</span>`;
    card.addEventListener("click", () => {
      applySkin(id);
      if (window.account) window.account.diceSkin = id;
      socket.connect();
      socket.emit("setDiceSkin", id);
      openSettings();
    });
    skinGrid.appendChild(card);
  });
  const d3 = document.getElementById("set-dice3d");
  if (d3) {
    d3.checked = !(window.account && window.account.dice3d === 0);
    d3.onchange = () => {
      setDice3dEnabled(d3.checked);
      if (window.account) window.account.dice3d = d3.checked ? 1 : 0;
      socket.connect();
      socket.emit("setDice3d", d3.checked);
    };
  }
  // Prefill the account fields.
  const a = window.account || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
  set("acc-name", a.name); set("acc-email", a.email); set("acc-billing", a.billingEmail);
  set("acc-address", a.address); set("acc-phone", a.phone);
  document.getElementById("acc-msg").textContent = "";
  document.getElementById("pw-msg").textContent = "";
  // SSO-only accounts have no password to "change" with a current one.
  document.getElementById("pw-block").style.display = a.isSSO ? "none" : "";
  settingsOverlay.classList.remove("hidden");
}
// Save account details.
document.getElementById("acc-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("acc-msg");
  msg.textContent = "Saving…";
  try {
    const { user } = await authPost("/auth/profile", {
      name: document.getElementById("acc-name").value,
      email: document.getElementById("acc-email").value,
      billingEmail: document.getElementById("acc-billing").value,
      address: document.getElementById("acc-address").value,
      phone: document.getElementById("acc-phone").value,
    });
    window.account = user;
    msg.textContent = "Saved ✓";
  } catch (e) { msg.textContent = e.message; }
});
// Change password.
document.getElementById("pw-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("pw-msg");
  msg.textContent = "Updating…";
  try {
    await authPost("/auth/change-password", {
      current: document.getElementById("pw-current").value,
      next: document.getElementById("pw-new").value,
    });
    document.getElementById("pw-current").value = "";
    document.getElementById("pw-new").value = "";
    msg.textContent = "Password updated ✓";
  } catch (e) { msg.textContent = e.message; }
});

initHelp(); // Help & Guide overlay (buttons exist on both the dashboard and the in-game top bar).
initTooltips(); // Styled hover tooltips for every control (upgrades native titles).

// Top-bar dropdown menus: each .menu has a trigger + a popover panel. One open at
// a time; clicking a button inside performs its action and closes the menu, while
// inputs/selects keep it open. Outside-click and Esc close everything.
(function wireMenus() {
  const closeAll = () => {
    document.querySelectorAll(".menu-panel.open").forEach((p) => p.classList.remove("open"));
    document.querySelectorAll(".menu-trigger.active").forEach((t) => t.classList.remove("active"));
  };
  document.querySelectorAll(".menu").forEach((menu) => {
    const trigger = menu.querySelector(".menu-trigger");
    const panel = menu.querySelector(".menu-panel");
    if (!trigger || !panel) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = panel.classList.contains("open");
      closeAll();
      if (!wasOpen) { panel.classList.add("open"); trigger.classList.add("active"); }
    });
    panel.addEventListener("click", (e) => { if (e.target.closest("button")) closeAll(); else e.stopPropagation(); });
  });
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
})();
document.getElementById("request-gm").addEventListener("click", () => { socket.connect(); socket.emit("requestGm"); });
socket.on("gmRequested", () => {
  const b = document.getElementById("request-gm");
  b.textContent = "Game Master access requested ✓"; b.disabled = true;
});

// Render the "Your tables" list; click one to jump straight in.
socket.on("myTablesList", (tables) => {
  const box = document.getElementById("my-tables");
  box.innerHTML = "";
  if (!tables.length) { box.innerHTML = "<p class='join-hint' style='margin:0 0 8px'>No tables yet. Create one below, or join a friend's with its name + invite password.</p>"; return; }
  tables.forEach((t) => {
    const row = document.createElement("div");
    row.className = "table-row";
    const open = document.createElement("button");
    open.className = "table-open";
    open.innerHTML = `<span>${escAcct(t.id)}</span><span class="table-role">${t.role === "gm" ? "GM" : "Player"}</span>`;
    open.addEventListener("click", () => { socket.connect(); socket.emit("enterTable", { room: t.id }); });
    row.appendChild(open);
    if (t.role === "gm") { // owners can delete their own table
      const del = document.createElement("button");
      del.className = "table-del"; del.textContent = "🗑"; del.title = "Delete this table";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`Delete table "${t.id}"? This permanently removes its maps, tokens, characters, monsters, and notes.`)) {
          socket.connect(); socket.emit("deleteTable", t.id);
        }
      });
      row.appendChild(del);
    }
    box.appendChild(row);
  });
});
async function authPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}
function logout() { fetch("/auth/logout", { method: "POST" }).then(() => { location.href = "/"; }); }

// Auth screen tabs
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const authErr = document.getElementById("auth-error");
document.getElementById("auth-mode-login").addEventListener("click", (e) => {
  e.target.classList.add("active"); document.getElementById("auth-mode-signup").classList.remove("active");
  loginForm.classList.remove("hidden"); signupForm.classList.add("hidden"); authErr.textContent = "";
});
document.getElementById("auth-mode-signup").addEventListener("click", (e) => {
  e.target.classList.add("active"); document.getElementById("auth-mode-login").classList.remove("active");
  signupForm.classList.remove("hidden"); loginForm.classList.add("hidden"); authErr.textContent = "";
});
document.getElementById("login-btn").addEventListener("click", async () => {
  authErr.textContent = "";
  try {
    const { user } = await authPost("/auth/login", {
      username: document.getElementById("login-user").value,
      password: document.getElementById("login-pass").value,
    });
    showLanding(user);
  } catch (e) { authErr.textContent = e.message; }
});
document.getElementById("signup-btn").addEventListener("click", async () => {
  authErr.textContent = "";
  try {
    const { user } = await authPost("/auth/signup", {
      name: document.getElementById("signup-name").value,
      email: document.getElementById("signup-email").value,
      username: document.getElementById("signup-user").value,
      password: document.getElementById("signup-pass").value,
    });
    showLanding(user);
  } catch (e) { authErr.textContent = e.message; }
});
document.getElementById("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("login-btn").click(); });
document.getElementById("logout-join").addEventListener("click", logout);
document.getElementById("logout-btn").addEventListener("click", logout);

// --- Account management (admin) -----------------------------------------
const accountsOverlay = document.getElementById("accounts-overlay");
const accountsListEl = document.getElementById("accounts-list");
let openAccounts = false;
document.getElementById("accounts-link").addEventListener("click", () => { openAccounts = true; socket.connect(); socket.emit("adminUsers"); });
document.getElementById("accounts-close").addEventListener("click", () => accountsOverlay.classList.add("hidden"));
socket.on("adminUserList", (users) => {
  // Update the pending-request badge on the link (in-app notification).
  const pending = users.filter((u) => u.gm_requested).length;
  const link = document.getElementById("accounts-link");
  link.textContent = "Manage accounts (admin)" + (pending ? `  •  ${pending} GM request${pending > 1 ? "s" : ""}` : "");
  if (!openAccounts) return; // landing refresh only updates the badge
  openAccounts = false;
  accountsListEl.innerHTML = "";
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString() : "—");
  // Am I the owner (super-admin)? Only the owner may manage the owner's account.
  const iAmSuper = users.some((u) => u.is_super && u.username === (window.account && window.account.username));
  users.forEach((u) => {
    const locked = u.is_super && !iAmSuper; // other admins can't touch the owner
    const row = document.createElement("div");
    row.className = "acct-card";
    const tables = (u.tables || []).map((t) => `${escAcct(t.id)} (${t.role === "gm" ? "GM" : "P"})`).join(", ") || "none";
    const reqBadge = u.gm_requested ? ` <span class="req-badge">wants GM</span>` : "";
    const ownerBadge = u.is_super ? ` <span class="owner-badge">owner</span>` : "";
    row.innerHTML = `
      <div class="acct-info">
        <div class="ar-name">${escAcct(u.name || u.username)} <span class="ar-meta">@${escAcct(u.username)}</span>${ownerBadge}${reqBadge}</div>
        <div class="ar-meta">${escAcct(u.email || "no email")} · joined ${fmtDate(u.created_at)}</div>
        <div class="ar-meta">tables: ${tables}</div>
        <div class="ar-meta">${billingLabel(u)}</div>
      </div>
      <div class="acct-controls">
        ${u.gm_requested ? '<button class="acct-approve">✓ Make GM</button><button class="acct-deny btn-secondary">Deny</button>' : ""}
        <select class="acct-role"${locked ? " disabled" : ""}>
          <option value="player"${u.role === "player" ? " selected" : ""}>Player</option>
          <option value="gm"${u.role === "gm" ? " selected" : ""}>Game Master</option>
          <option value="admin"${u.role === "admin" ? " selected" : ""}>Admin</option>
        </select>
        <select class="acct-plan" title="Billing plan (manual until Stripe)"${locked ? " disabled" : ""}>
          <option value=""${!u.plan ? " selected" : ""}>Plan: trial / none</option>
          <option value="gm"${u.plan === "gm" ? " selected" : ""}>Plan: GM ($5)</option>
          <option value="gm_ai"${u.plan === "gm_ai" ? " selected" : ""}>Plan: GM + AI ($10)</option>
          <option value="comp"${u.plan === "comp" ? " selected" : ""}>Plan: Free (comp)</option>
        </select>
        <button class="acct-credit btn-secondary" title="Grant AI top-up credit (USD)">+ AI credit</button>
        ${locked ? '<span class="ar-meta">owner account — managed by the owner only</span>'
          : '<button class="acct-reset btn-secondary">Reset password</button><button class="acct-del">Delete</button>'}
      </div>`;
    row.querySelector(".acct-credit").addEventListener("click", () => {
      const v = prompt(`Add AI credit for "${u.username}" — dollars of API usage (e.g. 5 for $5). Use a negative number to deduct.`);
      const usd = Number(v);
      if (v != null && isFinite(usd) && usd !== 0) socket.emit("adminAddAiCredit", { id: u.id, usd });
    });
    if (!locked) {
      row.querySelector(".acct-role").addEventListener("change", (e) => socket.emit("adminSetRole", { id: u.id, role: e.target.value }));
      row.querySelector(".acct-plan").addEventListener("change", (e) => socket.emit("adminSetPlan", { id: u.id, plan: e.target.value }));
      row.querySelector(".acct-reset").addEventListener("click", () => {
        const np = prompt(`New password for "${u.username}" (at least 6 characters):`);
        if (np) socket.emit("adminResetPassword", { id: u.id, newPassword: np });
      });
      row.querySelector(".acct-del").addEventListener("click", () => { if (confirm(`Delete account "${u.username}"?`)) socket.emit("adminDeleteUser", u.id); });
    }
    row.querySelector(".acct-approve")?.addEventListener("click", () => socket.emit("adminSetRole", { id: u.id, role: "gm" }));
    row.querySelector(".acct-deny")?.addEventListener("click", () => socket.emit("adminDenyGm", u.id));
    accountsListEl.appendChild(row);
  });
  accountsOverlay.classList.remove("hidden");
});
socket.on("adminNotice", (m) => alert(m));

// --- DM: manage allowed player emails for the current table --------------
const playersOverlay = document.getElementById("players-overlay");
const allowListEl = document.getElementById("allow-list");
document.getElementById("players-btn")?.addEventListener("click", () => { socket.emit("listAllowed"); playersOverlay.classList.remove("hidden"); });
document.getElementById("players-close")?.addEventListener("click", () => playersOverlay.classList.add("hidden"));
document.getElementById("allow-add")?.addEventListener("click", () => {
  const inp = document.getElementById("allow-email");
  const email = inp.value.trim();
  if (email) { socket.emit("addAllowed", email); inp.value = ""; }
});
socket.on("allowedEmails", (emails) => {
  allowListEl.innerHTML = "";
  if (!emails.length) { allowListEl.innerHTML = "<p class='join-hint' style='margin:0'>No emails added yet. Players can still use the invite password if you set one.</p>"; return; }
  emails.forEach((em) => {
    const row = document.createElement("div");
    row.className = "admin-room";
    row.innerHTML = `<span class="ar-name" style="flex:1">${escAcct(em)}</span><button>Remove</button>`;
    row.querySelector("button").addEventListener("click", () => socket.emit("removeAllowed", em));
    allowListEl.appendChild(row);
  });
});
function escAcct(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// AI usage meter shown in the AI tab (cost-based monthly allowance + credit).
function renderAiMeter(used, included, credit) {
  const el = document.getElementById("ai-meter");
  if (!el) return;
  if ((included || 0) <= 0 && (credit || 0) <= 0) { el.className = "ai-meter hidden"; return; }
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 100;
  const creditTxt = credit > 0 ? ` · <b>$${credit.toFixed(2)}</b> top-up credit` : "";
  el.innerHTML =
    `<div class="ai-meter-row"><span>AI usage this month</span><span>$${(used || 0).toFixed(2)} / $${(included || 0).toFixed(2)} included${creditTxt}</span></div>` +
    `<div class="ai-meter-bar"><div style="width:${pct}%"></div></div>`;
  el.className = "ai-meter";
}

// Short billing status for the admin accounts list.
function billingLabel(u) {
  let plan;
  if (u.plan === "comp") plan = "🎁 Free access (comp)";
  else if (u.plan === "gm_ai") plan = "💳 Plan: GM + AI ($10)";
  else if (u.plan === "gm") plan = "💳 Plan: GM ($5)";
  else if (u.trialActive && u.trialEndsAt) {
    const d = Math.max(0, Math.ceil((u.trialEndsAt - Date.now()) / 86400000));
    plan = `⏳ Trial: ${d} day${d === 1 ? "" : "s"} left`;
  } else if (u.trialEndsAt) plan = "Trial ended — no plan";
  else plan = "No plan / trial";
  // Append AI usage for accounts that can use it.
  if (u.plan === "gm_ai" || u.plan === "comp" || u.trialActive) {
    plan += ` · AI $${(u.aiUsed || 0).toFixed(2)}/$${(u.aiIncluded || 0).toFixed(2)}`;
    if (u.aiCredit > 0) plan += ` (+$${u.aiCredit.toFixed(2)} credit)`;
  }
  return plan;
}

// Email-verification banner: prompt unverified users, or confirm after verifying.
function renderVerifyBanner(user) {
  const el = document.getElementById("verify-banner");
  if (!el) return;
  if (new URLSearchParams(location.search).get("verified") === "1") {
    el.textContent = "✓ Email verified — thanks!"; el.className = "trial-banner ok"; return;
  }
  if (user && user.emailVerified === 0) {
    el.innerHTML = 'Please verify your email to secure your account. <a href="#" id="resend-verify">Resend link</a>';
    el.className = "trial-banner";
    el.querySelector("#resend-verify").addEventListener("click", async (e) => {
      e.preventDefault();
      try { await authPost("/auth/resend-verify", {}); } catch {}
      el.textContent = "Verification email sent — check your inbox (and spam).";
    });
    return;
  }
  el.className = "trial-banner hidden";
}

// Show GMs their trial countdown or a subscribe prompt. Players/admins see nothing.
function renderTrialBanner(user) {
  const el = document.getElementById("trial-banner");
  if (!el) return;
  el.className = "trial-banner hidden";
  if (!user || user.role !== "gm") return; // players & admins don't need it
  if (user.plan === "comp") { el.textContent = "🎁 You have free access — all Game Master + AI features, on the house. Enjoy!"; el.className = "trial-banner ok"; return; }
  if (user.plan === "gm_ai") { el.textContent = "✓ Game Master + AI plan active. Thanks for supporting the table!"; el.className = "trial-banner ok"; return; }
  if (user.plan === "gm") { el.innerHTML = '✓ Game Master plan active. Add the AI assistant any time — <a href="/pricing.html" target="_blank">see plans</a>.'; el.className = "trial-banner ok"; return; }
  if (user.trialActive && user.trialEndsAt) {
    const days = Math.max(0, Math.ceil((user.trialEndsAt - Date.now()) / 86400000));
    el.innerHTML = `⏳ <b>${days} day${days === 1 ? "" : "s"} left</b> in your free Game Master trial (everything unlocked, including AI). <a href="/pricing.html" target="_blank">See plans</a>`;
    el.className = "trial-banner";
    return;
  }
  // Trial ended, no plan.
  el.innerHTML = 'Your Game Master trial has ended. <a href="/pricing.html" target="_blank">Subscribe</a> to keep creating and running tables.';
  el.className = "trial-banner ended";
}

// On load, find out if we're already logged in.
// "Table View" — a second screen (TV/projector) that shows only the map, exactly
// as players should see it, with no controls. Opened via /play?display=<room>.
const _displayRoom = new URLSearchParams(location.search).get("display");
function startDisplay(user, room) {
  window.account = user;
  window.tableView = true;                       // map renders as a player, view-only
  document.body.classList.add("table-display");  // CSS hides all the chrome
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("join-screen").classList.add("hidden");
  socket.connect();
  socket.emit("enterTable", { room });
}
const _params = new URLSearchParams(location.search);
const _resetTok = _params.get("reset");
fetch("/auth/me").then((r) => r.json()).then(({ user }) => {
  if (_resetTok) { showAuth(); showResetForm(); }
  else if (user && _displayRoom) startDisplay(user, _displayRoom);
  else if (user) showLanding(user);
  else showAuth();
}).catch(showAuth);

// Password reset / forgot-password UI.
function hideAuthForms() {
  ["login-form", "signup-form", "forgot-form", "reset-form", "sso-buttons"].forEach((id) => document.getElementById(id)?.classList.add("hidden"));
  document.querySelector("#auth-screen .mode-tabs")?.classList.add("hidden");
}
function showResetForm() { hideAuthForms(); document.getElementById("reset-form").classList.remove("hidden"); }
document.getElementById("forgot-link")?.addEventListener("click", () => { document.getElementById("login-form").classList.add("hidden"); document.getElementById("forgot-form").classList.remove("hidden"); document.getElementById("auth-error").textContent = ""; });
document.getElementById("forgot-back")?.addEventListener("click", () => { document.getElementById("forgot-form").classList.add("hidden"); document.getElementById("login-form").classList.remove("hidden"); });
document.getElementById("forgot-btn")?.addEventListener("click", async () => {
  const login = document.getElementById("forgot-login").value.trim();
  if (!login) return;
  try { await authPost("/auth/forgot", { login }); } catch {}
  document.getElementById("forgot-form").innerHTML = '<p class="join-hint">If an account matches, we\'ve emailed a password-reset link. Check your inbox (and spam).</p>';
});
document.getElementById("reset-btn")?.addEventListener("click", async () => {
  const password = document.getElementById("reset-pass").value;
  const err = document.getElementById("auth-error");
  try {
    await authPost("/auth/reset", { token: _resetTok, password });
    document.getElementById("reset-form").innerHTML = '<p class="join-hint">Password updated! You can log in now.</p>';
    history.replaceState({}, "", "/play");
    setTimeout(() => location.href = "/play", 1500);
  } catch (e) { err.textContent = e.message; }
});

// Show SSO buttons only for providers configured on the server.
fetch("/auth/providers").then((r) => r.json()).then((p) => {
  let any = false;
  if (p.discord) { document.getElementById("sso-discord").classList.remove("hidden"); any = true; }
  if (p.google) { document.getElementById("sso-google").classList.remove("hidden"); any = true; }
  if (any) document.getElementById("sso-buttons").classList.remove("hidden");
}).catch(() => {});

// Role is decided by the server from the DM password. We mirror it to the body
// class (CSS hides .dm-only controls for players) and to window.isDM /
// window.playerName for the feature modules to read. Registered before connect
// so we never miss the event.
window.isDM = false;
window.playerName = "Player";
let entered = false;

function setRole(isDM, name) {
  // On the Table View screen we always render as a player (fog/lighting hide what
  // players shouldn't see), even though the account itself is the DM.
  const eff = !!isDM && !window.tableView;
  window.isDM = eff;
  window.playerName = name;
  document.body.classList.toggle("is-player", !eff);
  const badge = document.getElementById("role-badge");
  badge.textContent = isDM ? "DM" : "Player";
  badge.className = "role-badge " + (isDM ? "dm" : "player");
}

// Server confirms the join/create with a role; only then do we enter the app.
socket.on("role", ({ isDM, name, room }) => {
  setRole(isDM, name);
  if (!entered) { entered = true; enterApp(room); }
});
socket.on("joinError", (msg) => alert(msg || "Could not join that table."));

// Open the player-facing Table View (for a TV/second screen) for the current table.
document.getElementById("table-view")?.addEventListener("click", () => {
  if (!window.currentRoom) return;
  window.open("/play?display=" + encodeURIComponent(window.currentRoom), "_blank", "noopener");
});
// Fullscreen toggle (shown only on the Table View screen).
document.getElementById("tv-fullscreen")?.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

// Landing screen: toggle between Join and Create.
const joinForm = document.getElementById("join-form");
const createForm = document.getElementById("create-form");
const modeJoin = document.getElementById("mode-join");
const modeCreate = document.getElementById("mode-create");
modeJoin.addEventListener("click", () => {
  modeJoin.classList.add("active"); modeCreate.classList.remove("active");
  joinForm.classList.remove("hidden"); createForm.classList.add("hidden");
});
modeCreate.addEventListener("click", () => {
  modeCreate.classList.add("active"); modeJoin.classList.remove("active");
  createForm.classList.remove("hidden"); joinForm.classList.add("hidden");
});

function doJoin() {
  const room = document.getElementById("join-room").value.trim();
  const password = document.getElementById("join-pw").value;
  if (!room) { alert("Enter the table (room) name."); return; }
  socket.connect();
  socket.emit("join", { room, password });
}
function doCreate() {
  const room = document.getElementById("create-room").value.trim();
  const playerPassword = document.getElementById("create-player").value;
  if (!room) { alert("Enter a table name."); return; }
  socket.connect();
  socket.emit("createRoom", { room, playerPassword });
}
document.getElementById("join-btn").addEventListener("click", doJoin);
document.getElementById("join-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
document.getElementById("create-btn").addEventListener("click", doCreate);

// --- Owner room management ----------------------------------------------
let adminPw = null;
const adminOverlay = document.getElementById("admin-overlay");
const adminListEl = document.getElementById("admin-list");

document.getElementById("admin-link")?.addEventListener("click", () => {
  const pw = prompt("Owner/admin password:");
  if (!pw) return;
  adminPw = pw;
  socket.connect();
  socket.emit("adminList", pw);
});
document.getElementById("admin-close")?.addEventListener("click", () => adminOverlay.classList.add("hidden"));
socket.on("adminError", (msg) => alert(msg || "Admin error."));
socket.on("adminRooms", (rooms) => {
  adminListEl.innerHTML = "";
  if (!rooms.length) adminListEl.innerHTML = "<p class='join-hint'>No rooms yet.</p>";
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : "—";
  for (const r of rooms) {
    const row = document.createElement("div");
    row.className = "admin-room";
    row.innerHTML = `
      <div style="flex:1">
        <div class="ar-name">${escapeHtml(r.id)}</div>
        <div class="ar-meta">created ${fmtDate(r.created_at)} · last active ${fmtDate(r.last_active)} · ${r.characters} PCs, ${r.creatures} creatures</div>
      </div>
      <button>Delete</button>`;
    row.querySelector("button").addEventListener("click", () => {
      if (confirm(`Permanently delete room "${r.id}" and all its data?`)) {
        socket.emit("adminDelete", { password: adminPw, room: r.id });
      }
    });
    adminListEl.appendChild(row);
  }
  adminOverlay.classList.remove("hidden");
});

// Admin: manage ALL tables (role-gated, no password). Reuses the admin overlay.
document.getElementById("tables-admin-link")?.addEventListener("click", () => { socket.connect(); socket.emit("adminTables"); });
socket.on("adminTableList", (rooms) => {
  adminListEl.innerHTML = "";
  if (!rooms.length) adminListEl.innerHTML = "<p class='join-hint'>No tables yet.</p>";
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : "—";
  for (const r of rooms) {
    const row = document.createElement("div");
    row.className = "admin-room";
    row.innerHTML = `
      <div style="flex:1">
        <div class="ar-name">${escapeHtml(r.id)}</div>
        <div class="ar-meta">owner: ${escapeHtml(r.owner || "—")} · last active ${fmtDate(r.last_active)} · ${r.characters} PCs, ${r.creatures} creatures</div>
      </div>
      <button>Delete</button>`;
    row.querySelector("button").addEventListener("click", () => {
      if (confirm(`Permanently delete table "${r.id}" and all its data?`)) socket.emit("deleteTable", r.id);
    });
    adminListEl.appendChild(row);
  }
  adminOverlay.classList.remove("hidden");
});
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function enterApp(room) {
  window.currentRoom = room;
  document.getElementById("room-label").textContent = `Room: ${room}`;
  joinScreen.classList.add("hidden");
  app.classList.remove("hidden");

  // Modules must init after the app is visible so the canvas has a size.
  initMap(socket);
  initChat(socket);
  initCharacters(socket);
  initInitiative(socket);
  initBestiary(socket);
  initReference();
  initVoice(socket);
  initFX(socket);
  initAI(socket);
  initDice(socket);
  initSound(socket);
  initWeather(socket);
  initJournal(socket);
  initLoot(socket);
  initTimer(socket);
  initDice3d(socket);
  initFinder(socket);
  // Show the AI upsell in the AI tab if this account isn't entitled to the assistant.
  const aiUp = document.getElementById("ai-upsell");
  if (aiUp) aiUp.classList.toggle("hidden", !!(window.account && window.account.aiEntitled));
  // AI usage meter (cost-based): included $ + any purchased credit.
  const a = window.account || {};
  renderAiMeter(a.aiUsed || 0, a.aiIncluded || 0, a.aiCredit || 0);
  socket.on("aiUsage", ({ used, included, credit }) => renderAiMeter(used, included, credit));

  // Handouts — DM shows an image to everyone.
  const handoutOverlay = document.getElementById("handout-overlay");
  const handoutFile = document.getElementById("handout-file");
  document.getElementById("handout-btn")?.addEventListener("click", () => handoutFile.click());
  handoutFile?.addEventListener("change", async () => {
    const f = handoutFile.files[0]; handoutFile.value = "";
    if (!f) return;
    try { socket.emit("showHandout", await uploadImage(f)); } catch (e) { alert(e.message); }
  });
  socket.on("handout", (url) => { document.getElementById("handout-img").src = url; handoutOverlay.classList.remove("hidden"); });
  socket.on("handoutClear", () => handoutOverlay.classList.add("hidden"));
  document.getElementById("handout-close").addEventListener("click", () => {
    handoutOverlay.classList.add("hidden");
    if (window.isDM) socket.emit("clearHandout");
  });

  const mapUrl = document.getElementById("map-url");
  const mapPicker = document.getElementById("map-picker");

  // Map + token controls.
  document.getElementById("map-set").addEventListener("click", () => {
    socket.emit("setMap", mapUrl.value.trim());
  });
  document.getElementById("add-token").addEventListener("click", () => {
    const label = prompt("Token label (e.g. character initials):", "PC");
    if (label === null) return;
    const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    socket.emit("addToken", { label, color });
  });

  // --- Image uploads (DM) --------------------------------------------------
  // Streams a file to the server and returns its public URL.
  async function uploadImage(file) {
    const res = await fetch("/upload", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Upload failed");
    }
    return (await res.json()).url;
  }

  const mapFile = document.getElementById("map-file");
  const portraitFile = document.getElementById("portrait-file");

  document.getElementById("map-upload").addEventListener("click", () => mapFile.click());
  mapFile.addEventListener("change", async () => {
    const file = mapFile.files[0];
    mapFile.value = "";
    if (!file) return;
    try {
      const url = await uploadImage(file);
      mapUrl.value = url;
      socket.emit("setMap", url);
      const name = prompt("Save this map to the library as:", file.name.replace(/\.[^.]+$/, ""));
      if (name) socket.emit("saveMap", { name, url });
    } catch (e) { alert(e.message); }
  });

  document.getElementById("add-portrait").addEventListener("click", () => portraitFile.click());
  portraitFile.addEventListener("change", async () => {
    const file = portraitFile.files[0];
    portraitFile.value = "";
    if (!file) return;
    const label = prompt("Token label (e.g. character initials):", "PC");
    if (label === null) return;
    try {
      const img = await uploadImage(file);
      const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
      socket.emit("addToken", { label, color, img });
    } catch (e) { alert(e.message); }
  });

  // --- Map library ---------------------------------------------------------
  document.getElementById("map-save").addEventListener("click", () => {
    const url = mapUrl.value.trim();
    if (!url) { alert("Paste a map image URL first, then click ★ to save it."); return; }
    const name = prompt("Name this map:", "New map");
    if (name === null) return;
    socket.emit("saveMap", { name, url });
  });
  let savedMaps = [];
  mapPicker.addEventListener("change", () => {
    const m = savedMaps.find((x) => x.id === mapPicker.value);
    if (!m) return;
    mapUrl.value = m.url;
    socket.emit("setMap", m.url);
  });
  // Remove the selected map from the shared library (DM only).
  document.getElementById("map-remove")?.addEventListener("click", () => {
    const m = savedMaps.find((x) => x.id === mapPicker.value);
    if (!m) { alert("Pick a saved map from the dropdown first."); return; }
    if (confirm(`Remove "${m.name}" from the shared map library?`)) socket.emit("deleteMap", m.id);
  });

  function refreshMaps(maps) {
    mapPicker.innerHTML = '<option value="">— saved maps —</option>';
    (maps || []).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.name;
      mapPicker.appendChild(o);
    });
  }
  socket.on("state", (s) => { savedMaps = s.maps || []; refreshMaps(savedMaps); });
  socket.on("mapSaved", (m) => { savedMaps.push(m); refreshMaps(savedMaps); });
  socket.on("mapDeleted", (id) => {
    savedMaps = savedMaps.filter((m) => m.id !== id);
    refreshMaps(savedMaps);
  });
}

// Tab switching.
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});
