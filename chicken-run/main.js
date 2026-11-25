import * as THREE from "three";

// ---------- 기본 설정 ----------
const CFG = {
  chunk: 16,
  radius: 4,
  seed: 7241,
  // 이동 물리 (m/s, m/s²)
  maxSpeed: 6.5,
  boostSpeed: 10.5,
  accel: 5.5,
  boostAccel: 9,
  brake: 14,
  drag: 3.2,
  reverseMax: 2.2,
  turnRate: 2.6
};
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (t) => t * t * (3 - 2 * t);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const $ = (id) => document.getElementById(id);

// ---------- 렌더러 / 씬 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color("#bcd5d5");
scene.fog = new THREE.Fog("#bcd5d5", 30, 70);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 200);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  $("status").textContent = "이 페이지는 WebGL이 필요해요. 하드웨어 가속을 켠 브라우저에서 열어 주세요.";
  throw error;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
$("scene").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#e1f1ff", "#79644c", 2.1));
const sun = new THREE.DirectionalLight("#ffdf9e", 3.3);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

// ---------- 노이즈 & 지형 높이 ----------
function hash(x, z, s = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s + CFG.seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), fx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx), fz);
}
// 출발점 근처는 평평하게, 멀어질수록 계단식 언덕
function heightAtCell(x, z) {
  const wx = x + 0.5, wz = z + 0.5;
  const meadow = smooth(clamp((Math.hypot(wx, wz) - 6) / 14, 0, 1));
  const hills = noise(wx * 0.04, wz * 0.03) * 3.4 + noise(wx * 0.12, wz * 0.09) * 0.9;
  return Math.floor(hills * meadow * 2) * 0.5;
}
const ground = (x, z) => heightAtCell(Math.floor(x), Math.floor(z));
// 칸 사이를 부드럽게 보간해 닭이 계단을 자연스럽게 오르내리게 함
function groundSmooth(x, z) {
  const fx = x - 0.5, fz = z - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = smooth(fx - ix), tz = smooth(fz - iz);
  return lerp(
    lerp(heightAtCell(ix, iz), heightAtCell(ix + 1, iz), tx),
    lerp(heightAtCell(ix, iz + 1), heightAtCell(ix + 1, iz + 1), tx),
    tz
  );
}

// ---------- 재질 ----------
const cube = new THREE.BoxGeometry(1, 1, 1);
const color = new THREE.Color();
const flatMat = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
const grassMat = new THREE.MeshStandardMaterial({ color: "#84944a", roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ color: "#8b9280", roughness: 1 });
const barkMat = new THREE.MeshStandardMaterial({ color: "#6b503a", roughness: 1 });
const leafMats = ["#516f43", "#6e8248"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const dummy = new THREE.Object3D();

function matrixAt(mesh, i, x, y, z, sx, sy, sz, yaw = 0) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, yaw, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

const grassUniforms = { time: { value: 0 } };
grassMat.onBeforeCompile = (shader) => {
  shader.uniforms.windTime = grassUniforms.time;
  shader.vertexShader = "uniform float windTime;\n" + shader.vertexShader.replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>
    float sway = sin(windTime * 2.0 + instanceMatrix[3].x * .6 + instanceMatrix[3].z * .4);
    transformed.x += sway * .2 * (position.y + .5);`
  );
};

function pixelMaterial(base, seed) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const baseColor = new THREE.Color(base);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      color.copy(baseColor).multiplyScalar(0.9 + hash(x, y, seed) * 0.19);
      ctx.fillStyle = "#" + color.getHexString();
      ctx.fillRect(x, y, 1, 1);
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.91 });
}
const birdWhite = pixelMaterial("#ece6ce", 88);
const wingShade = pixelMaterial("#cac8b8", 86);
const yellow = pixelMaterial("#d9a044", 89);
const red = pixelMaterial("#b94938", 90);
const eyeMat = new THREE.MeshStandardMaterial({ color: "#141b1b", roughness: 0.33 });
const glintMat = new THREE.MeshStandardMaterial({ color: "#eee8ce", roughness: 0.5 });

// ---------- 지형 청크 ----------
const world = new THREE.Group();
scene.add(world);
const chunks = new Map();
const topColors = ["#879752", "#8d9a59", "#929e5c", "#7e914d", "#a1a567"];
const sideDirs = [
  [-1, 0, (x, z, y, l) => [[x, y, z + 1], [x, y, z], [x, l, z], [x, l, z + 1]], [-1, 0, 0]],
  [1, 0, (x, z, y, l) => [[x + 1, y, z], [x + 1, y, z + 1], [x + 1, l, z + 1], [x + 1, l, z]], [1, 0, 0]],
  [0, -1, (x, z, y, l) => [[x, y, z], [x + 1, y, z], [x + 1, l, z], [x, l, z]], [0, 0, -1]],
  [0, 1, (x, z, y, l) => [[x + 1, y, z + 1], [x, y, z + 1], [x, l, z + 1], [x + 1, l, z + 1]], [0, 0, 1]]
];

function makeChunk(cx, cz) {
  const group = new THREE.Group();
  const sx = cx * CFG.chunk, sz = cz * CFG.chunk;
  group.position.set(sx, 0, sz);
  const pos = [], norm = [], cols = [];
  const quad = (a, b, c, d, n, hex) => {
    color.set(hex);
    for (const p of [a, b, d, b, c, d]) {
      pos.push(...p);
      norm.push(...n);
      cols.push(color.r, color.g, color.b);
    }
  };
  const rocks = [], trunks = [], leaves = [], grass = [];
  for (let z = 0; z < CFG.chunk; z++)
    for (let x = 0; x < CFG.chunk; x++) {
      const wx = sx + x, wz = sz + z, y = heightAtCell(wx, wz), r = hash(wx, wz, 1);
      quad([x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [0, 1, 0], topColors[Math.floor(r * 5)]);
      for (const [dx, dz, corners, n] of sideDirs) {
        const below = heightAtCell(wx + dx, wz + dz);
        if (below >= y) continue;
        const lip = Math.max(below, y - 0.17);
        quad(...corners(x, z, y, lip), n, "#75864a");
        if (below < lip) quad(...corners(x, z, lip, below), n, r > 0.5 ? "#8a7050" : "#967b55");
      }
      const far = Math.hypot(wx, wz) > 8;
      if (far && r > 0.985) {
        const s = 0.25 + hash(wx, wz, 4) * 0.65;
        rocks.push([x + 0.5, y + s * 0.35, z + 0.5, s, s * 0.7, s * 0.8, r * TAU]);
      }
      if (far && hash(wx, wz, 17) > 0.996) {
        const h = 2.2 + hash(wx, wz, 18) * 1.7;
        trunks.push([x + 0.5, y + h * 0.5, z + 0.5, 0.34, h, 0.34]);
        leaves.push([x + 0.5, y + h, z + 0.5, 2.6, 1.2, 2.5]);
        leaves.push([x + 0.3, y + h + 0.8, z + 0.5, 1.9, 0.8, 1.9]);
        leaves.push([x + 0.5, y + h + 1.35, z + 0.4, 1, 0.4, 1.1]);
      }
    }
  for (let i = 0; i < 60; i++) {
    const x = hash(i + cx * 71, cz, 21) * CFG.chunk, z = hash(i + cx * 71, cz, 22) * CFG.chunk;
    const y = ground(sx + x, sz + z), h = 0.16 + hash(i, cz, 23) * 0.35;
    grass.push([x, y + h * 0.5, z, 0.065, h, 0.065]);
    grass.push([x + 0.12, y + h * 0.35, z + 0.08, 0.065, h * 0.7, 0.065, 0.5]);
    grass.push([x - 0.1, y + h * 0.3, z - 0.07, 0.065, h * 0.6, 0.065, -0.4]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const terrain = new THREE.Mesh(geo, flatMat);
  terrain.receiveShadow = true;
  group.add(terrain);
  const instances = (list, mat, cast) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(cube, mat, list.length);
    list.forEach((p, i) => matrixAt(mesh, i, ...p));
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  instances(grass, grassMat, false);
  instances(rocks, rockMat, true);
  instances(trunks, barkMat, true);
  instances(leaves, leafMats[Math.abs(cz) % 2], true);
  world.add(group);
  chunks.set(cx + "," + cz, group);
}

let lastChunk = "";
function streamTerrain(px, pz) {
  const cx = Math.floor(px / CFG.chunk), cz = Math.floor(pz / CFG.chunk), r = CFG.radius;
  const key = cx + "," + cz;
  if (key === lastChunk) return;
  lastChunk = key;
  for (let z = cz - r; z <= cz + r; z++)
    for (let x = cx - r; x <= cx + r; x++) if (!chunks.has(x + "," + z)) makeChunk(x, z);
  for (const [k, group] of chunks) {
    const [x, z] = k.split(",").map(Number);
    if (Math.abs(x - cx) > r || Math.abs(z - cz) > r) {
      world.remove(group);
      group.children.forEach((m) => {
        if (m.geometry !== cube) m.geometry.dispose();
        if (m.isInstancedMesh) m.dispose();
      });
      chunks.delete(k);
    }
  }
}

// ---------- 구름 ----------
const cloudMat = new THREE.MeshStandardMaterial({ color: "#f1eee0", roughness: 1 });
const clouds = new THREE.Group();
scene.add(clouds);
for (let i = 0; i < 16; i++) {
  const cluster = new THREE.Group();
  cluster.position.set((hash(i, 0, 70) - 0.5) * 160, 20 + hash(i, 0, 71) * 14, (hash(i, 0, 72) - 0.5) * 160);
  for (let j = 0; j < 4; j++) {
    const m = new THREE.Mesh(cube, cloudMat);
    m.scale.set(4 + hash(i, j, 73) * 6, 1.2, 3 + hash(i, j, 74) * 4);
    m.position.set((j - 1.5) * 2.4, hash(i, j, 75), (hash(i, j, 76) - 0.5) * 3);
    cluster.add(m);
  }
  clouds.add(cluster);
}

// ---------- 닭 ----------
function box(parent, mat, size, position, rotation) {
  const m = new THREE.Mesh(cube, mat);
  m.scale.set(...size);
  m.position.set(...position);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
function faceEyes(parent, width, y, z, size) {
  for (const sign of [-1, 1]) {
    box(parent, glintMat, [0.018, size * 1.35, size * 1.35], [sign * (width / 2 + 0.006), y, z]);
    box(parent, eyeMat, [0.022, size, size * 0.68], [sign * (width / 2 + 0.013), y, z + 0.012]);
  }
}

const chicken = new THREE.Group();
scene.add(chicken);
const rig = new THREE.Group(); // 기울임(lean/bank) 전용
chicken.add(rig);
rig.scale.setScalar(1.1);
const torso = new THREE.Group();
rig.add(torso);
box(torso, birdWhite, [0.38, 0.42, 0.51], [0, 0, 0]);
box(torso, birdWhite, [0.22, 0.31, 0.23], [0, 0.24, 0.16]);
box(torso, birdWhite, [0.24, 0.28, 0.19], [0, 0.13, -0.29], [0.55, 0, 0]);
const face = new THREE.Group();
face.position.set(0, 0.4, 0.23);
torso.add(face);
box(face, birdWhite, [0.3, 0.3, 0.3], [0, 0, 0]);
faceEyes(face, 0.3, 0.035, 0.04, 0.045);
box(face, yellow, [0.17, 0.1, 0.19], [0, -0.025, 0.22]);
box(face, red, [0.1, 0.14, 0.1], [0, -0.14, 0.15]);
for (let i = 0; i < 3; i++) box(face, red, [0.075, 0.11 + (i % 2) * 0.04, 0.075], [0, 0.19, (i - 1) * 0.075]);

const wings = [-1, 1].map((sign) => {
  const wing = new THREE.Group();
  wing.position.set(sign * 0.18, 0.08, -0.015);
  torso.add(wing);
  box(wing, birdWhite, [0.11, 0.29, 0.43], [sign * 0.06, -0.12, 0]);
  box(wing, wingShade, [0.12, 0.1, 0.39], [sign * 0.065, -0.26, -0.02]);
  return { wing, sign };
});
const legs = [-1, 1].map((sign) => {
  const pivot = new THREE.Group();
  rig.add(pivot);
  box(pivot, yellow, [0.045, 0.32, 0.045], [0, -0.16, 0]);
  for (let i = 0; i < 3; i++) box(pivot, yellow, [0.026, 0.035, 0.17], [0.035 * (i - 1), -0.32, 0.055]);
  return { pivot, sign, wasDown: false };
});

// ---------- 먼지 파티클 ----------
const DUST = 120;
const dustMat = new THREE.MeshStandardMaterial({ color: "#c9b78e", roughness: 1, transparent: true, opacity: 0.85 });
const dustMesh = new THREE.InstancedMesh(cube, dustMat, DUST);
dustMesh.frustumCulled = false;
scene.add(dustMesh);
const dust = Array.from({ length: DUST }, () => ({ life: 0 }));
let dustCursor = 0;
function puff(x, y, z, count, strength) {
  for (let i = 0; i < count; i++) {
    const p = dust[dustCursor];
    dustCursor = (dustCursor + 1) % DUST;
    const a = Math.random() * TAU;
    Object.assign(p, {
      x, y: y + 0.03, z,
      vx: Math.cos(a) * 0.6 * strength, vy: 0.6 + Math.random() * 0.8 * strength, vz: Math.sin(a) * 0.6 * strength,
      life: 0.45 + Math.random() * 0.35, size: 0.05 + Math.random() * 0.06 * strength, spin: Math.random() * TAU
    });
  }
}
function updateDust(dt, t) {
  dust.forEach((p, i) => {
    p.life = Math.max(0, p.life - dt);
    if (p.life > 0) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= 2 * dt;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.size * Math.min(1, p.life * 4));
      dummy.rotation.set(p.spin + t, p.spin, t * 0.7);
      dummy.updateMatrix();
      dustMesh.setMatrixAt(i, dummy.matrix);
    } else matrixAt(dustMesh, i, 0, -50, 0, 0, 0, 0);
  });
  dustMesh.instanceMatrix.needsUpdate = true;
}

// ---------- 입력 ----------
const keys = new Set();
const keyButtons = [...document.querySelectorAll("[data-key]")];
const alias = { ArrowUp: "KeyW", ArrowDown: "KeyS", ArrowLeft: "KeyA", ArrowRight: "KeyD", ShiftRight: "ShiftLeft" };
const norm = (code) => alias[code] || code;
function syncKeys() {
  for (const b of keyButtons) b.setAttribute("aria-pressed", keys.has(b.dataset.key));
}
const handled = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]);
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const code = norm(e.code);
  if (code === "KeyR") return reset();
  if (!handled.has(code)) return;
  e.preventDefault();
  keys.add(code);
  syncKeys();
});
addEventListener("keyup", (e) => {
  keys.delete(norm(e.code));
  syncKeys();
});
addEventListener("blur", () => {
  keys.clear();
  syncKeys();
});
// 화면 버튼(터치/마우스)으로도 조작
for (const b of keyButtons) {
  const press = (e) => {
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    keys.add(b.dataset.key);
    syncKeys();
  };
  const release = () => {
    keys.delete(b.dataset.key);
    syncKeys();
  };
  b.addEventListener("pointerdown", press);
  b.addEventListener("pointerup", release);
  b.addEventListener("pointercancel", release);
  b.addEventListener("lostpointercapture", release);
  b.addEventListener("keydown", (e) => e.code === "Space" && e.preventDefault());
}
$("reset").addEventListener("click", () => reset());

// ---------- 상태 ----------
const state = { x: 0, z: 0, y: 0, heading: 0, speed: 0, turnVel: 0, lean: 0, bank: 0, phase: 0, distance: 0, time: 0 };
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

function reset() {
  Object.assign(state, { x: 0, z: 0, heading: 0, speed: 0, turnVel: 0, lean: 0, bank: 0, distance: 0 });
  state.y = groundSmooth(0, 0);
  placeCamera(1);
}

function placeCamera(k) {
  const back = 5.2 + Math.max(0, state.speed) * 0.18;
  const up = 2.7 + Math.max(0, state.speed) * 0.05;
  const tx = state.x - Math.sin(state.heading) * back;
  const tz = state.z - Math.cos(state.heading) * back;
  const ty = Math.max(state.y + up, groundSmooth(tx, tz) + 1.2);
  camPos.lerp(new THREE.Vector3(tx, ty, tz), k);
  camLook.lerp(new THREE.Vector3(state.x + Math.sin(state.heading) * 1.5, state.y + 0.7, state.z + Math.cos(state.heading) * 1.5), k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- 이동 물리 ----------
function updatePhysics(dt) {
  const fwd = keys.has("KeyW"), back = keys.has("KeyS");
  const left = keys.has("KeyA"), right = keys.has("KeyD");
  const boost = keys.has("ShiftLeft") && fwd;
  const top = boost ? CFG.boostSpeed : CFG.maxSpeed;
  const prev = state.speed;

  if (fwd && !back) {
    if (state.speed < 0) state.speed = Math.min(0, state.speed + CFG.brake * dt);
    else if (state.speed < top) state.speed = Math.min(top, state.speed + (boost ? CFG.boostAccel : CFG.accel) * dt);
    else state.speed = Math.max(top, state.speed - CFG.drag * dt); // 질주를 놓으면 서서히 감속
  } else if (back && !fwd) {
    if (state.speed > 0) state.speed = Math.max(0, state.speed - CFG.brake * dt); // 브레이크
    else state.speed = Math.max(-CFG.reverseMax, state.speed - CFG.accel * 0.6 * dt); // 뒷걸음질
  } else {
    // 입력이 없으면 마찰로 자연 감속
    const s = Math.sign(state.speed);
    state.speed = s * Math.max(0, Math.abs(state.speed) - CFG.drag * dt);
  }

  // 회전: 느릴수록 제자리 회전도 가능, 빠를수록 살짝 둔해짐
  const steer = (left ? 1 : 0) - (right ? 1 : 0);
  const sp = Math.abs(state.speed);
  const agility = sp < 0.2 ? 0.7 : 1.15 - Math.min(sp / CFG.boostSpeed, 1) * 0.45;
  const dir = state.speed < -0.1 ? -1 : 1;
  state.turnVel = lerp(state.turnVel, steer * CFG.turnRate * agility * dir, damp(10, dt));
  state.heading += state.turnVel * dt;

  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;
  state.distance += sp * dt;
  state.y = lerp(state.y, groundSmooth(state.x, state.z), damp(14, dt));

  const accel = dt > 0 ? (state.speed - prev) / dt : 0;
  state.lean = lerp(state.lean, clamp(accel * 0.035, -0.25, 0.3) + sp * 0.025, damp(6, dt));
  state.bank = lerp(state.bank, -state.turnVel * sp * 0.035, damp(6, dt));
  return boost && state.speed > CFG.maxSpeed * 0.9;
}

// ---------- 애니메이션 ----------
function animateChicken(dt, boosting) {
  const sp = Math.abs(state.speed);
  const run = clamp(sp / CFG.maxSpeed, 0, 1.6);
  state.phase = (state.phase + dt * (sp / 1.1 + (sp > 0.05 ? 0.6 : 0)) * Math.sign(state.speed || 1)) % 1;
  if (state.phase < 0) state.phase += 1;
  const ph = state.phase * TAU;
  const t = state.time;

  chicken.position.set(state.x, state.y, state.z);
  chicken.rotation.y = state.heading;
  rig.rotation.set(state.lean, 0, state.bank);

  const hop = Math.abs(Math.sin(ph)) * 0.06 * Math.min(run, 1.2);
  torso.position.y = 0.55 + hop + (sp < 0.05 ? 0.012 * Math.sin(t * 3) : 0);
  torso.rotation.x = 0.04 * Math.sin(ph * 2) * run;
  torso.rotation.z = 0.06 * Math.sin(ph) * run;

  // 머리: 달릴 땐 앞뒤로 까딱, 멈추면 가끔 콕콕 쪼기
  const peck = sp < 0.05 ? Math.max(0, Math.sin(t * 1.3)) ** 12 * 0.9 : 0;
  face.position.z = 0.23 + 0.05 * Math.sin(ph * 2) * Math.min(run, 1);
  face.rotation.x = peck + 0.08 * Math.sin(ph * 2 - 0.5) * run;

  // 날개: 질주 시 크게 퍼덕
  const flapAmt = boosting ? 0.9 : 0.12 * run;
  const flap = Math.sin(t * (boosting ? 28 : 14));
  for (const { wing, sign } of wings) wing.rotation.z = sign * (0.1 + flapAmt * (0.6 + 0.4 * flap));

  // 다리 + 발자국 먼지
  for (const leg of legs) {
    const p = (state.phase + (leg.sign > 0 ? 0.5 : 0)) % 1;
    const swing = Math.sin(p * TAU);
    leg.pivot.position.set(leg.sign * 0.1, 0.38 + Math.max(0, swing) * 0.06 * Math.min(run, 1.3), 0);
    leg.pivot.rotation.x = swing * (0.15 + 0.6 * Math.min(run, 1.4));
    const down = p > 0.5 && sp > 0.4;
    if (down && !leg.wasDown) {
      const s = Math.sin(state.heading), c = Math.cos(state.heading);
      puff(state.x + c * leg.sign * 0.11, state.y, state.z - s * leg.sign * 0.11, boosting ? 4 : sp > 3 ? 2 : 1, 0.5 + run * 0.6);
    }
    leg.wasDown = down;
  }
}

// ---------- HUD ----------
const speedOut = $("speed-out"), distOut = $("dist-out"), speedBar = $("speed-bar");
function updateHud(boosting) {
  speedOut.textContent = state.speed.toFixed(1);
  distOut.textContent = Math.floor(state.distance);
  speedBar.style.width = clamp((Math.abs(state.speed) / CFG.boostSpeed) * 100, 0, 100) + "%";
  speedBar.classList.toggle("boost", boosting);
}

// ---------- 루프 ----------
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
document.addEventListener("visibilitychange", () => (last = performance.now()));

reset();
streamTerrain(0, 0);
$("status").hidden = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05); // rAF 시각이 performance.now()보다 앞설 수 있어 음수 방지
  last = now;
  if (document.hidden) return;
  state.time += dt;

  const boosting = updatePhysics(dt);
  animateChicken(dt, boosting);
  streamTerrain(state.x, state.z);
  updateDust(dt, state.time);

  // 그림자가 닭을 따라오도록 태양 이동
  sun.position.set(state.x - 14, 22, state.z + 14);
  sun.target.position.set(state.x, 0, state.z);
  clouds.position.set(state.x * 0.6 + Math.sin(state.time * 0.02) * 8, 0, state.z * 0.6);
  grassUniforms.time.value = state.time;

  // 속도감: 빠를수록 시야각이 넓어짐
  camera.fov = lerp(camera.fov, 48 + Math.max(0, state.speed) * 1.1, damp(4, dt));
  camera.updateProjectionMatrix();
  placeCamera(damp(5, dt));

  updateHud(boosting);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
