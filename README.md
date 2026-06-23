# ⚔️ D&D Virtual Tabletop

A lightweight, self-hosted live virtual tabletop for D&D 5e. Everyone who joins
the same **room** shares one game in real time:

- **Shared map + tokens** — set a battle-map image (paste a URL **or upload a file**),
  add tokens (colored discs or **uploaded portrait images**), drag them around with
  optional **grid snapping**, and **rotate** the map in 90° steps. Moves appear
  instantly for every player. **Shared map library:** saved maps are available in
  every room — upload once, reuse in any campaign.
- **Fog of war** — the DM toggles fog on, then paints to reveal areas as the party
  explores. Players see hidden areas blacked out; the DM sees them dimmed.
- **Bestiary → map** — place any saved creature onto the map as a token in one click.
- **Dice roller** — quick buttons (d20, d12, …) plus full notation like `2d6+3`
  or `3d10+2d4+1`. Rolls are broadcast to the whole table.
- **Character sheets** — full D&D 5e sheets saved per room: abilities, AC, HP
  (current/max), proficiency, saving throws, all 18 skills, spell slots, and
  inventory — with auto-computed modifiers and roll buttons on every save and skill.
- **Bestiary** — build and save monsters *and* NPCs with full stat blocks (AC, HP,
  speed, abilities, actions/notes). Comes with SRD templates (goblin, orc,
  skeleton, wolf, bandit, generic NPC). One click rolls a creature into initiative.
- **Initiative tracker** — add PCs and monsters, auto-sorted by initiative, with a
  highlighted active turn, "Next turn" button, and round counter. Synced live.
- **Reference** — type a spell or magic-item name to look it up on the D&D 5e wiki,
  plus quick links to spell/item/condition indexes.
- **Text chat** — in-session messaging.
- **Voice & video** — built-in WebRTC voice/video chat (Join voice → mute/camera
  toggles → video tiles over the map). **Requires HTTPS** — see `HTTPS-SETUP.md`.
- **Rooms, DM & player passwords** — the DM creates a named table and sets a DM
  password (secret) plus an optional player password (shared with players).
  Matching the DM password makes you DM; the player password lets people in to
  play. Everything is saved per room — characters, bestiary, maps, tokens, **and**
  initiative & fog — so you can close up and continue the campaign later.
- **DM controls** — the DM controls maps, tokens, the bestiary, and initiative;
  players can roll, chat, use voice, move tokens, and edit only their own
  character sheet. Enforced server-side, not just hidden in the UI.

No accounts, no build step. One Node process, one SQLite file.

---

## Run it locally

Requires **Node.js 18+**.

```bash
npm install
npm start
```

Open <http://localhost:3000>, pick a name and a room (e.g. `curse-of-strahd`),
and click **Enter table**. Open a second browser tab/window with the *same room*
to see the live sync. Share the room name with your players to all play together.

> **Note:** `better-sqlite3` is a native module. On a fresh machine you may need
> build tools. On Ubuntu: `sudo apt install -y build-essential python3`. Most
> systems get a prebuilt binary automatically and need nothing extra.

---

## Deploy to your Hetzner CX22 (Ubuntu)

After you've created the server and can SSH in:

### 1. Generate an SSH key (on your own computer, if you haven't)

```bash
ssh-keygen -t ed25519 -C "you@example.com"      # press Enter through the prompts
cat ~/.ssh/id_ed25519.pub                        # paste THIS into Hetzner's "SSH keys"
```

Then SSH in: `ssh root@YOUR_SERVER_IP`

### 2. Install Node + a process manager

```bash
apt update && apt install -y nodejs npm build-essential python3
npm install -g pm2
```

### 3. Upload the app

From your computer (in the `dnd-vtt` folder):

```bash
scp -r . root@YOUR_SERVER_IP:/opt/dnd-vtt
```

### 4. Start it and keep it running

```bash
cd /opt/dnd-vtt
npm install
pm2 start server.js --name dnd-vtt
pm2 save && pm2 startup        # makes it restart on reboot
```

The app now runs on port 3000. Visit `http://YOUR_SERVER_IP:3000`.

### 5. (Recommended) Domain + HTTPS

Point a domain at the server's IP, then put Nginx in front for a real
`https://` address:

```bash
apt install -y nginx certbot python3-certbot-nginx
# Create /etc/nginx/sites-available/dnd with a proxy_pass to localhost:3000
# (include the WebSocket upgrade headers — see the snippet below), then:
certbot --nginx -d yourdomain.com
```

Nginx location block (WebSocket-ready):

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

> **Easier alternative:** install **Coolify** on the server and deploy this repo
> through its UI — it handles the process, HTTPS, and redeploys for you.

---

## Project layout

```
dnd-vtt/
├── server.js          # Express + Socket.IO; all realtime event handling
├── db.js              # SQLite persistence (rooms, tokens, characters)
├── dice.js            # Dice-notation parser (shared logic)
├── package.json
└── public/
    ├── index.html     # App shell (join screen + table UI)
    ├── style.css
    └── js/
        ├── main.js        # Join flow, socket connection, tab wiring
        ├── map.js         # Canvas map + draggable tokens
        ├── chat.js        # Chat log + dice UI
        └── character.js   # 5e character sheets
```

State lives in `vtt.db` (created automatically). Back it up to keep campaigns.

---

## Roadmap / next phases

## Owner room management

Set an owner password once on the server to manage rooms:

```bash
echo "your-owner-password" > /opt/dnd-vtt/admin.key
pm2 restart dnd-vtt
```

Then on the landing screen click **"Manage rooms (owner)"**, enter that password,
and you'll get a list of every room (with created/last-active dates and content
counts) and a Delete button to clean up old tables. The `admin.key` file is kept
out of git. If it's absent, room management is simply disabled.

---

## Roadmap / next phases

Still on the list:

1. **TURN relay (coturn)** — only if voice fails across strict home networks;
   guarantees connectivity when plain STUN can't punch through.
2. **Auth / DM controls** — currently anyone in a room can edit anything. Add a
   DM password and player permissions.
3. **Fog of war & grid snapping** — hide unexplored map areas; snap tokens to a grid.
4. **Token images & map uploads** — upload portraits and map files from your
   computer instead of pasting URLs.
5. **Link creatures to map tokens** — drop a bestiary monster straight onto the map.
6. **Upgrade to Postgres** — swap `db.js` when you outgrow SQLite (rarely needed
   for a home group).
```
