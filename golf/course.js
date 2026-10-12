'use strict';
// Golf: percorso procedurale. Dallo stesso seme escono le stesse buche, sul server e in ogni browser.
// Ogni buca è un corridoio di piastrelle quadrate con curve; sulle piastrelle di mezzo ci sono ostacoli a caso.
(function (root) {
  const HOLES = 6;
  const TILE = 5;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // +x, +z, -x, -z

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

  // Cammino a caso sulla griglia, senza ripassare dove è già stato
  function walk(rng, length) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const path = [[0, 0]];
      const seen = new Set([key(0, 0)]);
      let dir = 0;
      while (path.length < length) {
        const [x, z] = path[path.length - 1];
        const options = [dir, (dir + 1) % 4, (dir + 3) % 4].filter((d) => !seen.has(key(x + DIRS[d][0], z + DIRS[d][1])));
        if (!options.length) break;
        // di solito si va dritti, ogni tanto si gira
        const d = options.includes(dir) && rng() < 0.55 ? dir : pick(rng, options);
        dir = d;
        const next = [x + DIRS[d][0], z + DIRS[d][1]];
        path.push(next);
        seen.add(key(...next));
      }
      if (path.length === length) return path;
    }
    throw new Error('percorso impossibile');
  }

  function dirBetween(a, b) {
    return DIRS.findIndex(([dx, dz]) => a[0] + dx === b[0] && a[1] + dz === b[1]);
  }

  // Lato della piastrella verso la direzione d, come segmento
  function edge(x0, z0, d) {
    const S = TILE;
    return [
      [x0 + S, z0, x0 + S, z0 + S],
      [x0, z0 + S, x0 + S, z0 + S],
      [x0, z0, x0, z0 + S],
      [x0, z0, x0 + S, z0],
    ][d];
  }

  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

  function addObstacle(rng, hole, x0, z0, straight, along) {
    const S = TILE;
    const cx = x0 + S / 2;
    const cz = z0 + S / 2;
    const types = straight ? ['bumper', 'sand', 'slope', 'water', 'spinner', 'stub'] : ['bumper', 'sand', 'slope'];
    const type = pick(rng, types);
    const alongX = along === 0 || along === 2;
    if (type === 'bumper') {
      const n = rng() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        hole.bumpers.push({ x: range(rng, x0 + 1.3, x0 + S - 1.3), z: range(rng, z0 + 1.3, z0 + S - 1.3), r: range(rng, 0.3, 0.45) });
      }
    } else if (type === 'sand') {
      const half = rng() < 0.5;
      const poly = rng() < 0.5
        ? rect(half ? x0 : cx, z0, half ? cx : x0 + S, z0 + S)
        : rect(x0, half ? z0 : cz, x0 + S, half ? cz : z0 + S);
      hole.zones.push({ type: 'sand', poly });
    } else if (type === 'slope') {
      const [dx, dz] = pick(rng, DIRS);
      const f = range(rng, 0.45, 0.8); // più debole dell'attrito: piega la traiettoria ma non fa rotolare da ferma
      hole.zones.push({ type: 'slope', poly: rect(x0, z0, x0 + S, z0 + S), force: [dx * f, dz * f] });
    } else if (type === 'water') {
      // striscia d'acqua lungo un lato: il corridoio resta largo 3,5
      const side = rng() < 0.5;
      const w = 1.5;
      const poly = alongX
        ? rect(x0 + 0.5, side ? z0 : z0 + S - w, x0 + S - 0.5, side ? z0 + w : z0 + S)
        : rect(side ? x0 : x0 + S - w, z0 + 0.5, side ? x0 + w : x0 + S, z0 + S - 0.5);
      hole.zones.push({ type: 'water', poly });
    } else if (type === 'spinner') {
      const sign = rng() < 0.5 ? -1 : 1;
      hole.spinners.push({ x: cx, z: cz, len: 2.6, speed: sign * range(rng, 0.7, 1.4), phase: range(rng, 0, Math.PI) });
    } else {
      // muretto da un lato, perpendicolare al cammino: bisogna passare dall'altra parte
      const fromStart = rng() < 0.5;
      const l = 2.8;
      hole.walls.push(alongX
        ? [cx, fromStart ? z0 : z0 + S, cx, fromStart ? z0 + l : z0 + S - l]
        : [fromStart ? x0 : x0 + S, cz, fromStart ? x0 + l : x0 + S - l, cz]);
    }
    return type;
  }

  function generateHole(seed, index) {
    const rng = makeRng(seed * 7919 + index * 104729 + 1);
    const length = 3 + Math.floor(index * 0.8) + (rng() < 0.5 ? 1 : 0);
    const path = walk(rng, length);
    const S = TILE;
    const hole = {
      index,
      name: `Buca ${index + 1}`,
      tiles: path.map(([gx, gz]) => [gx * S, gz * S, S]),
      start: null,
      cup: null,
      walls: [],
      bumpers: [],
      zones: [],
      spinners: [],
      par: 2,
    };
    const onPath = new Map(path.map((p, i) => [key(...p), i]));

    // muri: ogni lato che non porta alla piastrella prima o dopo
    path.forEach(([gx, gz], i) => {
      DIRS.forEach(([dx, dz], d) => {
        const j = onPath.get(key(gx + dx, gz + dz));
        if (j === i - 1 || j === i + 1) return;
        hole.walls.push(edge(gx * S, gz * S, d));
      });
    });

    const [sx, sz] = hole.tiles[0];
    hole.start = [sx + S / 2, sz + S / 2];
    const [ex, ez] = hole.tiles[length - 1];
    hole.cup = [ex + S / 2 + range(rng, -1, 1), ez + S / 2 + range(rng, -1, 1)];

    let obstacles = 0;
    const chance = 0.35 + 0.08 * index;
    for (let i = 1; i < length - 1; i++) {
      if (rng() >= chance) continue;
      const din = dirBetween(path[i - 1], path[i]);
      const dout = dirBetween(path[i], path[i + 1]);
      addObstacle(rng, hole, hole.tiles[i][0], hole.tiles[i][1], din === dout, din);
      obstacles++;
    }
    hole.par = Math.max(2, Math.min(6, 2 + Math.floor((length - 1) / 2) + (obstacles >= 3 ? 1 : 0)));
    return hole;
  }

  function generateCourse(seed, holes = HOLES) {
    return Array.from({ length: holes }, (_, i) => generateHole(seed, i));
  }

  const api = { HOLES, TILE, generateCourse, generateHole, makeRng };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GolfCourse = api;
})(this);
