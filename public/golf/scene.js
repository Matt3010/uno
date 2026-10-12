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
  water: canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#2a86d6';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const y = Math.random() * s;
      const x = Math.random() * s;
      ctx.beginPath();
      ctx.arc(x, y, 6 + Math.random() * 10, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }
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

const MAT = {
  grass: new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 0.95 }),
  terrain: new THREE.MeshStandardMaterial({ map: TEX.terrain, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.8 }),
  woodTop: new THREE.MeshStandardMaterial({ color: '#e0a86e', roughness: 0.7 }),
  stone: new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.95 }),
  sand: new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ map: TEX.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }),
  boost: new THREE.MeshStandardMaterial({ map: TEX.boost, roughness: 0.5, emissive: '#ff6a00', emissiveIntensity: 0.35 }),
  bumper: new THREE.MeshStandardMaterial({ color: '#e2342b', roughness: 0.4 }),
  white: new THREE.MeshStandardMaterial({ color: '#f6f3ea', roughness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.35, metalness: 0.7 }),
  spinner: new THREE.MeshStandardMaterial({ color: '#7d5cff', roughness: 0.4 }),
  slider: new THREE.MeshStandardMaterial({ color: '#ffb000', roughness: 0.4 }),
  roof: new THREE.MeshStandardMaterial({ color: '#b5462f', roughness: 0.8 }),
  house: new THREE.MeshStandardMaterial({ color: '#f1e3c6', roughness: 0.9 }),
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

const groundH = (hole, x, z, fallback) => {
  const g = P.groundAt(hole, x, z);
  return g ? g.h : fallback;
};

// Superficie di prato che segue le altezze della fisica, su un rettangolo [x0..x1] × [z0..z1]
function surface(hole, x0, z0, x1, z1, n, mat, lift = 0) {
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
    pos.setXYZ(i, x, groundH(hole, xi, zi, 0) + lift, z);
    uv.setXY(i, x / S, z / S);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.castShadow = true; // il percorso sospeso fa ombra sul terreno
  return m;
}

// Pareti di roccia sotto una superficie: dai bordi giù fino al terreno
function cliff(hole, corners, n = 6) {
  const verts = [];
  const uvs = [];
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % corners.length];
    const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
    const cz = corners.reduce((s, c) => s + c[1], 0) / corners.length;
    for (let k = 0; k < n; k++) {
      const p = (a, f) => a + (f / n) * 1;
      const x1 = ax + (bx - ax) * (k / n);
      const z1 = az + (bz - az) * (k / n);
      const x2 = ax + (bx - ax) * ((k + 1) / n);
      const z2 = az + (bz - az) * ((k + 1) / n);
      const inside = (x, z) => [x + (cx - x) * 0.002, z + (cz - z) * 0.002];
      const h1 = groundH(hole, ...inside(x1, z1), 0) - 0.02;
      const h2 = groundH(hole, ...inside(x2, z2), 0) - 0.02;
      const l1 = (Math.hypot(x1 - ax, z1 - az) + i * S) / 2;
      const l2 = (Math.hypot(x2 - ax, z2 - az) + i * S) / 2;
      verts.push(x1, h1, z1, x2, GROUND_Y, z2, x2, h2, z2, x1, h1, z1, x1, GROUND_Y, z1, x2, GROUND_Y, z2);
      uvs.push(l1, h1 / 2, l2, GROUND_Y / 2, l2, h2 / 2, l1, h1 / 2, l1, GROUND_Y / 2, l2, GROUND_Y / 2);
      void p;
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
  const moving = { spinners: [], sliders: [], mills: [], roofs: [], portals: [] };
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
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, t.h0 - GROUND_Y, 8), MAT.wood);
            post.position.set(px, (t.h0 + GROUND_Y) / 2, pz);
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
        group.add(surface(h, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 6, MAT.grass));
        group.add(cliff(h, c));
        continue;
      }
      group.add(surface(h, x0, z0, x1, z1, t.bowl ? 40 : t.kind === 'ramp' ? 10 : 4, MAT.grass));
      group.add(cliff(h, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]));
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
      const y = groundH(h, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, 0);
      if (zn.type === 'sand') {
        group.add(flatPoly(zn.poly, y + 0.006, MAT.sand));
      } else if (zn.type === 'water') {
        // vasca: bordo in pietra e acqua un po' più in basso
        group.add(flatPoly(zn.poly, y + 0.004, MAT.stone));
        group.add(flatPoly(zn.poly, y + 0.012, MAT.water));
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
      // mulino da minigolf: pilastri ai lati della porta, torre col tetto a piramide, pale sul davanti.
      // Il gruppo è orientato con +x nel verso di marcia e z di traverso.
      const y = m.y ?? 0;
      const g = new THREE.Group();
      const side = (S - m.width) / 2;
      for (const sign of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, side), MAT.house);
        pillar.position.set(0, 0.55, sign * (m.width / 2 + side / 2));
        g.add(pillar);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, m.width), MAT.house);
      lintel.position.set(0, 1.0, 0);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 2.6), MAT.house);
      tower.position.set(0.3, 1.85, 0);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2, 1.4, 4), MAT.roof);
      roof.position.set(0.3, 3.3, 0);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(0.85, 1, 1.35);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(m.width, 0.9), new THREE.MeshBasicMaterial({ color: '#2b1d12', side: THREE.DoubleSide }));
      door.rotation.y = Math.PI / 2;
      door.position.set(0.24, 0.45, 0);
      g.add(lintel, tower, roof);
      const hub = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.75, 0.08), MAT.trunk);
        spar.position.y = -0.9;
        const sail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 0.5), MAT.blade);
        sail.position.set(0, -1.05, 0.22);
        arm.add(spar, sail);
        arm.rotation.x = (i * Math.PI) / 2;
        hub.add(arm);
      }
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), MAT.metal);
      hub.add(cap);
      // le pale girano davanti alla facciata da cui si arriva, alte quanto basta a coprire la porta
      hub.position.set(-0.62, 1.95, 0);
      g.add(hub);
      const [dx, dz] = DIRS[m.dir];
      g.position.set(m.x, y, m.z);
      g.rotation.y = -Math.atan2(dz, dx);
      group.add(shadows(g));
      moving.mills.push({ hub, m });
    }

    for (const p of h.portals) {
      for (const [pt, mat] of [[p.a, MAT.portalA], [p.b, MAT.portalB]]) {
        const y = groundH(h, pt[0], pt[1], 0);
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
    const cy = groundH(h, cx, cz, 0);
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
    mat.position.set(sx, groundH(h, sx, sz, 0) + 0.005, sz);
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
    TEX.water.offset.set(t * 0.03, t * 0.02);
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

  function groundY(x, z) {
    return hole ? groundH(hole, x, z, null) : 0;
  }

  return { renderer, scene, camera, buildHole, animate, groundY };
}
