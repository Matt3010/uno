'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

async function startServer(t) {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: 0 } });
  t.after(() => srv.kill());
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  return `http://localhost:${line.match(/:(\d+)/)[1]}`;
}

test('la pagina iniziale fa scegliere tra UNO e Golf', async (t) => {
  const url = await startServer(t);
  const html = await (await fetch(`${url}/`)).text();
  assert.match(html, /href="\/uno\/"/);
  assert.match(html, /href="\/golf\/"/);
  assert.strictEqual((await fetch(`${url}/uno/`)).status, 200);
});

test('i vecchi link di UNO con la stanza portano ancora alla stanza', async (t) => {
  const url = await startServer(t);
  const res = await fetch(`${url}/?room=HDNU`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/uno/?room=HDNU');
});
