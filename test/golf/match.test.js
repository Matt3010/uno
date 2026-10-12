'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { GolfMatch, MAX_STROKES } = require('../../golf/match');

const players = () => [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bruno' }];
const newMatch = (opts = {}) => new GolfMatch(players(), { seed: 7, holes: 3, ...opts });

test('tutti giocano insieme la stessa buca e i colpi si contano', () => {
  const m = newMatch();
  assert.strictEqual(m.holeIndex, 0);
  m.shot('a');
  m.shot('b');
  m.shot('a');
  assert.deepStrictEqual(m.strokes.a, [2]);
  assert.deepStrictEqual(m.strokes.b, [1]);
});

test("in buca si ha finito; la buca finisce quando hanno finito tutti", () => {
  const m = newMatch();
  m.shot('a');
  m.sunk('a');
  assert.ok(m.done.a);
  assert.throws(() => m.shot('a'), /già finito/);
  assert.ok(!m.holeOver());
  m.shot('b');
  m.sunk('b');
  assert.ok(m.holeOver());
});

test("l'acqua costa un colpo in più", () => {
  const m = newMatch();
  m.shot('a');
  m.water('a');
  assert.deepStrictEqual(m.strokes.a, [2]);
});

test('al massimo dei colpi la buca è finita per te', () => {
  const m = newMatch();
  for (let i = 0; i < MAX_STROKES; i++) m.shot('a');
  assert.throws(() => m.shot('a'));
  m.rest('a'); // la pallina si ferma fuori dalla buca all'ultimo colpo
  assert.ok(m.done.a);
  assert.strictEqual(m.strokes.a[0], MAX_STROKES);
});

test('scaduto il tempo, chi non ha finito prende il massimo', () => {
  const m = newMatch();
  m.shot('a');
  m.sunk('a');
  m.timeUp();
  assert.ok(m.holeOver());
  assert.deepStrictEqual(m.strokes.b, [MAX_STROKES]);
});

test('si passa alla buca dopo e alla fine vince chi ha fatto meno colpi', () => {
  const m = newMatch({ holes: 2 });
  m.shot('a'); m.sunk('a');
  m.shot('b'); m.shot('b'); m.sunk('b');
  m.nextHole();
  assert.strictEqual(m.holeIndex, 1);
  assert.ok(!m.over);
  m.shot('a'); m.shot('a'); m.shot('a'); m.sunk('a');
  m.shot('b'); m.sunk('b');
  m.nextHole();
  assert.ok(m.over);
  assert.deepStrictEqual(m.totals(), { a: 4, b: 3 });
  assert.deepStrictEqual(m.ranking().map((r) => r.id), ['b', 'a']);
});

test('chi esce dalla partita non blocca la buca', () => {
  const m = newMatch();
  m.shot('a'); m.sunk('a');
  m.removePlayer('b');
  assert.ok(m.holeOver());
});
