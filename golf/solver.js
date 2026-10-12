'use strict';
// Golf: un giocatore automatico. Misura quanto manca alla buca seguendo il cammino delle piastrelle
// e a ogni colpo prova tanti tiri, scegliendo quello che porta più avanti.
const P = require('./physics');

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Quanto manca alla buca da (x, z): piastrelle che restano + strada fino all'uscita di quella attuale
function progressField(hole) {
  const S = hole.tile;
  const index = new Map(hole.tiles.map((t, i) => [`${t.gx},${t.gz}`, i]));
  const last = hole.tiles.length - 1;
  const exits = hole.tiles.map((t, i) => {
    if (i === last) return hole.cup;
    const n = hole.tiles[i + 1];
    return [((t.gx + n.gx + 1) * S) / 2, ((t.gz + n.gz + 1) * S) / 2];
  });
  return (x, z) => {
    const i = index.get(`${Math.floor(x / S)},${Math.floor(z / S)}`);
    if (i === undefined) return Infinity;
    const [ex, ez] = exits[i];
    return (last - i) * S + Math.hypot(x - ex, z - ez);
  };
}

const ANGLES = 36;
const POWERS = [0.1, 0.16, 0.24, 0.33, 0.44, 0.57, 0.72, 0.86, 1];

// Il tiro migliore da questa posizione: { angle, power, sunk, x, z, t }
function bestShot(hole, from, field, t0 = 0) {
  let best = null;
  for (let a = 0; a < ANGLES; a++) {
    const angle = (a / ANGLES) * Math.PI * 2;
    for (const power of POWERS) {
      const b = P.createBall(hole, from[0], from[1]);
      P.shoot(b, angle, power);
      const r = P.simulate(b, hole, { maxT: 20, t0 });
      if (r.event === 'sunk') return { angle, power, sunk: true, x: b.x, z: b.z, t: r.t };
      if (r.event !== 'rest') continue;
      const cost = field(b.x, b.z);
      if (!best || cost < best.cost) best = { angle, power, sunk: false, x: b.x, z: b.z, t: r.t, cost };
    }
  }
  return best;
}

function solveHole(hole, { maxShots = 12 } = {}) {
  const field = progressField(hole);
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

module.exports = { progressField, bestShot, solveHole, DIRS };
