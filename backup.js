// Safe online backup of the SQLite database.
//   node backup.js
// Uses better-sqlite3's backup API, which produces a consistent copy even while
// the app is running (it's WAL-aware) — much safer than `cp vtt.db`. Writes a
// timestamped file into ./backups and keeps the most recent KEEP copies.

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "vtt.db");
const BACKUP_DIR = join(__dirname, "backups");
const KEEP = 14; // how many backups to retain

if (!existsSync(DB_FILE)) { console.error("No vtt.db found at", DB_FILE); process.exit(1); }
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = join(BACKUP_DIR, `vtt-${stamp}.db`);

const db = new Database(DB_FILE, { readonly: true });
db.backup(dest)
  .then(() => {
    db.close();
    const kb = Math.round(statSync(dest).size / 1024);
    console.log(`Backup written: ${dest} (${kb} KB)`);
    // Prune oldest, keep the newest KEEP files.
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("vtt-") && f.endsWith(".db"))
      .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(KEEP).forEach(({ f }) => { unlinkSync(join(BACKUP_DIR, f)); console.log("Pruned old backup:", f); });
  })
  .catch((e) => { console.error("Backup failed:", e.message); db.close(); process.exit(1); });
