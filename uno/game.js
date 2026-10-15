'use strict';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const DARK_COLORS = ['pink', 'teal', 'orange', 'purple'];

const MODES = {
  classic: { name: 'UNO Classico', target: 500 },
  flip: { name: 'UNO Flip', target: 500 },
  nomercy: { name: "UNO Show 'Em No Mercy", target: 1000 },
};

// Carte "pesca" e quante carte fanno pescare
const DRAW_VALUE = { draw1: 1, draw2: 2, draw4: 4, draw5: 5, wild4: 4, wild2: 2, wildrev4: 4, wild6: 6, wild10: 10 };
// Jolly pesca sfidabili (Classico e Flip)
const CHALLENGEABLE = { wild4: 'fixed', wild2: 'fixed', wildcolor: 'untilColor' };
// Carte che nel No Mercy si accumulano
const STACKABLE = ['draw2', 'draw4', 'wildrev4', 'wild6', 'wild10'];
// Con la regola della casa dell'accumulo, nelle altre modalità
const HOUSE_STACKABLE = ['draw1', 'draw2', 'draw5', 'wild2', 'wild4'];
// Regole della casa (il No Mercy le ha già tutte)
const HOUSE_RULES = {
  stack: 'Accumulo dei +2 e +4',
  sevenZero: '7-0: col 7 scambi la mano, con lo 0 tutti la passano',
  drawUntil: 'Pesca finché non trovi una carta giocabile',
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function repeat(n, fn) {
  for (let i = 0; i < n; i++) fn();
}

// --- Mazzi ---

// Classico: 108 carte
function createDeck() {
  const deck = [];
  const add = (color, value) => deck.push({ id: deck.length, color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let n = 1; n <= 9; n++) repeat(2, () => add(color, String(n)));
    for (const value of ['skip', 'reverse', 'draw2']) repeat(2, () => add(color, value));
  }
  repeat(4, () => add('wild', 'wild'));
  repeat(4, () => add('wild', 'wild4'));
  return deck;
}

// UNO Flip: 112 carte a doppia faccia (lato chiaro / lato scuro)
function createFlipDeck() {
  const light = [];
  const dark = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 9; n++) repeat(2, () => light.push({ color, value: String(n) }));
    for (const value of ['draw1', 'reverse', 'skip', 'flip']) repeat(2, () => light.push({ color, value }));
  }
  repeat(4, () => light.push({ color: 'wild', value: 'wild' }));
  repeat(4, () => light.push({ color: 'wild', value: 'wild2' }));
  for (const color of DARK_COLORS) {
    for (let n = 1; n <= 9; n++) repeat(2, () => dark.push({ color, value: String(n) }));
    for (const value of ['draw5', 'reverse', 'skipall', 'flip']) repeat(2, () => dark.push({ color, value }));
  }
  repeat(4, () => dark.push({ color: 'wild', value: 'wild' }));
  repeat(4, () => dark.push({ color: 'wild', value: 'wildcolor' }));
  shuffle(dark);
  return light.map((l, i) => ({ id: i, light: l, dark: dark[i] }));
}

// Show 'Em No Mercy: 168 carte
function createNoMercyDeck() {
  const deck = [];
  const add = (color, value) => deck.push({ id: deck.length, color, value });
  for (const color of COLORS) {
    for (let n = 0; n <= 9; n++) repeat(2, () => add(color, String(n)));
    for (const value of ['discardall', 'draw2', 'reverse', 'skip']) repeat(3, () => add(color, value));
    for (const value of ['draw4', 'skipall']) repeat(2, () => add(color, value));
  }
  repeat(8, () => add('wild', 'roulette'));
  repeat(4, () => add('wild', 'wild6'));
  repeat(4, () => add('wild', 'wild10'));
  repeat(8, () => add('wild', 'wildrev4'));
  return deck;
}

const DECKS = { classic: createDeck, flip: createFlipDeck, nomercy: createNoMercyDeck };

// --- Punteggi ---

const POINTS = {
  classic: { skip: 20, reverse: 20, draw2: 20, wild: 50, wild4: 50 },
  flip: {
    draw1: 10, skip: 20, flip: 20, wild: 40, wild2: 50, // lato chiaro
    draw5: 20, skipall: 30, wildcolor: 60, reverse: 20, // lato scuro
  },
  nomercy: {
    skip: 20, reverse: 20, draw2: 20, draw4: 20, skipall: 20, discardall: 20,
    roulette: 50, wild6: 50, wild10: 50, wildrev4: 50,
  },
};
const ELIMINATION_POINTS = 250;
const MERCY_LIMIT = 25;

class GameError extends Error {}

/**
 * Stato di una singola mano.
 * players: array di { id, name } nell'ordine di gioco.
 * Una sola "decisione in sospeso" alla volta (this.pending), sempre a carico del giocatore di turno:
 *   color     – deve scegliere il colore (prima carta Jolly, Flip che scopre un Jolly)
 *   challenge – ha ricevuto un Jolly pesca sfidabile: accetta o sfida
 *   stack     – No Mercy: rilancia con una carta pesca o pesca il totale
 *   roulette  – No Mercy: sceglie il colore fino al quale pescare
 *   swap      – No Mercy: ha giocato un 7 e sceglie con chi scambiare la mano
 */
class Game {
  constructor(players, { dealer, mode = 'classic', rules = {} } = {}) {
    if (players.length < 2) throw new GameError('Servono almeno 2 giocatori');
    if (!MODES[mode]) throw new GameError('Modalità sconosciuta');
    this.mode = mode;
    this.rules = Object.fromEntries(Object.keys(HOUSE_RULES).map((k) => [k, mode !== 'nomercy' && !!rules[k]]));
    this.side = 'light'; // solo per Flip
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], saidUno: false }));
    this.deck = shuffle(DECKS[mode]());
    this.discard = [];
    this.direction = 1;
    this.turn = 0;
    this.currentColor = null;
    this.hasDrawn = false; // il giocatore di turno ha già pescato
    this.drawnCardId = null; // la sola carta che può giocare dopo aver pescato
    this.unoVulnerable = null; // id del giocatore che può essere "beccato" senza UNO
    this.pending = null;
    this.eliminated = []; // No Mercy: nomi degli eliminati in questa mano
    this.winner = null;
    this.log = [];
    // ultimo salto di turno da annunciare a tutti (chi lo perde e perché)
    this.skip = null;
    this.skipSeq = 0;

    for (let i = 0; i < 7; i++) {
      for (const p of this.players) p.hand.push(this.drawOne());
    }

    let first = this.drawOne();
    while (!this.validFirstCard(this.face(first))) {
      this.deck.unshift(first);
      shuffle(this.deck);
      first = this.drawOne();
    }
    this.discard.push(first);

    const n = this.players.length;
    const d = Number.isInteger(dealer) ? ((dealer % n) + n) % n : Math.floor(Math.random() * n);
    this.addLog(`${MODES[mode].name} — distribuisce ${this.players[d].name}`);
    this.turn = d;
    this.advance(1);
    this.applyFirstCard(this.face(first), d);
  }

  get isFlip() {
    return this.mode === 'flip';
  }

  get noMercy() {
    return this.mode === 'nomercy';
  }

  // Carte pesca che si possono accumulare (No Mercy, o regola della casa)
  stackable(value) {
    if (this.noMercy) return STACKABLE.includes(value);
    return this.rules.stack && HOUSE_STACKABLE.includes(value);
  }

  get sevenZero() {
    return this.noMercy || this.rules.sevenZero;
  }

  colors() {
    return this.isFlip && this.side === 'dark' ? DARK_COLORS : COLORS;
  }

  // Faccia attiva di una carta (in Flip dipende dal lato in gioco)
  face(card) {
    return this.isFlip ? card[this.side] : card;
  }

  otherFace(card) {
    return card[this.side === 'light' ? 'dark' : 'light'];
  }

  validFirstCard(f) {
    if (this.noMercy) return /^\d$/.test(f.value); // regola No Mercy: solo numeri
    return !['wild4', 'wild2', 'flip'].includes(f.value);
  }

  // Effetto della prima carta scoperta
  applyFirstCard(f, dealer) {
    this.currentColor = f.color === 'wild' ? null : f.color;
    const who = this.current().name;
    switch (f.value) {
      case 'wild':
        this.pending = { type: 'color', after: 0 };
        this.addLog(`Prima carta Jolly: ${who} sceglie il colore`);
        break;
      case 'skip':
        this.skipTurn([this.current()], `Prima carta Salta: ${who} salta il turno`);
        this.advance(1);
        break;
      case 'reverse':
        this.direction = -1;
        this.addLog('Prima carta Inverti: inizia chi distribuisce, in senso opposto');
        this.turn = dealer;
        break;
      case 'draw1':
      case 'draw2':
        this.draw(this.current(), DRAW_VALUE[f.value]);
        this.skipTurn([this.current()], `Prima carta ${valueName(f.value)}: ${who} pesca e salta il turno`);
        this.advance(1);
        break;
      default:
    }
    this.addLog(`Si parte! Inizia ${this.current().name}`);
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  // Annuncia che questi giocatori perdono il turno (finisce anche nel registro)
  skipTurn(players, msg) {
    this.addLog(msg);
    this.skip = { ids: players.map((p) => p.id), text: msg, seq: ++this.skipSeq };
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
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (this.noMercy && player.hand.length >= MERCY_LIMIT) break;
      const c = this.drawOne();
      if (!c) break;
      player.hand.push(c);
      drawn++;
    }
    this.drewCards(player, drawn);
    return drawn;
  }

  // Pesca finché non esce una carta del colore indicato (i Jolly non contano)
  drawUntilColor(player, color) {
    let drawn = 0;
    for (;;) {
      if (this.noMercy && player.hand.length >= MERCY_LIMIT) break;
      const c = this.drawOne();
      if (!c) break;
      player.hand.push(c);
      drawn++;
      if (this.face(c).color === color) break;
    }
    this.drewCards(player, drawn);
    return drawn;
  }

  // Chi pesca non ha più una carta sola: niente UNO da dire né da beccare
  drewCards(player, n) {
    player.saidUno = false;
    if (n && this.unoVulnerable === player.id) this.unoVulnerable = null;
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

  assertNoPending() {
    if (!this.pending) return;
    const msg = {
      color: 'Scegli prima il colore',
      challenge: 'Devi accettare o sfidare il Jolly',
      stack: 'Devi rilanciare con una carta pesca o pescare',
      roulette: 'Scegli prima il colore della roulette',
      swap: 'Scegli con chi scambiare la mano',
    }[this.pending.type];
    throw new GameError(msg);
  }

  canPlay(player, card) {
    const f = this.face(card);
    if (this.pending) {
      // No Mercy: durante un accumulo si può solo rilanciare con una carta pesca di valore pari o superiore
      return this.pending.type === 'stack' && this.stackable(f.value) && DRAW_VALUE[f.value] >= this.pending.min;
    }
    if (this.hasDrawn && card.id !== this.drawnCardId) return false;
    if (f.color === 'wild') return true;
    return f.color === this.currentColor || f.value === this.face(this.top()).value;
  }

  // Chi ha giocato la penultima carta senza dire UNO resta vulnerabile solo
  // fino a quando un altro giocatore compie un'azione.
  clearVulnerable(actorId) {
    if (this.unoVulnerable && this.unoVulnerable !== actorId) this.unoVulnerable = null;
  }

  play(playerId, cardId, chosenColor) {
    this.assertTurn(playerId);
    if (this.pending && this.pending.type !== 'stack') this.assertNoPending();
    const player = this.getPlayer(playerId);
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new GameError('Carta non trovata');
    const card = player.hand[idx];
    const f = this.face(card);
    if (!this.canPlay(player, card)) throw new GameError('Non puoi giocare questa carta');
    if (f.color === 'wild' && !this.colors().includes(chosenColor)) throw new GameError('Scegli un colore');

    this.clearVulnerable(playerId);
    const stackSoFar = this.pending ? this.pending.amount : 0;
    this.pending = null;
    const prevColor = this.currentColor;
    player.hand.splice(idx, 1);
    this.discard.push(card);
    this.currentColor = f.color === 'wild' ? chosenColor : f.color;
    this.addLog(`${player.name} gioca ${describe(f, this.currentColor)}`);

    if (f.value === 'discardall') {
      const same = player.hand.filter((c) => this.face(c).color === f.color);
      if (same.length) {
        player.hand = player.hand.filter((c) => this.face(c).color !== f.color);
        this.discard.splice(this.discard.length - 1, 0, ...same);
        this.addLog(`${player.name} scarta altre ${same.length} carte ${colorName(f.color)}`);
      }
    }

    if (player.hand.length === 1) {
      if (player.saidUno) this.addLog(`${player.name}: UNO!`);
      else this.unoVulnerable = player.id;
    } else {
      player.saidUno = false;
    }

    if (player.hand.length === 0) {
      this.lastCardPenalty(f, stackSoFar);
      this.finish(player);
      return;
    }

    this.resolve(player, f, prevColor, stackSoFar);
    this.checkMercy();
  }

  // Effetto della carta appena giocata
  resolve(player, f, prevColor, stackSoFar) {
    const twoPlayers = this.players.length === 2;
    const next = () => this.players[this.nextIndex()];

    if (this.stackable(f.value)) {
      if (f.value === 'wildrev4' && !twoPlayers) {
        this.direction *= -1;
        this.addLog('Cambio di direzione');
      }
      const amount = stackSoFar + DRAW_VALUE[f.value];
      this.advance(1);
      this.pending = { type: 'stack', amount, min: DRAW_VALUE[f.value] };
      this.addLog(`${this.current().name} deve pescare ${amount} carte o rilanciare`);
      return;
    }

    switch (f.value) {
      case 'skip':
        this.skipTurn([next()], `${next().name} salta il turno`);
        this.advance(2);
        break;
      case 'reverse':
        if (twoPlayers) {
          this.skipTurn([next()], `${next().name} salta il turno`);
          this.advance(2);
        } else {
          this.direction *= -1;
          this.addLog('Cambio di direzione');
          this.advance(1);
        }
        break;
      case 'skipall':
        this.skipTurn(this.players.filter((p) => p !== player), `Tutti saltano il turno: ${player.name} gioca ancora`);
        this.advance(0);
        break;
      case 'draw1':
      case 'draw2':
      case 'draw5': {
        const victim = next();
        const n = this.draw(victim, DRAW_VALUE[f.value]);
        this.skipTurn([victim], `${victim.name} pesca ${n} ${n === 1 ? 'carta' : 'carte'} e salta il turno`);
        this.advance(2);
        break;
      }
      case 'wild4':
      case 'wild2':
      case 'wildcolor': {
        // Legale solo se non si avevano carte del colore precedente
        const legal = !player.hand.some((c) => this.face(c).color === prevColor);
        this.advance(1);
        this.pending = {
          type: 'challenge',
          from: player.id,
          kind: CHALLENGEABLE[f.value],
          amount: DRAW_VALUE[f.value] || 0,
          color: this.currentColor,
          legal,
        };
        this.addLog(`${this.current().name} deve decidere: accettare o sfidare`);
        break;
      }
      case 'flip':
        this.flipAll(player);
        break;
      case 'roulette':
        this.advance(1);
        this.pending = { type: 'roulette' };
        this.addLog(`${this.current().name} sceglie un colore e pesca finché non esce`);
        break;
      case '7':
        if (this.sevenZero) {
          this.pending = { type: 'swap' };
          this.addLog(`${player.name} sceglie con chi scambiare la mano`);
          break;
        }
        this.advance(1);
        break;
      case '0':
        if (this.sevenZero) this.rotateHands();
        this.advance(1);
        break;
      default:
        this.advance(1);
    }
  }

  // Se l'ultima carta fa pescare, il successivo pesca comunque (conta nei punti)
  // (con l'accumulo pesca anche tutto quello accumulato prima)
  lastCardPenalty(f, stackSoFar = 0) {
    if (this.noMercy) return;
    const victim = this.players[this.nextIndex()];
    let n = 0;
    if (f.value === 'wildcolor') n = this.drawUntilColor(victim, this.currentColor);
    else if (DRAW_VALUE[f.value]) n = this.draw(victim, DRAW_VALUE[f.value] + stackSoFar);
    if (n) this.addLog(`${victim.name} pesca ${n} ${n === 1 ? 'carta' : 'carte'}`);
  }

  // UNO Flip: si girano mazzo, pila degli scarti e tutte le mani
  flipAll(player) {
    this.side = this.side === 'light' ? 'dark' : 'light';
    this.deck.reverse();
    this.discard.reverse();
    const f = this.face(this.top());
    this.addLog(`FLIP! Si passa al lato ${this.side === 'dark' ? 'scuro' : 'chiaro'}: in cima c'è ${describe(f)}`);
    if (f.color === 'wild') {
      // il giocatore che ha girato sceglie il colore
      this.currentColor = null;
      this.pending = { type: 'color', after: 1 };
      this.addLog(`${player.name} sceglie il colore`);
    } else {
      this.currentColor = f.color;
      this.advance(1);
    }
  }

  // No Mercy, carta 0: tutti passano la mano nella direzione di gioco
  rotateHands() {
    const n = this.players.length;
    const hands = this.players.map((p) => p.hand);
    this.players.forEach((p, i) => {
      p.hand = hands[(((i - this.direction) % n) + n) % n];
    });
    this.resetUnoFlags();
    this.addLog('Tutti passano la propria mano al giocatore successivo');
  }

  resetUnoFlags() {
    for (const p of this.players) p.saidUno = false;
    this.unoVulnerable = null;
  }

  drawCard(playerId) {
    this.assertTurn(playerId);
    if (this.pending && this.pending.type === 'stack') return this.accept(playerId);
    this.assertNoPending();
    if (this.hasDrawn) throw new GameError('Hai già pescato');
    const player = this.getPlayer(playerId);
    this.clearVulnerable(playerId);

    if (this.noMercy) {
      // Si pesca finché non si trova una carta giocabile
      let card = null;
      let n = 0;
      while (player.hand.length < MERCY_LIMIT) {
        const c = this.drawOne();
        if (!c) break;
        player.hand.push(c);
        n++;
        if (this.canPlay(player, c)) {
          card = c;
          break;
        }
      }
      player.saidUno = false;
      this.addLog(`${player.name} pesca ${n} ${n === 1 ? 'carta' : 'carte'}`);
      if (card) {
        this.hasDrawn = true;
        this.drawnCardId = card.id;
      } else {
        this.advance(1);
      }
      this.checkMercy();
      return;
    }

    if (this.rules.drawUntil) {
      // regola della casa: si pesca finché non esce una carta giocabile (si può anche tenerla)
      let n = 0;
      let card = null;
      for (let c = this.drawOne(); c; c = this.canPlay(player, c) ? null : this.drawOne()) {
        player.hand.push(c);
        n++;
        if (this.canPlay(player, c)) card = c;
      }
      this.drewCards(player, n);
      if (card) {
        this.hasDrawn = true;
        this.drawnCardId = card.id;
        this.addLog(`${player.name} pesca ${n} ${n === 1 ? 'carta' : 'carte'}`);
      } else {
        this.addLog(`${player.name} pesca ${n} carte e passa: mazzo finito`);
        this.advance(1);
      }
      return;
    }

    const card = this.drawOne();
    if (!card) {
      this.addLog(`${player.name} non può pescare: mazzo vuoto`);
      this.advance(1);
      return;
    }
    player.hand.push(card);
    this.drewCards(player, 1);
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
    this.assertTurn(playerId);
    this.assertNoPending();
    if (!this.hasDrawn) throw new GameError('Devi prima pescare');
    if (this.noMercy) throw new GameError('Devi giocare la carta pescata');
    this.addLog(`${this.current().name} passa`);
    this.advance(1);
  }

  chooseColor(playerId, color) {
    this.assertTurn(playerId);
    const p = this.pending;
    if (!p || !['color', 'roulette'].includes(p.type)) throw new GameError('Non devi scegliere un colore');
    if (!this.colors().includes(color)) throw new GameError('Colore non valido');
    const player = this.current();
    this.clearVulnerable(playerId);
    this.pending = null;
    if (p.type === 'color') {
      this.currentColor = color;
      this.addLog(`${player.name} sceglie il ${colorName(color)}`);
      this.advance(p.after);
    } else {
      const n = this.drawUntilColor(player, color);
      this.skipTurn([player], `${player.name} sceglie il ${colorName(color)}: pesca ${n} carte e salta il turno`);
      this.advance(1);
      this.checkMercy();
    }
  }

  // Accetta il Jolly sfidabile o, nel No Mercy, pesca il totale accumulato
  accept(playerId) {
    this.assertTurn(playerId);
    const p = this.pending;
    if (!p || !['challenge', 'stack'].includes(p.type)) throw new GameError('Niente da accettare');
    this.clearVulnerable(playerId);
    const victim = this.current();
    this.pending = null;
    const n = p.type === 'stack' ? this.draw(victim, p.amount) : this.penalty(victim, p, 0);
    this.skipTurn([victim], `${victim.name} pesca ${n} carte e salta il turno`);
    this.advance(1);
    this.checkMercy();
  }

  challenge(playerId) {
    this.assertTurn(playerId);
    const p = this.pending;
    if (!p || p.type !== 'challenge') throw new GameError('Niente da sfidare');
    this.clearVulnerable(playerId);
    const victim = this.current();
    const offender = this.players.find((pl) => pl.id === p.from);
    this.pending = null;
    if (!p.legal && offender) {
      const n = this.penalty(offender, p, 0);
      this.addLog(`${victim.name} sfida e vince: ${offender.name} bluffava e pesca ${n} carte!`);
      // chi ha sfidato gioca normalmente il proprio turno
    } else {
      const n = this.penalty(victim, p, 2);
      this.skipTurn([victim], `${victim.name} sfida e perde: pesca ${n} carte e salta il turno`);
      this.advance(1);
    }
  }

  penalty(player, p, extra) {
    const n = p.kind === 'untilColor' ? this.drawUntilColor(player, p.color) : this.draw(player, p.amount);
    return n + this.draw(player, extra);
  }

  swapHands(playerId, targetId) {
    this.assertTurn(playerId);
    if (!this.pending || this.pending.type !== 'swap') throw new GameError('Non devi scambiare');
    if (targetId === playerId) throw new GameError('Scegli un altro giocatore');
    const me = this.current();
    const other = this.getPlayer(targetId);
    this.pending = null;
    [me.hand, other.hand] = [other.hand, me.hand];
    this.resetUnoFlags();
    this.addLog(`${me.name} scambia la mano con ${other.name}`);
    this.advance(1);
  }

  // Colore di cui il giocatore ha più carte (per le scelte automatiche)
  bestColor(player) {
    const colors = this.colors();
    const count = Object.fromEntries(colors.map((c) => [c, 0]));
    for (const c of player.hand) {
      const col = this.face(c).color;
      if (col in count) count[col]++;
    }
    return colors.reduce((a, b) => (count[b] > count[a] ? b : a));
  }

  // Tempo scaduto: il gioco fa una mossa al posto del giocatore di turno
  autoPlay() {
    if (this.winner) return;
    const player = this.current();
    const p = this.pending;
    this.addLog(`⏱ Tempo scaduto per ${player.name}`);
    if (p) {
      if (p.type === 'color' || p.type === 'roulette') this.chooseColor(player.id, this.bestColor(player));
      else if (p.type === 'challenge' || p.type === 'stack') this.accept(player.id);
      else if (p.type === 'swap') {
        // scambia con chi ha meno carte
        const others = this.players.filter((pl) => pl.id !== player.id);
        const target = others.reduce((a, b) => (b.hand.length < a.hand.length ? b : a));
        this.swapHands(player.id, target.id);
      }
      return;
    }
    if (!this.hasDrawn) {
      this.drawCard(player.id);
      if (this.winner || this.current() !== player || !this.hasDrawn) return;
    }
    if (this.noMercy) {
      // nel No Mercy la carta pescata va giocata
      this.play(player.id, this.drawnCardId, this.bestColor(player));
    } else {
      this.pass(player.id);
    }
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
    this.checkMercy();
  }

  // No Mercy: con 25 o più carte si è eliminati
  checkMercy() {
    if (!this.noMercy || this.winner) return;
    for (const p of [...this.players]) {
      if (p.hand.length >= MERCY_LIMIT && !this.winner) {
        this.eliminated.push(p.name);
        this.addLog(`💀 ${p.name} ha ${p.hand.length} carte ed è eliminato!`);
        this.removePlayer(p.id, { eliminated: true });
      }
    }
  }

  removePlayer(playerId, { eliminated = false } = {}) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    // le carte di chi è eliminato vanno sotto la pila degli scarti
    if (eliminated) this.discard.unshift(...p.hand);
    else this.deck.unshift(...p.hand);
    if (this.unoVulnerable === playerId) this.unoVulnerable = null;
    if (this.pending && this.pending.from === playerId) this.pending = null;
    if (!eliminated) this.addLog(`${p.name} ha lasciato la partita`);
    const n = this.players.length;
    if (n === 0) return;
    // l'indice del turno va sempre sistemato, anche a mano finita
    if (idx < this.turn) {
      this.turn--;
    } else if (idx === this.turn) {
      if (this.direction === -1) this.turn--;
      this.hasDrawn = false;
      this.drawnCardId = null;
      // se doveva scegliere il colore, lo sceglie (e poi gioca) il giocatore dopo
      this.pending = this.pending && this.pending.type === 'color' ? { type: 'color', after: 0 } : null;
    }
    this.turn = ((this.turn % n) + n) % n;
    if (!this.winner && n === 1) this.finish(this.players[0]);
  }

  cardPoints(card) {
    const f = this.face(card);
    if (/^\d$/.test(f.value)) return Number(f.value);
    return POINTS[this.mode][f.value] || 0;
  }

  finish(player) {
    let points = 0;
    for (const p of this.players) {
      if (p.id === player.id) continue; // chi vince per eliminazione può avere ancora carte
      for (const c of p.hand) points += this.cardPoints(c);
    }
    if (this.noMercy) points += ELIMINATION_POINTS * this.eliminated.length;
    this.pending = null;
    this.winner = { id: player.id, name: player.name, points };
    this.addLog(`🏆 ${player.name} vince la mano (+${points} punti)!`);
  }

  // Vista dello stato per un giocatore specifico (nasconde le carte altrui)
  viewFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    const myTurn = !this.winner && this.current().id === playerId;
    const p = this.pending;
    const deckTop = this.deck[this.deck.length - 1];
    return {
      mode: this.mode,
      rules: this.rules,
      side: this.side,
      colors: this.colors(),
      players: this.players.map((pl) => ({
        id: pl.id,
        name: pl.name,
        cardCount: pl.hand.length,
        saidUno: pl.saidUno && pl.hand.length === 1,
        // in Flip si vede il retro (l'altra faccia) delle carte degli avversari
        backs: this.isFlip && pl.id !== playerId ? pl.hand.map((c) => this.otherFace(c)) : null,
      })),
      hand: me
        ? me.hand.map((c) => ({ id: c.id, ...this.face(c), playable: myTurn && this.canPlay(me, c) }))
        : [],
      top: this.face(this.top()),
      // ultime carte della pila degli scarti, per mostrarle sovrapposte
      pile: this.discard.slice(-4).map((c) => ({ id: c.id, ...this.face(c) })),
      currentColor: this.currentColor,
      turnId: this.current().id,
      nextId: this.players[this.nextIndex()].id,
      direction: this.direction,
      deckCount: this.deck.length,
      deckBack: this.isFlip && deckTop ? this.otherFace(deckTop) : null,
      hasDrawn: myTurn ? this.hasDrawn : false,
      pending: p
        ? { type: p.type, amount: p.amount, min: p.min, from: p.from, kind: p.kind, color: p.color }
        : null,
      unoVulnerable: this.unoVulnerable,
      eliminated: this.eliminated,
      skip: this.skip,
      winner: this.winner,
      log: this.log.slice(-14),
    };
  }
}

const COLOR_NAMES = {
  red: 'rosso', yellow: 'giallo', green: 'verde', blue: 'blu',
  pink: 'rosa', teal: 'azzurro', orange: 'arancione', purple: 'viola',
};
const VALUE_NAMES = {
  skip: 'Salta', reverse: 'Inverti', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: 'Salta tutti', flip: 'Flip', discardall: 'Scarta tutto',
  wild: 'Jolly', wild4: 'Jolly +4', wild2: 'Jolly +2', wildcolor: 'Jolly pesca colore',
  wildrev4: 'Jolly inverti +4', wild6: 'Jolly +6', wild10: 'Jolly +10', roulette: 'Roulette dei colori',
};

function colorName(c) {
  return COLOR_NAMES[c] || c;
}

function valueName(v) {
  return VALUE_NAMES[v] || v;
}

function describe(f, chosenColor) {
  if (f.color === 'wild') return chosenColor ? `${valueName(f.value)} (${colorName(chosenColor)})` : valueName(f.value);
  return `${valueName(f.value)} ${colorName(f.color)}`;
}

module.exports = { Game, GameError, MODES, HOUSE_RULES, COLORS, DARK_COLORS, DRAW_VALUE, STACKABLE, createDeck, createFlipDeck, createNoMercyDeck };
