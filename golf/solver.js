'use strict';
// Golf: un giocatore automatico. Calcola quanto manca alla buca "a piedi" (girando attorno ai muri)
// e a ogni colpo prova tanti tiri, scegliendo quello che porta più vicino.
const P = require('./physics');

const GRID = 0.5;

function segmentsCross(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Distanza dalla buca per ogni cella della griglia (Dijkstra con 8 vicini)
function distanceField(hole) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z, s] of hole.tiles) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x + s);
    maxZ = Math.max(maxZ, z + s);
  }
  const nx = Math.ceil((maxX - minX) / GRID);
  const nz = Math.ceil((maxZ - minZ) / GRID);
  const center = (i, j) => [minX + (i + 0.5) * GRID, minZ + (j + 0.5) * GRID];
  const walls = hole.walls;
  const walkable = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const [x, z] = center(i, j);
      const onTile = hole.tiles.some(([tx, tz, s]) => x > tx && x < tx + s && z > tz && z < tz + s);
      const wet = (hole.zones || []).some((zn) => zn.type === 'water' && P.inPoly(x, z, zn.poly));
      const bumped = (hole.bumpers || []).some((b) => Math.hypot(b.x - x, b.z - z) < b.r);
      walkable[i * nz + j] = onTile && !wet && !bumped ? 1 : 0;
    }
  }
  const dist = new Float64Array(nx * nz).fill(Infinity);
  const cell = (x, z) => [Math.floor((x - minX) / GRID), Math.floor((z - minZ) / GRID)];
  const [ci, cj] = cell(...hole.cup);
  dist[ci * nz + cj] = 0;
  const queue = [[0, ci, cj]];
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (queue.length) {
    // coda semplice: si prende il più vicino (le griglie sono piccole)
    let best = 0;
    for (let q = 1; q < queue.length; q++) if (queue[q][0] < queue[best][0]) best = q;
    const [d, i, j] = queue[best];
    queue[best] = queue[queue.length - 1];
    queue.pop();
    if (d > dist[i * nz + j]) continue;
    const from = center(i, j);
    for (const [di, dj] of steps) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || !walkable[a * nz + b]) continue;
      const to = center(a, b);
      if (walls.some((w) => segmentsCross(from, to, [w[0], w[1]], [w[2], w[3]]))) continue;
      const nd = d + Math.hypot(di, dj) * GRID;
      if (nd < dist[a * nz + b]) {
        dist[a * nz + b] = nd;
        queue.push([nd, a, b]);
      }
    }
  }
  return (x, z) => {
    const [i, j] = cell(x, z);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return Infinity;
    return dist[i * nz + j];
  };
}

const ANGLES = 36;
const POWERS = [0.1, 0.16, 0.24, 0.33, 0.44, 0.57, 0.72, 0.9];

// Il tiro migliore da questa posizione: { angle, power, sunk, x, z }
function bestShot(hole, from, field, t0 = 0) {
  let best = null;
  for (let a = 0; a < ANGLES; a++) {
    const angle = (a / ANGLES) * Math.PI * 2;
    for (const power of POWERS) {
      const b = P.createBall(from[0], from[1]);
      P.shoot(b, angle, power);
      const r = P.simulate(b, hole, { maxT: 15, t0 });
      if (r.event === 'sunk') return { angle, power, sunk: true, x: b.x, z: b.z, t: r.t };
      if (r.event === 'water' || r.event === 'timeout') continue;
      const cost = field(b.x, b.z);
      if (!best || cost < best.cost) best = { angle, power, sunk: false, x: b.x, z: b.z, t: r.t, cost };
    }
  }
  return best;
}

function solveHole(hole, { maxShots = 12 } = {}) {
  const field = distanceField(hole);
  let pos = hole.start;
  let t = 0;
  for (let shots = 1; shots <= maxShots; shots++) {
    const shot = bestShot(hole, pos, field, t);
    if (!shot) return { sunk: false, shots };
    if (shot.sunk) return { sunk: true, shots };
    pos = [shot.x, shot.z];
    t = shot.t;
  }
  return { sunk: false, shots: maxShots };
}

module.exports = { distanceField, bestShot, solveHole };
