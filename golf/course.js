'use strict';
// Golf: percorso procedurale. Dallo stesso seme escono le stesse buche, sul server e in ogni browser.
// Ogni buca è un cammino di piastrelle con curve e tornanti; le piastrelle diventano rampe, salti sul burrone,
// ponti, gallerie, oppure ospitano ostacoli (mulini, pale, muri mobili, funghi, sabbia, acqua, acceleratori, portali).
(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const P = isNode ? require('./physics') : root.GolfPhysics;

  const HOLES = 9;
  const TILE = 5;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // +x, +z, -x, -z
  const WALL_H = 0.3;

  // generatore pseudo-casuale con seme (mulberry32)
  function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const range = (rng, a, b) => a + rng() * (b - a);
  const pick = (rng, list) => list[Math.floor(rng() * list.length)];
  const key = (x, z) => `${x},${z}`;

  // Cammino a caso sulla griglia, senza ripassare; a volte due svolte uguali di fila (tornante a U)
  function walk(rng, length) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const path = [[0, 0]];
      const seen = new Set([key(0, 0)]);
      let dir = 0;
      let lastTurn = 0;
      while (path.length < length) {
        const [x, z] = path[path.length - 1];
        const free = (d) => !seen.has(key(x + DIRS[d][0], z + DIRS[d][1]));
        let d;
        if (lastTurn && rng() < 0.45 && free((dir + lastTurn + 4) % 4)) {
          d = (dir + lastTurn + 4) % 4; // seconda svolta dalla stessa parte: tornante
        } else {
          const options = [dir, (dir + 1) % 4, (dir + 3) % 4].filter(free);
          if (!options.length) break;
          d = options.includes(dir) && rng() < 0.4 ? dir : pick(rng, options);
        }
        lastTurn = d === dir ? 0 : (d === (dir + 1) % 4 ? 1 : -1);
        dir = d;
        const next = [x + DIRS[d][0], z + DIRS[d][1]];
        path.push(next);
        seen.add(key(...next));
      }
      if (path.length === length) return path;
    }
    throw new Error('percorso impossibile');
  }

  // Serpentina: righe avanti e indietro una accanto all'altra (un tornante a ogni cambio di riga)
  function serpentine(rng, length) {
    const row = rng() < 0.5 ? 3 : 4;
    const side = rng() < 0.5 ? 1 : 3;
    let dir = 0;
    let x = 0;
    let z = 0;
    let steps = 0;
    const path = [[0, 0]];
    while (path.length < length) {
      if (steps < row - 1) {
        x += DIRS[dir][0];
        z += DIRS[dir][1];
        steps++;
      } else {
        x += DIRS[side][0];
        z += DIRS[side][1];
        dir = (dir + 2) % 4;
        steps = 0;
      }
      path.push([x, z]);
    }
    return path;
  }

  const dirBetween = (a, b) => DIRS.findIndex(([dx, dz]) => a[0] + dx === b[0] && a[1] + dz === b[1]);

  // Punto della piastrella: u lungo la direzione di marcia, v di traverso (tutti e due da 0 a TILE)
  function local(t, u, v) {
    const S = TILE;
    const x0 = t.gx * S;
    const z0 = t.gz * S;
    switch (t.dir) {
      case 0: return [x0 + u, z0 + v];
      case 1: return [x0 + v, z0 + u];
      case 2: return [x0 + S - u, z0 + v];
      default: return [x0 + v, z0 + S - u];
    }
  }
  const localRect = (t, u0, u1, v0, v1) => [local(t, u0, v0), local(t, u1, v0), local(t, u1, v1), local(t, u0, v1)];
  const travelAxis = (t) => (t.dir === 0 || t.dir === 2 ? 0 : 1);

  // Lato d della piastrella, da a a b (frazioni 0..1 lungo il lato)
  function edgeSegment(t, d, a = 0, b = 1) {
    const S = TILE;
    const x0 = t.gx * S;
    const z0 = t.gz * S;
    const ends = [
      [x0 + S, z0, x0 + S, z0 + S],
      [x0, z0 + S, x0 + S, z0 + S],
      [x0, z0, x0, z0 + S],
      [x0, z0, x0 + S, z0],
    ][d];
    const [x1, z1, x2, z2] = ends;
    return [x1 + (x2 - x1) * a, z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, z1 + (z2 - z1) * b];
  }

  function floorAt(t, x, z) {
    // altezza del prato della piastrella (senza conca), anche sopra il vuoto
    if (t.kind !== 'ramp') return t.h0;
    const S = TILE;
    const [dx, dz] = DIRS[t.dir];
    const lx = x - t.gx * S;
    const lz = z - t.gz * S;
    const u = dx ? (dx > 0 ? lx : S - lx) : (dz > 0 ? lz : S - lz);
    return t.h0 + ((t.h1 - t.h0) * u) / S;
  }

  function addWalls(hole, t, d) {
    if (t.kind === 'bridge') return; // ponte: niente sponde, solo il vuoto
    const parts = t.kind === 'ramp' ? 5 : 1;
    let a0 = 0;
    let a1 = 1;
    if (t.kind === 'gap') {
      // sul burrone la sponda c'è solo sopra la parte d'atterraggio
      const along = DIRS[t.dir];
      const side = DIRS[d];
      if (side[0] === along[0] && side[1] === along[1]) {
        // lato di fronte: intero
      } else if (side[0] === -along[0] && side[1] === -along[1]) {
        return; // lato da cui si salta: aperto sul vuoto
      } else {
        const f = t.gap / TILE;
        // il lato va da un angolo all'altro: capire quale estremo è "avanti"
        const seg = edgeSegment(t, d);
        const forward = (seg[2] - seg[0]) * along[0] + (seg[3] - seg[1]) * along[1] > 0;
        [a0, a1] = forward ? [f, 1] : [0, 1 - f];
      }
    }
    for (let p = 0; p < parts; p++) {
      const a = a0 + ((a1 - a0) * p) / parts;
      const b = a0 + ((a1 - a0) * (p + 1)) / parts;
      const seg = edgeSegment(t, d, a, b);
      const ya = floorAt(t, seg[0], seg[1]) + WALL_H;
      const yb = floorAt(t, seg[2], seg[3]) + WALL_H;
      // ya e yb servono solo al disegno (sponda inclinata lungo le rampe)
      hole.walls.push({ seg, y0: -10, y1: Math.max(ya, yb), ya, yb });
    }
  }

  // Ostacolo su una piastrella dritta o in curva; restituisce un'etichetta per il par
  function decorate(rng, hole, t, straight, index, forceMill) {
    const S = TILE;
    const h = t.h0;
    const across = 1 - travelAxis(t);
    const choicesStraight = ['ramp', 'ramp', 'bridge', 'tunnel', 'windmill', 'windmill', 'slider', 'spinner', 'boost', 'water', 'stub', 'bumper', 'sand'];
    const choicesTurn = ['bumper', 'bumper', 'sand', 'spinner'];
    const kind = forceMill && straight ? 'windmill' : pick(rng, straight ? choicesStraight : choicesTurn);
    switch (kind) {
      case 'bumper': {
        const n = rng() < 0.5 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const [x, z] = local(t, range(rng, 1.3, S - 1.3), range(rng, 1.3, S - 1.3));
          hole.bumpers.push({ x, z, r: range(rng, 0.3, 0.45), y: h });
        }
        return 'bumper';
      }
      case 'sand':
        hole.zones.push({ type: 'sand', poly: rng() < 0.5 ? localRect(t, 0, S / 2, 0, S) : localRect(t, 0, S, rng() < 0.5 ? 0 : S / 2, rng() < 0.5 ? S / 2 : S) });
        return 'sand';
      case 'water': {
        const side = rng() < 0.5;
        hole.zones.push({ type: 'water', poly: localRect(t, 0.5, S - 0.5, side ? 0 : S - 1.5, side ? 1.5 : S) });
        return 'water';
      }
      case 'boost': {
        const f = range(rng, 12, 18);
        const [dx, dz] = DIRS[t.dir];
        hole.zones.push({ type: 'boost', poly: localRect(t, 1, 4, 1.4, S - 1.4), force: [dx * f, dz * f] });
        return 'boost';
      }
      case 'ramp':
        return 'ramp'; // le rampe le decide chi chiama (cambiano l'altezza)
      case 'bridge':
        t.kind = 'bridge';
        t.width = range(rng, 1.1, 1.5);
        return 'bridge';
      case 'tunnel':
        t.roof = true;
        // a volte in galleria c'è anche una pala
        if (rng() < 0.4) {
          const [x, z] = local(t, S / 2, S / 2);
          hole.spinners.push({ x, z, len: 2.6, speed: (rng() < 0.5 ? -1 : 1) * range(rng, 0.7, 1.3), phase: range(rng, 0, Math.PI), y: h });
        }
        return 'tunnel';
      case 'spinner': {
        const [x, z] = local(t, S / 2, S / 2);
        hole.spinners.push({ x, z, len: 2.6, speed: (rng() < 0.5 ? -1 : 1) * range(rng, 0.7, 1.4), phase: range(rng, 0, Math.PI), y: h });
        return 'spinner';
      }
      case 'slider': {
        const [x, z] = local(t, S / 2, S / 2);
        hole.sliders.push({ x, z, len: 1.6, axis: across, amp: 1.4, speed: range(rng, 0.9, 1.6), phase: range(rng, 0, Math.PI * 2), y: h });
        return 'slider';
      }
      case 'windmill': {
        // casetta col mulino: si entra solo dalla porta centrale, quando le pale non la coprono
        const gate = 1.6;
        const top = h + 0.9;
        const s1 = [...local(t, S / 2, 0), ...local(t, S / 2, S / 2 - gate / 2)];
        const s2 = [...local(t, S / 2, S / 2 + gate / 2), ...local(t, S / 2, S)];
        hole.walls.push({ seg: s1, y0: -10, y1: top, house: true }, { seg: s2, y0: -10, y1: top, house: true });
        const [x, z] = local(t, S / 2, S / 2);
        hole.windmills.push({ x, z, width: gate, axis: travelAxis(t), period: range(rng, 3.2, 4.4), open: range(rng, 0.45, 0.6), phase: range(rng, 0, 4), y: h, dir: t.dir });
        return 'windmill';
      }
      case 'stub': {
        const fromLeft = rng() < 0.5;
        hole.walls.push({ seg: [...local(t, S / 2, fromLeft ? 0 : S), ...local(t, S / 2, fromLeft ? 2.8 : S - 2.8)], y0: -10, y1: h + WALL_H });
        return 'stub';
      }
      default:
        return 'plain';
    }
  }

  function generateHole(seed, index, { forceMill = false } = {}) {
    const rng = makeRng(seed * 7919 + index * 104729 + 1);
    const serp = index >= 1 && rng() < 0.3 + 0.04 * index;
    let length = Math.min(12, 5 + Math.floor(index * 0.7)) + (rng() < 0.5 ? 1 : 0);
    if (serp) length = Math.max(length, 8);
    const path = serp ? serpentine(rng, length) : walk(rng, length);
    const din = path.map((p, i) => (i ? dirBetween(path[i - 1], p) : dirBetween(p, path[1])));
    const dout = path.map((p, i) => (i < length - 1 ? dirBetween(p, path[i + 1]) : din[i]));
    const straight = (i) => din[i] === dout[i];

    const hole = {
      index,
      name: `Buca ${index + 1}`,
      tile: TILE,
      tiles: path.map(([gx, gz], i) => ({ gx, gz, kind: 'flat', h0: 0, h1: 0, dir: din[i] })),
      start: null,
      cup: null,
      walls: [],
      bumpers: [],
      zones: [],
      spinners: [],
      sliders: [],
      windmills: [],
      portals: [],
      par: 2,
    };
    const T = hole.tiles;
    let h = 0;
    let jumps = 0;
    let hard = 0;
    const chance = Math.min(0.95, 0.85 + 0.02 * index);
    let wantMill = forceMill;
    const plain = new Set();
    for (let i = 1; i < length - 1; i++) {
      const t = T[i];
      t.h0 = h;
      t.h1 = h;
      // salto: rampa, burrone e atterraggio, tutti dritti
      if (!serp && i + 2 <= length - 1 && straight(i) && straight(i + 1) && din[i + 1] === din[i] && rng() < 0.2 + 0.05 * index) {
        t.kind = 'ramp';
        t.h1 = h + 0.8;
        const g = T[i + 1];
        g.kind = 'gap';
        g.gap = range(rng, 2, 2.6);
        g.h0 = h + 0.3;
        g.h1 = g.h0;
        h = g.h0;
        jumps++;
        i++;
        continue;
      }
      // sulle serpentine le righe salgono: tornanti di montagna
      if (serp && straight(i) && rng() < 0.65) {
        t.kind = 'ramp';
        t.h1 = h + range(rng, 0.6, 0.9);
        h = t.h1;
        continue;
      }
      if (rng() >= chance) {
        plain.add(i);
        continue;
      }
      const what = decorate(rng, hole, t, straight(i), index, wantMill);
      if (what === 'windmill') wantMill = false;
      // a volte un secondo ostacolo sulla stessa piastrella
      if (['sand', 'boost', 'water'].includes(what) && rng() < 0.5) {
        const [x, z] = local(t, range(rng, 1.4, TILE - 1.4), TILE / 2 + range(rng, -0.8, 0.8));
        hole.bumpers.push({ x, z, r: range(rng, 0.3, 0.4), y: t.h0 });
      }
      if (what === 'ramp') {
        const up = h < 0.6 || rng() < 0.5;
        t.kind = 'ramp';
        t.h1 = up ? h + range(rng, 0.6, 1) : h - range(rng, 0.6, Math.min(1, h));
        h = t.h1;
      } else if (what === 'plain') {
        plain.add(i);
      } else if (['windmill', 'slider', 'spinner', 'bridge', 'tunnel'].includes(what)) {
        hard++;
      }
    }
    const last = T[length - 1];
    last.h0 = h;
    last.h1 = h;
    last.bowl = true;

    // portale: una scorciatoia di lato, da una piastrella libera a una più avanti
    const free = [...plain].filter((i) => T[i].kind === 'flat');
    if (index >= 2 && free.length >= 2 && rng() < 0.45) {
      const a = free[0];
      const b = free[free.length - 1];
      if (b > a + 1) {
        hole.portals.push({ a: local(T[a], TILE / 2, rng() < 0.5 ? 1 : TILE - 1), b: local(T[b], TILE / 2, TILE / 2), r: 0.4 });
      }
    }

    // muri: ogni lato che non porta alla piastrella prima o dopo
    const onPath = new Map(path.map((p, i) => [key(...p), i]));
    path.forEach(([gx, gz], i) => {
      DIRS.forEach(([dx, dz], d) => {
        const j = onPath.get(key(gx + dx, gz + dz));
        if (j === i - 1 || j === i + 1) return;
        addWalls(hole, T[i], d);
      });
    });

    hole.start = local(T[0], TILE / 2, TILE / 2);
    hole.cup = local(last, range(rng, 2.5, 3.5), range(rng, 1.5, 3.5));
    let turns = 0;
    for (let i = 1; i < length - 1; i++) if (!straight(i)) turns++;
    hole.par = Math.max(2, Math.min(7, Math.round(1.5 + length * 0.3 + turns * 0.35 + jumps * 0.5 + hard * 0.3)));
    return P.prepare(hole);
  }

  function generateCourse(seed, holes = HOLES) {
    const course = Array.from({ length: holes }, (_, i) => generateHole(seed, i));
    // almeno un mulino a partita: se non è uscito, lo si mette in una buca a metà percorso
    const mid = Math.floor(holes / 2);
    for (let k = 0; k < holes && !course.some((h) => h.windmills.length); k++) {
      const i = (mid + k) % holes;
      const h = generateHole(seed, i, { forceMill: true });
      if (h.windmills.length) course[i] = h;
    }
    return course;
  }

  const api = { HOLES, TILE, generateCourse, generateHole, makeRng, local };
  if (isNode) module.exports = api;
  else root.GolfCourse = api;
})(this);
