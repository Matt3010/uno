#!/usr/bin/env node
'use strict';

// Gioca a UNO dal tuo terminale.
//   npm run terminale -- --nome Mario --stanza ABCD
// Senza --server si collega al sito ufficiale (https://uno.scanferlamatteo.work) e chiede nome e stanza.
// Per provarlo in locale:  npm run terminale -- --server http://localhost:3000

const { startTui } = require('./tui');

function arg(names) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    for (const n of names) {
      if (argv[i] === n) return argv[i + 1];
      if (argv[i].startsWith(`${n}=`)) return argv[i].slice(n.length + 1);
    }
  }
  return undefined;
}

const DEFAULT_SERVER = 'https://uno.scanferlamatteo.work';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`UNO da terminale

  npm run terminale -- [--server URL] [--nome NOME] [--stanza CODICE]

  --server   indirizzo del sito UNO (predefinito: ${DEFAULT_SERVER})
  --nome     il tuo nome (altrimenti te lo chiede)
  --stanza   codice di 4 lettere per entrare subito in una stanza`);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error('Avvia il gioco da un terminale vero (serve la tastiera).');
  process.exit(1);
}

const server = arg(['--server', '-s']) || process.env.UNO_SERVER || DEFAULT_SERVER;
const room = arg(['--stanza', '--room', '-r']);
const name = arg(['--nome', '--name', '-n']);

process.stdin.setRawMode(true);
process.stdin.resume();

const tui = startTui({
  input: process.stdin,
  output: process.stdout,
  server,
  name,
  room: room && room.toUpperCase(),
  size: () => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }),
  onExit: () => {
    process.stdin.setRawMode(false);
    process.exit(0);
  },
});

process.stdout.on('resize', () => tui.render());
