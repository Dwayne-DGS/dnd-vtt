// Promote a user to system admin — or create an admin account — from the server.
//
//   node make-admin.js <username>             promote an existing user to admin
//   node make-admin.js <username> <password>  create a new admin (if they don't exist)
//
// Run it in the app directory (where vtt.db lives): cd /opt/dnd-vtt && node make-admin.js iggy

import * as store from "./db.js";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const username = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3];

if (!username) {
  console.log("Usage:\n  node make-admin.js <username>             (promote existing user)\n  node make-admin.js <username> <password>  (create a new admin)");
  process.exit(1);
}

const existing = store.getUserByUsername(username);
if (existing) {
  store.setUserRole(existing.id, "admin");
  console.log(`✓ "${username}" is now a system admin.`);
} else if (password) {
  if (password.length < 6) { console.log("Password must be at least 6 characters."); process.exit(1); }
  store.createUser({ id: randomUUID(), username, pass_hash: bcrypt.hashSync(password, 10), role: "admin" });
  console.log(`✓ Created admin account "${username}".`);
} else {
  console.log(`No user named "${username}". To create one as admin:\n  node make-admin.js ${username} <password>`);
}
process.exit(0);
