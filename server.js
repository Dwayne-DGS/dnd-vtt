// D&D VTT server: Express serves the static client; Socket.IO handles all
// realtime state (map, tokens, dice, chat, character sheets) per room.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID, randomBytes } from "crypto";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import bcrypt from "bcryptjs";
import { rollDice } from "./dice.js";
import * as store from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Owner/admin password for room management. Read from an `admin.key` file in the
// app directory (kept out of git). If the file is absent, admin features are off.
const ADMIN_KEY_FILE = join(__dirname, "admin.key");
function adminPassword() {
  try {
    if (!existsSync(ADMIN_KEY_FILE)) return null;
    const pw = readFileSync(ADMIN_KEY_FILE, "utf8").trim();
    return pw || null;
  } catch { return null; }
}

// --- Transactional email (Resend) -----------------------------------------
// API key lives in `resend.key` (gitignored) or RESEND_API_KEY env. The "from"
// address defaults to Resend's sandbox so it works for testing before you verify
// your domain; set MAIL_FROM to e.g. "warcrimes.us <noreply@warcrimes.us>" after.
const RESEND_KEY_FILE = join(__dirname, "resend.key");
function resendKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY.trim();
  try { return readFileSync(RESEND_KEY_FILE, "utf8").trim() || null; } catch { return null; }
}
const mailConfigured = () => !!resendKey();
const mailFrom = () => process.env.MAIL_FROM || "warcrimes.us <onboarding@resend.dev>";
const siteBase = () => process.env.PUBLIC_URL || "https://warcrimes.us";
async function sendMail({ to, subject, html }) {
  const key = resendKey();
  if (!key || !to) { console.log("[email skipped — not configured]", subject, "→", to); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mailFrom(), to, subject, html }),
    });
    if (!r.ok) { console.error("Resend error", r.status, (await r.text().catch(() => "")).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error("Resend send failed:", e.message); return false; }
}
function emailLayout(title, bodyHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;margin:0;padding:24px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#ffffff;border:1px solid #e4ddd0;border-radius:12px;overflow:hidden">
      <tr><td align="center" style="background:#16110b;padding:24px 0">
        <img src="${siteBase()}/assets/warcrimes-logo.png" alt="warcrimes.us" width="240" style="display:block;width:240px;max-width:72%;height:auto" />
      </td></tr>
      <tr><td style="padding:32px 38px;color:#262626;line-height:1.65;font-size:15px">
        <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;color:#7a1f17;font-size:23px">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 38px 26px;border-top:1px solid #eee;color:#9a9a9a;font-size:12px;line-height:1.55">
        <a href="${siteBase()}" style="color:#7a1f17;text-decoration:none;font-weight:bold">warcrimes.us</a> — your own virtual tabletop for Dungeons &amp; Dragons 5th Edition.<br>
        If you didn't expect this email, you can safely ignore it.
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
const mailBtn = (url, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr>
  <td align="center" bgcolor="#c0392b" style="border-radius:8px">
    <a href="${url}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none">${label}</a>
  </td></tr></table>
<p style="font-size:12px;color:#9a9a9a;word-break:break-all;margin:0">Or paste this link into your browser:<br><a href="${url}" style="color:#7a1f17">${url}</a></p>`;

app.use(express.json()); // parses application/json bodies (not the image uploads)
// Public marketing site at "/"; the actual app lives at "/play". These routes
// run before express.static so "/" doesn't fall through to index.html.
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public", "home.html")));
app.get("/play", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));
app.use(express.static(join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- Accounts (username/password, in-house) -------------------------------
function parseCookies(str) {
  const out = {};
  (str || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `vtt_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}
function userFromReq(req) { return store.getSessionUser(parseCookies(req.headers.cookie)["vtt_session"]); }

// --- Billing / entitlements -----------------------------------------------
const TRIAL_DAYS = 30;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
// AI cost metering. Default = Claude Sonnet pricing ($/token); override via env if
// you switch models. INCLUDED_AI_USD is the API spend bundled into the GM+AI plan;
// beyond that a GM must have purchased top-up credit.
const AI_PRICE_IN = Number(process.env.AI_PRICE_IN || 3) / 1e6;   // $3 / M input tokens
const AI_PRICE_OUT = Number(process.env.AI_PRICE_OUT || 15) / 1e6; // $15 / M output tokens
const INCLUDED_AI_USD = Number(process.env.INCLUDED_AI_USD || 4);
const aiMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const aiCostThisMonth = (u) => (u && u.ai_period === aiMonth() ? (u.ai_cost || 0) : 0);
const aiAvailableUsd = (u) => (entitledAI(u) ? Math.max(0, INCLUDED_AI_USD - aiCostThisMonth(u)) + (u.ai_credit || 0) : 0);
const trialActive = (u) => !!(u && u.trial_start && Date.now() - u.trial_start < TRIAL_MS);
const trialEndsAt = (u) => (u && u.trial_start ? u.trial_start + TRIAL_MS : null);
// Can this account run tables as a DM? Admins always; GMs during trial or on a paid plan.
const entitledGM = (u) => !!(u && (u.role === "admin" || (u.role === "gm" && (u.plan === "gm" || u.plan === "gm_ai" || u.plan === "comp" || trialActive(u)))));
// Can this account use the AI assistant? Admins always; the AI/comp plans, or during trial.
const entitledAI = (u) => !!(u && (u.role === "admin" || u.plan === "gm_ai" || u.plan === "comp" || trialActive(u)));
// One-time migration: existing GM accounts (created before billing) get a fresh
// 30-day trial start so the new gating never locks them out unexpectedly.
try { store.listUsers().forEach((u) => { if (u.role === "gm") store.startTrial(u.id); }); } catch {}

const pubUser = (u) => {
  if (!u) return null;
  let macros = [];
  try { macros = JSON.parse(u.macros || "[]"); } catch {}
  return {
    username: u.username, role: u.role, name: u.name || null, gmRequested: !!u.gm_requested,
    diceSkin: u.dice_skin || "galaxy", dice3d: u.dice3d == null ? 1 : u.dice3d, macros,
    plan: u.plan || null, trialEndsAt: trialEndsAt(u), trialActive: trialActive(u),
    gmEntitled: entitledGM(u), aiEntitled: entitledAI(u),
    aiUsed: Math.min(aiCostThisMonth(u), INCLUDED_AI_USD), aiIncluded: entitledAI(u) ? INCLUDED_AI_USD : 0, aiCredit: u.ai_credit || 0,
    emailVerified: u.email_verified == null ? 1 : u.email_verified,
    email: u.email || "", billingEmail: u.billing_email || "", address: u.address || "", phone: u.phone || "",
    isSSO: !!u.provider,
  };
};

app.post("/auth/signup", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 letters, numbers, or underscores." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (!name) return res.status(400).json({ error: "Please enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email." });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: "That username is taken." });
  // Everyone signs up as a player; an admin promotes to GM. First account = admin.
  const finalRole = store.countUsers() === 0 ? "admin" : "player";
  const id = randomUUID();
  store.createUser({ id, username, name, email, pass_hash: bcrypt.hashSync(password, 10), role: finalRole });
  // If email sending is configured, mark unverified and send a welcome + verify email.
  if (mailConfigured()) {
    store.setEmailVerified(id, 0);
    const vtok = randomBytes(24).toString("hex");
    store.createAuthToken(vtok, id, "verify", Date.now() + 7 * 24 * 60 * 60 * 1000);
    sendMail({ to: email, subject: "Welcome to warcrimes.us — confirm your email",
      html: emailLayout(`Welcome, ${name}!`, `<p>Thanks for joining warcrimes.us. Confirm your email to finish setting up your account:</p>${mailBtn(`${siteBase()}/auth/verify?token=${vtok}`, "Confirm email")}<p>Then jump in at <a href="${siteBase()}/play">${siteBase()}/play</a>.</p>`) });
  }
  const token = randomBytes(32).toString("hex");
  store.createSession(token, id);
  setSessionCookie(res, token);
  res.json({ user: pubUser(store.getUserByUsername(username)) });
});

app.post("/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const u = store.getUserByUsername(username);
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.pass_hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const token = randomBytes(32).toString("hex");
  store.createSession(token, u.id);
  setSessionCookie(res, token);
  res.json({ user: pubUser(u) });
});

app.post("/auth/logout", (req, res) => {
  const t = parseCookies(req.headers.cookie)["vtt_session"];
  if (t) store.deleteSession(t);
  res.setHeader("Set-Cookie", "vtt_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/auth/me", (req, res) => res.json({ user: pubUser(userFromReq(req)) }));

// --- Single sign-on (Google / Discord OAuth) ------------------------------
// Credentials live in an `oauth.json` file in the app dir (gitignored), shaped:
//   { "google": {"clientId":"…","clientSecret":"…"}, "discord": {"clientId":"…","clientSecret":"…"} }
// If the file (or a provider) is absent, that sign-in button simply won't appear.
const OAUTH_FILE = join(__dirname, "oauth.json");
function oauthCfg() { try { return JSON.parse(readFileSync(OAUTH_FILE, "utf8")); } catch { return {}; } }
const OAUTH = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scope: "openid email profile",
    extra: { access_type: "online", prompt: "select_account" },
    profile: (d) => ({ id: d.sub, email: d.email, name: d.name || d.given_name }),
  },
  discord: {
    authUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
    extra: {},
    profile: (d) => ({ id: d.id, email: d.email, name: d.global_name || d.username }),
  },
};
const publicBase = (req) => process.env.PUBLIC_URL || ("https://" + req.get("host"));
const redirectUri = (req, provider) => `${publicBase(req)}/auth/${provider}/callback`;

// Which providers are configured (the client shows only these buttons).
app.get("/auth/providers", (_req, res) => {
  const c = oauthCfg();
  res.json({ google: !!(c.google && c.google.clientId), discord: !!(c.discord && c.discord.clientId) });
});

// Step 1: redirect the user to the provider's consent screen.
app.get("/auth/:provider/start", (req, res) => {
  const provider = req.params.provider;
  const P = OAUTH[provider], cfg = oauthCfg()[provider];
  if (!P || !cfg || !cfg.clientId) return res.status(404).send("That sign-in option isn't available.");
  const state = randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const u = new URL(P.authUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri(req, provider));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", P.scope);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(P.extra)) u.searchParams.set(k, v);
  res.redirect(u.toString());
});

// Step 2: provider redirects back with a code; exchange it, look up/create the user.
app.get("/auth/:provider/callback", async (req, res) => {
  const provider = req.params.provider;
  const P = OAUTH[provider], cfg = oauthCfg()[provider];
  if (!P || !cfg || !cfg.clientId) return res.redirect("/play");
  const { code, state } = req.query;
  const cookieState = parseCookies(req.headers.cookie)["oauth_state"];
  if (!code || !state || state !== cookieState) return res.status(400).send("Sign-in failed (security check). Please try again.");
  try {
    const body = new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code",
      code: String(code), redirect_uri: redirectUri(req, provider),
    });
    const tr = await fetch(P.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
    if (!tr.ok) throw new Error("token exchange " + tr.status);
    const tok = await tr.json();
    const pr = await fetch(P.profileUrl, { headers: { Authorization: "Bearer " + tok.access_token } });
    if (!pr.ok) throw new Error("profile fetch " + pr.status);
    const prof = P.profile(await pr.json());
    if (!prof.id) throw new Error("no account id from provider");

    // Find by provider id, else link by email, else create a fresh account.
    let user = store.getUserByProvider(provider, prof.id);
    if (!user && prof.email) {
      const byEmail = store.getUserByEmail(prof.email);
      if (byEmail) { store.linkProvider(byEmail.id, provider, prof.id); user = byEmail; }
    }
    if (!user) {
      let base = String(prof.name || (prof.email || "").split("@")[0] || provider).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || provider;
      let uname = base, n = 1;
      while (store.usernameTaken(uname)) uname = (base + n++).slice(0, 20);
      const id = randomUUID();
      const role = store.countUsers() === 0 ? "admin" : "player";
      store.createOAuthUser({ id, username: uname, name: prof.name || uname, email: prof.email || null, pass_hash: bcrypt.hashSync(randomBytes(24).toString("hex"), 10), role, provider, provider_id: prof.id });
      user = store.getUserById(id);
    }
    const token = randomBytes(32).toString("hex");
    store.createSession(token, user.id);
    setSessionCookie(res, token);
    res.redirect("/play");
  } catch (e) {
    console.error("OAuth error:", e.message);
    res.status(500).send("Sign-in failed. Please try again.");
  }
});

// --- Password reset & email verification ----------------------------------
app.post("/auth/forgot", (req, res) => {
  const login = String(req.body.login || "").trim().toLowerCase();
  const user = store.getUserByUsername(login) || store.getUserByEmail(login);
  if (user && user.email) {
    const tok = randomBytes(24).toString("hex");
    store.createAuthToken(tok, user.id, "reset", Date.now() + 60 * 60 * 1000); // 1 hour
    sendMail({ to: user.email, subject: "Reset your warcrimes.us password",
      html: emailLayout("Password reset", `<p>We received a request to reset the password for <b>${user.username}</b>. This link is good for one hour:</p>${mailBtn(`${siteBase()}/play?reset=${tok}`, "Reset password")}<p>If you didn't request this, you can ignore this email — your password won't change.</p>`) });
  }
  res.json({ ok: true }); // always succeed so we don't reveal which accounts exist
});
app.post("/auth/reset", (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const t = store.getAuthToken(token);
  if (!t || t.kind !== "reset" || t.expires < Date.now()) return res.status(400).json({ error: "This reset link is invalid or has expired." });
  store.setUserPassword(t.user_id, bcrypt.hashSync(password, 10));
  store.setEmailVerified(t.user_id, 1); // using the emailed link proves the address
  store.deleteAuthToken(token);
  res.json({ ok: true });
});
app.get("/auth/verify", (req, res) => {
  const token = String(req.query.token || "");
  const t = store.getAuthToken(token);
  if (!t || t.kind !== "verify" || t.expires < Date.now()) return res.redirect("/play?verified=0");
  store.setEmailVerified(t.user_id, 1);
  store.deleteAuthToken(token);
  res.redirect("/play?verified=1");
});
// Update your own profile (name, contact email, billing email, address, phone).
app.post("/auth/profile", (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: "Please log in." });
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const billingEmail = String(req.body.billingEmail || "").trim().toLowerCase();
  const address = String(req.body.address || "").trim().slice(0, 300);
  const phone = String(req.body.phone || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Name can't be empty." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (billingEmail && !/^\S+@\S+\.\S+$/.test(billingEmail)) return res.status(400).json({ error: "Enter a valid billing email (or leave it blank)." });
  const other = store.getUserByEmail(email);
  if (other && other.id !== u.id) return res.status(409).json({ error: "That email is already in use by another account." });
  const emailChanged = (u.email || "").toLowerCase() !== email;
  store.setProfile({ id: u.id, name, email, billing_email: billingEmail || null, address: address || null, phone: phone || null });
  if (emailChanged && mailConfigured()) store.setEmailVerified(u.id, 0); // re-verify the new address
  res.json({ user: pubUser(store.getUserById(u.id)) });
});

// Change your password (must know the current one).
app.post("/auth/change-password", (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: "Please log in." });
  const next = String(req.body.next || "");
  if (next.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  if (!bcrypt.compareSync(String(req.body.current || ""), u.pass_hash)) return res.status(400).json({ error: "Your current password is incorrect." });
  store.setUserPassword(u.id, bcrypt.hashSync(next, 10));
  res.json({ ok: true });
});

app.post("/auth/resend-verify", (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: "Please log in first." });
  if (!u.email_verified && u.email && mailConfigured()) {
    const vtok = randomBytes(24).toString("hex");
    store.createAuthToken(vtok, u.id, "verify", Date.now() + 7 * 24 * 60 * 60 * 1000);
    sendMail({ to: u.email, subject: "Confirm your warcrimes.us email",
      html: emailLayout("Confirm your email", `${mailBtn(`${siteBase()}/auth/verify?token=${vtok}`, "Confirm email")}`) });
  }
  res.json({ ok: true });
});

// Image upload (maps & token portraits). Streams the raw request body to a file
// under public/uploads and returns its public URL. Image types only, size-capped.
// Note: setting a map / placing a token is still DM-gated over the socket, so an
// uploaded image is inert until a DM actually uses it.
const UPLOAD_DIR = join(__dirname, "public", "uploads");
const MAX_UPLOAD = 30 * 1024 * 1024; // 30 MB
app.post("/upload", (req, res) => {
  const type = (req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("image/") && !type.startsWith("audio/")) {
    return res.status(400).json({ error: "Images or audio only" });
  }
  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const fname = `${randomUUID()}.${ext}`;
  const out = createWriteStream(join(UPLOAD_DIR, fname));
  let size = 0, aborted = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD && !aborted) {
      aborted = true;
      out.destroy();
      req.destroy();
      res.status(413).json({ error: "File too large (max 30 MB)" });
    }
  });
  req.pipe(out);
  out.on("finish", () => { if (!aborted) res.json({ url: `/uploads/${fname}` }); });
  out.on("error", () => { if (!aborted) res.status(500).json({ error: "Write failed" }); });
});

// Track display names and DM status in memory (cleared on restart).
const names = new Map(); // socket.id -> name
const dmFlags = new Map(); // socket.id -> boolean (is this socket the DM?)

// Initiative is live combat state — kept in memory per room and broadcast.
const initiatives = new Map(); // roomId -> { round, turn, started, entries:[] }
function getInit(roomId) {
  if (!initiatives.has(roomId)) {
    const raw = store.getInitState(roomId);
    initiatives.set(roomId, raw ? JSON.parse(raw) : { round: 1, turn: 0, started: false, entries: [] });
  }
  return initiatives.get(roomId);
}
function persistInit(roomId) {
  store.setInitState(roomId, JSON.stringify(getInit(roomId)));
}
// Who is currently in the voice call, per room.
const voiceRooms = new Map(); // roomId -> Set<socketId>

// Ephemeral map annotations per room: freehand drawings, area templates, weather.
const annotations = new Map(); // roomId -> { drawings:[], templates:[], weather:"none" }
const timers = new Map(); // roomId -> { running, endsAt, duration, label }
const hueHelpers = new Map(); // socket.id -> { room, url } (connected Hue helpers)
function hueStatusFor(room) {
  for (const h of hueHelpers.values()) if (h.room === room) return { connected: true, url: h.url || "" };
  return { connected: false, url: "" };
}
function getTimer(roomId) {
  if (!timers.has(roomId)) timers.set(roomId, { running: false, endsAt: 0, duration: 60, label: "" });
  return timers.get(roomId);
}
function getAnno(roomId) {
  if (!annotations.has(roomId)) annotations.set(roomId, { drawings: [], templates: [], weather: "none", walls: [], lights: [], lightingOn: false });
  return annotations.get(roomId);
}

// Fog of war per room. revealed = Set of "col,row" cell keys in a normalized
// grid over the map. enabled=false means the whole map is visible.
const fogRooms = new Map(); // roomId -> { enabled, revealed:Set }
function getFog(roomId) {
  if (!fogRooms.has(roomId)) {
    const raw = store.getFogState(roomId);
    if (raw) {
      const o = JSON.parse(raw);
      fogRooms.set(roomId, { enabled: !!o.enabled, revealed: new Set(o.revealed || []) });
    } else {
      fogRooms.set(roomId, { enabled: false, revealed: new Set() });
    }
  }
  return fogRooms.get(roomId);
}
function fogPayload(roomId) {
  const f = getFog(roomId);
  return { enabled: f.enabled, revealed: [...f.revealed] };
}
function persistFog(roomId) {
  store.setFogState(roomId, JSON.stringify(fogPayload(roomId)));
}

function sortInit(state) {
  // Highest initiative first. Before combat starts (no "Next turn" pressed yet),
  // the top of the order is "up first". Once combat is underway, keep the
  // highlight on whoever's turn it is even if a late arrival reshuffles the list.
  const currentId = state.entries[state.turn]?.id;
  state.entries.sort((a, b) => (b.init || 0) - (a.init || 0));
  if (!state.started) {
    state.turn = 0;
  } else {
    const idx = state.entries.findIndex((e) => e.id === currentId);
    state.turn = idx >= 0 ? idx : 0;
  }
}

io.on("connection", (socket) => {
  let roomId = null;
  const amDM = () => dmFlags.get(socket.id) === true;
  // Identify the logged-in account from the session cookie sent with the handshake.
  socket.user = store.getSessionUser(parseCookies(socket.handshake.headers.cookie)["vtt_session"]);

  function sendState() {
    socket.emit("state", {
      room: roomId,
      mapUrl: store.getRoom(roomId)?.map_url,
      mapRotation: store.getRoom(roomId)?.map_rotation || 0,
      gridOn: !!store.getRoom(roomId)?.grid_on,
      gridSize: store.getRoom(roomId)?.grid_size || 64,
      tokens: store.getTokens(roomId),
      characters: store.getCharacters(roomId),
      creatures: store.getCreatures(roomId),
      maps: store.getMaps(roomId),
      initiative: getInit(roomId),
      fog: fogPayload(roomId),
      anno: getAnno(roomId),
      journal: store.listJournal(roomId).filter((e) => amDM() || e.shared),
      loot: store.listLoot(roomId),
      gold: store.getPartyGold(roomId),
      timer: getTimer(roomId),
    });
  }

  function enterRoom(isDM) {
    const pname = socket.user.username;
    names.set(socket.id, pname);
    dmFlags.set(socket.id, isDM);
    socket.join(roomId);
    store.touchRoom(roomId);
    store.addMember(roomId, socket.user.id);
    socket.emit("role", { isDM, name: pname, room: roomId });
    sendState();
    io.to(roomId).emit("chat", sys(`${pname} joined${isDM ? " (DM)" : ""}`));
  }

  // A GM/admin creates a table — they become its owner and DM. Optional invite
  // password lets players join the first time.
  socket.on("createRoom", ({ room, playerPassword }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    if (!["gm", "admin"].includes(socket.user.role)) {
      return socket.emit("joinError", "Only Game Master accounts can create tables.");
    }
    if (!entitledGM(store.getUserById(socket.user.id))) {
      return socket.emit("joinError", "Your Game Master trial has ended. Subscribe to keep creating and running tables.");
    }
    roomId = (room || "").trim().toLowerCase();
    if (!roomId) return socket.emit("joinError", "Please enter a table name.");
    const existing = store.getRoom(roomId);
    if (existing && existing.owner_id && existing.owner_id !== socket.user.id) {
      return socket.emit("joinError", "That table name is already taken.");
    }
    store.ensureRoom(roomId);
    store.setRoomOwner(roomId, socket.user.id);
    store.setPlayerPassword(roomId, (playerPassword || "").trim() || null);
    enterRoom(true);
  });

  // Enter a table you already belong to (no password) — used by "Your tables".
  socket.on("enterTable", ({ room }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    roomId = (room || "").trim().toLowerCase();
    const r = store.getRoom(roomId);
    if (!r) return socket.emit("joinError", "That table no longer exists.");
    const owner = r.owner_id === socket.user.id;
    const allowed = owner || socket.user.role === "admin" ||
      store.isMember(roomId, socket.user.id) || store.isEmailAllowed(roomId, socket.user.email);
    if (!allowed) return socket.emit("joinError", "You're not on this table yet — ask your GM to add your email, or use the invite password.");
    if (owner && !entitledGM(store.getUserById(socket.user.id))) {
      return socket.emit("joinError", "Your Game Master trial has ended — subscribe to run your tables again.");
    }
    enterRoom(owner);
  });

  // First-time join to someone else's table: by email allow-list OR invite password.
  socket.on("join", ({ room, password }) => {
    if (!socket.user) return socket.emit("joinError", "Please log in first.");
    roomId = (room || "").trim().toLowerCase();
    if (!roomId) return socket.emit("joinError", "Please enter a table name.");
    const r = store.getRoom(roomId);
    if (!r) return socket.emit("joinError", "No table with that name. Ask your GM for it.");
    if (r.owner_id === socket.user.id) {
      if (!entitledGM(store.getUserById(socket.user.id))) return socket.emit("joinError", "Your Game Master trial has ended — subscribe to run your tables again.");
      return enterRoom(true);
    }
    if (store.isEmailAllowed(roomId, socket.user.email)) return enterRoom(false); // on the allow-list
    const ppw = r.player_password || "";
    if (ppw) {
      if ((password || "").trim() === ppw) return enterRoom(false);
      return socket.emit("joinError", "Wrong invite password for this table.");
    }
    // No password set: open table only if it has no allow-list.
    if (store.listAllowedEmails(roomId).length === 0) return enterRoom(false);
    return socket.emit("joinError", "You're not on this table's player list. Ask your GM to add your email.");
  });

  // The tables this account owns, has joined, or is invited to (dashboard list).
  socket.on("myTables", () => {
    if (!socket.user) return;
    socket.emit("myTablesList", store.getUserTables(socket.user.id, socket.user.email));
  });

  // Save a cosmetic dice-skin preference on the account.
  socket.on("setDiceSkin", (skin) => {
    if (!socket.user || typeof skin !== "string" || skin.length > 20) return;
    store.setDiceSkin(socket.user.id, skin);
  });
  // Toggle the 3D dice preference on the account.
  socket.on("setDice3d", (on) => {
    if (!socket.user) return;
    store.setDice3d(socket.user.id, on ? 1 : 0);
  });
  // Save the player's dice macros to their account.
  socket.on("setMacros", (macros) => {
    if (!socket.user || !Array.isArray(macros)) return;
    store.setMacros(socket.user.id, JSON.stringify(macros.slice(0, 30)));
  });

  // --- Soundboard (DM controls; everyone hears) ----------------------------
  socket.on("listSounds", () => { if (roomId) socket.emit("soundList", store.listSounds()); });
  socket.on("saveSound", ({ name, url, kind }) => {
    if (!roomId || !amDM() || !url) return;
    store.saveSound(randomUUID(), name || "Sound", url, kind === "ambient" ? "ambient" : "sfx");
    io.emit("soundList", store.listSounds());
  });
  socket.on("deleteSound", (id) => { if (!roomId || !amDM()) return; store.deleteSound(id); io.emit("soundList", store.listSounds()); });
  socket.on("playSound", ({ url, kind }) => { if (!roomId || !amDM() || !url) return; io.to(roomId).emit("sound", { url, kind }); });
  socket.on("stopAmbient", () => { if (!roomId || !amDM()) return; io.to(roomId).emit("stopAmbient"); });

  // --- Map annotations: drawings, templates, weather (DM) ------------------
  socket.on("drawStroke", (stroke) => {
    if (!roomId || !amDM() || !stroke) return;
    const a = getAnno(roomId);
    a.drawings.push(stroke);
    if (a.drawings.length > 400) a.drawings.shift();
    socket.to(roomId).emit("drawStroke", stroke); // others (the artist already sees it)
  });
  socket.on("clearDrawings", () => {
    if (!roomId || !amDM()) return;
    getAnno(roomId).drawings = [];
    io.to(roomId).emit("clearDrawings");
  });
  socket.on("addTemplate", (t) => {
    if (!roomId || !amDM() || !t) return;
    getAnno(roomId).templates.push(t);
    io.to(roomId).emit("addTemplate", t);
  });
  socket.on("clearTemplates", () => {
    if (!roomId || !amDM()) return;
    getAnno(roomId).templates = [];
    io.to(roomId).emit("clearTemplates");
  });
  socket.on("setWeather", (w) => {
    if (!roomId || !amDM()) return;
    const weather = ["none", "rain", "snow", "fog"].includes(w) ? w : "none";
    getAnno(roomId).weather = weather;
    io.to(roomId).emit("weather", weather);
  });

  // --- Dynamic lighting / line-of-sight (DM) -------------------------------
  socket.on("addWall", (wall) => { if (!roomId || !amDM() || !wall) return; getAnno(roomId).walls.push(wall); io.to(roomId).emit("addWall", wall); });
  socket.on("clearWalls", () => { if (!roomId || !amDM()) return; getAnno(roomId).walls = []; io.to(roomId).emit("clearWalls"); });
  socket.on("addLight", (light) => { if (!roomId || !amDM() || !light) return; getAnno(roomId).lights.push(light); io.to(roomId).emit("addLight", light); });
  socket.on("clearLights", () => { if (!roomId || !amDM()) return; getAnno(roomId).lights = []; io.to(roomId).emit("clearLights"); });
  socket.on("setLighting", (on) => { if (!roomId || !amDM()) return; getAnno(roomId).lightingOn = !!on; io.to(roomId).emit("lighting", !!on); });

  // --- Journal / session notes (DM authors; players see "shared" ones) -----
  async function broadcastJournal(rid) {
    const all = store.listJournal(rid);
    const shared = all.filter((e) => e.shared);
    const sockets = await io.in(rid).fetchSockets();
    for (const s of sockets) s.emit("journal", dmFlags.get(s.id) === true ? all : shared);
  }
  socket.on("saveJournal", async (e) => {
    if (!roomId || !amDM() || !e) return;
    store.upsertJournal({ id: e.id || randomUUID(), roomId, title: e.title, body: e.body, shared: e.shared });
    await broadcastJournal(roomId);
  });
  socket.on("deleteJournal", async (id) => {
    if (!roomId || !amDM()) return;
    store.deleteJournal(id);
    await broadcastJournal(roomId);
  });

  // --- Party loot (DM manages; everyone sees) ------------------------------
  socket.on("saveLoot", (it) => {
    if (!roomId || !amDM() || !it) return;
    store.upsertLoot({ id: it.id || randomUUID(), roomId, name: it.name, qty: it.qty, value: it.value, holder: it.holder, notes: it.notes });
    io.to(roomId).emit("loot", store.listLoot(roomId));
  });
  socket.on("deleteLoot", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteLoot(id);
    io.to(roomId).emit("loot", store.listLoot(roomId));
  });
  socket.on("setGold", (n) => {
    if (!roomId || !amDM()) return;
    store.setPartyGold(roomId, Number(n) || 0);
    io.to(roomId).emit("gold", store.getPartyGold(roomId));
  });

  // --- Turn timer (DM controls; everyone sees the countdown) ---------------
  socket.on("startTimer", ({ duration, label }) => {
    if (!roomId || !amDM()) return;
    const dur = Math.max(5, Math.min(3600, Number(duration) || 60));
    const t = getTimer(roomId);
    t.running = true; t.duration = dur; t.label = (label || "").slice(0, 60); t.endsAt = Date.now() + dur * 1000;
    io.to(roomId).emit("timer", t);
  });
  socket.on("stopTimer", () => {
    if (!roomId || !amDM()) return;
    const t = getTimer(roomId); t.running = false; t.endsAt = 0;
    io.to(roomId).emit("timer", t);
  });

  // --- Handouts ("show players" an image) ----------------------------------
  socket.on("showHandout", (url) => { if (!roomId || !amDM() || !url) return; io.to(roomId).emit("handout", String(url)); });
  socket.on("clearHandout", () => { if (!roomId || !amDM()) return; io.to(roomId).emit("handoutClear"); });

  // A player requests GM access (admins approve in their panel; email later).
  socket.on("requestGm", () => {
    if (!socket.user) return;
    store.setGmRequested(socket.user.id, 1);
    socket.emit("gmRequested");
    // Notify every admin by email that someone wants Game Master access.
    const who = socket.user.name || socket.user.username;
    for (const a of store.listAdmins()) {
      if (a.email) sendMail({ to: a.email, subject: `GM access requested by ${who}`,
        html: emailLayout("New Game Master request", `<p><b>${who}</b> (@${socket.user.username}${socket.user.email ? `, ${socket.user.email}` : ""}) requested Game Master access.</p><p>Approve or deny it in <a href="${siteBase()}/play">Manage accounts</a>.</p>`) });
    }
  });

  // The owner (or admin) manages a table's allowed player emails while in it.
  function ownsRoom() {
    const r = store.getRoom(roomId);
    return r && socket.user && (r.owner_id === socket.user.id || socket.user.role === "admin");
  }
  socket.on("listAllowed", () => { if (roomId && ownsRoom()) socket.emit("allowedEmails", store.listAllowedEmails(roomId)); });
  socket.on("addAllowed", (email) => {
    if (!roomId || !ownsRoom() || !/^\S+@\S+\.\S+$/.test(String(email || ""))) return;
    store.addAllowedEmail(roomId, email);
    socket.emit("allowedEmails", store.listAllowedEmails(roomId));
  });
  socket.on("removeAllowed", (email) => {
    if (!roomId || !ownsRoom()) return;
    store.removeAllowedEmail(roomId, email);
    socket.emit("allowedEmails", store.listAllowedEmails(roomId));
  });

  // --- Spell lighting effects ----------------------------------------------
  // The DM fires an effect; it's broadcast to the room. Browsers flash the
  // screen, and any connected Hue helper drives the lights. The helper joins a
  // room purely to listen (no password needed — it can only receive).
  socket.on("hueSubscribe", (payload) => {
    // Backward compatible: older helpers send a plain room string; newer ones
    // send { room, url } so the DM panel can link to the helper's setup page.
    const room = typeof payload === "string" ? payload : (payload && payload.room);
    const url = (payload && typeof payload === "object" && payload.url) || "";
    const r = (room || "").trim().toLowerCase();
    if (!r) return;
    socket.join(r);
    hueHelpers.set(socket.id, { room: r, url: String(url).slice(0, 200) });
    io.to(r).emit("hueStatus", hueStatusFor(r));
  });
  // The DM panel asks for the current helper status for its room.
  socket.on("hueStatus", () => { if (roomId) socket.emit("hueStatus", hueStatusFor(roomId)); });
  socket.on("castEffect", (effect) => {
    if (!roomId || !amDM() || !effect) return;
    io.to(roomId).emit("spellEffect", String(effect));
  });

  // --- AI assistant --------------------------------------------------------
  // Players can create their own characters and ask rules questions; the DM can
  // also generate creatures and story/encounter ideas. Rate-limited per socket.
  let aiLast = 0;
  socket.on("aiRequest", async ({ mode, prompt }) => {
    if (!roomId) return;
    if (!claudeKey()) return socket.emit("aiError", "The AI isn't set up on this server yet.");
    const text = String(prompt || "").trim();
    if (!text) return socket.emit("aiError", "Type a description or question first.");
    if ((mode === "creature" || mode === "story") && !amDM()) {
      return socket.emit("aiError", "Only the DM can use that.");
    }
    // Entitlement: the AI assistant is part of the GM + AI plan (or the free trial).
    const me = socket.user ? store.getUserById(socket.user.id) : null;
    if (!entitledAI(me)) {
      return socket.emit("aiError", "✨ The AI assistant is part of the GM + AI plan. Upgrade (or start your free trial) to use it.");
    }
    // Cost cap (admins exempt): each GM gets INCLUDED_AI_USD of API spend per month,
    // plus any purchased top-up credit. Block when both are exhausted.
    if (me.role !== "admin" && aiAvailableUsd(me) <= 0) {
      return socket.emit("aiError", `You've used this month's included AI ($${INCLUDED_AI_USD.toFixed(2)}). Add more AI credit to keep going, or wait for next month's reset.`);
    }
    const now = Date.now();
    if (now - aiLast < 3000) return socket.emit("aiError", "Please wait a few seconds between AI requests.");
    aiLast = now;
    socket.emit("aiBusy", mode);
    let usage = null;
    try {
      if (mode === "character") {
        const out = await callClaude({ system: AI_SYS.character, prompt: text, tool: CHARACTER_TOOL }); usage = out.usage;
        const data = mapCharacter(out.value, names.get(socket.id));
        const id = randomUUID();
        store.upsertCharacter(id, roomId, data);
        io.to(roomId).emit("characterSaved", { id, ...data });
        socket.emit("aiDone", { mode, message: `Created “${data.name}”. Open the PCs tab to see it.` });
      } else if (mode === "creature") {
        const out = await callClaude({ system: AI_SYS.creature, prompt: text, tool: CREATURE_TOOL }); usage = out.usage;
        const data = mapCreature(out.value);
        const id = randomUUID();
        store.upsertCreature(id, roomId, data);
        io.to(roomId).emit("creatureSaved", { id, ...data });
        socket.emit("aiDone", { mode, message: `Added “${data.name}” to the Bestiary.` });
      } else if (mode === "rules" || mode === "story") {
        const out = await callClaude({ system: AI_SYS[mode], prompt: text }); usage = out.usage;
        socket.emit("aiAnswer", { mode, text: out.value });
      } else {
        socket.emit("aiError", "Unknown AI action.");
      }
    } catch (e) {
      console.error("AI error:", e.message);
      socket.emit("aiError", e.message || "AI request failed.");
    }
    // Charge the actual API cost to this account's monthly meter (admins exempt).
    if (usage && me.role !== "admin") {
      const cost = (usage.input_tokens || 0) * AI_PRICE_IN + (usage.output_tokens || 0) * AI_PRICE_OUT;
      const period = aiMonth();
      const prevCost = me.ai_period === period ? (me.ai_cost || 0) : 0;
      const prevUsed = me.ai_period === period ? (me.ai_used || 0) : 0;
      const newCost = prevCost + cost;
      // The portion beyond the included allowance is drawn from purchased credit.
      const spilled = Math.max(0, newCost - INCLUDED_AI_USD) - Math.max(0, prevCost - INCLUDED_AI_USD);
      const newCredit = Math.max(0, (me.ai_credit || 0) - spilled);
      store.setAiMeter(me.id, newCost, newCredit, prevUsed + 1, period);
      socket.emit("aiUsage", { used: Math.min(newCost, INCLUDED_AI_USD), included: INCLUDED_AI_USD, credit: newCredit });
    }
  });

  // --- Account management (system admin role) ------------------------------
  const isAdmin = () => socket.user && socket.user.role === "admin";
  const adminCount = () => store.listUsers().filter((u) => u.role === "admin").length;
  // The very first account created is the "owner" (super-admin). Other admins
  // can manage everyone else, but cannot touch the owner's account.
  const superAdminId = () => { const us = store.listUsers(); return us.length ? us[0].id : null; };
  const amSuper = () => socket.user && socket.user.id === superAdminId();
  const userListPayload = () => {
    const sid = superAdminId();
    return store.listUsers().map((u) => ({
      id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
      gm_requested: u.gm_requested, created_at: u.created_at, is_super: u.id === sid,
      plan: u.plan || null, trialActive: trialActive(u), trialEndsAt: trialEndsAt(u),
      aiUsed: Math.min(aiCostThisMonth(u), INCLUDED_AI_USD), aiIncluded: INCLUDED_AI_USD, aiCredit: u.ai_credit || 0,
      tables: store.getUserTables(u.id, u.email),
    }));
  };
  socket.on("adminUsers", () => {
    if (!isAdmin()) return socket.emit("adminError", "Admins only.");
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminSetRole", ({ id, role }) => {
    if (!isAdmin() || !["player", "gm", "admin"].includes(role)) return;
    const target = store.getUserById(id);
    if (!target) return;
    if (id === superAdminId() && !amSuper())
      return socket.emit("adminError", "Only the owner can change the owner's account.");
    if (target.role === "admin" && role !== "admin" && adminCount() <= 1)
      return socket.emit("adminError", "Can't remove the last admin.");
    store.setUserRole(id, role);
    store.setGmRequested(id, 0); // any pending GM request is now resolved
    if (role === "gm") store.startTrial(id); // begin the 30-day GM trial (no-op if already started)
    socket.emit("adminUserList", userListPayload());
  });
  // Admin manually sets a billing plan (until Stripe is wired): null | 'gm' | 'gm_ai'.
  socket.on("adminSetPlan", ({ id, plan }) => {
    if (!isAdmin()) return socket.emit("adminError", "Admins only.");
    if (![null, "", "gm", "gm_ai", "comp"].includes(plan)) return;
    if (!store.getUserById(id)) return;
    store.setPlan(id, plan || null);
    socket.emit("adminUserList", userListPayload());
  });
  // Admin grants AI top-up credit (USD of API allowance). Until Stripe, this is
  // how you sell extra AI usage; later a Stripe purchase calls the same path.
  socket.on("adminAddAiCredit", ({ id, usd }) => {
    if (!isAdmin()) return socket.emit("adminError", "Admins only.");
    const amount = Number(usd);
    if (!store.getUserById(id) || !isFinite(amount) || amount === 0) return;
    store.addAiCredit(id, amount);
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminDenyGm", (id) => {
    if (!isAdmin()) return;
    store.setGmRequested(id, 0);
    socket.emit("adminUserList", userListPayload());
  });
  socket.on("adminResetPassword", ({ id, newPassword }) => {
    if (!isAdmin()) return;
    if (id === superAdminId() && !amSuper())
      return socket.emit("adminError", "Only the owner can reset the owner's password.");
    if (!newPassword || String(newPassword).length < 6) return socket.emit("adminError", "New password must be at least 6 characters.");
    if (!store.getUserById(id)) return;
    store.setUserPassword(id, bcrypt.hashSync(String(newPassword), 10));
    socket.emit("adminNotice", "Password reset ✓");
  });
  socket.on("adminDeleteUser", (id) => {
    if (!isAdmin()) return;
    if (id === socket.user.id) return socket.emit("adminError", "You can't delete your own account here.");
    if (id === superAdminId()) return socket.emit("adminError", "The owner account can't be deleted.");
    const target = store.getUserById(id);
    if (!target) return;
    if (target.role === "admin" && adminCount() <= 1)
      return socket.emit("adminError", "Can't delete the last admin.");
    store.deleteUser(id);
    socket.emit("adminUserList", userListPayload());
  });

  // --- Owner room management (admin.key password) --------------------------
  function checkAdmin(pw) {
    const real = adminPassword();
    return real && pw === real;
  }
  socket.on("adminList", (password) => {
    if (!adminPassword()) return socket.emit("adminError", "Admin isn't set up on this server yet.");
    if (!checkAdmin(password)) return socket.emit("adminError", "Wrong admin password.");
    socket.emit("adminRooms", store.listRooms());
  });
  socket.on("adminDelete", ({ password, room }) => {
    if (!checkAdmin(password)) return socket.emit("adminError", "Wrong admin password.");
    purgeRoom(room);
    socket.emit("adminRooms", store.listRooms());
  });

  // --- Role-based table management (no password) ---------------------------
  // Drop a table and all its in-memory state, and tell anyone still inside.
  function purgeRoom(room) {
    store.deleteRoom(room);
    initiatives.delete(room); fogRooms.delete(room); voiceRooms.delete(room);
    annotations.delete(room); timers.delete(room);
    io.to(room).emit("chat", sys("This table was deleted."));
  }
  function allTablesPayload() {
    const byId = Object.fromEntries(store.listUsers().map((u) => [u.id, u]));
    return store.listRooms().map((r) => ({ ...r, owner: r.owner_id ? (byId[r.owner_id]?.username || "—") : "—" }));
  }
  // A GM deletes a table they own; an admin can delete any table.
  socket.on("deleteTable", (room) => {
    if (!socket.user) return;
    const rid = String(room || "").trim().toLowerCase();
    const r = store.getRoom(rid);
    if (!r) return;
    const owner = r.owner_id === socket.user.id;
    if (!owner && !isAdmin()) return socket.emit("adminError", "Only the table's owner or an admin can delete it.");
    purgeRoom(rid);
    socket.emit("myTablesList", store.getUserTables(socket.user.id, socket.user.email));
    if (isAdmin()) socket.emit("adminTableList", allTablesPayload());
  });
  // Admin-only: list every table (with its owner) for the admin tables panel.
  socket.on("adminTables", () => {
    if (!isAdmin()) return socket.emit("adminError", "Admins only.");
    socket.emit("adminTableList", allTablesPayload());
  });

  // --- Map (DM only) -------------------------------------------------------
  socket.on("setMap", (url) => {
    if (!roomId || !amDM()) return;
    store.setMap(roomId, url);
    store.setMapRotation(roomId, 0); // new map starts unrotated
    io.to(roomId).emit("mapUrl", url);
    io.to(roomId).emit("mapRotation", 0);
    // A new map starts fully hidden again if fog was on.
    const f = getFog(roomId);
    f.revealed.clear();
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("setMapRotation", (deg) => {
    if (!roomId || !amDM()) return;
    const d = ((Number(deg) % 360) + 360) % 360; // normalize to 0/90/180/270
    store.setMapRotation(roomId, d);
    io.to(roomId).emit("mapRotation", d);
  });
  socket.on("setGrid", ({ on, size }) => {
    if (!roomId || !amDM()) return;
    const s = Math.max(16, Math.min(256, Number(size) || 64));
    store.setGrid(roomId, on, s);
    io.to(roomId).emit("gridState", { on: !!on, size: s });
  });

  // --- Fog of war (DM only) ------------------------------------------------
  socket.on("fogSet", (enabled) => {
    if (!roomId || !amDM()) return;
    getFog(roomId).enabled = !!enabled;
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReveal", (cells) => {
    if (!roomId || !amDM() || !Array.isArray(cells)) return;
    const f = getFog(roomId);
    cells.forEach((c) => f.revealed.add(c));
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });
  socket.on("fogReset", () => {
    if (!roomId || !amDM()) return;
    getFog(roomId).revealed.clear();
    persistFog(roomId);
    io.to(roomId).emit("fogState", fogPayload(roomId));
  });

  // --- Tokens --------------------------------------------------------------
  socket.on("addToken", ({ label, color, img }) => {
    if (!roomId || !amDM()) return; // only the DM places tokens
    const token = {
      id: randomUUID(),
      room_id: roomId,
      label: label || "?",
      color: color || "#c0392b",
      img: img || null,
      hp: null, hp_max: null, size: 1,
      x: 60,
      y: 60,
    };
    store.upsertToken(token);
    io.to(roomId).emit("tokenAdded", token);
  });

  socket.on("moveToken", ({ id, x, y }) => {
    if (!roomId) return;
    store.moveToken(id, x, y);
    // Broadcast to everyone else (the mover already sees it locally).
    socket.to(roomId).emit("tokenMoved", { id, x, y });
  });

  socket.on("updateToken", ({ id, label, color, hp, hpMax, size }) => {
    if (!roomId || !amDM()) return;
    const cur = store.getToken(id);
    if (!cur) return;
    const row = {
      id,
      label: label ?? cur.label,
      color: color ?? cur.color,
      hp: hp === undefined ? cur.hp : hp,
      hp_max: hpMax === undefined ? cur.hp_max : hpMax,
      size: size ?? cur.size ?? 1,
    };
    store.updateTokenRow(row);
    io.to(roomId).emit("tokenUpdated", { id, label: row.label, color: row.color, hp: row.hp, hp_max: row.hp_max, size: row.size });
  });

  socket.on("deleteToken", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteToken(id);
    io.to(roomId).emit("tokenDeleted", id);
  });

  // Pings — anyone can drop a "look here" marker; coordinates are normalized to
  // the map so they land on the same spot for everyone regardless of zoom/screen.
  socket.on("ping", ({ nx, ny }) => {
    if (!roomId || typeof nx !== "number" || typeof ny !== "number") return;
    io.to(roomId).emit("ping", { nx, ny });
  });

  // --- Dice + chat ---------------------------------------------------------
  socket.on("roll", async (notation, opts = {}) => {
    if (!roomId) return;
    const a = rollDice(notation);
    const who = names.get(socket.id) || "Player";
    if (a.error) { socket.emit("chat", sys(`Roll error: ${a.error}`)); return; }

    let payload;
    if (opts.advantage || opts.disadvantage) {
      const b = rollDice(notation);
      const adv = !!opts.advantage;
      const keep = adv ? (a.total >= b.total ? a : b) : (a.total <= b.total ? a : b);
      payload = {
        type: "roll", who,
        text: `rolled ${a.notation} with ${adv ? "advantage" : "disadvantage"} = ${keep.total}`,
        detail: `kept ${keep.total} of [${a.total}, ${b.total}]`,
        dice: keep.dice,
        ts: Date.now(),
      };
    } else {
      payload = { type: "roll", who, text: `rolled ${a.notation} = ${a.total}`, detail: a.breakdown, dice: a.dice, ts: Date.now() };
    }

    if (opts.secret) {
      payload.text = "🔒 " + payload.text;
      socket.emit("chat", payload); // the roller sees it
      const socks = await io.in(roomId).fetchSockets();
      for (const s of socks) { if (s.id !== socket.id && dmFlags.get(s.id)) s.emit("chat", payload); } // and the DM
    } else {
      io.to(roomId).emit("chat", payload);
    }
  });

  socket.on("chat", (text) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("chat", {
      type: "msg",
      who: names.get(socket.id) || "Player",
      text: String(text).slice(0, 1000),
      ts: Date.now(),
    });
  });

  // --- Character sheets ----------------------------------------------------
  // Players may edit only their own sheets; the DM may edit anyone's. Sheets
  // created before roles existed have no owner and stay editable by all.
  function mayEditChar(id) {
    if (amDM() || !id) return true;
    const existing = store.getCharacters(roomId).find((c) => c.id === id);
    if (!existing || !existing.owner) return true;
    return existing.owner === names.get(socket.id);
  }
  socket.on("saveCharacter", ({ id, data }) => {
    if (!roomId || !mayEditChar(id)) return;
    const charId = id || randomUUID();
    if (!data.owner) data.owner = names.get(socket.id); // stamp creator
    store.upsertCharacter(charId, roomId, data);
    io.to(roomId).emit("characterSaved", { id: charId, ...data });
  });

  socket.on("deleteCharacter", (id) => {
    if (!roomId || !mayEditChar(id)) return;
    store.deleteCharacter(id);
    io.to(roomId).emit("characterDeleted", id);
  });

  // --- Creatures (monsters / NPCs) — DM only -------------------------------
  socket.on("saveCreature", ({ id, data }) => {
    if (!roomId || !amDM()) return;
    const cid = id || randomUUID();
    store.upsertCreature(cid, roomId, data);
    io.to(roomId).emit("creatureSaved", { id: cid, ...data });
  });
  socket.on("deleteCreature", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteCreature(id);
    io.to(roomId).emit("creatureDeleted", id);
  });

  // --- Asset finder: search Creative-Commons libraries for maps & audio ----
  // DM types a description; we search Openverse (no key needed) for openly-
  // licensed images/audio they can preview and add. "Add" reuses saveMap/saveSound.
  socket.on("findAssets", async ({ kind, query }) => {
    if (!roomId || !amDM()) return;
    const q = String(query || "").trim().slice(0, 120);
    if (!q) return socket.emit("assetResults", { kind, items: [], error: "Type what you're looking for." });
    const t0 = Date.now();
    try {
      const items = await searchOpenverse(kind === "sounds" ? "audio" : "images", q);
      console.log(`[finder] ${kind} "${q}" -> ${items.length} results in ${Date.now() - t0}ms`);
      socket.emit("assetResults", { kind, items });
    } catch (e) {
      console.log(`[finder] ${kind} "${q}" -> ERROR ${e.message} in ${Date.now() - t0}ms`);
      socket.emit("assetResults", { kind, items: [], error: "Search failed: " + (e.message || "try again") });
    }
  });

  // --- AI map generation (DM only, metered like the AI assistant) ----------
  socket.on("generateMap", async ({ prompt, use }) => {
    if (!roomId || !amDM()) return;
    if (!imageGenConfigured()) return socket.emit("mapGenError", "AI map generation isn't set up on this server yet.");
    const desc = String(prompt || "").trim().slice(0, 300);
    if (!desc) return socket.emit("mapGenError", "Describe the map you want first.");
    const me = socket.user ? store.getUserById(socket.user.id) : null;
    if (!entitledAI(me)) return socket.emit("mapGenError", "✨ AI map generation is part of the GM + AI plan. Upgrade (or start your free trial) to use it.");
    if (me.role !== "admin" && aiAvailableUsd(me) < IMAGE_COST_USD) {
      return socket.emit("mapGenError", `That would exceed this month's included AI ($${INCLUDED_AI_USD.toFixed(2)}). Add AI credit, or wait for next month's reset.`);
    }
    const now = Date.now();
    if (now - aiLast < 3000) return socket.emit("mapGenError", "Please wait a few seconds between AI requests.");
    aiLast = now;
    socket.emit("mapGenBusy");
    const t0 = Date.now();
    try {
      const url = await generateMapImage(desc);
      const name = desc.slice(0, 40);
      const id = randomUUID();
      store.saveMapEntry(id, roomId, name, url); // add to the shared library
      io.emit("mapSaved", { id, name, url });
      socket.emit("mapGenDone", { url, name, use: !!use }); // client reuses setMap to go live
      console.log(`[mapgen] "${desc}" -> ${url} in ${Date.now() - t0}ms`);
      // Charge the estimated image cost to this account's monthly meter (admins exempt).
      if (me.role !== "admin") {
        const period = aiMonth();
        const prevCost = me.ai_period === period ? (me.ai_cost || 0) : 0;
        const prevUsed = me.ai_period === period ? (me.ai_used || 0) : 0;
        const newCost = prevCost + IMAGE_COST_USD;
        const spilled = Math.max(0, newCost - INCLUDED_AI_USD) - Math.max(0, prevCost - INCLUDED_AI_USD);
        const newCredit = Math.max(0, (me.ai_credit || 0) - spilled);
        store.setAiMeter(me.id, newCost, newCredit, prevUsed + 1, period);
        socket.emit("aiUsage", { used: Math.min(newCost, INCLUDED_AI_USD), included: INCLUDED_AI_USD, credit: newCredit });
      }
    } catch (e) {
      console.log(`[mapgen] ERROR ${e.message} in ${Date.now() - t0}ms`);
      socket.emit("mapGenError", e.message || "Map generation failed.");
    }
  });

  // --- Saved maps — shared library, DM only --------------------------------
  // Broadcast library changes to ALL clients (every room) so the shared library
  // stays consistent everywhere.
  socket.on("saveMap", ({ name, url }) => {
    if (!roomId || !amDM() || !url) return;
    const id = randomUUID();
    store.saveMapEntry(id, roomId, name || "Map", url);
    io.emit("mapSaved", { id, name: name || "Map", url });
  });
  socket.on("deleteMap", (id) => {
    if (!roomId || !amDM()) return;
    store.deleteMapEntry(id);
    io.emit("mapDeleted", id);
  });

  // --- Initiative tracker --------------------------------------------------
  function pushInit() {
    persistInit(roomId);
    io.to(roomId).emit("initState", getInit(roomId));
  }
  socket.on("initAdd", ({ name, init, hp, ac }) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    state.entries.push({
      id: randomUUID(),
      name: name || "Combatant",
      init: Number(init) || 0,
      hp: hp ?? "",
      ac: ac ?? "",
    });
    sortInit(state);
    pushInit();
  });
  socket.on("initUpdate", ({ id, field, value }) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    e[field] = field === "init" ? Number(value) || 0 : value;
    if (field === "init") sortInit(state);
    pushInit();
  });
  socket.on("initRemove", (id) => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    state.entries = state.entries.filter((e) => e.id !== id);
    if (state.turn >= state.entries.length) state.turn = 0;
    pushInit();
  });
  socket.on("initNext", () => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    if (!state.entries.length) return;
    state.started = true; // lock in the order so late arrivals don't move the highlight
    state.turn += 1;
    if (state.turn >= state.entries.length) { state.turn = 0; state.round += 1; }
    pushInit();
  });
  socket.on("initClear", () => {
    if (!roomId || !amDM()) return;
    initiatives.set(roomId, { round: 1, turn: 0, started: false, entries: [] });
    pushInit();
  });
  socket.on("initRollAll", () => {
    if (!roomId || !amDM()) return;
    const state = getInit(roomId);
    state.entries.forEach((e) => { e.init = 1 + Math.floor(Math.random() * 20); });
    state.started = false; // re-establish the order from the top
    sortInit(state);
    pushInit();
  });

  // --- Voice / video signaling (WebRTC mesh) -------------------------------
  // The server only relays signaling messages; audio/video flow peer-to-peer.
  // The newest peer to join initiates offers to everyone already in the call,
  // which avoids "glare" (both sides offering at once).
  socket.on("voiceJoin", () => {
    if (!roomId) return;
    const set = voiceRooms.get(roomId) || new Set();
    const existing = [...set];
    set.add(socket.id);
    voiceRooms.set(roomId, set);
    socket.emit("voicePeers", existing); // tell newcomer who to call
  });
  socket.on("voiceSignal", ({ to, signal }) => {
    io.to(to).emit("voiceSignal", { from: socket.id, signal });
  });
  socket.on("voiceLeave", () => leaveVoice());

  function leaveVoice() {
    if (!roomId) return;
    const set = voiceRooms.get(roomId);
    if (set && set.delete(socket.id)) {
      socket.to(roomId).emit("voicePeerLeft", socket.id);
    }
  }

  socket.on("disconnect", () => {
    leaveVoice();
    if (roomId && names.has(socket.id)) {
      io.to(roomId).emit("chat", sys(`${names.get(socket.id)} left`));
    }
    names.delete(socket.id);
    dmFlags.delete(socket.id);
    const helper = hueHelpers.get(socket.id);
    if (helper) { hueHelpers.delete(socket.id); io.to(helper.room).emit("hueStatus", hueStatusFor(helper.room)); }
  });
});

function sys(text) {
  return { type: "system", text, ts: Date.now() };
}

// ===========================================================================
//  AI assistant (Anthropic Claude). The API key lives in a `claude.key` file in
//  the app dir (kept out of git). If absent, AI features are simply disabled.
// ===========================================================================
const CLAUDE_KEY_FILE = join(__dirname, "claude.key");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
function claudeKey() {
  try { return existsSync(CLAUDE_KEY_FILE) ? readFileSync(CLAUDE_KEY_FILE, "utf8").trim() : null; }
  catch { return null; }
}

const ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const SKILL_NAMES = [
  "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History",
  "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception",
  "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival",
];
const abilityProps = {
  type: "object",
  properties: Object.fromEntries(ABILS.map((a) => [a, { type: "integer" }])),
  required: ABILS,
};

const CHARACTER_TOOL = {
  name: "save_character",
  description: "Save a complete, rules-legal D&D 5e (SRD) player character.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      class: { type: "string", description: "e.g. Barbarian, Wizard" },
      level: { type: "integer" },
      armor_class: { type: "integer" },
      hit_points: { type: "integer", description: "maximum HP for the class/level" },
      proficiency_bonus: { type: "integer" },
      abilities: abilityProps,
      saving_throw_proficiencies: { type: "array", items: { type: "string", enum: ABILS } },
      skill_proficiencies: { type: "array", items: { type: "string", enum: SKILL_NAMES } },
      spell_slots: {
        type: "array",
        items: { type: "object", properties: { level: { type: "integer" }, total: { type: "integer" } }, required: ["level", "total"] },
      },
      inventory_and_notes: { type: "string", description: "equipment, key features, and a one-line background" },
    },
    required: ["name", "class", "level", "armor_class", "hit_points", "proficiency_bonus", "abilities"],
  },
};
const CREATURE_TOOL = {
  name: "save_creature",
  description: "Save a D&D 5e (SRD) monster or NPC stat block.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["Monster", "NPC"] },
      type: { type: "string", description: "e.g. Medium humanoid, Large dragon" },
      armor_class: { type: "integer" },
      hit_points: { type: "integer" },
      speed: { type: "string", description: "e.g. 30 ft" },
      abilities: abilityProps,
      actions_and_notes: { type: "string", description: "attacks, special abilities, and notes" },
    },
    required: ["name", "kind", "armor_class", "hit_points", "abilities"],
  },
};

// Search Openverse (openverse.org) for Creative-Commons, commercially-usable
// images or audio. No API key required. Returns a tidy list for the asset finder.
const OV_STOPWORDS = new Set(["a", "an", "the", "with", "of", "and", "to", "for", "in", "on", "at", "my", "your", "some", "that", "this"]);
async function ovQuery(media, q) {
  const url = `https://api.openverse.org/v1/${media}/?q=${encodeURIComponent(q)}&page_size=18&mature=false`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": "warcrimes-vtt/1.0 (+https://warcrimes.us)" }, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "the search service timed out" : "couldn't reach the search service");
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error("search service returned " + res.status);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: (r.title || "Untitled").slice(0, 80),
    by: r.creator || r.source || "",
    license: ((r.license || "").toUpperCase() + (r.license_version ? " " + r.license_version : "")).trim(),
    source: r.foreign_landing_url || r.url || "",
    media: r.url || "",
    thumb: r.thumbnail || r.url || "",
    duration: Math.round((r.duration || 0) / 1000), // ms → s (audio)
  })).filter((x) => x.media);
}
// Forgiving search: drop filler words and try a few phrasings until we get hits.
async function searchOpenverse(media, query) {
  const clean = query.toLowerCase().split(/\s+/).filter((w) => w && !OV_STOPWORDS.has(w)).join(" ").trim() || query;
  const hint = media === "audio" ? "ambience" : "map";
  const tries = [`${clean} ${hint}`, clean]; // specific → looser (cap at 2 so it fails fast)
  const seen = new Set();
  for (const q of tries) {
    if (seen.has(q)) continue;
    seen.add(q);
    const items = await ovQuery(media, q);
    if (items.length) return items;
  }
  return [];
}

async function callClaude({ system, prompt, tool }) {
  const key = claudeKey();
  if (!key) throw new Error("The AI isn't set up on this server yet.");
  const body = { model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: prompt }] };
  if (tool) { body.tools = [tool]; body.tool_choice = { type: "tool", name: tool.name }; }

  // Give up after 30s instead of hanging forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The AI took too long (over 30s). Try again, or switch to the faster Haiku model.");
    throw new Error("Couldn't reach the AI service: " + e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (r.status === 401) throw new Error("AI key was rejected — check claude.key.");
    if (r.status === 429) throw new Error("AI is rate-limited or out of credit. Try again shortly.");
    throw new Error(`AI request failed (${r.status}). ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  const usage = data.usage || {}; // { input_tokens, output_tokens }
  if (tool) {
    const block = (data.content || []).find((c) => c.type === "tool_use");
    if (!block) throw new Error("AI did not return structured data.");
    return { value: block.input, usage };
  }
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  return { value: text, usage };
}

// ---------------------------------------------------------------------------
//  AI map generation. Claude can't make images, so this uses a separate image
//  API (OpenAI's Images API by default). The key lives in `image.key` (kept out
//  of git) or the OPENAI_API_KEY / IMAGE_API_KEY env var. If absent, the feature
//  is simply disabled and the UI says so. Each generated image is saved into the
//  same /uploads dir as uploaded maps, so it flows through the normal map library.
// ---------------------------------------------------------------------------
const IMAGE_KEY_FILE = join(__dirname, "image.key");
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const IMAGE_API_URL = process.env.IMAGE_API_URL || "https://api.openai.com/v1/images/generations";
const IMAGE_SIZE = process.env.IMAGE_SIZE || "1536x1024"; // landscape, good for battle maps
// Estimated API cost per generated image, charged to the GM's monthly AI meter.
const IMAGE_COST_USD = Number(process.env.IMAGE_COST_USD || 0.08);
function imageKey() {
  try {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
    if (process.env.IMAGE_API_KEY) return process.env.IMAGE_API_KEY.trim();
    return existsSync(IMAGE_KEY_FILE) ? readFileSync(IMAGE_KEY_FILE, "utf8").trim() : null;
  } catch { return null; }
}
const imageGenConfigured = () => !!imageKey();
async function generateMapImage(description) {
  const key = imageKey();
  if (!key) throw new Error("AI map generation isn't set up on this server yet.");
  const prompt =
    `Top-down overhead view tabletop RPG battle map: ${description}. ` +
    `Detailed digital painting, clear walkable terrain, consistent lighting, ` +
    `no text, no labels, no grid lines, no characters, no tokens, no UI.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // image gen is slow
  let r;
  try {
    r = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: IMAGE_SIZE }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Image generation took too long. Try again.");
    throw new Error("Couldn't reach the image service: " + e.message);
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (r.status === 401) throw new Error("Image API key was rejected — check image.key.");
    if (r.status === 429) throw new Error("Image API is rate-limited or out of credit. Try again shortly.");
    throw new Error(`Image generation failed (${r.status}). ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("Image service returned no image.");
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const fname = `${randomUUID()}.png`;
  writeFileSync(join(UPLOAD_DIR, fname), Buffer.from(b64, "base64"));
  return `/uploads/${fname}`;
}

function mapCharacter(c, owner) {
  const ab = {}; ABILS.forEach((a) => (ab[a] = Number(c.abilities?.[a]) || 10));
  const saves = {}; (c.saving_throw_proficiencies || []).forEach((s) => { if (ABILS.includes(s)) saves[s] = true; });
  const skills = {}; (c.skill_proficiencies || []).forEach((s) => { if (SKILL_NAMES.includes(s)) skills[s] = true; });
  const slots = {};
  (c.spell_slots || []).forEach((s) => { if (s.level >= 1 && s.level <= 9 && s.total > 0) slots[s.level] = { used: 0, total: Number(s.total) }; });
  return {
    name: c.name || "Adventurer", cls: c.class || "", level: Number(c.level) || 1,
    ac: Number(c.armor_class) || 10, hp: Number(c.hit_points) || 10, hpMax: Number(c.hit_points) || 10,
    prof: Number(c.proficiency_bonus) || 2, abilities: ab, saves, skills, slots,
    inventory: c.inventory_and_notes || "", owner,
  };
}
function mapCreature(c) {
  const ab = {}; ABILS.forEach((a) => (ab[a] = Number(c.abilities?.[a]) || 10));
  return {
    name: c.name || "Creature", kind: c.kind === "NPC" ? "NPC" : "Monster", type: c.type || "",
    ac: Number(c.armor_class) || 10, hp: Number(c.hit_points) || 10, speed: c.speed || "30 ft",
    abilities: ab, actions: c.actions_and_notes || "",
  };
}

const AI_SYS = {
  character: "You build complete, rules-legal D&D 5e SRD player characters from a description. Pick sensible ability scores, compute AC and maximum HP appropriate to the class and level, set the proficiency bonus by level, choose class/background skill and saving-throw proficiencies, include spell slots for casters, and summarize equipment, key features and a one-line background. Use only SRD-safe content.",
  creature: "You build D&D 5e SRD monster or NPC stat blocks from a description. Provide sensible AC, HP, speed, ability scores, and a concise list of attacks/abilities. Use only SRD-safe content.",
  rules: "You are a concise D&D 5e rules assistant using the 5e SRD. Answer briefly and practically. When relevant, mention the matching page on dnd5e.wikidot.com. If something is homebrew or you're unsure, say so.",
  story: "You are a creative D&D 5e DM assistant. Produce vivid, ready-to-use encounters, loot, plot hooks, or descriptions. Keep it concise and usable at the table.",
};

httpServer.listen(PORT, () => {
  console.log(`D&D VTT running on http://localhost:${PORT}`);
});
