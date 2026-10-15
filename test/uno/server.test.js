'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

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
  // porta 0: il sistema ne sceglie una libera, che il server stampa all'avvio
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, PORT: 0 } });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const port = line.match(/:(\d+)/)[1];

  const url = `http://localhost:${port}`;
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

test('Timer: allo scadere il gioco fa la mossa al posto del giocatore', async (t) => {
  // 1 "secondo" = 20 ms: un turno da 15 s dura 300 ms
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: 0, TURN_MS_PER_SECOND: 20 },
  });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const url = `http://localhost:${line.match(/:(\d+)/)[1]}`;
  const a = io(url, { transports: ['websocket'] });
  const b = io(url, { transports: ['websocket'] });
  t.after(() => { a.close(); b.close(); });

  a.emit('create', { name: 'Anna' });
  const { code } = await once(a, 'joined');
  const joined = waitState(a, (s) => s.members.length === 2);
  b.emit('join', { code, name: 'Bruno' });
  await joined;
  assert.strictEqual((await joined).turnTime, 30, 'timer di 30 s di partenza');
  const set = waitState(a, (s) => s.turnTime === 15);
  a.emit('timer', 15);
  await set;
  const started = waitState(a, (s) => s.game);
  a.emit('start');
  const first = (await started).game;
  assert.ok((await started).turnRemaining > 0);
  // nessuno gioca: dopo poco il turno passa da solo con "Tempo scaduto"
  const after = await waitState(a, (s) => s.game && s.game.log.some((l) => l.startsWith('⏱')));
  const who = first.players.find((p) => p.id === first.turnId).name;
  assert.ok(after.game.log.includes(`⏱ Tempo scaduto per ${who}`));
});

test('Computer: si aggiungono dalla sala d\'attesa e giocano una mano intera', async (t) => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: 0, TURN_MS_PER_SECOND: 20, BOT_DELAY_SCALE: 0.01 },
  });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const url = `http://localhost:${line.match(/:(\d+)/)[1]}`;
  const a = io(url, { transports: ['websocket'] });
  t.after(() => a.close());

  a.emit('create', { name: 'Anna' });
  await once(a, 'joined');
  const withBots = waitState(a, (s) => s.members.length === 3);
  a.emit('addBot', { level: 'normal' });
  a.emit('addBot', { level: 'hard' });
  const lobby = await withBots;
  const botsIn = lobby.members.filter((m) => m.bot);
  assert.strictEqual(botsIn.length, 2);
  assert.ok(botsIn.every((m) => m.name && m.name !== 'Anna'));
  assert.deepStrictEqual(botsIn.map((m) => m.level).sort(), ['Difficile', 'Normale']);

  // Anna non tocca niente: col timer brevissimo muove il gioco per lei, i computer giocano da soli
  const timer = waitState(a, (s) => s.turnTime === 15);
  a.emit('timer', 15);
  await timer;
  a.emit('start');
  const end = await waitState(a, (s) => s.game && s.game.winner);
  assert.ok(end.game.winner.name);
  assert.ok(end.game.log.some((l) => botsIn.some((b) => l.startsWith(`${b.name} gioca`))));
});

test('chi viene rimosso dalla stanza può crearne una nuova', async (t) => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, PORT: 0 } });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const url = `http://localhost:${line.match(/:(\d+)/)[1]}`;
  const a = io(url, { transports: ['websocket'] });
  const b = io(url, { transports: ['websocket'] });
  t.after(() => { a.close(); b.close(); });

  a.emit('create', { name: 'Anna' });
  const { code } = await once(a, 'joined');
  const both = waitState(a, (s) => s.members.length === 2);
  b.emit('join', { code, name: 'Bruno' });
  const { playerId: bruno } = await once(b, 'joined');
  await both;
  const kicked = once(b, 'kicked');
  a.emit('kick', { targetId: bruno });
  await kicked;

  b.emit('create', { name: 'Bruno' });
  const joined = await Promise.race([once(b, 'joined'), new Promise((res) => setTimeout(() => res(null), 1500))]);
  assert.ok(joined, 'nessuna nuova stanza creata');
  assert.notStrictEqual(joined.code, code);
});

test('l\'host accende le regole della casa e valgono nella mano', async (t) => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, PORT: 0 } });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const url = `http://localhost:${line.match(/:(\d+)/)[1]}`;
  const a = io(url, { transports: ['websocket'] });
  const b = io(url, { transports: ['websocket'] });
  t.after(() => { a.close(); b.close(); });

  a.emit('create', { name: 'Anna' });
  const { code } = await once(a, 'joined');
  const first = await waitState(a, () => true);
  assert.deepStrictEqual(first.houseRules, { stack: false, sevenZero: false, drawUntil: false });
  assert.ok(first.houseRuleNames.stack);

  const both = waitState(a, (s) => s.members.length === 2);
  b.emit('join', { code, name: 'Bruno' });
  await once(b, 'joined');
  await both;
  // solo l'host può cambiarle
  b.emit('rules', { key: 'drawUntil', on: true });
  const on = waitState(a, (s) => s.houseRules.stack);
  a.emit('rules', { key: 'stack', on: true });
  const st = await on;
  assert.strictEqual(st.houseRules.drawUntil, false);

  const started = waitState(a, (s) => s.game);
  a.emit('start');
  const g = await started;
  assert.deepStrictEqual(g.game.rules, { stack: true, sevenZero: false, drawUntil: false });
});
