'use strict';
// Golf: stanze e partite sul namespace /golf di Socket.IO.
// Ogni browser simula da sé la propria pallina; il server conta i colpi e tiene il passo delle buche.
const crypto = require('crypto');
const { GolfMatch, GolfError, MAX_STROKES } = require('./match');

const MAX_PLAYERS = 8;
const DISCONNECT_GRACE_MS = 60 * 1000;
const HOLE_SECONDS = Number(process.env.GOLF_HOLE_SECONDS) || 150;
const BETWEEN_MS = Number(process.env.GOLF_BETWEEN_MS) || 6000;
const HOLE_CHOICES = [9, 18];
const COLORS = ['#ffffff', '#ff5a4e', '#4ea3ff', '#ffd23f', '#5ee07a', '#c77dff', '#ff9f43', '#3ee6d6'];

module.exports = function setupGolf(nsp) {
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
    return String(name || '').trim().slice(0, 16) || 'Giocatore';
  }

  function freeColor(room) {
    const used = new Set([...room.members.values()].map((m) => m.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[room.members.size % COLORS.length];
  }

  function broadcast(room) {
    const m = room.match;
    const now = Date.now();
    for (const member of room.members.values()) {
      if (!member.connected || !member.socketId) continue;
      nsp.to(member.socketId).emit('state', {
        code: room.code,
        hostId: room.hostId,
        you: member.id,
        members: [...room.members.values()].map((x) => ({ id: x.id, name: x.name, connected: x.connected, color: x.color })),
        phase: room.phase,
        holes: room.holes,
        holeChoices: HOLE_CHOICES,
        seed: m ? m.seed : null,
        holeIndex: m ? m.holeIndex : 0,
        holeCount: m ? m.course.length : 0,
        strokes: m ? m.strokes : {},
        done: m ? m.done : {},
        pos: room.pos,
        totals: m ? m.totals() : {},
        ranking: m && m.over ? m.ranking() : null,
        maxStrokes: MAX_STROKES,
        holeElapsed: room.holeStartedAt ? (now - room.holeStartedAt) / 1000 : 0,
        holeRemaining: room.holeEndsAt ? Math.max(0, (room.holeEndsAt - now) / 1000) : null,
      });
    }
  }

  function clearTimers(room) {
    clearTimeout(room.holeTimer);
    clearTimeout(room.betweenTimer);
  }

  function startHole(room) {
    const m = room.match;
    room.phase = 'playing';
    room.pos = {};
    for (const p of m.players) room.pos[p.id] = [...m.hole.start];
    room.holeStartedAt = Date.now();
    room.holeEndsAt = room.holeStartedAt + HOLE_SECONDS * 1000;
    clearTimers(room);
    room.holeTimer = setTimeout(() => {
      m.timeUp();
      endHole(room);
    }, HOLE_SECONDS * 1000);
    broadcast(room);
  }

  function endHole(room) {
    clearTimers(room);
    room.phase = 'between';
    room.holeEndsAt = null;
    broadcast(room);
    room.betweenTimer = setTimeout(() => {
      room.match.nextHole();
      if (room.match.over) {
        room.phase = 'over';
        room.holeStartedAt = null;
        broadcast(room);
      } else {
        startHole(room);
      }
    }, BETWEEN_MS);
  }

  function checkHoleOver(room) {
    if (room.phase === 'playing' && room.match.holeOver()) endHole(room);
  }

  function removeMember(room, id) {
    const m = room.members.get(id);
    if (!m) return;
    clearTimeout(m.timer);
    room.members.delete(id);
    if (room.match) room.match.removePlayer(id);
    if (room.members.size === 0) {
      clearTimers(room);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === id) {
      const next = [...room.members.values()].find((x) => x.connected) || room.members.values().next().value;
      room.hostId = next.id;
    }
    if (room.match) checkHoleOver(room);
    broadcast(room);
  }

  nsp.on('connection', (socket) => {
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

    const fail = (msg) => socket.emit('error-msg', msg);

    function addMember(r, name) {
      const id = crypto.randomUUID();
      r.members.set(id, { id, name: cleanName(name), color: freeColor(r), socketId: null, connected: false, timer: null });
      return r.members.get(id);
    }

    socket.on('create', ({ name } = {}) => {
      if (room) return;
      const r = { code: newRoomCode(), hostId: null, members: new Map(), phase: 'lobby', match: null, pos: {}, holes: HOLE_CHOICES[0] };
      const m = addMember(r, name);
      r.hostId = m.id;
      rooms.set(r.code, r);
      attach(r, m);
    });

    socket.on('join', ({ code, name, playerId: existingId } = {}) => {
      if (room) return;
      const r = rooms.get(String(code || '').toUpperCase().trim());
      if (!r) return fail('Stanza non trovata');
      if (existingId && r.members.has(existingId)) return attach(r, r.members.get(existingId));
      if (r.phase === 'playing' || r.phase === 'between') return fail('Partita in corso, aspetta che finisca');
      if (r.members.size >= MAX_PLAYERS) return fail('Stanza piena');
      attach(r, addMember(r, name));
    });

    socket.on('start', () => {
      if (!room || room.hostId !== playerId) return;
      if (room.phase === 'playing' || room.phase === 'between') return;
      const players = [...room.members.values()];
      room.match = new GolfMatch(players, { seed: crypto.randomInt(1, 2 ** 31 - 1), holes: room.holes });
      startHole(room);
    });

    // quante buche: si sceglie prima di iniziare
    socket.on('holes', (n) => {
      if (!room || room.hostId !== playerId || !HOLE_CHOICES.includes(n)) return;
      if (room.phase === 'playing' || room.phase === 'between') return;
      room.holes = n;
      broadcast(room);
    });

    // azione di gioco: gli errori (colpo non valido...) tornano solo a chi l'ha fatta
    function act(fn) {
      return (data = {}) => {
        if (!room || !room.match || room.phase !== 'playing') return;
        try {
          fn(data);
        } catch (e) {
          if (e instanceof GolfError) return fail(e.message);
          throw e;
        }
      };
    }

    socket.on('shot', act(({ angle, power, t0 }) => {
      if (![angle, power, t0].every(Number.isFinite)) return;
      room.match.shot(playerId);
      const from = room.pos[playerId];
      socket.to(room.code).emit('shot', { id: playerId, angle, power: Math.max(0, Math.min(1, power)), t0, from });
      broadcast(room);
    }));

    socket.on('result', act(({ event, x, z }) => {
      const m = room.match;
      if (event === 'sunk') {
        m.sunk(playerId);
        room.pos[playerId] = [...m.hole.cup];
      } else if (event === 'water' || event === 'out') {
        m.water(playerId); // acqua o vuoto: un colpo in più e si riparte da dove si era tirato
      } else if (event === 'rest' && Number.isFinite(x) && Number.isFinite(z)) {
        room.pos[playerId] = [x, z];
        m.rest(playerId);
      } else {
        return;
      }
      broadcast(room);
      checkHoleOver(room);
    }));

    socket.on('disconnect', () => {
      if (!room) return;
      const r = room;
      const m = r.members.get(playerId);
      if (!m || m.socketId !== socket.id) return;
      m.connected = false;
      m.socketId = null;
      const id = playerId;
      m.timer = setTimeout(() => removeMember(r, id), DISCONNECT_GRACE_MS);
      broadcast(r);
    });
  });
};
