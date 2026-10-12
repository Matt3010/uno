'use strict';

const COLORS = ['red', 'yellow', 'green', 'blue'];

function createDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: id++, color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: id++, color, value: String(n) });
      deck.push({ id: id++, color, value: String(n) });
    }
    for (const value of ['skip', 'reverse', 'draw2']) {
      deck.push({ id: id++, color, value });
      deck.push({ id: id++, color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: id++, color: 'wild', value: 'wild' });
    deck.push({ id: id++, color: 'wild', value: 'wild4' });
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardPoints(card) {
  if (card.color === 'wild') return 50;
  if (['skip', 'reverse', 'draw2'].includes(card.value)) return 20;
  return Number(card.value);
}

class GameError extends Error {}

/**
 * Stato di una singola mano di UNO.
 * players: array di { id, name } nell'ordine di gioco.
 */
class Game {
  constructor(players, { dealer } = {}) {
    if (players.length < 2) throw new GameError('Servono almeno 2 giocatori');
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], saidUno: false }));
    this.deck = shuffle(createDeck());
    this.discard = [];
    this.direction = 1;
    this.turn = 0;
    this.currentColor = null;
    this.hasDrawn = false; // il giocatore di turno ha già pescato
    this.drawnCardId = null; // carta pescata giocabile
    this.unoVulnerable = null; // id del giocatore che può essere "beccato" senza UNO
    this.mustChooseColor = false; // prima carta Jolly: il primo giocatore sceglie il colore
    this.pendingWild4 = null; // { from, to, legal } in attesa di accetta/sfida
    this.winner = null;
    this.log = [];

    for (let i = 0; i < 7; i++) {
      for (const p of this.players) p.hand.push(this.drawOne());
    }

    // Regola ufficiale: un Jolly +4 come prima carta torna nel mazzo
    let first = this.drawOne();
    while (first.value === 'wild4') {
      this.deck.unshift(first);
      shuffle(this.deck);
      first = this.drawOne();
    }
    this.discard.push(first);

    const n = this.players.length;
    const d = Number.isInteger(dealer) ? ((dealer % n) + n) % n : Math.floor(Math.random() * n);
    this.addLog(`Distribuisce ${this.players[d].name}`);
    this.turn = d;
    this.advance(1);
    this.applyFirstCard(first, d);
  }

  // Effetto della prima carta scoperta (regole ufficiali)
  applyFirstCard(card, dealer) {
    this.currentColor = card.color === 'wild' ? null : card.color;
    switch (card.value) {
      case 'wild':
        this.mustChooseColor = true;
        this.addLog(`Prima carta Jolly: ${this.current().name} sceglie il colore`);
        break;
      case 'skip':
        this.addLog(`Prima carta Salta: ${this.current().name} salta il turno`);
        this.advance(1);
        break;
      case 'reverse':
        this.direction = -1;
        this.addLog('Prima carta Inverti: inizia chi distribuisce, in senso opposto');
        this.turn = dealer;
        break;
      case 'draw2':
        this.draw(this.current(), 2);
        this.addLog(`Prima carta +2: ${this.current().name} pesca 2 carte e salta il turno`);
        this.advance(1);
        break;
      default:
    }
    this.addLog(`Si parte! Inizia ${this.current().name}`);
  }

  chooseColor(playerId, color) {
    this.assertTurn(playerId);
    if (!this.mustChooseColor) throw new GameError('Il colore è già stato scelto');
    if (!COLORS.includes(color)) throw new GameError('Colore non valido');
    this.mustChooseColor = false;
    this.currentColor = color;
    this.addLog(`${this.current().name} sceglie il ${COLOR_NAMES[color]}`);
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 30) this.log.shift();
  }

  current() {
    return this.players[this.turn];
  }

  top() {
    return this.discard[this.discard.length - 1];
  }

  drawOne() {
    if (this.deck.length === 0) {
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = top ? [top] : [];
    }
    return this.deck.pop();
  }

  draw(player, n) {
    for (let i = 0; i < n; i++) {
      const c = this.drawOne();
      if (c) player.hand.push(c);
    }
    player.saidUno = false;
  }

  nextIndex(steps = 1) {
    const n = this.players.length;
    return (((this.turn + this.direction * steps) % n) + n) % n;
  }

  advance(steps = 1) {
    this.turn = this.nextIndex(steps);
    this.hasDrawn = false;
    this.drawnCardId = null;
  }

  getPlayer(id) {
    const p = this.players.find((pl) => pl.id === id);
    if (!p) throw new GameError('Giocatore non in partita');
    return p;
  }

  assertTurn(id) {
    if (this.winner) throw new GameError('La mano è finita');
    if (this.current().id !== id) throw new GameError('Non è il tuo turno');
  }

  // Turno "normale": niente +4 in sospeso né colore iniziale da scegliere
  assertAction(id) {
    this.assertTurn(id);
    if (this.pendingWild4) throw new GameError('Devi accettare o sfidare il +4');
    if (this.mustChooseColor) throw new GameError('Scegli prima il colore');
  }

  canPlay(player, card) {
    const top = this.top();
    if (this.pendingWild4 || this.mustChooseColor) return false;
    if (this.hasDrawn && card.id !== this.drawnCardId) return false;
    // Il +4 si può sempre giocare: se è un bluff, il giocatore successivo può sfidarlo
    if (card.color === 'wild') return true;
    return card.color === this.currentColor || card.value === top.value;
  }

  // Chi ha giocato la penultima carta senza dire UNO resta vulnerabile solo
  // fino a quando il giocatore successivo compie un'azione.
  clearVulnerable(actorId) {
    if (this.unoVulnerable && this.unoVulnerable !== actorId) this.unoVulnerable = null;
  }

  play(playerId, cardId, chosenColor) {
    this.assertAction(playerId);
    const player = this.getPlayer(playerId);
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new GameError('Carta non trovata');
    const card = player.hand[idx];
    if (!this.canPlay(player, card)) throw new GameError('Non puoi giocare questa carta');
    if (card.color === 'wild' && !COLORS.includes(chosenColor)) throw new GameError('Scegli un colore');

    this.clearVulnerable(playerId);
    const prevColor = this.currentColor;
    player.hand.splice(idx, 1);
    this.discard.push(card);
    this.currentColor = card.color === 'wild' ? chosenColor : card.color;
    this.addLog(`${player.name} gioca ${describe(card, this.currentColor)}`);

    if (player.hand.length === 1) {
      if (player.saidUno) this.addLog(`${player.name}: UNO!`);
      else this.unoVulnerable = player.id;
    } else {
      player.saidUno = false;
    }

    if (player.hand.length === 0) {
      // Se l'ultima carta è un +2 o +4, il successivo pesca comunque (conta nei punti)
      const penalty = { draw2: 2, wild4: 4 }[card.value];
      if (penalty) {
        const victim = this.players[this.nextIndex()];
        this.draw(victim, penalty);
        this.addLog(`${victim.name} pesca ${penalty} carte`);
      }
      this.finish(player);
      return;
    }

    const twoPlayers = this.players.length === 2;
    switch (card.value) {
      case 'skip':
        this.addLog(`${this.players[this.nextIndex()].name} salta il turno`);
        this.advance(2);
        break;
      case 'reverse':
        if (twoPlayers) {
          this.addLog(`${this.players[this.nextIndex()].name} salta il turno`);
          this.advance(2);
        } else {
          this.direction *= -1;
          this.addLog('Cambio di direzione');
          this.advance(1);
        }
        break;
      case 'draw2': {
        const victim = this.players[this.nextIndex()];
        this.draw(victim, 2);
        this.addLog(`${victim.name} pesca 2 carte e salta il turno`);
        this.advance(2);
        break;
      }
      case 'wild4': {
        // Legale solo se non si avevano carte del colore precedente
        const legal = !player.hand.some((c) => c.color === prevColor);
        this.advance(1);
        this.pendingWild4 = { from: player.id, to: this.current().id, legal };
        this.addLog(`${this.current().name} deve decidere: accettare o sfidare il +4`);
        break;
      }
      default:
        this.advance(1);
    }
  }

  acceptWild4(playerId) {
    this.assertTurn(playerId);
    if (!this.pendingWild4) throw new GameError('Nessun +4 da accettare');
    this.clearVulnerable(playerId);
    const victim = this.current();
    this.pendingWild4 = null;
    this.draw(victim, 4);
    this.addLog(`${victim.name} pesca 4 carte e salta il turno`);
    this.advance(1);
  }

  challengeWild4(playerId) {
    this.assertTurn(playerId);
    const pending = this.pendingWild4;
    if (!pending) throw new GameError('Nessun +4 da sfidare');
    this.clearVulnerable(playerId);
    const victim = this.current();
    const offender = this.players.find((p) => p.id === pending.from);
    this.pendingWild4 = null;
    if (!pending.legal && offender) {
      this.draw(offender, 4);
      this.addLog(`${victim.name} sfida il +4 e vince: ${offender.name} bluffava e pesca 4 carte!`);
      // la sfidante gioca normalmente il proprio turno
    } else {
      this.draw(victim, 6);
      this.addLog(`${victim.name} sfida il +4 e perde: pesca 6 carte e salta il turno`);
      this.advance(1);
    }
  }

  drawCard(playerId) {
    this.assertAction(playerId);
    if (this.hasDrawn) throw new GameError('Hai già pescato');
    const player = this.getPlayer(playerId);
    this.clearVulnerable(playerId);
    const card = this.drawOne();
    if (!card) {
      this.addLog(`${player.name} non può pescare: mazzo vuoto`);
      this.advance(1);
      return;
    }
    player.hand.push(card);
    player.saidUno = false;
    this.hasDrawn = true;
    this.drawnCardId = card.id;
    if (this.canPlay(player, card)) {
      this.addLog(`${player.name} pesca una carta`);
    } else {
      this.addLog(`${player.name} pesca una carta e passa`);
      this.advance(1);
    }
  }

  pass(playerId) {
    this.assertAction(playerId);
    if (!this.hasDrawn) throw new GameError('Devi prima pescare');
    this.addLog(`${this.current().name} passa`);
    this.advance(1);
  }

  sayUno(playerId) {
    if (this.winner) return;
    const player = this.getPlayer(playerId);
    const isTurn = this.current().id === playerId;
    // Si può dichiarare UNO con 1 carta, o con 2 carte prima di giocare la penultima
    if (player.hand.length === 1 || (player.hand.length === 2 && isTurn)) {
      player.saidUno = true;
      if (this.unoVulnerable === playerId) {
        this.unoVulnerable = null;
        this.addLog(`${player.name}: UNO!`);
      }
    }
  }

  catchUno(catcherId, targetId) {
    if (this.winner) return;
    const catcher = this.getPlayer(catcherId);
    if (this.unoVulnerable !== targetId || catcherId === targetId) {
      throw new GameError('Troppo tardi!');
    }
    const target = this.getPlayer(targetId);
    this.draw(target, 2);
    this.unoVulnerable = null;
    this.addLog(`${catcher.name} becca ${target.name} senza UNO: +2 carte!`);
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    this.deck.unshift(...p.hand);
    if (this.unoVulnerable === playerId) this.unoVulnerable = null;
    if (this.pendingWild4 && [this.pendingWild4.from, this.pendingWild4.to].includes(playerId)) {
      this.pendingWild4 = null;
    }
    this.addLog(`${p.name} ha lasciato la partita`);
    if (this.winner) return;
    if (this.players.length < 2) {
      if (this.players.length === 1) this.finish(this.players[0]);
      return;
    }
    if (idx < this.turn) {
      this.turn--;
    } else if (idx === this.turn) {
      if (this.direction === -1) this.turn--;
      this.turn = ((this.turn % this.players.length) + this.players.length) % this.players.length;
      this.hasDrawn = false;
      this.drawnCardId = null;
    }
  }

  finish(player) {
    let points = 0;
    for (const p of this.players) for (const c of p.hand) points += cardPoints(c);
    this.winner = { id: player.id, name: player.name, points };
    this.addLog(`🏆 ${player.name} vince la mano (+${points} punti)!`);
  }

  // Vista dello stato per un giocatore specifico (nasconde le carte altrui)
  viewFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    return {
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        saidUno: p.saidUno && p.hand.length === 1,
      })),
      hand: me ? me.hand.map((c) => ({ ...c, playable: this.current().id === playerId && !this.winner && this.canPlay(me, c) })) : [],
      top: this.top(),
      currentColor: this.currentColor,
      turnId: this.current().id,
      direction: this.direction,
      deckCount: this.deck.length,
      hasDrawn: this.current().id === playerId ? this.hasDrawn : false,
      mustChooseColor: this.mustChooseColor,
      pendingWild4: this.pendingWild4 ? { from: this.pendingWild4.from, to: this.pendingWild4.to } : null,
      unoVulnerable: this.unoVulnerable,
      winner: this.winner,
      log: this.log.slice(-12),
      handsAtEnd: this.winner ? Object.fromEntries(this.players.map((p) => [p.id, p.hand])) : null,
    };
  }
}

const COLOR_NAMES = { red: 'rosso', yellow: 'giallo', green: 'verde', blue: 'blu' };
const VALUE_NAMES = { skip: 'Salta', reverse: 'Inverti', draw2: '+2', wild: 'Jolly', wild4: 'Jolly +4' };

function describe(card, chosenColor) {
  if (card.color === 'wild') {
    return chosenColor ? `${VALUE_NAMES[card.value]} (${COLOR_NAMES[chosenColor]})` : VALUE_NAMES[card.value];
  }
  return `${VALUE_NAMES[card.value] || card.value} ${COLOR_NAMES[card.color]}`;
}

module.exports = { Game, GameError, createDeck, COLORS };
