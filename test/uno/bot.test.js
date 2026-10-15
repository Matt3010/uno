'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../../uno/game');
const { chooseAction, applyAction } = require('../../uno/bot');

// Partite intere giocate solo da computer: devono sempre arrivare a un vincitore senza errori
for (const mode of ['classic', 'flip', 'nomercy']) {
  for (const level of ['easy', 'normal', 'hard']) {
    test(`computer ${level} finiscono le partite in ${mode}`, () => {
      for (let round = 0; round < 25; round++) {
        const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
        const g = new Game(players.slice(0, 2 + (round % 3)), { mode });
        let steps = 0;
        while (!g.winner) {
          assert.ok(++steps < 5000, 'la partita non finisce');
          const id = g.current().id;
          const action = chooseAction(g, id, level);
          assert.ok(action, 'nessuna mossa');
          applyAction(g, id, action, level);
          // ogni tanto qualcuno becca chi non ha detto UNO
          if (g.unoVulnerable && Math.random() < 0.3) {
            const other = g.players.find((p) => p.id !== g.unoVulnerable);
            g.catchUno(other.id, g.unoVulnerable);
          }
        }
      }
    });
  }
}

test('il computer difficile attacca chi sta per vincere e tiene i Jolly', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], {});
  g.turn = 0;
  g.direction = 1;
  g.pending = null;
  const skip = { id: 901, color: 'red', value: 'skip' };
  const five = { id: 902, color: 'red', value: '5' };
  const wild = { id: 903, color: 'wild', value: 'wild' };
  g.players[0].hand = [five, skip, wild, { id: 904, color: 'blue', value: '1' }];
  g.players[1].hand = [{ id: 905, color: 'green', value: '1' }]; // sta per vincere
  g.players[2].hand = [{ id: 906, color: 'green', value: '2' }, { id: 907, color: 'green', value: '3' }];
  g.discard = [{ id: 908, color: 'red', value: '3' }];
  g.currentColor = 'red';
  assert.strictEqual(chooseAction(g, 'a', 'hard').cardId, skip.id);
  assert.notStrictEqual(chooseAction(g, 'a', 'normal').cardId, wild.id);
});

test('i computer non vanno troppo veloci: si vede cosa fanno', () => {
  const bots = require('../../uno/bot');
  for (const L of Object.values(bots.LEVELS)) assert.ok(L.think[0] >= 2500, `${L.name} pensa almeno 2,5 s`);
  assert.ok(bots.AFTER_DRAW[0] >= 1500, 'dopo aver pescato aspetta almeno 1,5 s');
});

// Con tutte le regole della casa accese le partite finiscono lo stesso
for (const mode of ['classic', 'flip']) {
  test(`computer con le regole della casa finiscono le partite in ${mode}`, () => {
    for (let round = 0; round < 25; round++) {
      const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
      const rules = { stack: true, sevenZero: true, drawUntil: true };
      const g = new Game(players.slice(0, 2 + (round % 2)), { mode, rules });
      let steps = 0;
      while (!g.winner) {
        assert.ok(++steps < 5000, 'la partita non finisce');
        const id = g.current().id;
        applyAction(g, id, chooseAction(g, id, 'normal'), 'normal');
      }
    }
  });
}

test('con l\'accumulo il computer risponde a un +2 col suo +4', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rules: { stack: true } });
  const w4 = { id: 9001, color: 'wild', value: 'wild4' };
  g.players[1].hand = [w4, { id: 9002, color: 'blue', value: '3' }];
  g.turn = 1;
  g.pending = { type: 'stack', amount: 2, min: 2 };
  const action = chooseAction(g, 'b', 'normal');
  assert.strictEqual(action.type, 'play');
  assert.strictEqual(action.cardId, w4.id);
});
