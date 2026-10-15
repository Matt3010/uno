'use strict';

const crypto = require('crypto');
const { Game, GameError, MODES, HOUSE_RULES } = require('./game');
const bots = require('./bot');

const MAX_PLAYERS = 10;
const DISCONNECT_GRACE_MS = 90 * 1000;
const TURN_TIMES = [0, 15, 30, 60]; // secondi per turno (0 = senza timer)
const DEFAULT_TURN_TIME = 30;
// durata di un "secondo" del timer: si può accorciare solo per i test automatici
const MS_PER_SECOND = Number(process.env.TURN_MS_PER_SECOND) || 1000;
// velocità dei computer (solo i test automatici la cambiano)
const BOT_DELAY_SCALE = Number(process.env.BOT_DELAY_SCALE) || 1;

// UNO: stanze, partite e giocatori computer sul namespace principale di Socket.IO
module.exports = function setupUno(io) {
  /** code -> { code, hostId, members: Map<playerId, {id, name, socketId, connected, score, timer}>, game } */
  const rooms = new Map();

  function newRoomCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function cleanName(name) {
    const n = String(name || '').trim().slice(0, 16);
    return n || 'Giocatore';
  }

  // "Firma" del turno: cambia quando tocca a un altro o c'è una nuova decisione da prendere
  function turnKey(g) {
    return [g.current().id, g.pending ? g.pending.type : '', g.hasDrawn, g.discard.length, g.side].join('|');
  }

  function clearTurnTimer(room) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
    room.timerKey = null;
    room.timerDeadline = null;
  }

  // (Ri)avvia il timer del turno quando il turno cambia
  function armTurnTimer(room) {
    const g = room.game;
    if (!g || g.winner || !room.turnTime || !g.players.length) return clearTurnTimer(room);
    const key = turnKey(g);
    if (key === room.timerKey) return;
    clearTimeout(room.timerHandle);
    const ms = room.turnTime * MS_PER_SECOND;
    room.timerKey = key;
    room.timerDeadline = Date.now() + ms;
    room.timerHandle = setTimeout(() => {
      if (room.game !== g || g.winner || turnKey(g) !== key) return;
      try {
        g.autoPlay();
        applyWinner(room);
      } catch (e) {
        console.error(e);
      }
      broadcast(room);
    }, ms);
  }

  // --- Giocatori computer ---
  function clearBotTimers(room) {
    clearTimeout(room.botHandle);
    (room.unoHandles || []).forEach(clearTimeout);
    room.botHandle = null;
    room.botKey = null;
    room.unoHandles = [];
    room.unoKey = null;
  }

  // Fa muovere il computer di turno (una mossa per volta, con i suoi tempi)
  function scheduleBots(room) {
    const g = room.game;
    if (!g || g.winner || !g.players.length) return clearBotTimers(room);
    const cur = room.members.get(g.current().id);
    if (cur && cur.bot) {
      const key = turnKey(g);
      if (key !== room.botKey) {
        room.botKey = key;
        clearTimeout(room.botHandle);
        const L = bots.LEVELS[cur.level];
        const delay = (g.hasDrawn ? bots.between(bots.AFTER_DRAW) : bots.between(L.think)) * BOT_DELAY_SCALE;
        room.botHandle = setTimeout(() => {
          if (room.game !== g || g.winner || turnKey(g) !== key) return;
          try {
            const action = bots.chooseAction(g, cur.id, cur.level);
            if (action) bots.applyAction(g, cur.id, action, cur.level);
          } catch (e) {
            console.error(e);
            try { g.autoPlay(); } catch (e2) { console.error(e2); }
          }
          applyWinner(room);
          broadcast(room);
        }, delay);
      }
    }

    // UNO: un computer distratto può dirlo in ritardo, gli altri computer possono beccare chi non l'ha detto
    const unoKey = g.unoVulnerable ? `${g.unoVulnerable}|${g.discard.length}` : null;
    if (unoKey === room.unoKey) return;
    (room.unoHandles || []).forEach(clearTimeout);
    room.unoHandles = [];
    room.unoKey = unoKey;
    if (!unoKey) return;
    const target = g.unoVulnerable;
    const still = () => room.game === g && !g.winner && g.unoVulnerable === target;
    const tm = room.members.get(target);
    if (tm && tm.bot && Math.random() < bots.LEVELS[tm.level].lateUno) {
      room.unoHandles.push(setTimeout(() => {
        if (!still()) return;
        g.sayUno(target);
        broadcast(room);
      }, bots.between([900, 2600]) * BOT_DELAY_SCALE));
    }
    for (const m of room.members.values()) {
      if (!m.bot || m.id === target || !g.players.some((p) => p.id === m.id)) continue;
      if (Math.random() >= bots.LEVELS[m.level].catchChance) continue;
      room.unoHandles.push(setTimeout(() => {
        if (!still()) return;
        try {
          g.catchUno(m.id, target);
        } catch (e) { /* troppo tardi */ }
        applyWinner(room);
        broadcast(room);
      }, bots.between([800, 2800]) * BOT_DELAY_SCALE));
    }
  }

  function broadcast(room) {
    armTurnTimer(room);
    scheduleBots(room);
    const turnRemaining = room.timerDeadline ? Math.max(0, room.timerDeadline - Date.now()) : null;
    for (const m of room.members.values()) {
      if (!m.connected || !m.socketId) continue;
      let game = null;
      try {
        game = room.game ? room.game.viewFor(m.id) : null;
      } catch (e) {
        console.error(e);
      }
      io.to(m.socketId).emit('state', {
        code: room.code,
        hostId: room.hostId,
        you: m.id,
        members: [...room.members.values()].map((x) => ({
          id: x.id,
          name: x.name,
          connected: x.connected,
          score: x.score,
          bot: !!x.bot,
          level: x.bot ? bots.LEVELS[x.level].name : null,
        })),
        botLevels: Object.fromEntries(Object.entries(bots.LEVELS).map(([k, v]) => [k, v.name])),
        game,
        mode: room.mode,
        modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.name])),
        targetScore: MODES[room.mode].target,
        matchWinner: room.matchWinner,
        houseRules: room.houseRules,
        houseRuleNames: HOUSE_RULES,
        turnTime: room.turnTime,
        turnTimes: TURN_TIMES,
        turnRemaining,
      });
    }
  }

  function removeMember(room, playerId) {
    const m = room.members.get(playerId);
    if (!m) return;
    clearTimeout(m.timer);
    room.members.delete(playerId);
    if (room.game) room.game.removePlayer(playerId);
    const humans = [...room.members.values()].filter((x) => !x.bot);
    if (humans.length === 0) {
      // senza persone vere la stanza si chiude (anche se ci sono computer)
      clearTurnTimer(room);
      clearBotTimers(room);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) {
      const next = humans.find((x) => x.connected) || humans[0];
      room.hostId = next.id;
    }
    broadcast(room);
  }

  function applyWinner(room) {
    const g = room.game;
    if (g && g.winner && !g.scored) {
      g.scored = true;
      const m = room.members.get(g.winner.id);
      if (m) {
        m.score += g.winner.points;
        if (m.score >= MODES[room.mode].target) room.matchWinner = { id: m.id, name: m.name, score: m.score };
      }
    }
  }

  io.on('connection', (socket) => {
    let room = null;
    let playerId = null;

    // ancora dentro la stanza? (chi viene rimosso dall'host o per assenza ne è fuori)
    function inRoom() {
      return !!room && rooms.get(room.code) === room && room.members.has(playerId);
    }

    function attach(r, member) {
      room = r;
      playerId = member.id;
      clearTimeout(member.timer);
      member.socketId = socket.id;
      member.connected = true;
      socket.join(r.code);
      socket.emit('joined', { code: r.code, playerId: member.id });
      broadcast(r);
    }

    function fail(msg) {
      socket.emit('error-msg', msg);
    }

    socket.on('create', ({ name } = {}) => {
      if (inRoom()) return;
      const code = newRoomCode();
      const id = crypto.randomUUID();
      const r = { code, hostId: id, members: new Map(), game: null, dealer: -1, matchWinner: null, mode: 'classic', turnTime: DEFAULT_TURN_TIME };
      r.houseRules = Object.fromEntries(Object.keys(HOUSE_RULES).map((k) => [k, false]));
      r.members.set(id, { id, name: cleanName(name), socketId: null, connected: false, score: 0, timer: null });
      rooms.set(code, r);
      attach(r, r.members.get(id));
    });

    socket.on('join', ({ code, name, playerId: existingId } = {}) => {
      if (inRoom()) return;
      const r = rooms.get(String(code || '').toUpperCase().trim());
      if (!r) return fail('Stanza non trovata');

      // Riconnessione
      if (existingId && r.members.has(existingId)) {
        return attach(r, r.members.get(existingId));
      }
      if (r.game && !r.game.winner) return fail('Partita già in corso, aspetta la fine della mano');
      if (r.members.size >= MAX_PLAYERS) return fail('Stanza piena');
      const id = crypto.randomUUID();
      r.members.set(id, { id, name: cleanName(name), socketId: null, connected: false, score: 0, timer: null });
      attach(r, r.members.get(id));
    });

    socket.on('start', () => {
      if (!room || room.hostId !== playerId) return;
      if (room.game && !room.game.winner) return;
      const players = [...room.members.values()];
      if (players.length < 2) return fail('Servono almeno 2 giocatori');
      if (room.matchWinner) {
        // nuova partita: punteggi azzerati
        room.matchWinner = null;
        for (const m of players) m.score = 0;
      }
      // chi distribuisce ruota a ogni mano
      room.dealer = (room.dealer + 1) % players.length;
      room.game = new Game(players, { dealer: room.dealer, mode: room.mode, rules: room.houseRules });
      broadcast(room);
    });

    // L'host sceglie la modalità tra una mano e l'altra; cambiarla azzera i punteggi
    socket.on('mode', (mode) => {
      if (!room || room.hostId !== playerId || !MODES[mode] || mode === room.mode) return;
      if (room.game && !room.game.winner) return;
      room.mode = mode;
      room.matchWinner = null;
      room.game = null;
      for (const m of room.members.values()) m.score = 0;
      broadcast(room);
    });

    // L'host accende o spegne una regola della casa (vale dalla mano dopo)
    socket.on('rules', ({ key, on } = {}) => {
      if (!room || room.hostId !== playerId || !(key in HOUSE_RULES)) return;
      if (room.game && !room.game.winner) return fail("Le regole si cambiano tra una mano e l'altra");
      room.houseRules = { ...room.houseRules, [key]: !!on };
      broadcast(room);
    });

    // L'host aggiunge un giocatore computer
    socket.on('addBot', ({ level } = {}) => {
      if (!room || room.hostId !== playerId || !bots.LEVELS[level]) return;
      if (room.game && !room.game.winner) return fail('Aspetta la fine della mano per aggiungere computer');
      if (room.members.size >= MAX_PLAYERS) return fail('Stanza piena');
      const id = `bot-${crypto.randomUUID()}`;
      const name = bots.pickName([...room.members.values()].map((m) => m.name));
      room.members.set(id, { id, name, bot: true, level, socketId: null, connected: true, score: 0, timer: null });
      broadcast(room);
    });

    // L'host sceglie quanti secondi ha ciascuno per il proprio turno
    socket.on('timer', (seconds) => {
      if (!room || room.hostId !== playerId || !TURN_TIMES.includes(seconds)) return;
      room.turnTime = seconds;
      clearTurnTimer(room);
      broadcast(room);
    });

    socket.on('lobby', () => {
      if (!room || room.hostId !== playerId) return;
      if (room.game && !room.game.winner) return;
      room.game = null;
      broadcast(room);
    });

    function gameAction(fn) {
      return (data = {}) => {
        if (!room || !room.game) return;
        try {
          fn(room.game, data);
          applyWinner(room);
        } catch (e) {
          if (e instanceof GameError) return fail(e.message);
          console.error(e);
          return fail('Errore interno');
        }
        broadcast(room);
      };
    }

    socket.on('play', gameAction((g, { cardId, color }) => g.play(playerId, cardId, color)));
    socket.on('draw', gameAction((g) => g.drawCard(playerId)));
    socket.on('pass', gameAction((g) => g.pass(playerId)));
    socket.on('color', gameAction((g, { color }) => g.chooseColor(playerId, color)));
    socket.on('accept', gameAction((g) => g.accept(playerId)));
    socket.on('challenge', gameAction((g) => g.challenge(playerId)));
    socket.on('swap', gameAction((g, { targetId }) => g.swapHands(playerId, targetId)));
    socket.on('uno', gameAction((g) => g.sayUno(playerId)));
    socket.on('catch', gameAction((g, { targetId }) => g.catchUno(playerId, targetId)));

    socket.on('kick', ({ targetId } = {}) => {
      if (!room || room.hostId !== playerId || targetId === playerId) return;
      const m = room.members.get(targetId);
      if (!m) return;
      if (m.socketId) io.to(m.socketId).emit('kicked');
      const r = room;
      removeMember(r, targetId);
      applyWinner(r);
      if (rooms.has(r.code)) broadcast(r);
    });

    socket.on('leave', () => {
      if (!room) return;
      const r = room;
      socket.leave(r.code);
      removeMember(r, playerId);
      applyWinner(r);
      if (rooms.has(r.code)) broadcast(r);
      room = null;
      playerId = null;
    });

    socket.on('disconnect', () => {
      if (!room) return;
      const r = room;
      const m = r.members.get(playerId);
      if (!m || m.socketId !== socket.id) return;
      m.connected = false;
      m.socketId = null;
      const id = playerId;
      m.timer = setTimeout(() => {
        removeMember(r, id);
        applyWinner(r);
        if (rooms.has(r.code)) broadcast(r);
      }, DISCONNECT_GRACE_MS);
      broadcast(r);
    });
  });
};
