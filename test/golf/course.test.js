'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateCourse, HOLES } = require('../../golf/course');
const P = require('../../golf/physics');

const inTile = (hole, [x, z]) => hole.tiles.some(([tx, tz, s]) => x > tx && x < tx + s && z > tz && z < tz + s);
const inWater = (hole, [x, z]) => (hole.zones || []).some((zn) => zn.type === 'water' && P.inPoly(x, z, zn.poly));

test('stesso seme, stesse buche; semi diversi, buche diverse', () => {
  assert.deepStrictEqual(generateCourse(42), generateCourse(42));
  assert.notDeepStrictEqual(generateCourse(42), generateCourse(43));
  assert.strictEqual(generateCourse(42).length, HOLES);
});

test('ogni buca ha senso: partenza e buca sul prato, lontane e senza ostacoli addosso', () => {
  for (let seed = 1; seed <= 150; seed++) {
    generateCourse(seed).forEach((hole, i) => {
      const where = `seme ${seed}, buca ${i + 1}`;
      assert.ok(inTile(hole, hole.start), `${where}: partenza fuori`);
      assert.ok(inTile(hole, hole.cup), `${where}: buca fuori`);
      assert.ok(!inWater(hole, hole.start) && !inWater(hole, hole.cup), `${where}: in acqua`);
      assert.ok(Math.hypot(hole.start[0] - hole.cup[0], hole.start[1] - hole.cup[1]) > 4, `${where}: troppo vicine`);
      for (const b of hole.bumpers) {
        for (const p of [hole.start, hole.cup]) assert.ok(Math.hypot(b.x - p[0], b.z - p[1]) > b.r + 1, `${where}: fungo addosso`);
      }
      assert.ok(hole.par >= 2 && hole.par <= 6, `${where}: par ${hole.par}`);
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
