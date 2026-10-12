'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateCourse, HOLES } = require('../../golf/course');
const P = require('../../golf/physics');

const inWater = (hole, [x, z], y) => hole.zones.some((zn) => zn.type === 'water' && Math.abs(zn.y - y) < 0.6 && P.inPoly(x, z, zn.poly));

test('stesso seme, stesse buche; semi diversi, buche diverse', () => {
  assert.deepStrictEqual(JSON.stringify(generateCourse(42)), JSON.stringify(generateCourse(42)));
  assert.notDeepStrictEqual(JSON.stringify(generateCourse(42)), JSON.stringify(generateCourse(43)));
  assert.strictEqual(generateCourse(42).length, HOLES);
  assert.strictEqual(HOLES, 9);
});

test('ogni buca ha senso: partenza e buca sul prato, lontane e senza ostacoli addosso', () => {
  for (let seed = 1; seed <= 150; seed++) {
    generateCourse(seed).forEach((hole, i) => {
      const where = `seme ${seed}, buca ${i + 1}`;
      assert.ok(P.groundAt(hole, ...hole.start), `${where}: partenza nel vuoto`);
      assert.ok(P.groundAt(hole, ...hole.cup), `${where}: buca nel vuoto`);
      assert.ok(!inWater(hole, hole.start, hole.startY) && !inWater(hole, hole.cup, hole.cupY), `${where}: in acqua`);
      assert.ok(Math.hypot(hole.start[0] - hole.cup[0], hole.start[1] - hole.cup[1], hole.startY - hole.cupY) > 4, `${where}: troppo vicine`);
      for (const b of hole.bumpers) {
        for (const [p, y] of [[hole.start, hole.startY], [hole.cup, hole.cupY]]) {
          if (Math.abs((b.y ?? 0) - y) < 1) assert.ok(Math.hypot(b.x - p[0], b.z - p[1]) > b.r + 1, `${where}: fungo addosso`);
        }
      }
      assert.ok(hole.par >= 3 && hole.par <= 12, `${where}: par ${hole.par}`);
    });
  }
});

test('le buche diventano via via più lunghe', () => {
  let first = 0;
  let last = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const c = generateCourse(seed);
    first += c[0].tiles.length;
    last += c[HOLES - 1].tiles.length;
  }
  assert.ok(last > first);
});

// due svolte di fila dalla stessa parte: il percorso torna indietro a U
function hairpins(hole) {
  const t = hole.tiles;
  let n = 0;
  for (let i = 0; i + 3 < t.length; i++) {
    const d = (a, b) => [t[b].gx - t[a].gx, t[b].gz - t[a].gz];
    const [ax, az] = d(i, i + 1);
    const [bx, bz] = d(i + 2, i + 3);
    if (ax === -bx && az === -bz) n++;
  }
  return n;
}
const hasHairpin = (hole) => hairpins(hole) > 0;

test('i tornanti sono frequenti e ci sono buche a serpentina che salgono', () => {
  let withHairpin = 0;
  let serpentine = 0;
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const hole of generateCourse(seed)) {
      total++;
      if (hasHairpin(hole)) withHairpin++;
      const climbs = hole.tiles.some((t) => t.kind === 'ramp' && t.h1 > t.h0);
      if (hairpins(hole) >= 2 && climbs) serpentine++;
    }
  }
  assert.ok(withHairpin / total > 0.4, `buche con tornante: ${withHairpin}/${total}`);
  assert.ok(serpentine / total > 0.15, `serpentine in salita: ${serpentine}/${total}`);
});

test('nelle partite compaiono tutti i pezzi e gli ostacoli', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    for (const hole of generateCourse(seed)) {
      for (const t of hole.tiles) {
        seen.add(t.kind);
        if (t.roof) seen.add('tunnel');
        if (t.kind === 'ramp') seen.add(t.h1 > t.h0 ? 'salita' : 'discesa');
      }
      for (const k of ['bumpers', 'spinners', 'sliders', 'windmills', 'portals']) if (hole[k].length) seen.add(k);
      for (const zn of hole.zones) seen.add(zn.type);
      if (hasHairpin(hole)) seen.add('tornante');
    }
  }
  for (const k of ['salita', 'discesa', 'gap', 'bridge', 'tunnel', 'tornante', 'bumpers', 'spinners', 'sliders', 'windmills', 'portals', 'sand', 'water', 'boost']) {
    assert.ok(seen.has(k), `manca: ${k}`);
  }
});

test('9 buche di base, 18 se si vuole', () => {
  assert.strictEqual(generateCourse(5).length, 9);
  assert.strictEqual(generateCourse(5, 18).length, 18);
});

test('in ogni partita c’è almeno un mulino', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const n = generateCourse(seed).reduce((a, h) => a + h.windmills.length, 0);
    assert.ok(n >= 1, `seme ${seed}: nessun mulino`);
  }
});

test('percorsi impegnativi: quasi ogni piastrella di mezzo ha qualcosa', () => {
  let middle = 0;
  let busy = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const hole of generateCourse(seed)) {
      const cell = (x, z) => `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
      const filled = new Set([
        ...hole.bumpers.map((o) => cell(o.x, o.z)),
        ...[...hole.spinners, ...hole.sliders, ...hole.windmills].map((o) => cell(o.x, o.z)),
        ...hole.zones.map((zn) => cell(zn.poly.reduce((a, p) => a + p[0], 0) / zn.poly.length, zn.poly.reduce((a, p) => a + p[1], 0) / zn.poly.length)),
      ]);
      const things = (x, z) => filled.has(`${x},${z}`);
      hole.tiles.slice(1, -1).forEach((t) => {
        middle++;
        if (t.kind !== 'flat' || t.roof || things(t.gx, t.gz)) busy++;
      });
    }
  }
  assert.ok(busy / middle > 0.75, `piastrelle con qualcosa: ${busy}/${middle}`);
});

test('buche lunghe', () => {
  let tiles = 0;
  let holes = 0;
  let longest = 0;
  for (let seed = 1; seed <= 20; seed++) {
    for (const hole of generateCourse(seed)) {
      tiles += hole.tiles.length;
      holes++;
      longest = Math.max(longest, hole.tiles.length);
    }
  }
  assert.ok(tiles / holes >= 12, `in media ${tiles / holes} piastrelle`);
  assert.ok(longest >= 16, `la più lunga: ${longest}`);
});

test('più piani: il percorso passa sopra se stesso, con spazio in altezza', () => {
  let stacked = 0;
  let falls = 0;
  let total = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const hole of generateCourse(seed)) {
      total++;
      const cells = new Map();
      for (const t of hole.tiles) {
        const k = `${t.gx},${t.gz}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(t);
      }
      let here = false;
      for (const list of cells.values()) {
        if (list.length < 2) continue;
        here = true;
        const sorted = list.map((t) => [Math.min(t.h0, t.h1), Math.max(t.h0, t.h1)]).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][0] - sorted[i - 1][1] >= 2, `seme ${seed}: piani troppo vicini`);
      }
      if (here) stacked++;
      if (hole.openEdges > 0) falls++;
    }
  }
  assert.ok(stacked / total >= 0.4, `buche a più piani: ${stacked}/${total}`);
  assert.ok(falls / total >= 0.2, `buche con sponde aperte in alto: ${falls}/${total}`);
});

test('partenza e buca hanno la loro altezza', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const hole of generateCourse(seed)) {
      const s = P.groundAt(hole, hole.start[0], hole.start[1], hole.startY + P.BALL_R);
      assert.ok(s && Math.abs(s.h - hole.startY) < 1e-9);
      const c = P.groundAt(hole, hole.cup[0], hole.cup[1], hole.cupY + P.BALL_R + 0.3);
      assert.ok(c && c.h <= hole.cupY + 1e-9 && c.h > hole.cupY - 0.3);
    }
  }
});

test('niente mulini né gallerie dove due piani stanno nella stessa cella', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const hole of generateCourse(seed)) {
      const count = new Map();
      for (const t of hole.tiles) count.set(`${t.gx},${t.gz}`, (count.get(`${t.gx},${t.gz}`) || 0) + 1);
      const shared = (x, z) => count.get(`${Math.floor(x / 5)},${Math.floor(z / 5)}`) > 1;
      for (const m of hole.windmills) assert.ok(!shared(m.x, m.z), `seme ${seed}: mulino tra due piani`);
      for (const t of hole.tiles) if (t.roof) assert.ok(count.get(`${t.gx},${t.gz}`) === 1, `seme ${seed}: galleria tra due piani`);
    }
  }
});
