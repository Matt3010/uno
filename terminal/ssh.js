'use strict';

// Server SSH: chi si collega con  ssh -p 2222 nome@indirizzo  si ritrova direttamente nel gioco,
// senza installare niente. Il nome usato per collegarsi diventa il nome nel gioco.
// Non dà accesso a nessuna shell: l'unica cosa che si può fare è giocare a UNO.

const fs = require('fs');
const path = require('path');
const { Server, utils } = require('ssh2');
const { startTui } = require('./tui');

// chiave del server: si crea al primo avvio e si riusa (così i client non vedono avvisi di chiave cambiata)
function hostKey(file) {
  if (process.env.SSH_HOST_KEY) return process.env.SSH_HOST_KEY;
  if (!fs.existsSync(file)) {
    const { private: key } = utils.generateKeyPairSync('ed25519');
    fs.writeFileSync(file, key, { mode: 0o600 });
  }
  return fs.readFileSync(file);
}

/**
 * Avvia il server SSH.
 * opts: { port, gameServer (es. http://localhost:3000), keyFile }
 */
function startSshServer({ port = 2222, gameServer = 'http://localhost:3000', keyFile } = {}) {
  const key = hostKey(keyFile || path.join(__dirname, '..', 'ssh_host_key'));
  const server = new Server({ hostKeys: [key] }, (client) => {
    let username = '';
    client.on('authentication', (ctx) => {
      // gioco aperto a tutti: si entra senza password
      username = ctx.username || '';
      ctx.accept();
    });
    client.on('error', () => {});
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        const term = { cols: 80, rows: 24 };
        let tui = null;
        session.on('pty', (acc, _rej, info) => {
          term.cols = info.cols || 80;
          term.rows = info.rows || 24;
          if (acc) acc();
        });
        session.on('window-change', (acc, _rej, info) => {
          term.cols = info.cols || term.cols;
          term.rows = info.rows || term.rows;
          if (acc) acc();
          if (tui) tui.render();
        });
        session.on('exec', (_acc, reject) => reject && reject()); // niente comandi
        session.on('shell', (acc) => {
          const stream = acc();
          // un nome valido preso dall'utente SSH (es. ssh mario@...), altrimenti lo chiede
          const name = /^[\p{L}\p{N} _.-]{1,16}$/u.test(username) && !['root', 'uno', 'guest', 'ospite'].includes(username)
            ? username
            : undefined;
          tui = startTui({
            input: stream,
            output: stream,
            server: gameServer,
            name,
            size: () => term,
            onExit: () => {
              stream.exit(0);
              stream.end();
            },
          });
          stream.on('close', () => tui.quit());
        });
      });
    });
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`UNO via SSH: ssh -p ${server.address().port} nome@<indirizzo>`);
  });
  return server;
}

module.exports = { startSshServer };

// avviato da solo:  npm run ssh  (con il server del gioco già acceso)
if (require.main === module) {
  startSshServer({
    port: Number(process.env.SSH_PORT) || 2222,
    gameServer: process.env.UNO_SERVER || 'http://localhost:3000',
  });
}
