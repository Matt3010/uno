import * as THREE from 'three';
import { createWorld } from './scene.js';

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

// --- Scena 3D (in scene.js) ---
const world = createWorld($('view'));
const { scene, camera, renderer } = world;

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
    b = { mesh, label, sim: null, x: 0, y: 0, z: 0, sunk: false };
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
  const sim = P.createBall(course[state.holeIndex], from[0], from[1], from[2]);
  P.shoot(sim, angle, power);
  b.sim = { ball: sim, t: t0, t0, start: from, mine, acc: 0 };
  b.x = from[0];
  b.y = sim.y;
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
    if (!end && P.atRest(s.ball, hole) && !P.touchingMoving(s.ball, hole, s.t)) end = 'rest';
    if (!end && s.t - s.t0 > 30) end = 'rest'; // non dovrebbe mai servire: si ferma comunque
    if (end) {
      finishBall(id, b, end);
      return;
    }
  }
  b.x = s.ball.x;
  b.y = s.ball.y;
  b.z = s.ball.z;
}

function finishBall(id, b, event) {
  const s = b.sim;
  b.sim = null;
  if (event === 'water' || event === 'out') {
    // un colpo in più e si riparte da dove si era tirato
    b.x = s.start[0];
    b.z = s.start[1];
    b.y = s.start[2] + P.BALL_R;
    if (s.mine) toast(event === 'water' ? '💦 In acqua! +1 colpo' : '🕳 Caduta nel vuoto! +1 colpo');
  } else {
    b.x = s.ball.x;
    b.y = s.ball.y;
    b.z = s.ball.z;
  }
  if (event === 'sunk') {
    b.sunk = true;
    if (s.mine) {
      const strokes = state.strokes[state.you][state.holeIndex];
      toast(scoreWord(strokes, course[state.holeIndex].par), true);
    }
  }
  if (s.mine) socket.emit('result', { event, x: b.x, z: b.z, y: b.y - P.BALL_R });
}

// centro della pallina appoggiata in (x, z) sul prato a quota "floor" (o sul più alto, se non si sa)
function restY(x, z, floor) {
  const g = world.groundY(x, z, floor == null ? Infinity : floor + 0.5);
  return (g ?? floor ?? 0) + P.BALL_R;
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
let pull = 0; // quanto si è tirato indietro il mouse (pixel) mentre si carica
const FULL_PULL = 320; // pixel per la forza massima

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
  return Math.max(0, Math.min(1, pull / FULL_PULL));
}

function stopCharging() {
  charging = false;
  pull = 0;
  $('powerBox').classList.add('hidden');
}

function shoot() {
  const p = power();
  stopCharging();
  // riportando il mouse a zero il tiro si annulla
  if (p < 0.02 || !canShoot()) return;
  const b = myBall();
  const t0 = holeClock();
  socket.emit('shot', { angle: yaw, power: p, t0 });
  launch(b, [b.x, b.z, b.y - P.BALL_R], yaw, p, t0, true);
}

// Il mouse gira la visuale (catturato dalla pagina); tenendo premuto il sinistro e tirando indietro si carica
const canvas = $('view');
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!locked()) {
    if (state && state.phase === 'playing') canvas.requestPointerLock();
    return;
  }
  if (canShoot()) {
    charging = true;
    pull = 0;
    $('powerBox').classList.remove('hidden');
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0 && charging) shoot();
});
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  if (charging) {
    pull = Math.max(0, Math.min(FULL_PULL, pull + e.movementY));
  } else {
    yaw += e.movementX * 0.0035;
    pitch = Math.max(0.15, Math.min(1.2, pitch + e.movementY * 0.003));
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!locked()) stopCharging();
  updateHint();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = Math.max(1.6, Math.min(14, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });

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

  if (course && state && state.phase !== 'lobby') {
    const t = holeClock();
    world.animate(t, myBall());

    // la mia pallina ferma toccata da una pala, un muro che scorre o la porta del mulino: viene spinta
    const mine = myBall();
    if (mine && !mine.sim && !mine.sunk && state.phase === 'playing' && !state.done[state.you]
      && P.touchingMoving(mine, course[state.holeIndex], t)) {
      socket.emit('push', { t0: t });
      launch(mine, [mine.x, mine.z, mine.y - P.BALL_R], 0, 0, t, true);
    }

    for (const [id, b] of balls) {
      advanceBall(id, b, dt);
      b.mesh.visible = !(b.sunk && !b.sim);
      b.mesh.position.set(b.x, b.y, b.z);
      tmp.set(b.x, b.y + 0.25, b.z).project(camera);
      const visible = b.mesh.visible && tmp.z < 1;
      b.label.style.display = visible ? '' : 'none';
      if (visible) {
        b.label.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
        b.label.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`;
      }
    }

    const me = myBall();
    const start = course[state.holeIndex].start;
    const hole = course[state.holeIndex];
    const focus = me ? me.mesh.position : tmp.set(start[0], restY(start[0], start[1], hole.startY), start[1]);
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
      // i puntini seguono il prato (rampe, conca); sul vuoto spariscono
      const dotAt = (d, k, lift) => {
        const x = me.x + cx * k;
        const z = me.z + cz * k;
        // sul prato della pallina i puntini seguono rampe e conche; sopra il vuoto o un piano più basso
        // restano alla sua quota, così la mira non "cade" di sotto
        const floor = me.y - P.BALL_R;
        const g = world.groundY(x, z, me.y + 0.3);
        const y = g != null && g > floor - 0.6 ? g : floor;
        d.position.set(x, y + lift, z);
      };
      aimDots.forEach((d, i) => dotAt(d, 0.25 + ((i + 1) / AIM_DOTS) * (len - 0.25), 0.03));
      dotAt(aimTip, len + 0.15, 0.035);
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
  // tabellone, attesa o stanza: il mouse torna libero
  if (s.phase !== 'playing' && document.pointerLockElement) document.exitPointerLock();
  if (s.phase === 'lobby') return renderLobby(s);

  if (s.seed !== builtSeed) {
    course = s.holes === 'prova' ? C.showcaseCourse() : C.generateCourse(s.seed, s.holeCount);
    builtSeed = s.seed;
    builtHole = -1;
  }
  if (s.holeIndex !== builtHole) {
    world.buildHole(course[s.holeIndex]);
    builtHole = s.holeIndex;
    for (const b of balls.values()) {
      b.sim = null;
      b.sunk = false;
    }
    const h = course[s.holeIndex];
    // la telecamera parte guardando verso la seconda piastrella
    const t1 = h.tiles[1];
    yaw = Math.atan2((t1.gz + 0.5) * C.TILE - h.start[1], (t1.gx + 0.5) * C.TILE - h.start[0]);
    camLook.set(h.start[0], restY(h.start[0], h.start[1], h.startY), h.start[1]);
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
      const [x, z, floor] = s.pos[m.id];
      b.x = x;
      b.z = z;
      b.y = restY(x, z, floor);
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
  const choices = $('holeChoices');
  choices.innerHTML = '';
  for (const n of s.holeChoices) {
    const b = document.createElement('button');
    b.className = 'btn' + (n === s.holes ? ' on' : '');
    b.textContent = n === 'prova' ? 'Prova tutto' : n;
    b.disabled = !host; // sceglie chi ha creato la stanza
    b.onclick = () => socket.emit('holes', n);
    choices.append(b);
  }
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
  updateHint();
}

function updateHint() {
  const s = state;
  if (!s || !course || s.phase === 'lobby') return;
  const mine = s.strokes[s.you];
  let hint;
  if (!mine) hint = 'Partita già iniziata: guardi gli altri';
  else if (s.phase !== 'playing') hint = '';
  else if (!locked()) hint = '🖱 Clicca sul campo per usare il mouse';
  else if (s.done[s.you]) hint = 'Hai finito la buca: aspetta gli altri';
  else if (mine[s.holeIndex] >= s.maxStrokes) hint = 'Ultimo colpo fatto';
  else hint = 'Muovi il mouse per mirare · Tieni premuto il sinistro e tira indietro il mouse per la forza, rilascia per tirare · Esc libera il mouse';
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
