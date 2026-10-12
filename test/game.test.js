'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, createDeck } = require('../game');

const two = () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const three = () => [...two(), { id: 'c', name: 'C' }];

function setup(players, hands, top, turn = 0) {
  const g = new Game(players);
  g.turn = turn;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = top.color;
  return g;
}
let nid = 1000;
const c = (color, value) => ({ id: nid++, color, value });

test('il mazzo ha 108 carte', () => {
  assert.strictEqual(createDeck().length, 108);
});

test('distribuzione iniziale: 7 carte ciascuno, prima carta numerica', () => {
  const g = new Game(three());
  for (const p of g.players) assert.strictEqual(p.hand.length, 7);
  assert.match(g.top().value, /^\d$/);
  assert.strictEqual(g.deck.length + g.discard.length + 21, 108);
});

test('gioco di carta valida e turno successivo', () => {
  const card = c('red', '5');
  const g = setup(three(), [[card, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', card.id);
  assert.strictEqual(g.current().id, 'b');
  assert.strictEqual(g.top().id, card.id);
});

test('carta non valida e turno sbagliato vengono rifiutati', () => {
  const bad = c('blue', '7');
  const g = setup(three(), [[bad, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.throws(() => g.play('a', bad.id), /Non puoi/);
  assert.throws(() => g.play('b', g.players[1].hand[0].id), /turno/);
});

test('salta, inverti, +2', () => {
  const skip = c('red', 'skip');
  let g = setup(three(), [[skip, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', skip.id);
  assert.strictEqual(g.current().id, 'c');

  const rev = c('red', 'reverse');
  g = setup(three(), [[rev, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', rev.id);
  assert.strictEqual(g.current().id, 'c');
  assert.strictEqual(g.direction, -1);

  const rev2 = c('red', 'reverse');
  g = setup(two(), [[rev2, c('blue', '1')], [c('red', '1')]], c('red', '3'));
  g.play('a', rev2.id);
  assert.strictEqual(g.current().id, 'a', 'in 2 giocatori inverti = salta');

  const d2 = c('red', 'draw2');
  g = setup(three(), [[d2, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', d2.id);
  assert.strictEqual(g.players[1].hand.length, 3);
  assert.strictEqual(g.current().id, 'c');
});

test('jolly e +4 (solo senza carte del colore)', () => {
  const w4 = c('wild', 'wild4');
  let g = setup(three(), [[w4, c('red', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.throws(() => g.play('a', w4.id, 'blue'), /Non puoi/);

  const w4b = c('wild', 'wild4');
  g = setup(three(), [[w4b, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.throws(() => g.play('a', w4b.id), /colore/);
  g.play('a', w4b.id, 'green');
  assert.strictEqual(g.currentColor, 'green');
  assert.strictEqual(g.players[1].hand.length, 5);
  assert.strictEqual(g.current().id, 'c');
});

test('pesca: carta giocabile si può giocare o passare, altrimenti passa automatico', () => {
  const g = setup(three(), [[c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  const drawn = c('red', '9');
  g.deck.push(drawn);
  g.drawCard('a');
  assert.strictEqual(g.current().id, 'a');
  assert.throws(() => g.drawCard('a'), /già pescato/);
  assert.throws(() => g.play('a', g.players[0].hand[0].id), /Non puoi/);
  g.pass('a');
  assert.strictEqual(g.current().id, 'b');

  g.deck.push(c('blue', '9'));
  g.drawCard('b');
  assert.strictEqual(g.current().id, 'c', 'carta non giocabile => passa');
});

test('UNO: dimenticarsi e farsi beccare costa 2 carte', () => {
  const card = c('red', '5');
  const g = setup(three(), [[card, c('blue', '1')], [c('red', '1'), c('red', '4')], [c('red', '2')]], c('red', '3'));
  g.play('a', card.id);
  assert.strictEqual(g.unoVulnerable, 'a');
  g.catchUno('c', 'a');
  assert.strictEqual(g.players[0].hand.length, 3);
  assert.throws(() => g.catchUno('c', 'a'), /tardi/);
});

test('UNO detto in tempo protegge', () => {
  const card = c('red', '5');
  const g = setup(three(), [[card, c('blue', '1')], [c('red', '1'), c('red', '4')], [c('red', '2')]], c('red', '3'));
  g.sayUno('a');
  g.play('a', card.id);
  assert.strictEqual(g.unoVulnerable, null);
  assert.throws(() => g.catchUno('b', 'a'), /tardi/);
});

test('vulnerabilità finisce quando il prossimo agisce', () => {
  const card = c('red', '5');
  const g = setup(three(), [[card, c('blue', '1')], [c('red', '1'), c('red', '4')], [c('red', '2')]], c('red', '3'));
  g.play('a', card.id);
  g.play('b', g.players[1].hand[0].id);
  assert.throws(() => g.catchUno('c', 'a'), /tardi/);
});

test('vittoria e punteggio', () => {
  const card = c('red', '5');
  const g = setup(three(), [[card], [c('red', '1'), c('wild', 'wild')], [c('blue', 'skip')]], c('red', '3'));
  g.play('a', card.id);
  assert.deepStrictEqual(g.winner, { id: 'a', name: 'A', points: 71 });
  assert.throws(() => g.play('b', g.players[1].hand[0].id), /finita/);
});

test('uscita di un giocatore durante il suo turno', () => {
  const g = setup(three(), [[c('red', '1')], [c('red', '2')], [c('red', '4')]], c('red', '3'), 1);
  g.removePlayer('b');
  assert.strictEqual(g.current().id, 'c');
  g.removePlayer('a');
  assert.strictEqual(g.winner.id, 'c');
});

test('il mazzo si rimescola quando finisce', () => {
  const g = setup(two(), [[c('blue', '1')], [c('red', '1')]], c('red', '3'));
  g.discard = [c('green', '1'), c('green', '2'), c('red', '3')];
  g.deck = [];
  g.drawCard('a');
  assert.strictEqual(g.discard.length, 1);
  assert.strictEqual(g.top().value, '3');
  assert.strictEqual(g.players[0].hand.length, 2);
});
