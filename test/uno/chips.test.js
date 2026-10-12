'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chipColumns } = require('../../public/uno/chips');

const total = (cols) => cols.reduce((n, c) => n + c.value * c.count, 0);

test('le fiche si dividono per taglio, dalla più grande', () => {
  assert.deepStrictEqual(chipColumns(137), [
    { value: 100, count: 1 },
    { value: 25, count: 1 },
    { value: 10, count: 1 },
    { value: 1, count: 2 },
  ]);
  assert.deepStrictEqual(chipColumns(0), []);
});

test('le pile restano basse ma rappresentano sempre la somma, finché ci stanno', () => {
  for (const n of [1, 9, 40, 99, 260, 480]) {
    const cols = chipColumns(n);
    assert.strictEqual(total(cols), n, `${n}`);
    for (const c of cols) assert.ok(c.count <= 8);
  }
});

test('con montagne di fiche le pile si fermano a 8', () => {
  const cols = chipColumns(5000);
  assert.deepStrictEqual(cols, [{ value: 100, count: 8 }]);
});
