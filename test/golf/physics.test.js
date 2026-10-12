'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../golf/physics');

// campo rettangolare 20 x 6, aperto: i bordi sono muri
const box = (extra = {}) => ({
  start: [1, 3],
  cup: [18, 3],
  floor: [[0, 0], [20, 0], [20, 6], [0, 6]],
  ...extra,
});
const ball = (x, z) => P.createBall(x, z);
const run = (b, hole, maxT = 20, t0 = 0) => P.simulate(b, hole, { maxT, t0 });

test('la pallina rallenta e si ferma da sola', () => {
  const hole = box({ cup: [19, 5.5] });
  const b = ball(1, 3);
  P.shoot(b, 0, 0.3);
  const r = run(b, hole);
  assert.strictEqual(r.event, 'rest');
  assert.ok(P.atRest(b));
  assert.ok(b.x > 2 && b.x < 19, `x=${b.x}`);
});

test('più forza, più strada', () => {
  const hole = box({ cup: [19, 5.5] });
  const a = ball(1, 3);
  const b = ball(1, 3);
  P.shoot(a, 0, 0.2);
  P.shoot(b, 0, 0.4);
  run(a, hole);
  run(b, hole);
  assert.ok(b.x > a.x);
});

test('i muri fanno rimbalzare la pallina e non si attraversano', () => {
  const hole = box({ cup: [1, 1] });
  const b = ball(17, 3);
  P.shoot(b, 0, 0.6); // verso il muro a x = 20
  run(b, hole);
  assert.ok(b.x < 20 - P.BALL_R + 1e-6, `x=${b.x}`);
  assert.ok(b.x < 17, 'è tornata indietro');
});

test('in buca piano sì, troppo forte no', () => {
  const hole = box();
  const slow = ball(15, 3);
  P.shoot(slow, 0, 0.25);
  assert.strictEqual(run(slow, hole).event, 'sunk');

  const fast = ball(17.4, 3);
  P.shoot(fast, 0, 1);
  const r = P.simulate(fast, hole, { maxT: 0.12 });
  assert.notStrictEqual(r.event, 'sunk', 'passa sopra la buca');
});

test('la sabbia frena più del prato', () => {
  const sand = { type: 'sand', poly: [[4, 0], [20, 0], [20, 6], [4, 6]] };
  const a = ball(1, 3);
  const b = ball(1, 3);
  P.shoot(a, 0, 0.5);
  P.shoot(b, 0, 0.5);
  run(a, box({ cup: [19, 5.5] }));
  run(b, box({ cup: [19, 5.5], zones: [sand] }));
  assert.ok(b.x < a.x - 1);
});

test("nell'acqua si torna indietro", () => {
  const water = { type: 'water', poly: [[8, 0], [12, 0], [12, 6], [8, 6]] };
  const b = ball(1, 3);
  P.shoot(b, 0, 0.6);
  assert.strictEqual(run(b, box({ zones: [water] })).event, 'water');
});

test('una discesa spinge la pallina anche da ferma', () => {
  const slope = { type: 'slope', poly: [[0, 0], [20, 0], [20, 6], [0, 6]], force: [0, 2] };
  const b = ball(10, 1);
  run(b, box({ cup: [1, 1], zones: [slope] }), 5);
  assert.ok(b.z > 4, `z=${b.z}`);
});

test('i muri interni e i funghi respingono', () => {
  const wall = box({ cup: [1, 1], walls: [[10, 0, 10, 6]] });
  const a = ball(5, 3);
  P.shoot(a, 0, 0.6);
  run(a, wall);
  assert.ok(a.x < 10);

  const bump = box({ cup: [1, 1], bumpers: [{ x: 10, z: 3, r: 0.5 }] });
  const b = ball(5, 3);
  P.shoot(b, 0, 0.5);
  run(b, bump);
  assert.ok(b.x < 10);
});

test('la pala che gira blocca o lascia passare a seconda del momento', () => {
  // pala lunga 3 al centro, verticale quando l'angolo è 90°
  const spin = { x: 10, z: 3, len: 3, speed: Math.PI / 2 }; // un quarto di giro al secondo
  const hole = box({ cup: [1, 1], spinners: [spin] });
  const blocked = ball(8, 3);
  P.shoot(blocked, 0, 0.35);
  run(blocked, hole, 20, 1 - 0.1); // la pala arriva in verticale mentre passa
  assert.ok(blocked.x < 10, `x=${blocked.x}`);
});

test('la pallina non scappa mai dal campo, neanche al massimo della forza', () => {
  const hole = box({ cup: [1, 1], walls: [[10, 0, 10, 4]] });
  for (let a = 0; a < 16; a++) {
    const b = ball(5, 3);
    P.shoot(b, (a / 16) * Math.PI * 2, 1);
    run(b, hole);
    assert.ok(b.x > 0 && b.x < 20 && b.z > 0 && b.z < 6, `angolo ${a}: ${b.x},${b.z}`);
  }
});
