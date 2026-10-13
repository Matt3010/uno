'use strict';

// Giocatori computer: decidono una mossa alla volta guardando la propria mano
// e le informazioni pubbliche del tavolo (come farebbe una persona).

const { DRAW_VALUE } = require('./game');

const BOT_NAMES = [
  'Giulia', 'Marco', 'Sofia', 'Luca', 'Chiara', 'Davide', 'Martina', 'Simone', 'Elena', 'Andrea',
  'Francesca', 'Paolo', 'Sara', 'Federico', 'Alice', 'Riccardo', 'Giorgia', 'Tommaso', 'Valentina', 'Nicola',
];

const LEVELS = {
  easy: {
    name: 'Facile',
    think: [3000, 5000], // ms di "riflessione" prima di muovere
    forgetUno: 0.4, // probabilità di dimenticarsi di dire UNO
    lateUno: 0.5, // se se ne dimentica, probabilità di accorgersene in ritardo
    catchChance: 0.15, // probabilità di beccare chi non dice UNO
    challenge: 0, // probabilità di sfidare un Jolly pesca
  },
  normal: {
    name: 'Normale',
    think: [2600, 4400],
    forgetUno: 0.12,
    lateUno: 0.6,
    catchChance: 0.45,
    challenge: 0.2,
  },
  hard: {
    name: 'Difficile',
    think: [2500, 4000],
    forgetUno: 0,
    lateUno: 1,
    catchChance: 0.85,
    challenge: 0.35,
  },
};

// ms di attesa prima di giocare (o passare) la carta appena pescata
const AFTER_DRAW = [1500, 2500];

const ATTACK = ['skip', 'reverse', 'draw1', 'draw2', 'draw4', 'draw5', 'skipall'];

function pickName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  return `Bot ${taken.length + 1}`;
}

function between([min, max]) {
  return min + Math.random() * (max - min);
}

// Punteggio di una carta: più è alto, più conviene giocarla adesso
function cardScore(game, me, card, level) {
  const f = game.face(card);
  const counts = {};
  for (const c of me.hand) {
    const col = game.face(c).color;
    counts[col] = (counts[col] || 0) + 1;
  }
  const next = game.players[game.nextIndex()];
  const nextIsClose = next && next.id !== me.id && next.hand.length <= 3;
  let score = 0;

  if (f.color === 'wild') {
    // i Jolly si tengono per quando servono davvero
    score -= DRAW_VALUE[f.value] ? 45 : 60;
    if (level === 'hard' && nextIsClose && DRAW_VALUE[f.value]) score += 70;
  } else {
    score += 10 + (counts[f.color] || 0) * 4; // libera il colore di cui ha più carte
    if (/^\d$/.test(f.value)) score += Number(f.value) * 0.6; // via i numeri alti (valgono punti)
    if (ATTACK.includes(f.value)) {
      if (level === 'hard') score += nextIsClose ? 45 : -6; // attacca chi sta per vincere
      else score += 4;
    }
    if (f.value === 'discardall') score += 8 * ((counts[f.color] || 1) - 1);
    if (f.value === '7' && game.sevenZero) {
      const fewest = Math.min(...game.players.filter((p) => p.id !== me.id).map((p) => p.hand.length));
      score += fewest < me.hand.length - 1 ? 30 : -25;
    }
  }
  return score;
}

/**
 * Decide la prossima mossa del computer "botId".
 * Restituisce una delle azioni: play, draw, pass, color, accept, challenge, swap (o null se non tocca a lui).
 */
function chooseAction(game, botId, level = 'normal') {
  if (game.winner || game.current().id !== botId) return null;
  const me = game.current();
  const L = LEVELS[level] || LEVELS.normal;
  const p = game.pending;

  if (p) {
    if (p.type === 'color' || p.type === 'roulette') return { type: 'color', color: game.bestColor(me) };
    if (p.type === 'challenge') return { type: Math.random() < L.challenge ? 'challenge' : 'accept' };
    if (p.type === 'swap') {
      const others = game.players.filter((pl) => pl.id !== me.id);
      const target = others.reduce((a, b) => (b.hand.length < a.hand.length ? b : a));
      return { type: 'swap', targetId: target.id };
    }
    if (p.type === 'stack') {
      // rilancia con la carta pesca più piccola che basta, altrimenti pesca
      const options = me.hand
        .filter((c) => game.canPlay(me, c))
        .sort((a, b) => DRAW_VALUE[game.face(a).value] - DRAW_VALUE[game.face(b).value]);
      const pick = level === 'easy' ? options[Math.floor(Math.random() * options.length)] : options[0];
      if (pick && game.stackable(game.face(pick).value)) return playAction(game, me, pick);
      return { type: 'accept' };
    }
  }

  const playable = me.hand.filter((c) => game.canPlay(me, c));
  if (!playable.length) return game.hasDrawn ? { type: 'pass' } : { type: 'draw' };

  let card;
  if (game.hasDrawn) {
    card = playable[0]; // dopo aver pescato si può giocare solo la carta pescata
  } else if (level === 'easy') {
    card = playable[Math.floor(Math.random() * playable.length)];
  } else {
    card = playable.reduce((best, c) => (cardScore(game, me, c, level) > cardScore(game, me, best, level) ? c : best));
  }
  return playAction(game, me, card);
}

function playAction(game, me, card) {
  const action = { type: 'play', cardId: card.id };
  if (game.face(card).color === 'wild') {
    // sceglie il colore di cui ha più carte, senza contare la carta che sta giocando
    const rest = { ...me, hand: me.hand.filter((c) => c.id !== card.id) };
    action.color = rest.hand.length ? game.bestColor(rest) : game.colors()[0];
  }
  // con 2 carte, prima di giocare la penultima, ci si ricorda (forse) di dire UNO
  action.sayUno = me.hand.length === 2;
  return action;
}

// Esegue l'azione sulla partita
function applyAction(game, botId, action, level = 'normal') {
  const L = LEVELS[level] || LEVELS.normal;
  switch (action.type) {
    case 'play':
      if (action.sayUno && Math.random() >= L.forgetUno) game.sayUno(botId);
      return game.play(botId, action.cardId, action.color);
    case 'draw':
      return game.drawCard(botId);
    case 'pass':
      return game.pass(botId);
    case 'color':
      return game.chooseColor(botId, action.color);
    case 'accept':
      return game.accept(botId);
    case 'challenge':
      return game.challenge(botId);
    case 'swap':
      return game.swapHands(botId, action.targetId);
    default:
      return undefined;
  }
}

module.exports = { LEVELS, AFTER_DRAW, BOT_NAMES, pickName, between, chooseAction, applyAction };
