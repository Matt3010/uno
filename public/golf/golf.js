import * as THREE from 'three';

const P = window.GolfPhysics;
const C = window.GolfCourse;
const $ = (id) => document.getElementById(id);
const socket = io('/golf');

// --- Sessione salvata, per rientrare se cade la linea ---
function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) { /* senza memoria del browser si va avanti lo stesso */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

let state = null;
let course = null; // buche della partita in corso (dal seme)
let builtHole = -1;
let builtSeed = null;
let clockBase = 0; // performance.now()/1000 quando la buca è iniziata (orologio locale)

let toastTimer;
function toast(msg, big = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('big', big);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), big ? 1800 : 2600);
}

function show(screen) {
  for (const id of ['home', 'lobby']) $(id).classList.toggle('hidden', id !== screen);
  $('hud').classList.toggle('hidden', screen !== 'game');
}

// --- Ingresso ---
const urlRoom = new URLSearchParams(location.search).get('room');
$('nameInput').value = load('golf-name') || load('uno-name') || '';
if (urlRoom) $('codeInput').value = urlRoom.toUpperCase();
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('mobileNote').classList.remove('hidden');

function myName() {
  const n = $('nameInput').value.trim();
  if (!n) {
    toast('Scrivi il tuo nome');
    return null;
  }
  store('golf-name', n);
  return n;
}
$('createBtn').onclick = () => {
  const name = myName();
  if (name) socket.emit('create', { name });
};
$('joinBtn').onclick = () => {
  const name = myName();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) return toast('Il codice ha 4 lettere');
  socket.emit('join', { code, name });
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('shareLink').value);
    toast('Link copiato!');
  } catch (_) {
    $('shareLink').select();
    toast('Copia il link a mano');
  }
};
$('startBtn').onclick = () => socket.emit('start');
$('againBtn').onclick = () => socket.emit('start');
$('leaveBtn').onclick = () => {
  store('golf-session', null);
  location.href = '/golf/';
};

socket.on('connect', () => {
  // rientro automatico nella stanza dopo un ricaricamento o un calo di linea
  const saved = JSON.parse(load('golf-session') || 'null');
  if (saved && (!urlRoom || urlRoom.toUpperCase() === saved.code)) {
    socket.emit('join', { code: saved.code, playerId: saved.playerId, name: load('golf-name') });
  }
});
socket.on('joined', ({ code, playerId }) => {
  store('golf-session', JSON.stringify({ code, playerId }));
  history.replaceState(null, '', `?room=${code}`);
});
socket.on('error-msg', (msg) => {
  if (msg === 'Stanza non trovata') store('golf-session', null);
  toast(msg);
});

// --- Scena 3D ---
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd3ff');
scene.fog = new THREE.Fog('#8fd3ff', 45, 110);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 300);
scene.add(new THREE.HemisphereLight('#dff4ff', '#3d6b2f', 1.1));
const sun = new THREE.DirectionalLight('#fff6e0', 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#4f8f3a' }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.4;
ground.receiveShadow = true;
scene.add(ground);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const MAT = {
  grassA: new THREE.MeshLambertMaterial({ color: '#57c45a' }),
  grassB: new THREE.MeshLambertMaterial({ color: '#4fb653' }),
  base: new THREE.MeshLambertMaterial({ color: '#6b4a2b' }),
  wall: new THREE.MeshLambertMaterial({ color: '#c98b4f' }),
  wallTop: new THREE.MeshLambertMaterial({ color: '#e7b07a' }),
  sand: new THREE.MeshLambertMaterial({ color: '#ecd59a' }),
  water: new THREE.MeshLambertMaterial({ color: '#2d8fe0', transparent: true, opacity: 0.85 }),
  slope: new THREE.MeshLambertMaterial({ color: '#3e9e46' }),
  arrow: new THREE.MeshLambertMaterial({ color: '#d9f7c8' }),
  bumper: new THREE.MeshLambertMaterial({ color: '#e2342b' }),
  bumperTop: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  spinner: new THREE.MeshLambertMaterial({ color: '#7d5cff' }),
  cup: new THREE.MeshBasicMaterial({ color: '#111111' }),
  pole: new THREE.MeshLambertMaterial({ color: '#f4f1e8' }),
  flag: new THREE.MeshLambertMaterial({ color: '#e2342b', side: THREE.DoubleSide }),
  start: new THREE.MeshLambertMaterial({ color: '#2f7d36' }),
};

let holeGroup = null;
let spinnerMeshes = [];
let flag = null;

function flatShape(poly, y, mat) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

function wallMesh([x1, z1, x2, z2]) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len + 0.16, 0.32, 0.16), MAT.wall);
  body.position.y = 0.16;
  const top = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.05, 0.22), MAT.wallTop);
  top.position.y = 0.33;
  g.add(body, top);
  g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
  g.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

function buildHole(hole) {
  if (holeGroup) scene.remove(holeGroup);
  holeGroup = new THREE.Group();
  spinnerMeshes = [];
  hole.tiles.forEach(([x, z, s], i) => {
    const top = new THREE.Mesh(new THREE.BoxGeometry(s, 0.02, s), i % 2 ? MAT.grassB : MAT.grassA);
    top.position.set(x + s / 2, -0.01, z + s / 2);
    top.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(s, 0.38, s), MAT.base);
    base.position.set(x + s / 2, -0.21, z + s / 2);
    holeGroup.add(top, base);
  });
  for (const zone of hole.zones) {
    if (zone.type === 'sand') holeGroup.add(flatShape(zone.poly, 0.004, MAT.sand));
    if (zone.type === 'water') holeGroup.add(flatShape(zone.poly, 0.006, MAT.water));
    if (zone.type === 'slope') {
      holeGroup.add(flatShape(zone.poly, 0.002, MAT.slope));
      // frecce che indicano da che parte scende
      const xs = zone.poly.map((p) => p[0]);
      const zs = zone.poly.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const ang = Math.atan2(zone.force[1], zone.force[0]);
      for (const off of [-1.3, 0, 1.3]) {
        const a = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 3), MAT.arrow);
        const holder = new THREE.Group();
        holder.add(a);
        a.rotation.z = -Math.PI / 2;
        holder.rotation.y = -ang;
        holder.position.set(cx - Math.sin(ang) * off, 0.01, cz + Math.cos(ang) * off);
        holder.scale.y = 0.05;
        holeGroup.add(holder);
      }
    }
  }
  for (const w of hole.walls) holeGroup.add(wallMesh(w));
  for (const b of hole.bumpers) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.36, 24), MAT.bumper);
    body.position.set(b.x, 0.18, b.z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.6, b.r * 0.6, 0.38, 24), MAT.bumperTop);
    cap.position.set(b.x, 0.19, b.z);
    body.castShadow = true;
    holeGroup.add(body, cap);
  }
  for (const s of hole.spinners) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.22, 0.16), MAT.spinner);
    bar.position.set(s.x, 0.14, s.z);
    bar.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), MAT.wallTop);
    post.position.set(s.x, 0.25, s.z);
    holeGroup.add(bar, post);
    spinnerMeshes.push({ mesh: bar, s });
  }
  const [cx, cz] = hole.cup;
  const cup = new THREE.Mesh(new THREE.CircleGeometry(P.CUP_R, 32), MAT.cup);
  cup.rotation.x = -Math.PI / 2;
  cup.position.set(cx, 0.008, cz);
  flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8), MAT.pole);
  pole.position.y = 0.8;
  const cloth = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0.6, 1.42, 0), new THREE.Vector3(0, 1.24, 0),
  ]), MAT.flag);
  cloth.geometry.computeVertexNormals();
  flag.add(pole, cloth);
  flag.position.set(cx, 0, cz);
  flag.traverse((o) => { o.castShadow = true; });
  const [sx, sz] = hole.start;
  const mat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.9), MAT.start);
  mat.position.set(sx, 0.003, sz);
  holeGroup.add(cup, flag, mat);
  scene.add(holeGroup);

  // il sole segue la buca per avere ombre nitide
  const xs = hole.tiles.map((t) => t[0]);
  const zs = hole.tiles.map((t) => t[1]);
  const mx = (Math.min(...xs) + Math.max(...xs) + C.TILE) / 2;
  const mz = (Math.min(...zs) + Math.max(...zs) + C.TILE) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + C.TILE;
  sun.position.set(mx + 12, 25, mz + 8);
  sun.target.position.set(mx, 0, mz);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
}

// --- Palline ---
const balls = new Map(); // id -> { mesh, label, sim, x, z, moving }
const ballGeo = new THREE.SphereGeometry(P.BALL_R, 24, 16);

function ballFor(member) {
  let b = balls.get(member.id);
  if (!b) {
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color: member.color }));
    mesh.castShadow = true;
    scene.add(mesh);
    const label = document.createElement('div');
    label.className = 'label';
    $('labels').append(label);
    b = { mesh, label, sim: null, x: 0, z: 0, sunk: false };
    balls.set(member.id, b);
  }
  b.mesh.material.color.set(member.color);
  b.label.textContent = member.id === state.you ? 'Tu' : member.name;
  b.label.style.color = member.color;
  return b;
}

function dropBalls() {
  for (const [id, b] of balls) {
    if (!state || !state.members.some((m) => m.id === id)) {
      scene.remove(b.mesh);
      b.label.remove();
      balls.delete(id);
    }
  }
}

function holeClock() {
  return performance.now() / 1000 - clockBase;
}

// Avvia una pallina (mia o di un altro) e la fa correre fotogramma per fotogramma
function launch(b, from, angle, power, t0, mine) {
  const sim = P.createBall(from[0], from[1]);
  P.shoot(sim, angle, power);
  b.sim = { ball: sim, t: t0, t0, start: from, mine, acc: 0 };
  b.x = from[0];
  b.z = from[1];
}

function advanceBall(id, b, dt) {
  if (!b.sim) return;
  const hole = course[state.holeIndex];
  const s = b.sim;
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= P.DT) {
    s.acc -= P.DT;
    const ev = P.step(s.ball, hole, P.DT, s.t);
    s.t += P.DT;
    let end = ev;
    if (!end && P.atRest(s.ball, hole)) end = 'rest';
    if (!end && s.t - s.t0 > 30) end = 'rest'; // non dovrebbe mai servire: si ferma comunque
    if (end) {
      finishBall(id, b, end);
      return;
    }
  }
  b.x = s.ball.x;
  b.z = s.ball.z;
}

function finishBall(id, b, event) {
  const s = b.sim;
  b.sim = null;
  if (event === 'water') {
    b.x = s.start[0];
    b.z = s.start[1];
    if (s.mine) toast('💦 In acqua! +1 colpo');
  } else {
    b.x = s.ball.x;
    b.z = s.ball.z;
  }
  if (event === 'sunk') {
    b.sunk = true;
    if (s.mine) {
      const strokes = state.strokes[state.you][state.holeIndex];
      toast(scoreWord(strokes, course[state.holeIndex].par), true);
    }
  }
  if (s.mine) socket.emit('result', { event, x: b.x, z: b.z });
}

function scoreWord(strokes, par) {
  if (strokes === 1) return '🎉 Buca in uno!';
  const d = strokes - par;
  return { '-3': '🦅 Albatross!', '-2': '🦅 Eagle!', '-1': '🐦 Birdie!', 0: '⛳ Par', 1: 'Bogey', 2: 'Doppio bogey' }[d] || `In buca in ${strokes}`;
}

socket.on('shot', ({ id, angle, power, t0, from }) => {
  const member = state && state.members.find((m) => m.id === id);
  if (!member || !course) return;
  launch(ballFor(member), from, angle, power, t0, false);
});

// --- Mira e tiro ---
let yaw = 0; // direzione in cui guarda la telecamera = direzione del tiro
let pitch = 0.55;
let zoom = 5;
let charging = false;
let chargeStart = 0;
let dragging = false;
let lastX = 0;
const keys = new Set();

function myBall() {
  return state && balls.get(state.you);
}

function canShoot() {
  if (!state || state.phase !== 'playing' || !course) return false;
  const b = myBall();
  if (!b || b.sim || state.done[state.you]) return false;
  return state.strokes[state.you][state.holeIndex] < state.maxStrokes;
}

function power() {
  // la forza sale e scende finché si tiene premuto
  const t = (performance.now() - chargeStart) / 1000;
  const cycle = (t / 1.6) % 2;
  return cycle < 1 ? cycle : 2 - cycle;
}

function shoot() {
  const p = Math.max(0.03, power());
  charging = false;
  $('powerBox').classList.add('hidden');
  if (!canShoot()) return;
  const b = myBall();
  const t0 = holeClock();
  socket.emit('shot', { angle: yaw, power: p, t0 });
  launch(b, [b.x, b.z], yaw, p, t0, true);
}

const canvas = $('view');
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 || e.button === 1) {
    dragging = true;
    lastX = e.clientX;
  } else if (e.button === 0 && canShoot()) {
    charging = true;
    chargeStart = performance.now();
    $('powerBox').classList.remove('hidden');
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 2 || e.button === 1) dragging = false;
  else if (e.button === 0 && charging) shoot();
});
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.006;
  pitch = Math.max(0.15, Math.min(1.2, pitch + e.movementY * 0.004));
  lastX = e.clientX;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = Math.max(1.6, Math.min(14, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.key.toLowerCase());
  if (e.code === 'Space' && !e.repeat && canShoot()) {
    e.preventDefault();
    charging = true;
    chargeStart = performance.now();
    $('powerBox').classList.remove('hidden');
  }
  if (e.key === 'Escape' && charging) {
    charging = false;
    $('powerBox').classList.add('hidden');
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.code === 'Space' && charging) shoot();
});

// linea di mira davanti alla pallina
// puntini sul prato più una punta di freccia: la scia si allunga con la forza
const aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
const aim = new THREE.Group();
const AIM_DOTS = 12;
const aimDots = Array.from({ length: AIM_DOTS }, () => {
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), aimMat);
  d.rotation.x = -Math.PI / 2;
  aim.add(d);
  return d;
});
const aimTip = new THREE.Mesh(new THREE.CircleGeometry(0.16, 3), aimMat);
aimTip.rotation.x = -Math.PI / 2;
aim.add(aimTip);
scene.add(aim);

// --- Ciclo dei fotogrammi ---
let last = performance.now();
const camPos = new THREE.Vector3(0, 8, 8);
const camLook = new THREE.Vector3();
const tmp = new THREE.Vector3();

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (keys.has('a') || keys.has('arrowleft')) yaw -= 1.8 * dt;
  if (keys.has('d') || keys.has('arrowright')) yaw += 1.8 * dt;
  if (keys.has('w') || keys.has('arrowup')) pitch = Math.max(0.15, pitch - 0.8 * dt);
  if (keys.has('s') || keys.has('arrowdown')) pitch = Math.min(1.2, pitch + 0.8 * dt);

  if (course && state && state.phase !== 'lobby') {
    const t = holeClock();
    for (const { mesh, s } of spinnerMeshes) {
      const [x1, z1, x2, z2] = P.spinnerSegment(s, t);
      mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    }
    if (flag) flag.children[1].rotation.y = Math.sin(t * 2) * 0.25;

    for (const [id, b] of balls) {
      advanceBall(id, b, dt);
      b.mesh.visible = !(b.sunk && !b.sim);
      b.mesh.position.set(b.x, P.BALL_R, b.z);
      tmp.set(b.x, P.BALL_R + 0.25, b.z).project(camera);
      const visible = b.mesh.visible && tmp.z < 1;
      b.label.style.display = visible ? '' : 'none';
      if (visible) {
        b.label.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
        b.label.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`;
      }
    }

    const me = myBall();
    const start = course[state.holeIndex].start;
    const focus = me ? me.mesh.position : tmp.set(start[0], 0, start[1]);
    const dist = zoom;
    camLook.lerp(focus, Math.min(1, dt * 6));
    camPos.set(
      camLook.x - Math.cos(yaw) * Math.cos(pitch) * dist,
      camLook.y + Math.sin(pitch) * dist,
      camLook.z - Math.sin(yaw) * Math.cos(pitch) * dist,
    );
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    const ready = canShoot();
    aim.visible = ready;
    if (ready) {
      const len = 0.8 + (charging ? power() : 0.2) * 4;
      const cx = Math.cos(yaw);
      const cz = Math.sin(yaw);
      aimDots.forEach((d, i) => {
        const k = 0.25 + ((i + 1) / AIM_DOTS) * (len - 0.25);
        d.position.set(me.x + cx * k, 0.015, me.z + cz * k);
      });
      aimTip.position.set(me.x + cx * (len + 0.15), 0.016, me.z + cz * (len + 0.15));
      // il triangolo punta lungo la mira
      aimTip.rotation.z = -yaw;
      aimMat.color.set(charging ? '#ffe066' : '#ffffff');
    }
    if (charging) $('powerFill').style.width = `${power() * 100}%`;
    updateClock();
  } else {
    // in attesa: il campo gira piano sullo sfondo
    yaw += dt * 0.1;
    camera.position.set(Math.cos(yaw) * 14, 7, Math.sin(yaw) * 14);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Stato dal server ---
socket.on('state', (s) => {
  const prev = state;
  state = s;
  if (s.phase === 'lobby') return renderLobby(s);

  if (s.seed !== builtSeed) {
    course = C.generateCourse(s.seed);
    builtSeed = s.seed;
    builtHole = -1;
  }
  if (s.holeIndex !== builtHole) {
    buildHole(course[s.holeIndex]);
    builtHole = s.holeIndex;
    for (const b of balls.values()) {
      b.sim = null;
      b.sunk = false;
    }
    const h = course[s.holeIndex];
    // la telecamera parte guardando verso la seconda piastrella
    const [t1x, t1z, ts] = h.tiles[1];
    yaw = Math.atan2(t1z + ts / 2 - h.start[1], t1x + ts / 2 - h.start[0]);
    camLook.set(h.start[0], 0, h.start[1]);
  }
  if (s.phase === 'playing' && (!prev || prev.phase !== 'playing' || prev.holeIndex !== s.holeIndex || Math.abs(holeClock() - s.holeElapsed) > 0.5)) {
    clockBase = performance.now() / 1000 - s.holeElapsed;
  }

  show('game');
  dropBalls();
  for (const m of s.members) {
    if (!s.strokes[m.id]) continue; // entrato dopo: guarda soltanto
    const b = ballFor(m);
    if (!b.sim && s.pos[m.id]) {
      [b.x, b.z] = s.pos[m.id];
      b.sunk = !!s.done[m.id] && s.pos[m.id][0] === course[s.holeIndex].cup[0] && s.pos[m.id][1] === course[s.holeIndex].cup[1];
    }
  }
  renderHud(s);
  renderScores(s);
});

function memberName(s, id) {
  const m = s.members.find((x) => x.id === id);
  return m ? m.name : '?';
}

function renderLobby(s) {
  show('lobby');
  $('scores').classList.add('hidden');
  $('lobbyCode').textContent = s.code;
  $('shareLink').value = `${location.origin}/golf/?room=${s.code}`;
  const ul = $('lobbyMembers');
  ul.innerHTML = '';
  for (const m of s.members) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = m.color;
    const name = document.createElement('span');
    name.textContent = m.name + (m.id === s.you ? ' (tu)' : '') + (m.connected ? '' : ' 📴');
    li.append(dot, name);
    if (m.id === s.hostId) {
      const h = document.createElement('span');
      h.className = 'host';
      h.textContent = 'crea la partita';
      li.append(h);
    }
    ul.append(li);
  }
  const host = s.hostId === s.you;
  $('startBtn').classList.toggle('hidden', !host);
  $('waitHost').classList.toggle('hidden', host);
}

function renderHud(s) {
  const hole = course[s.holeIndex];
  const mine = s.strokes[s.you];
  const strokes = mine ? mine[s.holeIndex] : 0;
  $('holeInfo').textContent = `Buca ${s.holeIndex + 1}/${s.holeCount} · Par ${hole.par} · Colpi ${strokes}`;
  const ul = $('players');
  ul.innerHTML = '';
  for (const m of s.members) {
    if (!s.strokes[m.id]) continue;
    const li = document.createElement('li');
    li.classList.toggle('done', !!s.done[m.id]);
    li.classList.toggle('off', !m.connected);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = m.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.id === s.you ? 'Tu' : m.name;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${s.done[m.id] ? '✔ ' : ''}${s.strokes[m.id][s.holeIndex]} · tot ${s.totals[m.id]}`;
    li.append(dot, name, num);
    ul.append(li);
  }
  let hint;
  if (!mine) hint = 'Partita già iniziata: guardi gli altri';
  else if (s.done[s.you]) hint = s.phase === 'playing' ? 'Hai finito la buca: aspetta gli altri' : '';
  else if (strokes >= s.maxStrokes) hint = 'Ultimo colpo fatto';
  else hint = 'Tieni premuto il tasto sinistro (o Spazio) e rilascia per tirare · Tasto destro o A/D per mirare · Rotellina per lo zoom';
  $('hint').textContent = hint;
  $('hint').classList.toggle('hidden', !hint);
}

function updateClock() {
  if (!state || state.phase !== 'playing' || state.holeRemaining == null) {
    $('clock').textContent = '';
    return;
  }
  const left = Math.max(0, Math.ceil(state.holeRemaining - (holeClock() - state.holeElapsed)));
  $('clock').textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('low', left <= 20);
}

function renderScores(s) {
  const open = s.phase === 'between' || s.phase === 'over';
  $('scores').classList.toggle('hidden', !open);
  if (!open) return;
  const over = s.phase === 'over';
  if (over) {
    const w = s.ranking[0];
    $('scoresTitle').textContent = w ? (w.id === s.you ? '🏆 Hai vinto!' : `🏆 Vince ${w.name}`) : 'Partita finita';
  } else {
    $('scoresTitle').textContent = `Fine buca ${s.holeIndex + 1}`;
  }
  const table = $('scoreTable');
  table.innerHTML = '';
  const head = document.createElement('tr');
  const played = s.holeIndex + 1;
  head.innerHTML = '<th>Buca</th>';
  for (let i = 0; i < played; i++) head.innerHTML += `<th>${i + 1}</th>`;
  head.innerHTML += '<th>Totale</th>';
  table.append(head);
  const parRow = document.createElement('tr');
  parRow.innerHTML = '<td>Par</td>';
  let parTot = 0;
  for (let i = 0; i < played; i++) {
    parRow.innerHTML += `<td>${course[i].par}</td>`;
    parTot += course[i].par;
  }
  parRow.innerHTML += `<td>${parTot}</td>`;
  table.append(parRow);
  const ids = Object.keys(s.strokes).sort((a, b) => s.totals[a] - s.totals[b]);
  for (const id of ids) {
    const tr = document.createElement('tr');
    tr.classList.toggle('me', id === s.you);
    const name = document.createElement('td');
    name.textContent = id === s.you ? 'Tu' : memberName(s, id);
    tr.append(name);
    for (let i = 0; i < played; i++) {
      const td = document.createElement('td');
      const n = s.strokes[id][i];
      td.textContent = n;
      if (n < course[i].par) td.className = 'under';
      else if (n > course[i].par) td.className = 'over';
      tr.append(td);
    }
    const tot = document.createElement('td');
    tot.className = 'total';
    tot.textContent = s.totals[id];
    tr.append(tot);
    table.append(tr);
  }
  const host = s.hostId === s.you;
  $('scoresNote').textContent = over
    ? (host ? 'Vuoi rigiocare? Le buche saranno tutte nuove.' : 'Aspetta che chi ha creato la stanza inizi una nuova partita')
    : 'La prossima buca parte tra pochi secondi…';
  $('againBtn').classList.toggle('hidden', !(over && host));
  $('homeLink').classList.toggle('hidden', !over);
}
