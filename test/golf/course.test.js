'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateCourse, HOLES } = require('../../golf/course');
const P = require('../../golf/physics');

const inWater = (hole, [x, z]) => hole.zones.some((zn) => zn.type === 'water' && P.inPoly(x, z, zn.poly));

test('stesso seme, stesse buche; semi diversi, buche diverse', () => {
  assert.deepStrictEqual(JSON.stringify(generateCourse(42)), JSON.stringify(generateCourse(42)));
  assert.notDeepStrictEqual(JSON.stringify(generateCourse(42)), JSON.stringify(generateCourse(43)));
  assert.strictEqual(generateCourse(42).length, HOLES);
});

test('ogni buca ha senso: partenza e buca sul prato, lontane e senza ostacoli addosso', () => {
  for (let seed = 1; seed <= 150; seed++) {
    generateCourse(seed).forEach((hole, i) => {
      const where = `seme ${seed}, buca ${i + 1}`;
      assert.ok(P.groundAt(hole, ...hole.start), `${where}: partenza nel vuoto`);
      assert.ok(P.groundAt(hole, ...hole.cup), `${where}: buca nel vuoto`);
      assert.ok(!inWater(hole, hole.start) && !inWater(hole, hole.cup), `${where}: in acqua`);
      assert.ok(Math.hypot(hole.start[0] - hole.cup[0], hole.start[1] - hole.cup[1]) > 4, `${where}: troppo vicine`);
      for (const b of hole.bumpers) {
        for (const p of [hole.start, hole.cup]) assert.ok(Math.hypot(b.x - p[0], b.z - p[1]) > b.r + 1, `${where}: fungo addosso`);
      }
      assert.ok(hole.par >= 2 && hole.par <= 7, `${where}: par ${hole.par}`);
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
function hasHairpin(hole) {
  const t = hole.tiles;
  for (let i = 0; i + 3 < t.length; i++) {
    const d = (a, b) => [t[b].gx - t[a].gx, t[b].gz - t[a].gz];
    const [ax, az] = d(i, i + 1);
    const [bx, bz] = d(i + 2, i + 3);
    if (ax === -bx && az === -bz) return true;
  }
  return false;
}

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
