// True 3D dice. WebGL dice (Three.js) tumble across the screen and settle showing
// the authoritative value the SERVER rolled — physics is cosmetic, the result is real.
// Falls back gracefully: if WebGL is unavailable or the player turns 3D dice off in
// Settings, the classic 2D animation (dice.js) handles the roll instead.
import * as THREE from "/vendor/three.module.js";
import { SKINS, currentSkin } from "./dice.js";

let socket = null;
let enabled = true;          // account preference
let webglOK = null;          // detected lazily
let renderer, scene, camera, overlay, raf = null;
let live = [];               // active dice this throw
let endsAt = 0;

const TYPE_FOR_SIDES = { 4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12", 20: "d20", 100: "d10" };

export function dice3dActive() { return enabled && detectWebGL(); }

export function setDice3dEnabled(on) {
  enabled = !!on;
  window.dice3dActive = dice3dActive();
}

function detectWebGL() {
  if (webglOK !== null) return webglOK;
  try {
    const c = document.createElement("canvas");
    webglOK = !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { webglOK = false; }
  return webglOK;
}

// ---- textures -------------------------------------------------------------
function gradientTexture(skin) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 256, 256);
  for (const [o, col] of skin.stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    x.globalAlpha = Math.random() * 0.5 + 0.15;
    x.fillStyle = "#fff";
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, Math.random() * 1.6 + 0.3, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function numberTexture(n, skin) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d");
  x.clearRect(0, 0, 128, 128);
  x.font = "bold 74px Cinzel, Georgia, serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  const s = String(n);
  x.lineWidth = 7; x.strokeStyle = skin.numStroke; x.strokeText(s, 64, 70);
  x.fillStyle = skin.num; x.fillText(s, 64, 70);
  // underline 6/9 so they read unambiguously
  if (s === "6" || s === "9") { x.strokeStyle = skin.num; x.lineWidth = 5; x.beginPath(); x.moveTo(44, 96); x.lineTo(84, 96); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- geometry + faces -----------------------------------------------------
function d10Geometry() {
  const r = 0.62, h = 0.78, eq = [];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.31; eq.push([Math.cos(a) * r, 0, Math.sin(a) * r]); }
  const top = [0, h, 0], bot = [0, -h, 0], pos = [];
  const push = (v) => pos.push(v[0], v[1], v[2]);
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    push(top); push(eq[i]); push(eq[j]);
    push(bot); push(eq[j]); push(eq[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function baseGeometry(type) {
  switch (type) {
    case "d4": return new THREE.TetrahedronGeometry(0.72);
    case "d6": return new THREE.BoxGeometry(0.92, 0.92, 0.92);
    case "d8": return new THREE.OctahedronGeometry(0.72);
    case "d10": return d10Geometry();
    case "d12": return new THREE.DodecahedronGeometry(0.66);
    default: return new THREE.IcosahedronGeometry(0.72);
  }
}
// Group triangles into die-faces by shared outward normal; return centroids + normals.
function extractFaces(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute("position");
  const groups = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac).normalize();
    // Cluster coplanar triangles by normal direction (robust to float noise).
    let grp = groups.find((gr) => gr.normal.dot(n) > 0.985);
    if (!grp) { grp = { normal: n.clone(), pts: [] }; groups.push(grp); }
    grp.pts.push(a.clone(), b.clone(), c.clone());
  }
  return groups.map((grp) => {
    const cen = new THREE.Vector3();
    grp.pts.forEach((v) => cen.add(v)); cen.multiplyScalar(1 / grp.pts.length);
    return { normal: grp.normal, centroid: cen };
  }).sort((u, v) => (v.normal.y - u.normal.y) || (u.normal.x - v.normal.x));
}

function makeDie(sides, skin) {
  const type = TYPE_FOR_SIDES[sides] || "d20";
  const geo = baseGeometry(type);
  const body = new THREE.MeshStandardMaterial({ map: gradientTexture(skin), metalness: 0.35, roughness: 0.42, emissive: new THREE.Color(skin.stops[1][1]), emissiveIntensity: 0.12 });
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, body);
  group.add(mesh);
  const faces = extractFaces(geo);
  const count = Math.min(faces.length, type === "d4" ? 4 : faces.length);
  faces.forEach((f, i) => {
    if (i >= count) return;
    const value = i + 1;
    const tex = numberTexture(value, skin);
    const sz = type === "d6" ? 0.5 : type === "d20" ? 0.34 : 0.42;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    plane.position.copy(f.centroid).addScaledVector(f.normal, 0.012);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.normal);
    plane.userData.value = value;
    plane.userData.numMat = plane.material;
    group.add(plane);
    f.plane = plane;
  });
  geo.computeBoundingSphere();
  group.userData = { faces: faces.slice(0, count), radius: geo.boundingSphere.radius };
  return group;
}

// ---- scene ----------------------------------------------------------------
function ensureScene() {
  if (renderer) return;
  overlay = document.getElementById("dice3d");
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 8.2, 7.6); camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0x6677aa, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 1.7); d.position.set(4, 10, 6); scene.add(d);
  const pl = new THREE.PointLight(0x88aaff, 0.6, 40); pl.position.set(-6, 5, 2); scene.add(pl);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  overlay.appendChild(renderer.domElement);
  sizeRenderer();
  window.addEventListener("resize", sizeRenderer);
}
function sizeRenderer() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}

// world half-width visible at y=0 (to place dice within frame)
const TRAY = 4.2;

export function roll3D(diceArr) {
  if (!dice3dActive() || !Array.isArray(diceArr) || !diceArr.length) return;
  ensureScene();
  // clear previous
  for (const d of live) scene.remove(d.group);
  live = [];
  const skin = SKINS[currentSkin()] || SKINS.galaxy;
  const dice = diceArr.slice(0, 14);
  const n = dice.length;
  const spread = Math.min(TRAY, 0.9 * n);
  dice.forEach((d, i) => {
    const group = makeDie(d.sides, skin);
    const slotX = n === 1 ? 0 : -spread + (2 * spread) * (i / (n - 1));
    const startX = slotX * 0.4 + (Math.random() - 0.5) * 2;
    group.position.set(startX, 6 + Math.random() * 2.5, (Math.random() - 0.5) * 2);
    group.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    scene.add(group);
    live.push({
      group,
      value: d.value,
      sides: d.sides,
      radius: group.userData.radius * 0.82,
      vel: new THREE.Vector3((Math.random() - 0.5) * 3, -2 - Math.random() * 2, (Math.random() - 0.5) * 3),
      ang: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
      phase: "tumble",
      tumbleEnd: 0.85 + Math.random() * 0.25 + i * 0.04,
      t: 0,
      slot: new THREE.Vector3(slotX, 0, 0),
      q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), p0: new THREE.Vector3(),
    });
  });
  overlay.classList.remove("hidden");
  overlay.style.opacity = "1";
  endsAt = performance.now() + 4200;
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

// Quaternion that brings a die's chosen face to point up (+Y) toward the camera.
function targetQuat(die) {
  const faces = die.group.userData.faces;
  let face = faces.find((f) => f.plane && f.plane.userData.value === die.value);
  if (!face) {
    face = faces[0];
    if (face && face.plane) face.plane.material.map = numberTexture(die.value, SKINS[currentSkin()] || SKINS.galaxy), face.plane.material.needsUpdate = true;
  }
  const up = new THREE.Vector3(0, 1, 0);
  const align = new THREE.Quaternion().setFromUnitVectors(face.normal.clone().normalize(), up);
  const yaw = new THREE.Quaternion().setFromAxisAngle(up, (Math.random() - 0.5) * 0.8);
  return yaw.multiply(align);
}

let last = 0;
function loop(now) {
  const dt = Math.min(0.04, (now - last) / 1000); last = now;
  let anyLive = false;
  for (const die of live) {
    die.t += dt;
    if (die.phase === "tumble") {
      anyLive = true;
      die.vel.y -= 16 * dt;                       // gravity
      die.group.position.addScaledVector(die.vel, dt);
      if (die.group.position.y < die.radius) {     // floor bounce
        die.group.position.y = die.radius;
        die.vel.y = Math.abs(die.vel.y) * 0.42;
        die.vel.x *= 0.7; die.vel.z *= 0.7;
        die.ang.multiplyScalar(0.6);
      }
      const a = die.ang;
      const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.x * dt, a.y * dt, a.z * dt));
      die.group.quaternion.premultiply(dq);
      die.ang.multiplyScalar(0.985);
      if (die.t >= die.tumbleEnd) {
        die.phase = "settle"; die.t = 0;
        die.q0.copy(die.group.quaternion); die.q1.copy(targetQuat(die));
        die.p0.copy(die.group.position);
        die.slot.y = die.radius;
      }
    } else if (die.phase === "settle") {
      anyLive = true;
      const k = Math.min(1, die.t / 0.4);
      const e = 1 - Math.pow(1 - k, 3);            // ease-out cubic
      die.group.quaternion.copy(die.q0).slerp(die.q1, e);
      die.group.position.lerpVectors(die.p0, die.slot, e);
      if (k >= 1) { die.phase = "hold"; die.t = 0; }
    } else {
      anyLive = true; // holding until overlay fades
    }
  }
  renderer.render(scene, camera);

  if (now > endsAt) {
    const o = Math.max(0, 1 - (now - endsAt) / 500);
    overlay.style.opacity = String(o);
    if (o <= 0) {
      overlay.classList.add("hidden");
      for (const d of live) scene.remove(d.group);
      live = [];
      cancelAnimationFrame(raf); raf = null;
      return;
    }
  }
  raf = requestAnimationFrame(loop);
}

export function initDice3d(s) {
  socket = s;
  if (window.account && window.account.dice3d != null) enabled = !!window.account.dice3d;
  window.dice3dActive = dice3dActive();
  socket.on("chat", (m) => {
    if (window.tableView) return; // never show dice (incl. secret rolls) on the player-facing screen
    if (m.type === "roll" && m.who === window.playerName && Array.isArray(m.dice) && m.dice.length) {
      roll3D(m.dice);
    }
  });
}
