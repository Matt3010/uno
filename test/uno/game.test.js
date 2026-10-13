'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, createDeck } = require('../../uno/game');

const two = () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const three = () => [...two(), { id: 'c', name: 'C' }];

function setup(players, hands, top, turn = 0) {
  const g = new Game(players);
  g.turn = turn;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = top.color;
  g.direction = 1;
  g.pending = null;
  g.skip = null;
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
  g.pending = null;
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
  assert.strictEqual(g.pending.type, 'color');
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
  g.accept('b');
  assert.strictEqual(g.players[1].hand.length, 5);
  assert.strictEqual(g.current().id, 'c');
});

test('+4 sfidato ed era un bluff: pesca 4 chi l\'ha giocato', () => {
  const w4 = c('wild', 'wild4');
  const g = setup(three(), [[w4, c('red', '1'), c('blue', '2')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', w4.id, 'blue');
  g.challenge('b');
  assert.strictEqual(g.players[0].hand.length, 6);
  assert.strictEqual(g.players[1].hand.length, 1);
  assert.strictEqual(g.current().id, 'b', 'chi sfida gioca il suo turno');
  assert.strictEqual(g.currentColor, 'blue');
});

test('+4 sfidato ed era regolare: chi sfida pesca 6 e salta', () => {
  const w4 = c('wild', 'wild4');
  const g = setup(three(), [[w4, c('blue', '1'), c('green', '7')], [c('red', '1')], [c('red', '2')]], c('red', '7'));
  g.play('a', w4.id, 'green');
  g.challenge('b');
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

// ---------------- UNO Flip ----------------
const { createFlipDeck, createNoMercyDeck } = require('../../uno/game');

const fc = (light, dark) => ({ id: nid++, light: { color: light[0], value: light[1] }, dark: { color: dark[0], value: dark[1] } });

function flipSetup(players, hands, top, turn = 0) {
  const g = new Game(players, { mode: 'flip' });
  g.side = 'light';
  g.turn = turn;
  g.direction = 1;
  g.pending = null;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = g.face(top).color;
  g.log = [];
  return g;
}

test('Flip: mazzo da 112 carte a doppia faccia', () => {
  const d = createFlipDeck();
  assert.strictEqual(d.length, 112);
  const count = (side, v) => d.filter((c) => c[side].value === v).length;
  assert.strictEqual(count('light', 'draw1'), 8);
  assert.strictEqual(count('light', 'wild2'), 4);
  assert.strictEqual(count('dark', 'draw5'), 8);
  assert.strictEqual(count('dark', 'skipall'), 8);
  assert.strictEqual(count('dark', 'wildcolor'), 4);
  assert.ok(d.every((c) => ['pink', 'teal', 'orange', 'purple', 'wild'].includes(c.dark.color)));
});

test('Flip: la carta Flip gira tutto e si gioca sul lato scuro', () => {
  const flip = fc(['red', 'flip'], ['pink', 'flip']);
  const bottom = fc(['red', '3'], ['teal', '7']);
  const g = flipSetup(three(), [[flip, fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], bottom);
  g.play('a', flip.id);
  assert.strictEqual(g.side, 'dark');
  // la pila si gira: in cima c'è l'altra faccia della prima carta
  assert.strictEqual(g.face(g.top()).value, '7');
  assert.strictEqual(g.currentColor, 'teal');
  assert.strictEqual(g.current().id, 'b');
  const v = g.viewFor('b');
  assert.strictEqual(v.hand[0].color, 'teal');
  assert.strictEqual(v.hand[0].playable, true);
  // si vede il retro (lato chiaro) delle carte degli avversari
  assert.strictEqual(v.players[0].backs[0].color, 'blue');
  assert.strictEqual(v.players[1].backs, null);
});

test('Flip: se dopo il flip in cima c\'è un Jolly, sceglie il colore chi ha girato', () => {
  const flip = fc(['red', 'flip'], ['pink', 'flip']);
  const bottom = fc(['red', '3'], ['wild', 'wild']);
  const g = flipSetup(three(), [[flip, fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], bottom);
  g.play('a', flip.id);
  assert.strictEqual(g.current().id, 'a');
  assert.strictEqual(g.pending.type, 'color');
  assert.throws(() => g.chooseColor('a', 'red'), /non valido/);
  g.chooseColor('a', 'purple');
  assert.strictEqual(g.currentColor, 'purple');
  assert.strictEqual(g.current().id, 'b');
});

test('Flip: +1, +5 e Salta tutti', () => {
  const d1 = fc(['red', 'draw1'], ['pink', '1']);
  let g = flipSetup(three(), [[d1, fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], fc(['red', '3'], ['pink', '3']));
  g.play('a', d1.id);
  assert.strictEqual(g.players[1].hand.length, 2);
  assert.strictEqual(g.current().id, 'c');

  g = flipSetup(three(), [[fc(['red', '1'], ['pink', 'draw5']), fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], fc(['red', '3'], ['pink', '3']));
  g.side = 'dark';
  g.currentColor = 'pink';
  g.play('a', g.players[0].hand[0].id);
  assert.strictEqual(g.players[1].hand.length, 6);
  assert.strictEqual(g.current().id, 'c');

  g = flipSetup(three(), [[fc(['red', '1'], ['pink', 'skipall']), fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], fc(['red', '3'], ['pink', '3']));
  g.side = 'dark';
  g.currentColor = 'pink';
  g.play('a', g.players[0].hand[0].id);
  assert.strictEqual(g.current().id, 'a', 'Salta tutti: rigioca lo stesso');
});

test('Flip: Jolly pesca colore, sfida persa = pesca fino al colore + 2', () => {
  const wc = fc(['red', '1'], ['wild', 'wildcolor']);
  const g = flipSetup(three(), [[wc, fc(['blue', '1'], ['orange', '2'])], [fc(['red', '1'], ['teal', '1'])], [fc(['red', '2'], ['pink', '5'])]], fc(['red', '3'], ['pink', '3']));
  g.side = 'dark';
  g.currentColor = 'pink';
  g.play('a', wc.id, 'teal');
  assert.strictEqual(g.pending.type, 'challenge');
  // mazzo: (in cima) orange, pink, teal, poi altre 2
  g.deck = [fc(['red', '1'], ['pink', '1']), fc(['red', '1'], ['pink', '2']), fc(['red', '1'], ['teal', '9']), fc(['red', '1'], ['pink', '4']), fc(['red', '1'], ['orange', '4'])];
  g.challenge('b');
  // regolare (a non aveva rosa): b pesca orange, pink, teal (3) + 2
  assert.strictEqual(g.players[1].hand.length, 1 + 5);
  assert.strictEqual(g.current().id, 'c');
});

test('Flip: punti contati sul lato attivo', () => {
  const last = fc(['red', '5'], ['pink', '5']);
  const g = flipSetup(two(), [[last], [fc(['red', '1'], ['wild', 'wildcolor']), fc(['red', 'skip'], ['teal', 'skipall'])]], fc(['red', '3'], ['pink', '3']));
  g.side = 'dark';
  g.currentColor = 'pink';
  g.play('a', last.id);
  assert.strictEqual(g.winner.points, 60 + 30);
});

// ---------------- No Mercy ----------------
function nmSetup(players, hands, top, turn = 0) {
  const g = new Game(players, { mode: 'nomercy' });
  g.turn = turn;
  g.direction = 1;
  g.pending = null;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = top.color;
  g.log = [];
  return g;
}

test('No Mercy: mazzo da 168 carte, prima carta numerica', () => {
  const d = createNoMercyDeck();
  assert.strictEqual(d.length, 168);
  const n = (v) => d.filter((c) => c.value === v).length;
  assert.strictEqual(n('wild10'), 4);
  assert.strictEqual(n('wildrev4'), 8);
  assert.strictEqual(n('roulette'), 8);
  assert.strictEqual(n('draw4'), 8);
  assert.strictEqual(n('discardall'), 12);
  for (let i = 0; i < 50; i++) assert.match(new Game(three(), { mode: 'nomercy' }).top().value, /^\d$/);
});

test('No Mercy: accumulo delle carte pesca', () => {
  const d2 = c('red', 'draw2');
  const d4 = c('blue', 'draw4');
  const w6 = c('wild', 'wild6');
  const g = nmSetup(three(), [[d2, c('red', '9')], [d4, c('green', '1'), c('green', '2')], [c('yellow', '2'), w6]], c('red', '3'));
  g.play('a', d2.id);
  assert.deepStrictEqual([g.pending.type, g.pending.amount, g.current().id], ['stack', 2, 'b']);
  assert.throws(() => g.play('b', g.players[1].hand[1].id), /Non puoi/);
  g.play('b', d4.id);
  assert.strictEqual(g.pending.amount, 6);
  g.play('c', w6.id, 'green');
  assert.strictEqual(g.pending.amount, 12);
  assert.strictEqual(g.current().id, 'a');
  // a non può rilanciare (+6 minimo): pesca 12
  g.drawCard('a');
  assert.strictEqual(g.players[0].hand.length, 13);
  assert.strictEqual(g.current().id, 'b');
});

test('No Mercy: non si può rilanciare con un valore più basso', () => {
  const d4 = c('red', 'draw4');
  const d2 = c('red', 'draw2');
  const g = nmSetup(two(), [[d4, c('red', '9')], [d2, c('green', '1')]], c('red', '3'));
  g.play('a', d4.id);
  assert.throws(() => g.play('b', d2.id), /Non puoi/);
});

test('No Mercy: Jolly inverti +4 cambia direzione', () => {
  const w = c('wild', 'wildrev4');
  const g = nmSetup(three(), [[w, c('red', '9')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  g.play('a', w.id, 'blue');
  assert.strictEqual(g.direction, -1);
  assert.strictEqual(g.current().id, 'c');
  assert.strictEqual(g.pending.amount, 4);
});

test('No Mercy: pesca finché non puoi giocare, poi devi giocarla', () => {
  const g = nmSetup(three(), [[c('blue', '1')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  const good = c('red', '8');
  g.deck = [good, c('blue', '5'), c('green', '6')];
  g.drawCard('a');
  assert.strictEqual(g.players[0].hand.length, 4);
  assert.strictEqual(g.current().id, 'a');
  assert.throws(() => g.pass('a'), /giocare/);
  g.play('a', good.id);
  assert.strictEqual(g.current().id, 'b');
});

test('No Mercy: 7 scambia, 0 passa le mani', () => {
  const seven = c('red', '7');
  let g = nmSetup(three(), [[seven, c('red', '9')], [c('green', '1'), c('green', '2'), c('green', '3')], [c('green', '2')]], c('red', '3'));
  g.play('a', seven.id);
  assert.strictEqual(g.pending.type, 'swap');
  assert.strictEqual(g.current().id, 'a');
  g.swapHands('a', 'b');
  assert.strictEqual(g.players[0].hand.length, 3);
  assert.strictEqual(g.players[1].hand.length, 1);
  assert.strictEqual(g.current().id, 'b');

  const zero = c('red', '0');
  g = nmSetup(three(), [[zero, c('red', '9')], [c('green', '1'), c('green', '2'), c('green', '3')], [c('blue', '2')]], c('red', '3'));
  g.play('a', zero.id);
  assert.strictEqual(g.players[1].hand[0].value, '9', 'b riceve la mano di a');
  assert.strictEqual(g.players[2].hand.length, 3, 'c riceve la mano di b');
  assert.strictEqual(g.players[0].hand[0].color, 'blue', 'a riceve la mano di c');
});

test('No Mercy: Scarta tutto, Salta tutti, Roulette', () => {
  const da = c('red', 'discardall');
  let g = nmSetup(three(), [[da, c('red', '1'), c('red', '5'), c('blue', '9')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  g.play('a', da.id);
  assert.strictEqual(g.players[0].hand.length, 1);
  assert.strictEqual(g.top().id, da.id);

  const sa = c('red', 'skipall');
  g = nmSetup(three(), [[sa, c('blue', '9')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  g.play('a', sa.id);
  assert.strictEqual(g.current().id, 'a');

  const r = c('wild', 'roulette');
  g = nmSetup(three(), [[r, c('blue', '9')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  g.play('a', r.id, 'blue');
  assert.strictEqual(g.pending.type, 'roulette');
  g.deck = [c('yellow', '1'), c('wild', 'wild6'), c('red', '1')];
  g.chooseColor('b', 'yellow');
  assert.strictEqual(g.players[1].hand.length, 4);
  assert.strictEqual(g.current().id, 'c');
});

test('No Mercy: con 25 carte si è eliminati', () => {
  const w10 = c('wild', 'wild10');
  const big = Array.from({ length: 16 }, (_, i) => c('green', String(i % 9 + 1)));
  const g = nmSetup(three(), [[w10, c('red', '9')], big, [c('green', '2')]], c('red', '3'));
  g.play('a', w10.id, 'blue');
  g.accept('b');
  assert.strictEqual(g.players.length, 2);
  assert.deepStrictEqual(g.eliminated, ['B']);
  assert.strictEqual(g.current().id, 'c');
  // c'è anche un vincitore se resta un solo giocatore
  g.removePlayer('c', { eliminated: true });
  assert.strictEqual(g.winner.id, 'a');
});

test('eliminazione dell\'ultimo avversario: turno valido e vista generabile', () => {
  const w10 = c('wild', 'wild10');
  const big = Array.from({ length: 16 }, (_, i) => c('green', String(i % 9 + 1)));
  // a è l'ultimo indice: dopo l'eliminazione il turno deve restare nei limiti
  const g = nmSetup(two(), [big, [w10, c('red', '9')]], c('red', '3'), 1);
  g.play('b', w10.id, 'blue');
  g.accept('a');
  assert.strictEqual(g.winner.id, 'b');
  assert.strictEqual(g.winner.points, 250, 'solo i punti dell\'eliminato, non le carte del vincitore');
  assert.ok(g.current());
  assert.doesNotThrow(() => g.viewFor('a'));
  assert.doesNotThrow(() => g.viewFor('b'));
});

// ---------------- UNO Casinò ----------------
const chips100 = (ps) => Object.fromEntries(ps.map((p) => [p.id, 100]));

function casinoSetup(players, hands, top, rolls = [], turn = 0) {
  const g = new Game(players, { mode: 'gambling', chips: chips100(players) });
  g.turn = turn;
  g.direction = 1;
  g.pending = null;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = top.color;
  g.skip = null;
  g.log = [];
  const seq = [...rolls];
  g.rng = () => seq.shift();
  return g;
}
// valore di rng che fa uscire un certo indice (su n possibilità)
const pick = (i, n) => (i + 0.5) / n;

test('Casinò: mazzo, puntata iniziale nel piatto', () => {
  const g = new Game(three(), { mode: 'gambling', chips: chips100(three()) });
  assert.strictEqual(g.deck.length + g.discard.length + 21 + (g.top().value === 'draw2' ? 2 : 0), 108 + 16);
  assert.strictEqual(g.pot, 30);
  assert.deepStrictEqual(Object.values(g.chips), [90, 90, 90]);
  assert.ok(!['slot', 'dice', 'raise'].includes(g.top().value));
});

test('Casinò: slot machine', () => {
  const slot = () => c('wild', 'slot');
  // jackpot 7-7-7
  let s1 = slot();
  let g = casinoSetup(three(), [[s1, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), [pick(4, 5), pick(4, 5), pick(4, 5)]);
  g.play('a', s1.id, 'blue');
  assert.strictEqual(g.chips.a, 190);
  assert.strictEqual(g.players[1].hand.length, 4);
  assert.strictEqual(g.event.type, 'slot');
  assert.deepStrictEqual(g.event.reels, ['7️⃣', '7️⃣', '7️⃣']);
  assert.strictEqual(g.current().id, 'b');

  // coppia: +10 e il successivo pesca 1
  s1 = slot();
  g = casinoSetup(three(), [[s1, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), [pick(0, 5), pick(0, 5), pick(2, 5)]);
  g.play('a', s1.id, 'blue');
  assert.strictEqual(g.chips.a, 100);
  assert.strictEqual(g.players[1].hand.length, 2);
  assert.strictEqual(g.players[2].hand.length, 1);

  // niente: paga 10 nel piatto e pesca 1
  s1 = slot();
  g = casinoSetup(three(), [[s1, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), [pick(0, 5), pick(1, 5), pick(2, 5)]);
  const pot = g.pot;
  g.play('a', s1.id, 'blue');
  assert.strictEqual(g.chips.a, 80);
  assert.strictEqual(g.pot, pot + 10);
  assert.strictEqual(g.players[0].hand.length, 2);
});

test('Casinò: dadi', () => {
  const roll = (a, b) => [pick(a - 1, 6), pick(b - 1, 6)];
  // doppio: vince e gioca ancora
  let d = c('red', 'dice');
  let g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), roll(4, 4));
  g.play('a', d.id);
  assert.strictEqual(g.chips.a, 130);
  assert.strictEqual(g.current().id, 'a');
  // sette: tutti gli altri pescano 1
  d = c('red', 'dice');
  g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), roll(3, 4));
  g.play('a', d.id);
  assert.deepStrictEqual(g.players.map((p) => p.hand.length), [1, 2, 2]);
  assert.strictEqual(g.current().id, 'b');
  // 10 o più: il successivo pesca 2 e salta
  d = c('red', 'dice');
  g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), roll(5, 6));
  g.play('a', d.id);
  assert.strictEqual(g.players[1].hand.length, 3);
  assert.strictEqual(g.current().id, 'c');
  // 4 o meno: pesca chi ha lanciato
  d = c('red', 'dice');
  g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), roll(1, 2));
  g.play('a', d.id);
  assert.strictEqual(g.players[0].hand.length, 3);
});

test('Casinò: rilancio, multa UNO e vincita del piatto', () => {
  const r = c('red', 'raise');
  const last = c('red', '5');
  const g = casinoSetup(three(), [[r, last, c('blue', '1')], [c('red', '2'), c('blue', 'skip')], [c('red', '3')]], c('red', '7'));
  g.play('a', r.id); // tutti +10 nel piatto: 60
  assert.strictEqual(g.pot, 60);
  assert.deepStrictEqual(Object.values(g.chips), [80, 80, 80]);
  g.play('b', g.players[1].hand[0].id); // b resta con 1 carta senza UNO
  g.catchUno('c', 'b');
  assert.strictEqual(g.chips.b, 70);
  assert.strictEqual(g.chips.c, 90);
  // c gioca l'ultima carta: vince piatto + 2 fiches per carta degli avversari
  g.play('c', g.players[2].hand[0].id);
  assert.strictEqual(g.winner.id, 'c');
  const expected = 60 + 2 * 2 + 2 * 3;
  assert.strictEqual(g.winner.points, expected);
  assert.strictEqual(g.chips.c, 90 + expected);
  assert.strictEqual(g.pot, 0);
});

test('Casinò: chi è senza fiches non paga', () => {
  const g = new Game(two(), { mode: 'gambling', chips: { a: 0, b: 5 } });
  assert.strictEqual(g.pot, 5);
  assert.deepStrictEqual(g.chips, { a: 0, b: 0 });
});

// ---------------- Timer: mossa automatica ----------------
test('Tempo scaduto: pesca e passa', () => {
  const g = setup(three(), [[c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.deck.push(c('red', '9')); // giocabile, ma il tempo è scaduto: passa
  g.autoPlay();
  assert.strictEqual(g.players[0].hand.length, 2);
  assert.strictEqual(g.current().id, 'b');
  // se aveva già pescato, passa e basta
  g.deck.push(c('red', '8'));
  g.drawCard('b');
  g.autoPlay();
  assert.strictEqual(g.players[1].hand.length, 2);
  assert.strictEqual(g.current().id, 'c');
});

test('Tempo scaduto: decisioni in sospeso', () => {
  // +4 ricevuto: accetta
  const w4 = c('wild', 'wild4');
  let g = setup(three(), [[w4, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', w4.id, 'green');
  g.autoPlay();
  assert.strictEqual(g.players[1].hand.length, 5);
  assert.strictEqual(g.current().id, 'c');

  // colore da scegliere: quello di cui ha più carte
  g = gameWithFirst(three(), 'wild', 'wild');
  g.players[1].hand = [c('blue', '1'), c('blue', '2'), c('red', '3')];
  g.autoPlay();
  assert.strictEqual(g.currentColor, 'blue');

  // No Mercy: accumulo → pesca; 7 → scambia con chi ha meno carte
  const d2 = c('red', 'draw2');
  g = nmSetup(three(), [[d2, c('red', '9')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  g.play('a', d2.id);
  g.autoPlay();
  assert.strictEqual(g.players[1].hand.length, 3);
  const seven = c('red', '7');
  g = nmSetup(three(), [[seven, c('red', '9'), c('red', '8')], [c('green', '1'), c('green', '2')], [c('green', '3')]], c('red', '3'));
  g.play('a', seven.id);
  g.autoPlay();
  assert.strictEqual(g.players[2].hand.length, 2, 'c (1 carta) riceve la mano di a');
  assert.strictEqual(g.players[0].hand.length, 1);
});

test('Tempo scaduto nel No Mercy: la carta pescata viene giocata', () => {
  const g = nmSetup(three(), [[c('blue', '1')], [c('green', '1')], [c('green', '2')]], c('red', '3'));
  const good = c('red', '8');
  g.deck = [good, c('blue', '5')];
  g.autoPlay();
  assert.strictEqual(g.top().id, good.id);
  assert.strictEqual(g.current().id, 'b');
});

test('la vista dice chi gioca dopo, anche dopo un cambio di direzione', () => {
  const rev = c('red', 'reverse');
  const g = setup(three(), [[rev, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.strictEqual(g.viewFor('a').nextId, 'b');
  g.play('a', rev.id);
  assert.strictEqual(g.viewFor('a').turnId, 'c');
  assert.strictEqual(g.viewFor('a').nextId, 'b');
});

test('la vista annuncia chi salta il turno, ogni volta con un nuovo numero', () => {
  const s1 = c('red', 'skip');
  const s2 = c('red', 'skip');
  const g = setup(three(), [[s1, s2, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  assert.strictEqual(g.viewFor('a').skip, null);
  g.play('a', s1.id);
  const first = g.viewFor('a').skip;
  assert.deepStrictEqual(first.ids, ['b']);
  assert.match(first.text, /B salta il turno/);
  g.turn = 0;
  g.play('a', s2.id);
  assert.ok(g.viewFor('a').skip.seq > first.seq);
});

test('salti annunciati: +2, inverti in due, salta tutti, +4 accettato', () => {
  const d2 = c('red', 'draw2');
  let g = setup(three(), [[d2, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', d2.id);
  assert.deepStrictEqual(g.viewFor('a').skip.ids, ['b']);

  const rev = c('red', 'reverse');
  g = setup(two(), [[rev, c('blue', '1')], [c('red', '1')]], c('red', '3'));
  g.play('a', rev.id);
  assert.deepStrictEqual(g.viewFor('a').skip.ids, ['b']);

  const w4 = c('wild', 'wild4');
  g = setup(three(), [[w4, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', w4.id, 'green');
  assert.strictEqual(g.viewFor('a').skip, null, 'non ha ancora deciso');
  g.accept('b');
  assert.deepStrictEqual(g.viewFor('a').skip.ids, ['b']);

  const sa = c('red', 'skipall');
  g = setup(three(), [[sa, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.mode = 'nomercy';
  g.play('a', sa.id);
  assert.deepStrictEqual(g.viewFor('a').skip.ids, ['b', 'c']);
});

test('una mossa normale non annuncia salti', () => {
  const r1 = c('red', '1');
  const g = setup(three(), [[r1, c('blue', '1')], [c('red', '1')], [c('red', '2')]], c('red', '3'));
  g.play('a', r1.id);
  assert.strictEqual(g.viewFor('a').skip, null);
});

test('Casinò: dadi da 10 in su annunciano il salto del successivo', () => {
  const d = c('red', 'dice');
  const g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), [pick(4, 6), pick(5, 6)]);
  g.play('a', d.id);
  assert.deepStrictEqual(g.viewFor('a').skip.ids, ['b']);
});

test('Casinò: chi pesca dai dadi non può più essere beccato senza UNO', () => {
  const roll = (a, b) => [pick(a - 1, 6), pick(b - 1, 6)];
  const d = c('red', 'dice');
  const g = casinoSetup(three(), [[d, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'), roll(1, 2));
  g.play('a', d.id); // resta con 1 carta senza UNO, poi i dadi gliene fanno pescare 2
  assert.strictEqual(g.players[0].hand.length, 3);
  assert.throws(() => g.catchUno('b', 'a'), /Troppo tardi/);
  assert.strictEqual(g.players[0].hand.length, 3);
});

test('se esce chi doveva scegliere il colore, lo sceglie il giocatore dopo', () => {
  const g = setup(three(), [[c('red', '1')], [c('blue', '2')], [c('green', '3')]], c('wild', 'wild'));
  g.currentColor = null;
  g.pending = { type: 'color', after: 0 };
  g.removePlayer('a');
  assert.strictEqual(g.current().id, 'b');
  assert.strictEqual(g.pending && g.pending.type, 'color');
  g.chooseColor('b', 'blue');
  assert.strictEqual(g.currentColor, 'blue');
  assert.strictEqual(g.current().id, 'b'); // poi gioca lui
});

// --- Regole della casa ---
function houseSetup(rules, players, hands, top, mode = 'classic') {
  const g = new Game(players, { mode, rules });
  g.turn = 0;
  g.direction = 1;
  g.pending = null;
  g.hasDrawn = false;
  g.players.forEach((p, i) => { p.hand = hands[i]; });
  g.discard = [top];
  g.currentColor = top.color;
  g.skip = null;
  g.log = [];
  return g;
}

test('regola della casa: accumulo dei +2 e +4 nel Classico', () => {
  const p2 = c('red', 'draw2');
  const p2b = c('blue', 'draw2');
  const w4 = c('wild', 'wild4');
  const g = houseSetup({ stack: true }, three(), [[p2, c('red', '1')], [p2b, c('red', '2')], [w4, c('red', '3')]], c('red', '5'));
  g.play('a', p2.id);
  assert.strictEqual(g.pending.type, 'stack');
  assert.strictEqual(g.current().id, 'b');
  g.play('b', p2b.id); // +2 su +2
  g.play('c', w4.id, 'green'); // +4 su +2
  assert.strictEqual(g.pending.amount, 8);
  assert.strictEqual(g.current().id, 'a');
  g.accept('a');
  assert.strictEqual(g.players[0].hand.length, 9);
  assert.strictEqual(g.current().id, 'b');
});

test('senza la regola dell\'accumulo il +2 si pesca subito', () => {
  const p2 = c('red', 'draw2');
  const g = houseSetup({}, three(), [[p2, c('red', '1')], [c('blue', 'draw2')], [c('red', '3')]], c('red', '5'));
  g.play('a', p2.id);
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.players[1].hand.length, 3);
});

test('regola della casa: un +2 sopra un +4 non si può', () => {
  const w4 = c('wild', 'wild4');
  const p2 = c('blue', 'draw2');
  const g = houseSetup({ stack: true }, three(), [[w4, c('red', '1')], [p2, c('blue', '2')], [c('red', '3')]], c('red', '5'));
  g.play('a', w4.id, 'blue');
  assert.throws(() => g.play('b', p2.id), /Non puoi/);
});

test('regola della casa: chiudere con un +2 su un accumulo fa pescare tutto', () => {
  const p2 = c('red', 'draw2');
  const p2b = c('blue', 'draw2');
  const g = houseSetup({ stack: true }, three(), [[p2, c('red', '1')], [p2b], [c('red', '3')]], c('red', '5'));
  g.play('a', p2.id);
  g.play('b', p2b.id); // ultima carta
  assert.strictEqual(g.winner.id, 'b');
  assert.strictEqual(g.players[2].hand.length, 5);
});

test('regola della casa 7-0: col 7 scambi la mano, con lo 0 tutti la passano', () => {
  const s7 = c('red', '7');
  let g = houseSetup({ sevenZero: true }, three(), [[s7, c('red', '1')], [c('blue', '2'), c('blue', '3'), c('blue', '4')], [c('red', '3')]], c('red', '5'));
  g.play('a', s7.id);
  assert.strictEqual(g.pending.type, 'swap');
  g.swapHands('a', 'b');
  assert.strictEqual(g.players[0].hand.length, 3);
  assert.strictEqual(g.players[1].hand.length, 1);

  const z = c('red', '0');
  g = houseSetup({ sevenZero: true }, three(), [[z, c('red', '1')], [c('blue', '2'), c('blue', '3')], [c('red', '3'), c('red', '4'), c('red', '6')]], c('red', '5'));
  g.play('a', z.id);
  assert.deepStrictEqual(g.players.map((p) => p.hand.length), [3, 1, 2]);
  assert.strictEqual(g.viewFor('a').rules.sevenZero, true);
});

test('regola della casa: pesca finché non trovi una carta giocabile', () => {
  const g = houseSetup({ drawUntil: true }, two(), [[c('blue', '1')], [c('blue', '2')]], c('red', '5'));
  g.deck = [c('red', '9'), c('green', '1'), c('green', '2')]; // si pesca dalla fine
  g.drawCard('a');
  assert.strictEqual(g.players[0].hand.length, 4);
  assert.strictEqual(g.current().id, 'a');
  assert.ok(g.hasDrawn);
  g.pass('a'); // la si può anche tenere
  assert.strictEqual(g.current().id, 'b');
});
