'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../golf/physics');

// Piastrelle 5 x 5 in fila lungo +x; ogni piastrella: { gx, gz, kind, h0, h1, dir }
const S = 5;
function strip(kinds, extra = {}) {
  const tiles = kinds.map((k, i) => ({ gx: i, gz: 0, dir: 0, h0: 0, h1: 0, ...(typeof k === 'string' ? { kind: k } : k) }));
  const n = tiles.length;
  const walls = [
    { seg: [0, 0, n * S, 0], y0: -5, y1: 3 },
    { seg: [0, S, n * S, S], y0: -5, y1: 3 },
    { seg: [0, 0, 0, S], y0: -5, y1: 3 },
    { seg: [n * S, 0, n * S, S], y0: -5, y1: 3 },
  ];
  return P.prepare({ tile: S, tiles, walls, start: [1, 2.5], cup: [n * S - 1, 2.5], ...extra });
}
const ball = (hole, x, z) => P.createBall(hole, x, z);
const run = (b, hole, maxT = 20, t0 = 0) => P.simulate(b, hole, { maxT, t0 });

test('sul piano la pallina rallenta e si ferma; più forza, più strada', () => {
  const hole = strip(['flat', 'flat', 'flat', 'flat'], { cup: [19, 4.5] });
  const a = ball(hole, 1, 2.5);
  const b = ball(hole, 1, 2.5);
  P.shoot(a, 0, 0.2);
  P.shoot(b, 0, 0.35);
  assert.strictEqual(run(a, hole).event, 'rest');
  run(b, hole);
  assert.ok(a.x > 2 && b.x > a.x, `${a.x} ${b.x}`);
});

test('i muri fanno rimbalzare e non si attraversano, neanche al massimo', () => {
  const hole = strip(['flat', 'flat', 'flat', 'flat'], { cup: [1, 0.5] });
  for (let i = 0; i < 12; i++) {
    const b = ball(hole, 10, 2.5);
    P.shoot(b, (i / 12) * Math.PI * 2, 1);
    run(b, hole);
    assert.ok(b.x > 0 && b.x < 20 && b.z > 0 && b.z < 5, `${i}: ${b.x},${b.z}`);
  }
});

test('in buca piano sì, troppo forte no', () => {
  const hole = strip(['flat', 'flat', 'flat', 'flat']);
  const slow = ball(hole, 16, 2.5);
  P.shoot(slow, 0, 0.3);
  assert.strictEqual(run(slow, hole).event, 'sunk');
  const fast = ball(hole, 18.2, 2.5);
  P.shoot(fast, 0, 1);
  assert.notStrictEqual(P.simulate(fast, hole, { maxT: 0.1 }).event, 'sunk');
});

test('una rampa in discesa fa rotolare la pallina anche da ferma', () => {
  const hole = strip([{ kind: 'ramp', h0: 1, h1: 0 }, 'flat', 'flat'], { cup: [14, 0.5] });
  const b = ball(hole, 1, 2.5);
  assert.ok(Math.abs(b.y - (1 - 1 / S) - P.BALL_R) < 0.02, `y=${b.y}`);
  run(b, hole);
  assert.ok(b.x > 5, `x=${b.x}`);
});

test('in salita senza forza si torna indietro', () => {
  const hole = strip(['flat', { kind: 'ramp', h0: 0, h1: 1.2 }, { kind: 'flat', h0: 1.2, h1: 1.2 }], { cup: [14, 0.5] });
  const b = ball(hole, 2, 2.5);
  P.shoot(b, 0, 0.3);
  run(b, hole);
  assert.ok(b.x < 6, `x=${b.x}`);
});

test('salto: con la rincorsa si vola sopra il burrone, piano si cade', () => {
  const land = { kind: 'flat', h0: 0.3, h1: 0.3 };
  const kinds = ['flat', { kind: 'ramp', h0: 0, h1: 0.8 }, { kind: 'gap', h0: 0.3, h1: 0.3, gap: 2.5 }, land, land, land];
  const hole = strip(kinds, { cup: [29, 0.5] });
  const fast = ball(hole, 1, 2.5);
  P.shoot(fast, 0, 1);
  let flew = false;
  const r = P.simulate(fast, hole, { maxT: 20, onStep: (b) => { if (!b.grounded) flew = true; } });
  assert.ok(flew, 'ha volato');
  assert.notStrictEqual(r.event, 'out');
  assert.ok(fast.x > 12.5, `atterrata a x=${fast.x}`);

  const slow = ball(hole, 7, 2.5);
  P.shoot(slow, 0, 0.45);
  assert.strictEqual(run(slow, hole).event, 'out');
});

test('ponte: sulla passerella si passa, fuori si cade', () => {
  const kinds = ['flat', { kind: 'bridge', width: 1.4 }, 'flat'];
  const hole = strip(kinds, { cup: [14, 0.5] });
  const on = ball(hole, 1, 2.5);
  P.shoot(on, 0, 0.5);
  assert.notStrictEqual(run(on, hole).event, 'out');
  assert.ok(on.x > 10);
  const off = ball(hole, 1, 1);
  P.shoot(off, 0, 0.5);
  assert.strictEqual(run(off, hole).event, 'out');
});

test('in volo si passa sopra un muretto basso', () => {
  const kinds = ['flat', { kind: 'ramp', h0: 0, h1: 0.8 }, { kind: 'gap', h0: 0, h1: 0, gap: 1 }, 'flat'];
  const hole = strip(kinds, { cup: [19, 0.5] });
  hole.walls.push({ seg: [13, 0, 13, 5], y0: 0, y1: 0.3 });
  const b = ball(hole, 1, 2.5);
  P.shoot(b, 0, 1);
  run(b, hole);
  assert.ok(b.x > 13, `scavalcato? x=${b.x}`);
});

test('acqua, sabbia, acceleratore', () => {
  const water = strip(['flat', 'flat', 'flat'], { cup: [14, 0.5], zones: [{ type: 'water', poly: [[6, 0], [9, 0], [9, 5], [6, 5]] }] });
  const w = ball(water, 1, 2.5);
  P.shoot(w, 0, 0.5);
  assert.strictEqual(run(w, water).event, 'water');

  const grass = strip(['flat', 'flat', 'flat', 'flat'], { cup: [19, 4.5] });
  const sand = strip(['flat', 'flat', 'flat', 'flat'], { cup: [19, 4.5], zones: [{ type: 'sand', poly: [[4, 0], [20, 0], [20, 5], [4, 5]] }] });
  const g = ball(grass, 1, 2.5);
  const s = ball(sand, 1, 2.5);
  P.shoot(g, 0, 0.45);
  P.shoot(s, 0, 0.45);
  run(g, grass);
  run(s, sand);
  assert.ok(s.x < g.x - 1);

  const boost = strip(['flat', 'flat', 'flat', 'flat'], { cup: [19, 4.5], zones: [{ type: 'boost', poly: [[3, 0], [5, 0], [5, 5], [3, 5]], force: [20, 0] }] });
  const k = ball(boost, 1, 2.5);
  P.shoot(k, 0, 0.2);
  run(k, boost);
  const plain = ball(grass, 1, 2.5);
  P.shoot(plain, 0, 0.2);
  run(plain, grass);
  assert.ok(k.x > plain.x + 2);
});

test('funghi, pale e muri mobili respingono', () => {
  const bump = strip(['flat', 'flat', 'flat'], { cup: [1, 0.5], bumpers: [{ x: 8, z: 2.5, r: 0.5 }] });
  const a = ball(bump, 3, 2.5);
  P.shoot(a, 0, 0.5);
  run(a, bump);
  assert.ok(a.x < 8);

  const spin = strip(['flat', 'flat', 'flat'], { cup: [1, 0.5], spinners: [{ x: 8, z: 2.5, len: 4.6, speed: 1 }] });
  const b = ball(spin, 3, 2.5);
  P.shoot(b, 0, 0.45);
  run(b, spin);
  assert.ok(b.x < 8, 'la pala ruota attorno al centro: il centro è sempre chiuso');

  // muro che scorre di traverso: a t=0 è al centro del corridoio
  const slide = strip(['flat', 'flat', 'flat'], { cup: [1, 0.5], sliders: [{ x: 8, z: 2.5, len: 2, axis: 1, amp: 1.5, speed: 0.001 }] });
  const c = ball(slide, 3, 2.5);
  P.shoot(c, 0, 0.45);
  run(c, slide);
  assert.ok(c.x < 8);
});

test('mulino: la porta si apre e si chiude col tempo', () => {
  const mill = { x: 8, z: 2.5, width: 5, axis: 0, period: 4, open: 0.5 };
  const hole = strip(['flat', 'flat', 'flat'], { cup: [1, 0.5], windmills: [mill] });
  assert.ok(P.gateOpen(mill, 0.5));
  assert.ok(!P.gateOpen(mill, 3));
  const closed = ball(hole, 6, 2.5);
  P.shoot(closed, 0, 0.3);
  run(closed, hole, 20, 2.2);
  assert.ok(closed.x < 8, 'porta chiusa: rimbalza');
  const open = ball(hole, 6, 2.5);
  P.shoot(open, 0, 0.3);
  run(open, hole, 20, 0);
  assert.ok(open.x > 8, 'porta aperta: passa');
});

test("portale: si entra da una parte e si esce dall'altra", () => {
  const hole = strip(['flat', 'flat', 'flat', 'flat'], { cup: [1, 0.5], portals: [{ a: [5, 2.5], b: [15, 2.5], r: 0.4 }] });
  const b = ball(hole, 2, 2.5);
  P.shoot(b, 0, 0.3);
  run(b, hole);
  assert.ok(b.x > 15, `x=${b.x}`);
});

test('la conca intorno alla buca accompagna la pallina dentro', () => {
  const hole = strip(['flat', 'flat', { kind: 'flat', bowl: true }], { cup: [12.5, 2.5] });
  const b = ball(hole, 11.8, 2.5);
  assert.strictEqual(run(b, hole, 10).event, 'sunk');
});
