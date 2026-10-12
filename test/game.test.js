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
  g.direction = 1;
  g.mustChooseColor = false;
  g.log = [];
  return g;
}
let nid = 1000;
const c = (color, value) => ({ id: nid++, color, value });

test('il mazzo ha 108 carte', () => {
  assert.strictEqual(createDeck().length, 108);
});

test('distribuzione iniziale: 7 carte ciascuno, mai +4 come prima carta', () => {
  for (let i = 0; i < 200; i++) {
    const g = new Game(three());
    const extra = g.top().value === 'draw2' ? 2 : 0;
    assert.strictEqual(g.players.reduce((n, p) => n + p.hand.length, 0), 21 + extra);
    assert.notStrictEqual(g.top().value, 'wild4');
    assert.strictEqual(g.deck.length + g.discard.length + 21 + extra, 108);
  }
});

// Forza una prima carta specifica in cima al mazzo dopo la distribuzione
function gameWithFirst(players, value, color = 'red') {
  // costruisce normalmente (distribuisce il primo giocatore), poi riapplica la prima carta voluta
  const g = new Game(players, { dealer: 0 });
  g.players.forEach((p) => { p.hand = p.hand.slice(0, 7); });
  g.direction = 1;
  g.mustChooseColor = false;
  g.turn = 0;
  g.advance(1);
  const card = { id: 9999, color, value };
  g.discard = [card];
  g.applyFirstCard(card, 0);
  return g;
}

test('prima carta: effetti ufficiali', () => {
  let g = gameWithFirst(three(), 'skip');
  assert.strictEqual(g.current().id, 'c', 'il primo (b) salta');

  g = gameWithFirst(three(), 'draw2');
  assert.strictEqual(g.players[1].hand.length, 9);
  assert.strictEqual(g.current().id, 'c');

  g = gameWithFirst(three(), 'reverse');
  assert.strictEqual(g.current().id, 'a', 'inizia chi distribuisce');
  assert.strictEqual(g.direction, -1);

  g = gameWithFirst(three(), 'wild', 'wild');
  assert.strictEqual(g.current().id, 'b');
  assert.ok(g.mustChooseColor);
  assert.throws(() => g.play('b', g.players[1].hand[0].id, 'red'), /colore/);
  assert.throws(() => g.drawCard('b'), /colore/);
  assert.throws(() => g.chooseColor('c', 'red'), /turno/);
  g.chooseColor('b', 'green');
  assert.strictEqual(g.currentColor, 'green');
  assert.strictEqual(g.current().id, 'b', 'dopo la scelta gioca lo stesso giocatore');
});

test('chi distribuisce: inizia il giocatore alla sua sinistra', () => {
  const g = gameWithFirst(three(), '5');
  assert.strictEqual(g.current().id, 'b');
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

test('+4 accettato: pesca 4 e salta', () => {
  const w4 = c('wild', 'wild4');
  const g = setup(three(), [[w4, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.throws(() => g.play('a', w4.id), /colore/);
  g.play('a', w4.id, 'green');
  assert.strictEqual(g.currentColor, 'green');
  assert.strictEqual(g.current().id, 'b');
  assert.throws(() => g.drawCard('b'), /sfidare/);
  assert.throws(() => g.play('b', g.players[1].hand[0].id), /Non puoi|sfidare/);
  g.acceptWild4('b');
  assert.strictEqual(g.players[1].hand.length, 5);
  assert.strictEqual(g.current().id, 'c');
});

test('+4 sfidato ed era un bluff: pesca 4 chi l\'ha giocato', () => {
  const w4 = c('wild', 'wild4');
  const g = setup(three(), [[w4, c('red', '1'), c('blue', '2')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', w4.id, 'blue');
  g.challengeWild4('b');
  assert.strictEqual(g.players[0].hand.length, 6);
  assert.strictEqual(g.players[1].hand.length, 1);
  assert.strictEqual(g.current().id, 'b', 'chi sfida gioca il suo turno');
  assert.strictEqual(g.currentColor, 'blue');
});

test('+4 sfidato ed era regolare: chi sfida pesca 6 e salta', () => {
  const w4 = c('wild', 'wild4');
  const g = setup(three(), [[w4, c('blue', '1'), c('green', '7')], [c('red', '1')], [c('red', '2')]], c('red', '7'));
  g.play('a', w4.id, 'green');
  g.challengeWild4('b');
  assert.strictEqual(g.players[0].hand.length, 2);
  assert.strictEqual(g.players[1].hand.length, 7);
  assert.strictEqual(g.current().id, 'c');
});

test('ultima carta +2: il successivo pesca e le carte contano nei punti', () => {
  const d2 = c('red', 'draw2');
  const g = setup(three(), [[d2], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.deck.push(c('blue', '5'), c('blue', '4'));
  g.play('a', d2.id);
  assert.strictEqual(g.players[1].hand.length, 3);
  assert.strictEqual(g.winner.points, 1 + 9 + 2);
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
