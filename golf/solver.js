'use strict';
// Golf: un giocatore automatico. Misura quanto manca alla buca seguendo il cammino delle piastrelle
// e a ogni colpo prova tanti tiri, scegliendo quello che porta più avanti.
const P = require('./physics');

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Quanto manca alla buca dalla pallina (x, z, y): piastrelle che restano + strada fino all'uscita di quella attuale
function progressField(hole) {
  const S = hole.tile;
  const index = new Map(hole.tiles.map((t, i) => [t, i]));
  const last = hole.tiles.length - 1;
  const exits = hole.tiles.map((t, i) => {
    if (i === last) return hole.cup;
    const n = hole.tiles[i + 1];
    return [((t.gx + n.gx + 1) * S) / 2, ((t.gz + n.gz + 1) * S) / 2];
  });
  return (x, z, y) => {
    const g = P.groundAt(hole, x, z, y);
    const i = g ? index.get(g.tile) : undefined;
    if (i === undefined) return Infinity;
    const [ex, ez] = exits[i];
    return (last - i) * S + Math.hypot(x - ex, z - ez);
  };
}

const ANGLES = 32;
const POWERS = [0.12, 0.2, 0.3, 0.42, 0.56, 0.72, 0.86, 1];

// Il tiro migliore da questa posizione [x, z, y]: { angle, power, sunk, x, z, y, t }
function bestShot(hole, from, field, t0 = 0) {
  let best = null;
  for (let a = 0; a < ANGLES; a++) {
    const angle = (a / ANGLES) * Math.PI * 2;
    for (const power of POWERS) {
      const b = P.createBall(hole, from[0], from[1], from[2] - P.BALL_R);
      P.shoot(b, angle, power);
      const r = P.simulate(b, hole, { maxT: 20, t0 });
      if (r.event === 'sunk') return { angle, power, sunk: true, x: b.x, z: b.z, y: b.y, t: r.t };
      if (r.event !== 'rest') continue;
      const cost = field(b.x, b.z, b.y);
      if (!best || cost < best.cost) best = { angle, power, sunk: false, x: b.x, z: b.z, y: b.y, t: r.t, cost };
    }
  }
  return best;
}

function solveHole(hole, { maxShots = 12 } = {}) {
  const field = progressField(hole);
  let pos = [hole.start[0], hole.start[1], hole.startY + P.BALL_R];
  let t = 0;
  for (let shots = 1; shots <= maxShots; shots++) {
    const shot = bestShot(hole, pos, field, t);
    if (!shot) return { sunk: false, shots };
    if (shot.sunk) return { sunk: true, shots };
    pos = [shot.x, shot.z, shot.y];
    t = shot.t;
  }
  return { sunk: false, shots: maxShots };
}

module.exports = { progressField, bestShot, solveHole, DIRS };
