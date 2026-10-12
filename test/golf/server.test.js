'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const once = (sock, ev) => new Promise((res) => sock.once(ev, res));
const waitState = (sock, pred) => new Promise((res) => {
  const h = (s) => { if (pred(s)) { sock.off('state', h); res(s); } };
  sock.on('state', h);
});

async function start(t, env = {}) {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, PORT: 0, ...env } });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  return `http://localhost:${line.match(/:(\d+)/)[1]}/golf`;
}

test('golf: stanza, partenza, colpi condivisi, buca dopo', { timeout: 20000 }, async (t) => {
  const url = await start(t, { GOLF_BETWEEN_MS: 50 });
  const a = io(url, { transports: ['websocket'] });
  const b = io(url, { transports: ['websocket'] });
  t.after(() => { a.close(); b.close(); });

  a.emit('create', { name: 'Anna' });
  const { code } = await once(a, 'joined');
  const lobby = waitState(a, (s) => s.members.length === 2);
  b.emit('join', { code, name: 'Bruno' });
  await once(b, 'joined');
  const { members } = await lobby;
  const bruno = members.find((m) => m.name === 'Bruno').id;
  const anna = members.find((m) => m.name === 'Anna').id;

  const playing = waitState(b, (s) => s.phase === 'playing');
  a.emit('start');
  const s1 = await playing;
  assert.strictEqual(s1.holeIndex, 0);
  assert.ok(Number.isInteger(s1.seed));

  // il colpo di Anna arriva a Bruno, così lo vede partire
  const seen = once(b, 'shot');
  a.emit('shot', { angle: 1, power: 0.5, t0: 2 });
  const shot = await seen;
  assert.deepStrictEqual({ id: shot.id, angle: shot.angle, power: shot.power, t0: shot.t0 }, { id: anna, angle: 1, power: 0.5, t0: 2 });

  a.emit('result', { event: 'sunk', x: 1, z: 1 });
  await waitState(b, (s) => s.done[anna] && s.strokes[anna][0] === 1);
  b.emit('shot', { angle: 0, power: 0.2, t0: 3 });
  b.emit('result', { event: 'sunk', x: 1, z: 1 });
  const next = await waitState(a, (s) => s.holeIndex === 1 && s.phase === 'playing');
  assert.deepStrictEqual(next.strokes[bruno], [1, 0]);

  // a partita iniziata non si entra
  const c = io(url, { transports: ['websocket'] });
  t.after(() => c.close());
  c.emit('join', { code, name: 'Carla' });
  assert.match(await once(c, 'error-msg'), /in corso/);
});

test('golf: cadere nel vuoto costa un colpo come l’acqua', { timeout: 20000 }, async (t) => {
  const url = await start(t);
  const a = io(url, { transports: ['websocket'] });
  t.after(() => a.close());
  a.emit('create', { name: 'Anna' });
  await once(a, 'joined');
  const playing = waitState(a, (s) => s.phase === 'playing');
  a.emit('start');
  const s = await playing;
  a.emit('shot', { angle: 0, power: 1, t0: 1 });
  a.emit('result', { event: 'out' });
  const after = await waitState(a, (x) => x.strokes[s.you][0] === 2);
  assert.deepStrictEqual(after.pos[s.you], s.pos[s.you], 'si riparte da dove si era tirato');
});
