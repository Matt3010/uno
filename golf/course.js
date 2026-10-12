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

  const LEVEL = 2.6; // dislivello tra un piano e l'altro
  const CLEAR = 2.2; // spazio minimo in altezza tra due piani nella stessa cella

  // Cammino a più piani: dritto, curve, tornanti, salite e discese di un piano, salti.
  // Una cella si può riusare se il nuovo pezzo sta abbastanza sopra (o sotto) quello che c'è già.
  function walk3d(rng, length, index) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const cells = new Map();
      const tiles = [];
      const lo = (t) => Math.min(t.h0, t.h1);
      const hi = (t) => Math.max(t.h0, t.h1);
      const fits = (gx, gz, a, b) => (cells.get(key(gx, gz)) || []).every((t) => hi(t) <= Math.min(a, b) - CLEAR || lo(t) >= Math.max(a, b) + CLEAR);
      const put = (gx, gz, h0, h1, kind, extra = {}) => {
        const t = { gx, gz, kind, h0, h1, ...extra };
        tiles.push(t);
        if (!cells.has(key(gx, gz))) cells.set(key(gx, gz), []);
        cells.get(key(gx, gz)).push(t);
        return t;
      };
      put(0, 0, 0, 0, 'flat');
      let dir = 0;
      let lastTurn = 0;
      let h = 0;
      let climbs = 0;
      let highSteps = 0; // piastrelle fatte al piano attuale (sopra il primo)
      let route = []; // direzioni obbligate: dopo una salita, il cavalcavia che torna sopra il già fatto
      let straightNext = false; // dopo rampe e salti si esce dritti, dal lato di fronte
      let ok = true;
      while (tiles.length < length - 1 && ok) {
        const cur = tiles[tiles.length - 1];
        const ahead = (k) => [cur.gx + DIRS[dir][0] * k, cur.gz + DIRS[dir][1] * k];
        const room = length - 1 - tiles.length;
        // pezzi speciali (salite, discese, salti) solo dopo due piastrelle piane di rincorsa;
        // con un tornante in corso o subito dopo un pezzo speciale si fa solo un passo normale
        const calm = tiles.length >= 2 && tiles.slice(-2).every((t) => t.kind === 'flat');
        const r = route.length || straightNext || !calm ? 2 : rng();
        const [a1x, a1z] = ahead(1);
        const [a2x, a2z] = ahead(2);
        // salita di un piano: due rampe ripide di fila
        const climbChance = climbs === 0 && tiles.length >= 3 ? 0.75 : 0.3;
        if (room >= 3 && climbs < 3 && h < LEVEL * 2 && r < climbChance + 0.01 * index
          && fits(a1x, a1z, h, h + LEVEL / 2) && fits(a2x, a2z, h + LEVEL / 2, h + LEVEL)) {
          put(a1x, a1z, h, h + LEVEL / 2, 'ramp');
          put(a2x, a2z, h + LEVEL / 2, h + LEVEL, 'ramp');
          h += LEVEL;
          climbs++;
          lastTurn = 0;
          // cavalcavia: dritto, tornante, indietro nella riga accanto, poi sopra la piastrella da cui si è saliti
          if (rng() < 0.85) {
            const side = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
            const back = (dir + 2) % 4;
            route = [dir, side, back, back, back, (side + 2) % 4];
          } else {
            straightNext = true;
          }
          continue;
        }
        // discesa di un piano: a rampe, oppure saltando giù dal bordo (dopo un po' di strada lassù)
        if (h >= LEVEL && highSteps >= 3 && r < 0.14) {
          if (rng() < 0.5 && room >= 3 && fits(a1x, a1z, h - LEVEL / 2, h) && fits(a2x, a2z, h - LEVEL, h - LEVEL / 2)) {
            put(a1x, a1z, h, h - LEVEL / 2, 'ramp');
            put(a2x, a2z, h - LEVEL / 2, h - LEVEL, 'ramp');
            h -= LEVEL;
            lastTurn = 0;
            straightNext = true;
            continue;
          }
          if (room >= 2 && fits(a1x, a1z, h - LEVEL, h - LEVEL)) {
            put(a1x, a1z, h - LEVEL, h - LEVEL, 'gap', { gap: 1.6 });
            h -= LEVEL;
            lastTurn = 0;
            straightNext = true;
            continue;
          }
        }
        // salto sul burrone: rampa e atterraggio più avanti
        if (room >= 3 && r > 0.82 - 0.01 * index && r <= 1 && fits(a1x, a1z, h, h + 0.8) && fits(a2x, a2z, h + 0.3, h + 0.3)) {
          put(a1x, a1z, h, h + 0.8, 'ramp');
          put(a2x, a2z, h + 0.3, h + 0.3, 'gap', { gap: range(rng, 2.4, 3) });
          h += 0.3;
          lastTurn = 0;
          straightNext = true;
          continue;
        }
        // passo normale: dritto, curva, o seconda curva dalla stessa parte (tornante)
        const free = (d) => fits(cur.gx + DIRS[d][0], cur.gz + DIRS[d][1], h, h);
        let d;
        const options = [dir, (dir + 1) % 4, (dir + 3) % 4].filter(free);
        // dall'alto si va apposta sopra i pezzi già fatti: chi cade torna indietro
        // quanto porta sopra il già fatto: la cella accanto conta di più, quella dopo un po' meno
        const used = (o, k) => ((cells.get(key(cur.gx + DIRS[o][0] * k, cur.gz + DIRS[o][1] * k)) || []).length ? 1 : 0);
        const score = (o) => used(o, 1) * 2 + used(o, 2);
        const bestScore = Math.max(0, ...options.map(score));
        const over = bestScore ? options.filter((o) => score(o) === bestScore) : [];
        if (!options.length) {
          ok = false;
          break;
        }
        if (route.length) {
          d = route.shift();
          if (!free(d)) {
            ok = false;
            break;
          }
        } else if (straightNext) {
          if (!options.includes(dir)) {
            ok = false;
            break;
          }
          d = dir;
          straightNext = false;
        } else if (h >= LEVEL && over.length && rng() < 0.9) {
          d = pick(rng, over);
        } else if (lastTurn && rng() < 0.65 && free((dir + lastTurn + 4) % 4)) {
          d = (dir + lastTurn + 4) % 4; // seconda curva dalla stessa parte: tornante
        } else {
          d = options.includes(dir) && rng() < 0.4 ? dir : pick(rng, options);
        }
        lastTurn = d === dir ? 0 : (d === (dir + 1) % 4 ? 1 : -1);
        dir = d;
        put(cur.gx + DIRS[d][0], cur.gz + DIRS[d][1], h, h, 'flat');
        highSteps = h >= LEVEL ? highSteps + 1 : 0;
      }
      if (!ok) continue;
      // la buca: una cella libera accanto all'ultima
      const cur = tiles[tiles.length - 1];
      // (non accanto alla partenza, se si è tornati allo stesso piano)
      const far = (gx, gz) => Math.abs(gx) + Math.abs(gz) >= 2;
      const end = (straightNext ? [dir] : [dir, (dir + 1) % 4, (dir + 3) % 4]).find((d) => fits(cur.gx + DIRS[d][0], cur.gz + DIRS[d][1], h, h) && far(cur.gx + DIRS[d][0], cur.gz + DIRS[d][1]));
      if (end === undefined) continue;
      put(cur.gx + DIRS[end][0], cur.gz + DIRS[end][1], h, h, 'flat', { bowl: true });
      // direzione di marcia di ogni piastrella
      tiles.forEach((t, i) => {
        const a = i ? tiles[i - 1] : t;
        const b = i ? t : tiles[1];
        t.dir = dirBetween([a.gx, a.gz], [b.gx, b.gz]);
      });
      return tiles;
    }
    throw new Error('percorso impossibile');
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
      hole.walls.push({ seg, y0: Math.min(ya, yb) - WALL_H - 0.45, y1: Math.max(ya, yb), ya, yb });
    }
  }

  // Ostacolo su una piastrella dritta o in curva; restituisce un'etichetta per il par
  // tall = false: nella cella c'è anche un altro piano, quindi niente pezzi alti (mulini, gallerie)
  function decorate(rng, hole, t, straight, index, force, tall = true) {
    const S = TILE;
    const h = t.h0;
    const across = 1 - travelAxis(t);
    const choicesStraight = ['bridge', 'bridge', 'tunnel', 'windmill', 'windmill', 'slider', 'slider', 'spinner', 'spinner', 'boost', 'water', 'water', 'stub', 'bumper', 'sand'];
    const choicesTurn = ['bumper', 'bumper', 'sand', 'spinner'];
    const allowed = tall ? choicesStraight : choicesStraight.filter((k) => k !== 'windmill' && k !== 'tunnel');
    const kind = force || pick(rng, straight ? allowed : choicesTurn);
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
        hole.zones.push({ type: 'sand', y: h, poly: rng() < 0.5 ? localRect(t, 0, S / 2, 0, S) : localRect(t, 0, S, rng() < 0.5 ? 0 : S / 2, rng() < 0.5 ? S / 2 : S) });
        return 'sand';
      case 'water': {
        const side = rng() < 0.5;
        hole.zones.push({ type: 'water', y: h, poly: localRect(t, 0.5, S - 0.5, side ? 0 : S - 1.9, side ? 1.9 : S) });
        return 'water';
      }
      case 'boost': {
        const f = range(rng, 12, 18);
        const [dx, dz] = DIRS[t.dir];
        hole.zones.push({ type: 'boost', y: h, poly: localRect(t, 1, 4, 1.4, S - 1.4), force: [dx * f, dz * f] });
        return 'boost';
      }
      case 'ramp':
        return 'ramp'; // le rampe le decide chi chiama (cambiano l'altezza)
      case 'bridge':
        t.kind = 'bridge';
        t.width = range(rng, 0.9, 1.3);
        return 'bridge';
      case 'tunnel':
        t.roof = true;
        // a volte in galleria c'è anche una pala
        if (rng() < 0.4) {
          const [x, z] = local(t, S / 2, S / 2);
          hole.spinners.push({ x, z, len: 3, speed: (rng() < 0.5 ? -1 : 1) * range(rng, 1, 1.8), phase: range(rng, 0, Math.PI), y: h });
        }
        return 'tunnel';
      case 'spinner': {
        const [x, z] = local(t, S / 2, S / 2);
        hole.spinners.push({ x, z, len: 3.2, speed: (rng() < 0.5 ? -1 : 1) * range(rng, 1, 2), phase: range(rng, 0, Math.PI), y: h });
        return 'spinner';
      }
      case 'slider': {
        const [x, z] = local(t, S / 2, S / 2);
        hole.sliders.push({ x, z, len: 1.8, axis: across, amp: 1.4, speed: range(rng, 1.2, 2.2), phase: range(rng, 0, Math.PI * 2), y: h });
        return 'slider';
      }
      case 'windmill': {
        // casetta col mulino: si entra solo dalla porta centrale, quando le pale non la coprono
        const gate = 1.6;
        const top = h + 0.9;
        const s1 = [...local(t, S / 2, 0), ...local(t, S / 2, S / 2 - gate / 2)];
        const s2 = [...local(t, S / 2, S / 2 + gate / 2), ...local(t, S / 2, S)];
        hole.walls.push({ seg: s1, y0: h - 0.45, y1: top, house: true }, { seg: s2, y0: h - 0.45, y1: top, house: true });
        const [x, z] = local(t, S / 2, S / 2);
        hole.windmills.push({ x, z, width: gate, axis: travelAxis(t), period: range(rng, 3, 4), open: range(rng, 0.3, 0.45), phase: range(rng, 0, 4), y: h, dir: t.dir });
        return 'windmill';
      }
      case 'stub': {
        const fromLeft = rng() < 0.5;
        hole.walls.push({ seg: [...local(t, S / 2, fromLeft ? 0 : S), ...local(t, S / 2, fromLeft ? 2.8 : S - 2.8)], y0: h - 0.45, y1: h + WALL_H, stub: true });
        return 'stub';
      }
      default:
        return 'plain';
    }
  }

  function generateHole(seed, index, { forceMill = false } = {}) {
    const rng = makeRng(seed * 7919 + index * 104729 + 1);
    const length = Math.min(20, 10 + index) + Math.floor(rng() * 3);
    const tiles = walk3d(rng, length, index);
    const hole = emptyHole(index, `Buca ${index + 1}`, tiles);
    const T = hole.tiles;
    const straight = (i) => T[i - 1] && T[i + 1] && dirBetween([T[i - 1].gx, T[i - 1].gz], [T[i].gx, T[i].gz]) === dirBetween([T[i].gx, T[i].gz], [T[i + 1].gx, T[i + 1].gz]);
    let hard = 0;
    let wantMill = forceMill;
    const plain = [];
    for (let i = 1; i < T.length - 1; i++) {
      const t = T[i];
      if (t.kind !== 'flat') continue;
      if (rng() >= 0.92) {
        plain.push(i);
        continue;
      }
      const tall = T.filter((o) => o.gx === t.gx && o.gz === t.gz).length === 1;
      const what = decorate(rng, hole, t, straight(i), index, wantMill && straight(i) && tall ? 'windmill' : null, tall);
      if (what === 'windmill') wantMill = false;
      // spesso un secondo ostacolo sulla stessa piastrella
      if (['sand', 'boost', 'water', 'stub'].includes(what) && rng() < 0.6) {
        const [x, z] = local(t, range(rng, 1.4, TILE - 1.4), TILE / 2 + range(rng, -0.8, 0.8));
        hole.bumpers.push({ x, z, r: range(rng, 0.3, 0.4), y: t.h0 });
      }
      if (what === 'plain') plain.push(i);
      else if (['windmill', 'slider', 'spinner', 'bridge', 'tunnel'].includes(what)) hard++;
    }

    // portale: una scorciatoia di lato, da una piastrella libera a una più avanti
    if (plain.length >= 2 && rng() < 0.5) {
      const a = plain[0];
      const b = plain[plain.length - 1];
      if (b > a + 2) hole.portals.push({ a: local(T[a], TILE / 2, rng() < 0.5 ? 1 : TILE - 1), ay: T[a].h0, b: local(T[b], TILE / 2, TILE / 2), by: T[b].h0, r: 0.4 });
    }

    const last = T[T.length - 1];
    finish(hole, local(last, range(rng, 2.5, 3.5), range(rng, 1.5, 3.5)), rng);
    let turns = 0;
    let jumps = 0;
    let climbs = 0;
    T.forEach((t, i) => {
      if (i > 0 && i < T.length - 1 && !straight(i)) turns++;
      if (t.kind === 'gap') jumps++;
      if (t.kind === 'ramp' && Math.abs(t.h1 - t.h0) > 1) climbs++;
    });
    hole.par = Math.max(3, Math.min(12, Math.round(2 + T.length * 0.3 + turns * 0.12 + jumps * 0.6 + climbs * 0.5 + hard * 0.35)));
    return P.prepare(hole);
  }

  // Muri (ogni lato che non porta alla piastrella prima o dopo), partenza e buca.
  // Ai piani alti alcune sponde mancano: chi esce cade al piano di sotto (o nel vuoto).
  function finish(hole, cup, rng = null) {
    const T = hole.tiles;
    hole.openEdges = 0;
    T.forEach((t, i) => {
      DIRS.forEach(([dx, dz], d) => {
        const nx = t.gx + dx;
        const nz = t.gz + dz;
        const linked = [T[i - 1], T[i + 1]].some((o) => o && o.gx === nx && o.gz === nz);
        if (linked) return;
        const high = Math.min(t.h0, t.h1) >= 2 && t.kind === 'flat' && !t.bowl && i > 0;
        if (rng && high && rng() < 0.3) {
          hole.openEdges++;
          return;
        }
        addWalls(hole, t, d);
      });
    });
    hole.start = local(T[0], TILE / 2, TILE / 2);
    hole.startY = T[0].h0;
    hole.cup = cup;
    hole.cupY = T[T.length - 1].h0;
  }

  function emptyHole(index, name, tiles) {
    return {
      index,
      name,
      tile: TILE,
      tiles,
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
  }

  // Piastrelle piane in fila da una lista di celle
  function flatTiles(path) {
    return path.map(([gx, gz], i) => ({
      gx, gz, kind: 'flat', h0: 0, h1: 0, dir: i ? dirBetween(path[i - 1], [gx, gz]) : dirBetween([gx, gz], path[1]),
    }));
  }

  // Buca fissa da un piano: per ogni piastrella { up | down: dislivello, jump: true, deco: tipo di ostacolo }
  function planned(index, name, path, plan, par) {
    const rng = makeRng(4242 + index);
    const hole = emptyHole(index, name, flatTiles(path));
    const T = hole.tiles;
    let h = 0;
    for (let i = 1; i < T.length - 1; i++) {
      const t = T[i];
      const step = plan[i] || {};
      t.h0 = h;
      t.h1 = h;
      if (step.jump) {
        t.kind = 'ramp';
        t.h1 = h + 0.8;
        const g = T[i + 1];
        g.kind = 'gap';
        g.gap = 2.3;
        g.h0 = h + 0.3;
        g.h1 = g.h0;
        h = g.h0;
        i++;
        continue;
      }
      if (step.up || step.down) {
        t.kind = 'ramp';
        t.h1 = h + (step.up || -step.down);
        h = t.h1;
      }
      for (const d of [].concat(step.deco || [])) decorate(rng, hole, t, true, index, d);
    }
    const last = T[T.length - 1];
    last.h0 = h;
    last.h1 = h;
    last.bowl = true;
    if (plan.portal) {
      const [a, b] = plan.portal;
      hole.portals.push({ a: local(T[a], TILE / 2, 1), ay: T[a].h0, b: local(T[b], TILE / 2, TILE / 2), by: T[b].h0, r: 0.4 });
    }
    finish(hole, local(last, 3, TILE / 2));
    hole.par = par;
    return P.prepare(hole);
  }

  const row = (n, z = 0) => Array.from({ length: n }, (_, i) => [i, z]);

  // Mappa di prova: tre buche fisse che insieme hanno tutti i pezzi e gli ostacoli
  function showcaseCourse() {
    const serp = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
    return [
      planned(0, 'Rampe e salti', row(8), { 1: { deco: 'boost' }, 2: { jump: true }, 4: { up: 0.8 }, 5: { down: 1 }, 6: { deco: 'sand' } }, 4),
      planned(1, 'Mulino e ostacoli mobili', serp, {
        1: { deco: 'windmill' }, 2: { up: 0.7 }, 4: { deco: 'bumper' }, 5: { deco: 'slider' }, 6: { deco: 'spinner' }, 9: { deco: 'tunnel' }, 10: { deco: 'bridge' },
      }, 6),
      planned(2, 'Acqua, sabbia e portali', [...row(6), [5, 1], [5, 2]], {
        1: { deco: 'water' }, 2: { deco: ['sand', 'bumper'] }, 3: { deco: 'stub' }, portal: [4, 6],
      }, 4),
    ];
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

  const api = { HOLES, TILE, generateCourse, generateHole, showcaseCourse, makeRng, local };
  if (isNode) module.exports = api;
  else root.GolfCourse = api;
})(this);
