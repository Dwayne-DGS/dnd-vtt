# 🎲 D&D VTT — Philips Hue Helper

Flashes your Philips Hue lights to match spell effects fired from the tabletop
(Fireball → red flash, Healing → green glow, Lightning → strobe, etc.).

It runs on any computer on the **same Wi-Fi/network as your Hue Bridge** — your
Mac now, a Raspberry Pi later (the exact same files work on both). It has a small
web page for setup, so you never edit config files by hand.

## Run it

Requires **Node.js 18+** (on a Mac: `brew install node`, or download from nodejs.org).

```bash
cd hue-helper
npm install
npm start
```

Then open **http://localhost:8765** in your browser and follow the 4 steps:

1. **Connect to your game** — enter your server URL (`https://warcrimes.us`) and the
   room name you play in, then *Save & connect*.
2. **Pair your Hue Bridge** — click *Find it* to auto-detect the bridge, **press the
   round button on top of the bridge**, then click *Pair*.
3. **Choose lights** — check the lights you want effects on (none checked = all).
   Set your normal ambiance and click *Set current lights as "normal"* so the
   lights return to it after each effect.
4. **Test effects** — fire any effect right from the page to see it on your lights.

Once it's set up and connected, whenever the DM clicks an effect in the game (the
**FX** tab), your lights react automatically. Leave this program running during play.

## How it works

- The game server only relays the effect *name* to everyone in the room.
- This helper subscribes to your room and maps each effect to Hue light commands.
- It talks to the bridge over your local network (HTTPS, self-signed cert — normal
  for a local device, so cert checks are off; this never leaves your network).

## Moving to a Raspberry Pi later

Copy the `hue-helper` folder to the Pi, run `npm install` and `npm start`, and open
`http://<pi-ip>:8765` from any device on your network to set it up. Use something
like `pm2` to keep it running on boot (same as the game server).

## Effects

`fire`, `fireball`, `lightning`, `healing`, `frost`, `necrotic`, `radiant`,
`poison`, `darkness`, and `reset` (return to normal). Want different colors or to
map specific spells to effects? It's all in the `FX` table in `hue-helper.js`.

## Notes

- `config.json` (your bridge key, room, light choices) stays on this machine and is
  not committed to git.
- If pairing can't reach the bridge, double-check the IP and that you're on the same
  network. Very old bridges may need HTTP — the helper auto-falls-back if HTTPS fails.
