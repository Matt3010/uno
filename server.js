'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const DISCONNECT_GRACE_MS = 90 * 1000;
const TARGET_SCORE = 500; // regola ufficiale: vince la partita chi arriva a 500 punti

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

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

function broadcast(room) {
  for (const m of room.members.values()) {
    if (!m.connected || !m.socketId) continue;
    io.to(m.socketId).emit('state', {
      code: room.code,
      hostId: room.hostId,
      you: m.id,
      members: [...room.members.values()].map((x) => ({
        id: x.id,
        name: x.name,
        connected: x.connected,
        score: x.score,
      })),
      game: room.game ? room.game.viewFor(m.id) : null,
      targetScore: TARGET_SCORE,
      matchWinner: room.matchWinner,
    });
  }
}

function removeMember(room, playerId) {
  const m = room.members.get(playerId);
  if (!m) return;
  clearTimeout(m.timer);
  room.members.delete(playerId);
  if (room.game) room.game.removePlayer(playerId);
  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === playerId) {
    const next = [...room.members.values()].find((x) => x.connected) || room.members.values().next().value;
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
      if (m.score >= TARGET_SCORE) room.matchWinner = { id: m.id, name: m.name, score: m.score };
    }
  }
}

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

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
    if (room) return;
    const code = newRoomCode();
    const id = crypto.randomUUID();
    const r = { code, hostId: id, members: new Map(), game: null, dealer: -1, matchWinner: null };
    r.members.set(id, { id, name: cleanName(name), socketId: null, connected: false, score: 0, timer: null });
    rooms.set(code, r);
    attach(r, r.members.get(id));
  });

  socket.on('join', ({ code, name, playerId: existingId } = {}) => {
    if (room) return;
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
    room.game = new Game(players, { dealer: room.dealer });
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
  socket.on('accept4', gameAction((g) => g.acceptWild4(playerId)));
  socket.on('challenge4', gameAction((g) => g.challengeWild4(playerId)));
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

  socket.on('chat', (text) => {
    if (!room) return;
    const msg = String(text || '').trim().slice(0, 200);
    if (!msg) return;
    const m = room.members.get(playerId);
    io.to(room.code).emit('chat', { name: m ? m.name : '?', text: msg });
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

server.listen(PORT, () => {
  console.log(`UNO online su http://localhost:${PORT}`);
});
