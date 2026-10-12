'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { showcaseCourse } = require('../../golf/course');
const { solveHole } = require('../../golf/solver');

function features(course) {
  const seen = new Set();
  for (const hole of course) {
    const t = hole.tiles;
    t.forEach((tile, i) => {
      seen.add(tile.kind);
      if (tile.roof) seen.add('tunnel');
      if (tile.bowl) seen.add('conca');
      if (tile.kind === 'ramp') seen.add(tile.h1 > tile.h0 ? 'salita' : 'discesa');
      if (i + 3 < t.length) {
        const a = [t[i + 1].gx - t[i].gx, t[i + 1].gz - t[i].gz];
        const b = [t[i + 3].gx - t[i + 2].gx, t[i + 3].gz - t[i + 2].gz];
        if (a[0] === -b[0] && a[1] === -b[1]) seen.add('tornante');
      }
    });
    for (const k of ['bumpers', 'spinners', 'sliders', 'windmills', 'portals']) if (hole[k].length) seen.add(k);
    for (const zn of hole.zones) seen.add(zn.type);
    if (hole.walls.some((w) => w.stub)) seen.add('muretto');
  }
  return seen;
}

test('la mappa di prova contiene tutti i pezzi e gli ostacoli', () => {
  const seen = features(showcaseCourse());
  for (const k of ['salita', 'discesa', 'gap', 'bridge', 'tunnel', 'tornante', 'conca', 'bumpers', 'spinners', 'sliders', 'windmills', 'portals', 'sand', 'water', 'boost', 'muretto']) {
    assert.ok(seen.has(k), `manca: ${k}`);
  }
});

test('la mappa di prova è sempre uguale e ogni buca si può finire', () => {
  assert.strictEqual(JSON.stringify(showcaseCourse()), JSON.stringify(showcaseCourse()));
  showcaseCourse().forEach((hole, i) => {
    const r = solveHole(hole, { maxShots: 12 });
    assert.ok(r.sunk, `buca ${i + 1} non finita`);
  });
});
