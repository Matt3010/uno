'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { Client } = require('ssh2');
const { io } = require('socket.io-client');
const { parseKeys } = require('../../terminal/tui');

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

test('i tasti del terminale vengono riconosciuti', () => {
  assert.deepStrictEqual(parseKeys(Buffer.from('\x1b[D\x1b[Cab\r\x7f\x03')), ['left', 'right', 'a', 'b', 'enter', 'backspace', 'ctrl-c']);
  assert.deepStrictEqual(parseKeys(Buffer.from('\x1bOA')), ['up']);
});

// Avvia il server con SSH e restituisce le due porte
async function startServer(t) {
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-ssh-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: 0, SSH_PORT: 0, BOT_DELAY_SCALE: 0.05, SSH_HOST_KEY: '' },
    cwd: keyDir,
  });
  t.after(() => srv.kill());
  let out = '';
  await new Promise((res) => srv.stdout.on('data', (d) => { out += d; if (/ssh -p \d+/.test(out)) res(); }));
  return { http: out.match(/localhost:(\d+)/)[1], ssh: out.match(/ssh -p (\d+)/)[1] };
}

// Collegamento SSH con un terminale finto: raccoglie lo schermo e permette di premere tasti
function sshPlayer(port, username) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 110, rows: 40 }, (err, stream) => {
        if (err) return reject(err);
        const player = {
          screen: '',
          conn,
          press: (keys) => stream.write(keys),
          waitFor: (re, ms = 15000) => new Promise((res, rej) => {
            const t0 = Date.now();
            const tick = setInterval(() => {
              // l'ultima schermata disegnata (ogni ridisegno inizia pulendo lo schermo)
              const last = strip(player.screen.split('\x1b[2J').pop());
              if (re.test(last)) { clearInterval(tick); res(last); }
              else if (Date.now() - t0 > ms) { clearInterval(tick); rej(new Error(`non trovato ${re}:\n${last}`)); }
            }, 50);
          }),
        };
        stream.on('data', (d) => { player.screen += d.toString('utf8'); });
        resolve(player);
      });
    });
    conn.on('error', reject);
    conn.connect({ host: '127.0.0.1', port: Number(port), username, password: '', tryKeyboard: false });
  });
}

test('via SSH si crea una stanza, si gioca con un computer e chi usa il browser entra nella stessa stanza', async (t) => {
  const ports = await startServer(t);
  const mario = await sshPlayer(ports.ssh, 'mario');
  t.after(() => mario.conn.end());

  // il nome arriva da "ssh mario@..."
  await mario.waitFor(/Ciao mario!/);
  mario.press('c');
  const lobby = await mario.waitFor(/Stanza\s+([A-Z]{4})/);
  const code = lobby.match(/Stanza\s+([A-Z]{4})/)[1];

  // un amico entra dal browser (stesso server, stessa stanza)
  const web = io(`http://localhost:${ports.http}`, { transports: ['websocket'] });
  t.after(() => web.close());
  web.emit('join', { code, name: 'Giulia' });
  await mario.waitFor(/Giulia/);

  mario.press('b'); // un computer normale
  await mario.waitFor(/computer Normale/);
  mario.press('s');
  await mario.waitFor(/La tua mano/);

  // si gioca: quando tocca a mario pesca con P
  await mario.waitFor(/È IL TUO TURNO/, 30000).catch(() => null);
  const before = await mario.waitFor(/La tua mano \((\d+)\)/);
  if (/È IL TUO TURNO/.test(before)) {
    mario.press('p');
    await mario.waitFor(/mario pesca/);
  }

  // Q due volte: si esce dal gioco e la connessione si chiude
  mario.press('q');
  mario.press('q');
  await mario.waitFor(/Grazie per aver giocato/);
});
