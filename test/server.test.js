'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 3999;

function once(sock, ev) {
  return new Promise((res) => sock.once(ev, res));
}

function waitState(sock, pred) {
  return new Promise((res) => {
    const h = (s) => { if (pred(s)) { sock.off('state', h); res(s); } };
    sock.on('state', h);
  });
}

test('due giocatori creano, entrano e giocano', async (t) => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT } });
  t.after(() => srv.kill());
  await new Promise((res) => srv.stdout.once('data', res));

  const url = `http://localhost:${PORT}`;
  const a = io(url, { transports: ['websocket'] });
  const b = io(url, { transports: ['websocket'] });
  t.after(() => { a.close(); b.close(); });

  a.emit('create', { name: 'Anna' });
  const { code } = await once(a, 'joined');
  const lobbyP = waitState(a, (s) => s.members.length === 2);
  b.emit('join', { code, name: 'Bruno' });
  await once(b, 'joined');
  const lobby = await lobbyP;
  assert.strictEqual(lobby.members.length, 2);

  const sa = waitState(a, (s) => s.game);
  const sb = waitState(b, (s) => s.game);
  a.emit('start');
  const [stA, stB] = await Promise.all([sa, sb]);
  assert.strictEqual(stA.game.hand.length, 7);
  assert.strictEqual(stB.game.players.length, 2);
  // le carte avversarie non sono visibili
  assert.ok(!('hand' in stB.game.players[0]));

  const turnSock = stA.game.turnId === stA.you ? a : b;
  const st = turnSock === a ? stA : stB;
  const playable = st.game.hand.find((c) => c.playable);
  const next = once(turnSock, 'state');
  if (playable) turnSock.emit('play', { cardId: playable.id, color: 'red' });
  else turnSock.emit('draw');
  const after = await next;
  assert.notDeepStrictEqual(after.game.hand, st.game.hand);
});
