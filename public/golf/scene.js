// Golf: il mondo 3D. Costruisce la buca dai dati del percorso (le altezze sono quelle della fisica)
// e anima pale, muri mobili, mulini, acqua e acceleratori.
import * as THREE from 'three';

const P = window.GolfPhysics;
const C = window.GolfCourse;
const S = C.TILE;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const GROUND_Y = -3.2; // il terreno sotto al percorso sospeso

// --- Texture disegnate al volo (niente file da scaricare) ---
function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(ctx, size, colors, n, rMax) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    const r = Math.random() * rMax;
    ctx.globalAlpha = 0.25 + Math.random() * 0.35;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r * (0.5 + Math.random()));
  }
  ctx.globalAlpha = 1;
}

const TEX = {
  // prato rasato a strisce, con fili d'erba
  grass: canvasTexture(256, (ctx, s) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#4fb84f' : '#5ac85a';
      ctx.fillRect(0, (i * s) / 4, s, s / 4);
    }
    noise(ctx, s, ['#3f9e42', '#6bd76a', '#4aad4c'], 2600, 3);
  }),
  terrain: canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4c8a38';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, ['#3e7a2e', '#5b9b44', '#6f8f3a', '#447f33'], 3000, 5);
  }, 60),
  wood: canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#b97a43';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 3) {
      ctx.strokeStyle = `rgba(90, 50, 20, ${0.15 + Math.random() * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(0, y + Math.random() * 2);
      for (let x = 0; x < s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.07 + y) * 1.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60, 30, 10, 0.5)';
    for (let x = 0; x < s; x += 32) ctx.fillRect(x, 0, 2, s); // giunture delle assi
  }),
  stone: canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#7b6f62';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      const off = (y / 16) % 2 ? 16 : 0;
      for (let x = -16; x < s; x += 32) {
        const g = 100 + Math.random() * 40;
        ctx.fillStyle = `rgb(${g}, ${g - 10}, ${g - 22})`;
        ctx.fillRect(x + off + 1, y + 1, 30, 14);
      }
    }
  }),
  sand: canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#e8d29a';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, ['#d8bf80', '#f3e2b4', '#cdb172'], 1800, 2);
  }),
  boost: canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#ff8c1a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#fff3c4';
    for (let i = 0; i < 2; i++) {
      const x = i * (s / 2);
      ctx.beginPath();
      ctx.moveTo(x + 10, 10);
      ctx.lineTo(x + s / 2 - 10, s / 2);
      ctx.lineTo(x + 10, s - 10);
      ctx.lineTo(x + 30, s - 10);
      ctx.lineTo(x + s / 2 + 10, s / 2);
      ctx.lineTo(x + 30, 10);
      ctx.fill();
    }
  }),
  sky: canvasTexture(16, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#4a9eea');
    g.addColorStop(0.6, '#a8d8ff');
    g.addColorStop(1, '#e8f5ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }),
};

// Mappa delle normali per le increspature dell'acqua: da un'altezza a caso si ricava l'inclinazione
function rippleNormals(size = 256) {
  const hc = document.createElement('canvas');
  hc.width = hc.height = size;
  const h = hc.getContext('2d');
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 26;
    const g = h.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() < 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    h.fillStyle = g;
    // ripetuto ai bordi, così la texture si affianca senza giunture
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) h.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
  }
  const src = h.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const o = out.getContext('2d');
  const img = o.createImageData(size, size);
  const at = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.5;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  o.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const RIPPLES = rippleNormals();

// Cielo "a 360°" per i riflessi (acqua, metallo): gradiente con il sole
function skyEquirect() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f7fd6');
  g.addColorStop(0.45, '#9fd2ff');
  g.addColorStop(0.5, '#e9f6ff');
  g.addColorStop(0.55, '#5f8f4a');
  g.addColorStop(1, '#3b5f2c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  const sun = ctx.createRadialGradient(380, 60, 0, 380, 60, 50);
  sun.addColorStop(0, 'rgba(255,255,240,1)');
  sun.addColorStop(1, 'rgba(255,255,240,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(320, 0, 120, 120);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAT = {
  grass: new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 0.95 }),
  terrain: new THREE.MeshStandardMaterial({ map: TEX.terrain, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.8 }),
  woodTop: new THREE.MeshStandardMaterial({ color: '#e0a86e', roughness: 0.7 }),
  stone: new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.95 }),
  sand: new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }),
  water: new THREE.MeshPhysicalMaterial({
    color: '#3aa0d8', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.62,
    normalMap: RIPPLES, normalScale: new THREE.Vector2(1.1, 1.1), envMapIntensity: 2, clearcoat: 1, clearcoatRoughness: 0.02,
    clearcoatNormalMap: RIPPLES, clearcoatNormalScale: new THREE.Vector2(0.8, 0.8),
  }),
  poolBottom: new THREE.MeshStandardMaterial({ map: TEX.stone, color: '#4f8fa0', roughness: 1 }),
  boost: new THREE.MeshStandardMaterial({ map: TEX.boost, roughness: 0.5, emissive: '#ff6a00', emissiveIntensity: 0.35 }),
  bumper: new THREE.MeshStandardMaterial({ color: '#e2342b', roughness: 0.4 }),
  white: new THREE.MeshStandardMaterial({ color: '#f6f3ea', roughness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.35, metalness: 0.7 }),
  spinner: new THREE.MeshStandardMaterial({ color: '#7d5cff', roughness: 0.4 }),
  slider: new THREE.MeshStandardMaterial({ color: '#ffb000', roughness: 0.4 }),
  roof: new THREE.MeshStandardMaterial({ color: '#b5462f', roughness: 0.8 }),
  house: new THREE.MeshStandardMaterial({ color: '#efe4cf', roughness: 0.9 }),
  brick: new THREE.MeshStandardMaterial({ map: TEX.stone, color: '#d9886a', roughness: 0.95 }),
  sail: new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
  window: new THREE.MeshStandardMaterial({ color: '#3a5a78', roughness: 0.3, side: THREE.DoubleSide }),
  blade: new THREE.MeshStandardMaterial({ color: '#f6f3ea', roughness: 0.7, side: THREE.DoubleSide }),
  cup: new THREE.MeshBasicMaterial({ color: '#0b0b0b' }),
  flag: new THREE.MeshStandardMaterial({ color: '#e2342b', side: THREE.DoubleSide }),
  start: new THREE.MeshStandardMaterial({ color: '#2f7d36', roughness: 1 }),
  portalA: new THREE.MeshStandardMaterial({ color: '#b46bff', emissive: '#8a2be2', emissiveIntensity: 0.9 }),
  portalB: new THREE.MeshStandardMaterial({ color: '#ffa94d', emissive: '#ff7a00', emissiveIntensity: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 }),
  leaves: [new THREE.MeshStandardMaterial({ color: '#2f7d32', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#3d8f3a', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#2a6b34', roughness: 1 })],
  rock: new THREE.MeshStandardMaterial({ color: '#8a8580', roughness: 1, flatShading: true }),
};

function shadows(o, cast = true, receive = true) {
  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
}

// Altezza del prato in (x, z); con più piani "y" dice a che altezza si guarda (il prato più alto sotto y)
const groundH = (hole, x, z, fallback, y = Infinity) => {
  const g = P.groundAt(hole, x, z, y);
  return g ? g.h : fallback;
};
// altezza da passare a groundH per prendere proprio la piastrella t (e non quella del piano sopra)
const yOf = (t) => Math.max(t.h0, t.h1) + 0.5;

// Superficie di prato che segue le altezze della fisica, su un rettangolo [x0..x1] × [z0..z1]
function surface(hole, x0, z0, x1, z1, n, mat, yHint = Infinity) {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    // un pelo dentro, per non prendere l'altezza della piastrella accanto
    const xi = Math.min(x1 - 1e-3, Math.max(x0 + 1e-3, x));
    const zi = Math.min(z1 - 1e-3, Math.max(z0 + 1e-3, z));
    pos.setXYZ(i, x, groundH(hole, xi, zi, 0, yHint), z);
    uv.setXY(i, x / S, z / S);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.castShadow = true; // il percorso sospeso fa ombra sul terreno
  return m;
}

// Pareti di roccia sotto una superficie: dai bordi giù fino a "bottom" (il terreno, o poco sotto per le lastre)
function cliff(hole, corners, yHint = Infinity, bottom = GROUND_Y, n = 6) {
  const verts = [];
  const uvs = [];
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % corners.length];
    const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
    const cz = corners.reduce((s, c) => s + c[1], 0) / corners.length;
    for (let k = 0; k < n; k++) {
      const x1 = ax + (bx - ax) * (k / n);
      const z1 = az + (bz - az) * (k / n);
      const x2 = ax + (bx - ax) * ((k + 1) / n);
      const z2 = az + (bz - az) * ((k + 1) / n);
      const inside = (x, z) => [x + (cx - x) * 0.002, z + (cz - z) * 0.002];
      const h1 = groundH(hole, ...inside(x1, z1), 0, yHint) - 0.02;
      const h2 = groundH(hole, ...inside(x2, z2), 0, yHint) - 0.02;
      const l1 = (Math.hypot(x1 - ax, z1 - az) + i * S) / 2;
      const l2 = (Math.hypot(x2 - ax, z2 - az) + i * S) / 2;
      verts.push(x1, h1, z1, x2, bottom, z2, x2, h2, z2, x1, h1, z1, x1, bottom, z1, x2, bottom, z2);
      uvs.push(l1, h1 / 2, l2, bottom / 2, l2, h2 / 2, l1, h1 / 2, l1, bottom / 2, l2, bottom / 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, MAT.stone);
  m.material.side = THREE.DoubleSide;
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

function tileRect(t) {
  return [t.gx * S, t.gz * S, t.gx * S + S, t.gz * S + S];
}

// Rettangolo in coordinate locali della piastrella (u avanti, v di traverso) → angoli nel mondo
const local = (t, u, v) => C.local(t, u, v);

function boxBetween(x1, z1, x2, z2, yBottom, yTop, thick, mat) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len + thick, yTop - yBottom, thick), mat);
  m.position.set((x1 + x2) / 2, (yBottom + yTop) / 2, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  return shadows(m);
}

function flatPoly(poly, y, mat) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, pos.getZ(i) / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function tree(rng, x, z) {
  const g = new THREE.Group();
  const h = 1.2 + rng() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h, 7), MAT.trunk);
  trunk.position.y = h / 2;
  g.add(trunk);
  const leaves = MAT.leaves[Math.floor(rng() * MAT.leaves.length)];
  const layers = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < layers; i++) {
    const r = 1.1 - i * 0.28 + rng() * 0.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.4, 8), leaves);
    cone.position.y = h + i * 0.7;
    g.add(cone);
  }
  g.position.set(x, GROUND_Y, z);
  g.rotation.y = rng() * Math.PI;
  return shadows(g, true, false);
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = TEX.sky;
  // riflessi del cielo su acqua e metallo
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(skyEquirect()).texture;
  scene.environmentIntensity = 0.6;
  scene.fog = new THREE.Fog('#cfe9ff', 60, 160);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
  scene.add(new THREE.HemisphereLight('#e3f3ff', '#4a6b2f', 1.2));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), MAT.terrain);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = GROUND_Y;
  terrain.receiveShadow = true;
  scene.add(terrain);

  let group = null;
  let hole = null;
  const moving = { spinners: [], sliders: [], mills: [], roofs: [], portals: [], waters: [], upper: [] };
  let flag = null;

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  function buildHole(h) {
    hole = h;
    if (group) scene.remove(group);
    group = new THREE.Group();
    for (const k of Object.keys(moving)) moving[k] = [];

    // la piastrella più alta tra quelle sotto t (nella stessa cella), se c'è
    const under = (t) => h.tiles.filter((o) => o !== t && o.gx === t.gx && o.gz === t.gz && Math.max(o.h0, o.h1) < Math.min(t.h0, t.h1))
      .sort((a, b) => Math.max(b.h0, b.h1) - Math.max(a.h0, a.h1))[0];
    // fin dove scende la roccia: fino al terreno, o una lastra spessa 0,4 se sotto c'è un altro piano
    const base = (t) => (under(t) ? Math.min(t.h0, t.h1) - 0.4 : GROUND_Y);
    for (const t of h.tiles) {
      const [x0, z0, x1, z1] = tileRect(t);
      if (t.kind === 'bridge') {
        // passerella di legno sul vuoto, con i piloni
        // lunga esattamente quanto la piastrella e appena sotto il prato: niente sfarfallio ai bordi
        const [cx, cz] = local(t, S / 2, S / 2);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(S - 0.01, 0.14, t.width), MAT.wood);
        deck.position.set(cx, t.h0 - 0.075, cz);
        deck.rotation.y = -Math.atan2(DIRS[t.dir][1], DIRS[t.dir][0]);
        group.add(shadows(deck));
        for (const u of [0.3, S - 0.3]) {
          for (const side of [-1, 1]) {
            const [px, pz] = local(t, u, S / 2 + side * (t.width / 2 - 0.1));
            const low = under(t) ? Math.max(under(t).h0, under(t).h1) : GROUND_Y;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, t.h0 - low, 8), MAT.wood);
            post.position.set(px, (t.h0 + low) / 2, pz);
            group.add(shadows(post));
            const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), MAT.woodTop);
            knob.position.set(px, t.h0 + 0.2, pz);
            group.add(shadows(knob));
          }
        }
        continue;
      }
      if (t.kind === 'gap') {
        // solo la parte d'atterraggio: davanti c'è il burrone
        const c = [local(t, t.gap, 0), local(t, S, 0), local(t, S, S), local(t, t.gap, S)];
        const xs = c.map((p) => p[0]);
        const zs = c.map((p) => p[1]);
        group.add(surface(h, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 6, MAT.grass, yOf(t)));
        group.add(cliff(h, c, yOf(t), base(t)));
        continue;
      }
      const below = under(t);
      const top = surface(h, x0, z0, x1, z1, t.bowl ? 40 : t.kind === 'ramp' ? 10 : 4, below ? MAT.grass.clone() : MAT.grass, yOf(t));
      const side = cliff(h, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], yOf(t), base(t), 6);
      group.add(top, side);
      if (below) {
        // piano di sopra: lastra su quattro pilastri piantati nel piano di sotto
        side.material = MAT.stone.clone();
        for (const m of [top.material, side.material]) m.transparent = true;
        moving.upper.push({ tile: t, mats: [top.material, side.material] });
        const floor = Math.max(below.h0, below.h1);
        for (const [px, pz] of [[x0 + 0.2, z0 + 0.2], [x1 - 0.2, z0 + 0.2], [x1 - 0.2, z1 - 0.2], [x0 + 0.2, z1 - 0.2]]) {
          const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, base(t) - floor, 10), MAT.stone);
          pil.position.set(px, (base(t) + floor) / 2, pz);
          group.add(shadows(pil));
        }
      }
      if (t.roof) {
        // galleria in pietra a volta, con le facciate
        const arch = new THREE.Mesh(new THREE.CylinderGeometry(S / 2 + 0.1, S / 2 + 0.1, S, 24, 1, true, 0, Math.PI), MAT.stone.clone());
        arch.material.side = THREE.DoubleSide;
        arch.material.transparent = true;
        const [cx, cz] = local(t, S / 2, S / 2);
        arch.position.set(cx, t.h0, cz);
        // il cilindro di three sta in piedi: lo si corica lungo la direzione di marcia
        arch.rotation.set(0, 0, Math.PI / 2);
        const yaw = -Math.atan2(DIRS[t.dir][1], DIRS[t.dir][0]);
        const holder = new THREE.Group();
        holder.add(arch);
        arch.position.set(0, 0, 0);
        arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        holder.position.set(cx, t.h0, cz);
        holder.rotation.y = yaw;
        group.add(shadows(holder));
        moving.roofs.push({ mesh: arch, tile: t });
      }
    }

    for (const w of h.walls) {
      if (w.house) continue; // i muri del mulino li disegna il mulino stesso
      const [x1, z1, x2, z2] = w.seg;
      if (w.ya != null && Math.abs(w.ya - w.yb) > 1e-6) {
        // sponda lungo una rampa: un'asse inclinata come il prato
        const len = Math.hypot(x2 - x1, z2 - z1);
        const holder = new THREE.Group();
        holder.position.set((x1 + x2) / 2, (w.ya + w.yb) / 2, (z1 + z2) / 2);
        holder.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        const tilt = Math.atan2(w.yb - w.ya, len);
        const body = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(len, w.yb - w.ya) + 0.02, 0.42, 0.16), MAT.wood);
        body.position.y = -0.21;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(len, w.yb - w.ya) + 0.02, 0.06, 0.24), MAT.woodTop);
        const tilted = new THREE.Group();
        tilted.rotation.z = tilt;
        tilted.add(body, cap);
        holder.add(tilted);
        group.add(shadows(holder));
        continue;
      }
      group.add(boxBetween(x1, z1, x2, z2, w.y1 - 0.42, w.y1, 0.16, MAT.wood));
      group.add(boxBetween(x1, z1, x2, z2, w.y1 - 0.03, w.y1 + 0.03, 0.24, MAT.woodTop));
    }

    for (const zn of h.zones) {
      const xs = zn.poly.map((p) => p[0]);
      const zs = zn.poly.map((p) => p[1]);
      const y = zn.y ?? groundH(h, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, 0);
      if (zn.type === 'sand') {
        group.add(flatPoly(zn.poly, y + 0.006, MAT.sand));
      } else if (zn.type === 'water') {
        // vasca: fondo scuro, bordo in pietra e superficie che ondeggia
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const z0 = Math.min(...zs);
        const z1 = Math.max(...zs);
        group.add(flatPoly(zn.poly, y + 0.004, MAT.poolBottom));
        const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) * 6), Math.ceil((z1 - z0) * 6));
        geo.rotateX(-Math.PI / 2);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 2, uv.getY(i) * (z1 - z0) / 2);
        const surf = new THREE.Mesh(geo, MAT.water);
        surf.position.set((x0 + x1) / 2, y + 0.04, (z0 + z1) / 2);
        surf.receiveShadow = true;
        group.add(surf);
        moving.waters.push({ geo, base: geo.attributes.position.array.slice() });
        const curb = (ax, az, bx, bz) => group.add(boxBetween(ax, az, bx, bz, y, y + 0.08, 0.14, MAT.stone));
        curb(x0, z0, x1, z0);
        curb(x1, z0, x1, z1);
        curb(x1, z1, x0, z1);
        curb(x0, z1, x0, z0);
      } else if (zn.type === 'boost') {
        const m = flatPoly(zn.poly, y + 0.008, MAT.boost.clone());
        const tex = TEX.boost.clone();
        tex.needsUpdate = true;
        m.material.map = tex;
        // le frecce puntano nel verso della spinta
        tex.center.set(0.5, 0.5);
        tex.rotation = -Math.atan2(zn.force[1], zn.force[0]);
        group.add(m);
        moving.portals.push({ boost: tex });
      }
    }

    for (const b of h.bumpers) {
      const y = b.y ?? 0;
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.85, b.r, 0.3, 24), MAT.white);
      stem.position.y = 0.15;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(b.r * 1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.bumper);
      cap.position.y = 0.28;
      cap.scale.y = 0.6;
      g.add(stem, cap);
      for (let i = 0; i < 5; i++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(b.r * 0.16, 8, 6), MAT.white);
        const a = (i / 5) * Math.PI * 2;
        dot.position.set(Math.cos(a) * b.r * 0.6, 0.42, Math.sin(a) * b.r * 0.6);
        g.add(dot);
      }
      g.position.set(b.x, y, b.z);
      group.add(shadows(g));
    }

    for (const s of h.spinners) {
      const y = s.y ?? 0;
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.24, 0.16), MAT.spinner);
      bar.position.y = 0.16;
      g.add(bar);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.55, 14), MAT.metal);
      post.position.set(s.x, y + 0.27, s.z);
      g.position.set(s.x, y, s.z);
      group.add(shadows(g), shadows(post));
      moving.spinners.push({ mesh: g, s });
    }

    for (const s of h.sliders) {
      const y = s.y ?? 0;
      const block = new THREE.Mesh(new THREE.BoxGeometry(s.axis === 0 ? s.len : 0.3, 0.4, s.axis === 0 ? 0.3 : s.len), MAT.slider);
      block.position.set(s.x, y + 0.2, s.z);
      group.add(shadows(block));
      // binario su cui scorre
      const rail = new THREE.Mesh(new THREE.BoxGeometry(s.axis === 0 ? s.amp * 2 + s.len : 0.08, 0.02, s.axis === 0 ? 0.08 : s.amp * 2 + s.len), MAT.metal);
      rail.position.set(s.x, y + 0.01, s.z);
      group.add(rail);
      moving.sliders.push({ mesh: block, s });
    }

    for (const m of h.windmills) {
      // mulino olandese: muretti di mattoni ai lati della porta, torre ottagonale rastremata con il
      // ballatoio, cappello a cono e quattro pale a graticcio sul davanti. +x = verso di marcia, z = di traverso.
      const y = m.y ?? 0;
      const g = new THREE.Group();
      // basamento in mattoni largo quanto il percorso, con l'arco aperto al centro: la pallina passa di lì
      const BASE_H = 1.7;
      const shape = new THREE.Shape();
      shape.moveTo(-S / 2, 0);
      shape.lineTo(S / 2, 0);
      shape.lineTo(S / 2, BASE_H);
      shape.lineTo(-S / 2, BASE_H);
      shape.lineTo(-S / 2, 0);
      const arch = new THREE.Path();
      const r = m.width / 2;
      arch.moveTo(-r, 0);
      arch.lineTo(-r, 0.55);
      arch.absarc(0, 0.55, r, Math.PI, 0, true);
      arch.lineTo(r, 0);
      arch.lineTo(-r, 0);
      shape.holes.push(arch);
      const baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
      baseGeo.translate(0, 0, -0.6);
      baseGeo.rotateY(Math.PI / 2); // l'arco si attraversa lungo +x
      const uv = baseGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
      const base = new THREE.Mesh(baseGeo, MAT.brick);
      g.add(base);
      // la torre poggia sopra l'arco
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.45, 3.4, 8), MAT.house);
      tower.position.set(0.2, BASE_H + 1.7, 0);
      tower.rotation.y = Math.PI / 8;
      const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.1, 16), MAT.wood);
      gallery.position.set(0.2, BASE_H + 0.05, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.5, 16), MAT.roof);
      cap.position.set(0.2, BASE_H + 3.4 + 0.75, 0);
      const windows = new THREE.Group();
      for (const [wy, wz] of [[BASE_H + 1, 0], [BASE_H + 2, 0.35]]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.45), MAT.window);
        win.position.set(0.2 - 1.2, wy, wz);
        win.rotation.y = -Math.PI / 2;
        windows.add(win);
      }
      g.add(tower, gallery, cap, windows);

      // pale: lunghe abbastanza da scendere davanti alla porta quando è chiusa
      const hub = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3, 0.1), MAT.trunk);
        spar.position.y = -1.5;
        arm.add(spar);
        // graticcio: telaio con i listelli e la tela
        const sail = new THREE.Group();
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 2.3), MAT.sail);
        cloth.rotation.y = Math.PI / 2;
        sail.add(cloth);
        for (let k = 0; k <= 6; k++) {
          const slat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.66), MAT.trunk);
          slat.position.y = -1.15 + (k * 2.3) / 6;
          sail.add(slat);
        }
        for (const zz of [-0.32, 0.32]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.3, 0.03), MAT.trunk);
          rail.position.z = zz;
          sail.add(rail);
        }
        sail.position.set(-0.02, -1.75, 0.36);
        arm.add(sail);
        arm.rotation.x = (i * Math.PI) / 2;
        hub.add(arm);
      }
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), MAT.metal);
      axle.rotation.z = Math.PI / 2;
      hub.add(axle);
      // il mozzo sporge dalla torre verso chi arriva, all'altezza giusta perché la pala tocchi terra
      hub.position.set(-0.75, 3.2, 0);
      g.add(hub);
      const [dx, dz] = DIRS[m.dir];
      g.position.set(m.x, y, m.z);
      g.rotation.y = -Math.atan2(dz, dx);
      group.add(shadows(g));
      moving.mills.push({ hub, m });
    }

    for (const p of h.portals) {
      for (const [pt, mat, py] of [[p.a, MAT.portalA, p.ay], [p.b, MAT.portalB, p.by]]) {
        const y = groundH(h, pt[0], pt[1], 0, py == null ? Infinity : py + 0.5);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.06, 10, 32), mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(pt[0], y + 0.04, pt[1]);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 32), mat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(pt[0], y + 0.015, pt[1]);
        const glow = new THREE.PointLight(mat.emissive, 2, 3);
        glow.position.set(pt[0], y + 0.5, pt[1]);
        group.add(ring, disc, glow);
        moving.portals.push({ ring });
      }
    }

    // buca con bandierina
    const [cx, cz] = h.cup;
    const cy = groundH(h, cx, cz, 0, h.cupY + 0.5);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(P.CUP_R, P.CUP_R, 0.2, 32, 1, true), MAT.cup);
    cup.material.side = THREE.DoubleSide;
    cup.position.set(cx, cy - 0.09, cz);
    const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(P.CUP_R, 32), MAT.cup);
    cupBottom.rotation.x = -Math.PI / 2;
    cupBottom.position.set(cx, cy + 0.004, cz);
    flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8), MAT.white);
    pole.position.y = 0.9;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.4, 8, 1), MAT.flag);
    cloth.position.set(0.34, 1.6, 0);
    flag.add(pole, cloth);
    flag.position.set(cx, cy, cz);
    group.add(cup, cupBottom, shadows(flag));

    const [sx, sz] = h.start;
    const mat = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), MAT.start);
    mat.position.set(sx, groundH(h, sx, sz, 0, h.startY + 0.5) + 0.005, sz);
    group.add(mat);

    // alberi e rocce intorno (sempre gli stessi per la stessa buca)
    const rng = C.makeRng(h.index * 977 + Math.round(h.cup[0] * 100));
    const occupied = new Set(h.tiles.map((t) => `${t.gx},${t.gz}`));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const t of h.tiles) {
      minX = Math.min(minX, t.gx * S);
      maxX = Math.max(maxX, t.gx * S + S);
      minZ = Math.min(minZ, t.gz * S);
      maxZ = Math.max(maxZ, t.gz * S + S);
    }
    for (let i = 0; i < 90; i++) {
      const x = minX - 25 + rng() * (maxX - minX + 50);
      const z = minZ - 25 + rng() * (maxZ - minZ + 50);
      if (occupied.has(`${Math.floor(x / S)},${Math.floor(z / S)}`)) continue;
      // non troppo vicino al percorso, per non coprire la vista
      const near = h.tiles.some((t) => Math.abs(t.gx * S + S / 2 - x) < S && Math.abs(t.gz * S + S / 2 - z) < S);
      if (near) continue;
      if (rng() < 0.75) {
        group.add(tree(rng, x, z));
      } else {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rng() * 0.8, 0), MAT.rock);
        r.position.set(x, GROUND_Y + 0.2, z);
        r.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        group.add(shadows(r));
      }
    }
    scene.add(group);

    const mx = (minX + maxX) / 2;
    const mz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ) / 2 + 8;
    sun.position.set(mx + 18, 30, mz + 10);
    sun.target.position.set(mx, 0, mz);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 90 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  // Anima gli ostacoli al tempo t della buca; "focus" è la mia pallina (per la galleria trasparente)
  function animate(t, focus) {
    for (const { mesh, s } of moving.spinners) {
      const [x1, z1, x2, z2] = P.spinnerSegment(s, t);
      mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    }
    for (const { mesh, s } of moving.sliders) {
      const [x1, z1, x2, z2] = P.sliderSegment(s, t);
      mesh.position.x = (x1 + x2) / 2;
      mesh.position.z = (z1 + z2) / 2;
    }
    for (const { hub, m } of moving.mills) {
      // una pala copre la porta proprio a metà del tempo in cui è chiusa
      const k = ((((t + (m.phase || 0)) % m.period) + m.period) % m.period) / m.period;
      const closedMid = m.open + (1 - m.open) / 2;
      hub.rotation.x = (k - closedMid) * (Math.PI / 2);
    }
    for (const p of moving.portals) {
      if (p.ring) p.ring.rotation.z = t * 2;
      if (p.boost) p.boost.offset.x = -t * 1.5;
    }
    // increspature che scorrono e piccole onde sulla superficie
    RIPPLES.offset.set(t * 0.04, t * 0.025);
    for (const { geo, base } of moving.waters) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        pos.array[i * 3 + 1] = Math.sin(x * 3.1 + t * 2.2) * 0.008 + Math.cos(z * 2.7 + t * 1.7) * 0.008;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    for (const { tile, mats } of moving.upper) {
      const below = focus && Math.floor(focus.x / S) === tile.gx && Math.floor(focus.z / S) === tile.gz && focus.y < Math.min(tile.h0, tile.h1) - 0.5;
      for (const m of mats) {
        m.opacity += ((below ? 0.18 : 1) - m.opacity) * 0.15;
        m.depthWrite = m.opacity > 0.9;
      }
    }
    for (const { mesh, tile } of moving.roofs) {
      // dentro la galleria il tetto diventa trasparente, così si vede la pallina
      const inside = focus && Math.floor(focus.x / S) === tile.gx && Math.floor(focus.z / S) === tile.gz;
      mesh.material.opacity += ((inside ? 0.25 : 1) - mesh.material.opacity) * 0.15;
      mesh.material.depthWrite = mesh.material.opacity > 0.9;
    }
    if (flag) {
      const cloth = flag.children[1];
      cloth.rotation.y = Math.sin(t * 2.2) * 0.3;
    }
  }

  // altezza del prato in (x, z) sotto l'altezza y (senza y: il piano più alto)
  function groundY(x, z, y = Infinity) {
    return hole ? groundH(hole, x, z, null, y) : 0;
  }

  return { renderer, scene, camera, buildHole, animate, groundY };
}
