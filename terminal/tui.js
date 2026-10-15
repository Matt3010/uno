'use strict';

// UNO da terminale: si collega allo stesso server del sito (stesse stanze dei giocatori nel browser).
// Funziona su qualsiasi coppia di stream: il terminale locale oppure una sessione SSH.

const { io } = require('socket.io-client');

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const INVERSE = `${ESC}7m`;

// colori di sfondo (256 colori) e colore del testo leggibile sopra
const PALETTE = {
  red: [160, 231], yellow: [220, 16], green: [34, 231], blue: [27, 231],
  pink: [205, 16], teal: [37, 16], orange: [208, 16], purple: [93, 231],
  wild: [16, 231],
};
const COLOR_NAMES = {
  red: 'rosso', yellow: 'giallo', green: 'verde', blue: 'blu',
  pink: 'rosa', teal: 'azzurro', orange: 'arancione', purple: 'viola',
};
const SYMBOLS = {
  skip: '⊘', reverse: '⇄', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: '⊘⊘', flip: 'FLIP', discardall: '⇊',
  wild: '★', wild4: '★+4', wild2: '★+2', wildcolor: '★+?',
  wildrev4: '⇄+4', wild6: '★+6', wild10: '★+10', roulette: '★?',
};
const CARD_NAMES = {
  skip: 'Salta', reverse: 'Inverti', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: 'Salta tutti', flip: 'Flip', discardall: 'Scarta tutto', wild: 'Jolly', wild4: 'Jolly +4',
  wild2: 'Jolly +2', wildcolor: 'Jolly pesca colore', wildrev4: 'Jolly inverti +4', wild6: 'Jolly +6',
  wild10: 'Jolly +10', roulette: 'Roulette dei colori',
};
const LEVEL_KEYS = { f: 'easy', b: 'normal', d: 'hard' };

function paint(color, text) {
  const [bg, fg] = PALETTE[color] || PALETTE.wild;
  return `${ESC}48;5;${bg}m${ESC}38;5;${fg}m${text}${RESET}`;
}

function fg(color, text) {
  const [c] = PALETTE[color] || [250];
  return `${ESC}38;5;${c}m${text}${RESET}`;
}

function cardLabel(c) {
  return SYMBOLS[c.value] || c.value;
}

function cardText(c, width = 5) {
  const label = cardLabel(c);
  const left = Math.max(0, Math.floor((width - [...label].length) / 2));
  return ' '.repeat(left) + label + ' '.repeat(Math.max(0, width - left - [...label].length));
}

function describe(c) {
  const v = CARD_NAMES[c.value] || c.value;
  return c.color === 'wild' ? v : `${v} ${COLOR_NAMES[c.color] || ''}`;
}

// Tasti: frecce, invio, backspace, ctrl-c, esc e caratteri normali
function parseKeys(data) {
  const s = data.toString('utf8');
  const keys = [];
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    const arrow = /^\x1b(?:\[|O)([ABCD])/.exec(rest);
    if (arrow) {
      keys.push({ A: 'up', B: 'down', C: 'right', D: 'left' }[arrow[1]]);
      i += arrow[0].length;
      continue;
    }
    const ch = rest.codePointAt(0);
    const char = String.fromCodePoint(ch);
    i += char.length;
    if (char === '\x03') keys.push('ctrl-c');
    else if (char === '\r' || char === '\n') keys.push('enter');
    else if (char === '\x7f' || char === '\b') keys.push('backspace');
    else if (char === '\x1b') keys.push('esc');
    else if (ch >= 32) keys.push(char);
  }
  return keys;
}

/**
 * Avvia l'interfaccia.
 * opts: { input, output, server, name, room, size: () => ({ cols, rows }), onExit }
 */
function startTui(opts) {
  const { input, output, server } = opts;
  const size = opts.size || (() => ({ cols: 80, rows: 24 }));
  const ui = {
    phase: opts.name ? (opts.room ? 'connecting' : 'menu') : 'name',
    text: '',
    name: opts.name || '',
    sel: 0,
    picking: null, // { cardId } mentre si sceglie il colore di un Jolly
    message: null,
    confirmQuit: false,
    sent: false, // richiesta di creare/entrare già inviata
    joined: null, // { code, playerId } per rientrare se cade la connessione
  };
  let state = null;
  let deadline = null;
  let closed = false;

  const socket = io(server, { transports: ['websocket'], reconnectionAttempts: 5 });

  function write(s) {
    if (!closed) output.write(s);
  }

  function flash(text) {
    ui.message = { text, until: Date.now() + 3500 };
    render();
  }

  function quit() {
    if (closed) return;
    if (state) socket.emit('leave');
    write(`${ESC}?25h${RESET}${ESC}2J${ESC}H`);
    write('Ciao! Grazie per aver giocato a UNO.\r\n');
    closed = true;
    clearInterval(ticker);
    socket.close();
    input.removeListener('data', onData);
    if (opts.onExit) opts.onExit();
  }

  socket.on('connect', () => {
    if (ui.joined) {
      // la connessione era caduta: si torna al proprio posto
      socket.emit('join', { ...ui.joined, name: ui.name });
    } else if (ui.phase === 'connecting' && !ui.sent && opts.room) {
      ui.sent = true;
      socket.emit('join', { code: opts.room, name: ui.name });
    }
  });
  socket.on('joined', ({ code, playerId }) => {
    ui.joined = { code, playerId };
  });
  socket.on('connect_error', () => flash(`Non riesco a collegarmi a ${server}`));
  socket.on('error-msg', (msg) => {
    if (ui.phase === 'connecting' && !state) {
      ui.phase = 'menu';
      ui.sent = false;
    }
    flash(msg);
  });
  socket.on('kicked', () => {
    state = null;
    ui.joined = null;
    ui.sent = false;
    ui.phase = 'menu';
    flash("Sei stato rimosso dalla stanza");
  });
  socket.on('state', (s) => {
    state = s;
    ui.phase = 'room';
    deadline = s.turnRemaining != null ? Date.now() + s.turnRemaining : null;
    const hand = s.game ? s.game.hand : [];
    if (ui.sel >= hand.length) ui.sel = Math.max(0, hand.length - 1);
    if (ui.picking && !(s.game && s.game.turnId === s.you)) ui.picking = null;
    render();
  });

  // aggiorna il conto alla rovescia e i messaggi che scadono
  const ticker = setInterval(() => {
    if (deadline || (ui.message && ui.message.until < Date.now())) {
      if (ui.message && ui.message.until < Date.now()) ui.message = null;
      render();
    }
  }, 1000);

  // --- tasti ---
  function onData(data) {
    for (const key of parseKeys(data)) {
      if (closed) return;
      if (key === 'ctrl-c') return quit();
      handleKey(key);
    }
    render();
  }
  input.on('data', onData);

  function textInput(key, maxLen, onDone) {
    if (key === 'enter') return onDone(ui.text.trim());
    if (key === 'backspace') ui.text = ui.text.slice(0, -1);
    else if (key === 'esc') ui.text = '';
    else if (key.length === 1 && ui.text.length < maxLen) ui.text += key;
    return undefined;
  }

  function handleKey(key) {
    const k = typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
    if (ui.phase === 'name') {
      return textInput(key, 16, (v) => {
        if (!v) return flash('Scrivi il tuo nome');
        ui.name = v;
        ui.text = '';
        ui.phase = 'menu';
      });
    }
    if (ui.phase === 'menu') {
      if (k === 'c') {
        ui.phase = 'connecting';
        ui.sent = true;
        socket.emit('create', { name: ui.name });
      } else if (k === 'e') {
        ui.phase = 'code';
        ui.text = '';
      } else if (k === 'q') quit();
      return undefined;
    }
    if (ui.phase === 'code') {
      if (key === 'esc') { ui.phase = 'menu'; return undefined; }
      return textInput(key.toUpperCase ? key.toUpperCase() : key, 4, (v) => {
        if (v.length !== 4) return flash('Il codice ha 4 lettere');
        ui.phase = 'connecting';
        ui.sent = true;
        socket.emit('join', { code: v, name: ui.name });
      });
    }
    if (ui.phase !== 'room' || !state) return undefined;

    if (k === 'q') {
      if (ui.confirmQuit) return quit();
      ui.confirmQuit = true;
      return flash('Premi di nuovo Q per uscire dalla stanza');
    }
    ui.confirmQuit = false;
    return state.game ? tableKey(key, k) : lobbyKey(k);
  }

  function lobbyKey(k) {
    const s = state;
    if (s.hostId !== s.you) return flash("Aspetta che l'host inizi la partita");
    const modes = Object.keys(s.modes);
    const rules = Object.keys(s.houseRuleNames || {});
    if (/^[1-9]$/.test(k)) {
      const n = Number(k) - 1;
      if (n < modes.length) socket.emit('mode', modes[n]);
      else if (n - modes.length < rules.length) {
        const key = rules[n - modes.length];
        socket.emit('rules', { key, on: !s.houseRules[key] });
      }
    } else if (k === 't') {
      const i = s.turnTimes.indexOf(s.turnTime);
      socket.emit('timer', s.turnTimes[(i + 1) % s.turnTimes.length]);
    } else if (LEVEL_KEYS[k]) {
      socket.emit('addBot', { level: LEVEL_KEYS[k] });
    } else if (k === 'k') {
      const bot = [...s.members].reverse().find((m) => m.bot);
      if (bot) socket.emit('kick', { targetId: bot.id });
    } else if (k === 's' || k === 'enter') {
      if (s.members.length < 2) flash('Servono almeno 2 giocatori: aggiungi un computer con B');
      else socket.emit('start');
    }
    return undefined;
  }

  function tableKey(key, k) {
    const s = state;
    const g = s.game;
    const myTurn = g.turnId === s.you && !g.winner;
    const p = myTurn ? g.pending : null;

    if (g.winner) {
      if (s.hostId !== s.you) return flash("Aspetta che l'host faccia partire la prossima mano");
      if (k === 'n' || k === 'enter') socket.emit('start');
      else if (k === 'l') socket.emit('lobby');
      return undefined;
    }

    // scelta del colore (Jolly giocato, prima carta Jolly, Flip, roulette)
    if (ui.picking || (p && (p.type === 'color' || p.type === 'roulette'))) {
      if (key === 'esc' && ui.picking) { ui.picking = null; return undefined; }
      const n = Number(k) - 1;
      const color = g.colors[n];
      if (!color) return flash(`Scegli il colore con i tasti 1-${g.colors.length}`);
      if (ui.picking) socket.emit('play', { cardId: ui.picking.cardId, color });
      else socket.emit('color', { color });
      ui.picking = null;
      return undefined;
    }
    if (p && p.type === 'challenge') {
      if (k === 'a') socket.emit('accept');
      else if (k === 's') socket.emit('challenge');
      else flash('A = accetta, S = sfida');
      return undefined;
    }
    if (p && p.type === 'swap') {
      const others = g.players.filter((x) => x.id !== s.you);
      const target = others[Number(k) - 1];
      if (target) socket.emit('swap', { targetId: target.id });
      else flash(`Scegli con chi scambiare con i tasti 1-${others.length}`);
      return undefined;
    }

    const hand = g.hand;
    if (key === 'left') ui.sel = Math.max(0, ui.sel - 1);
    else if (key === 'right') ui.sel = Math.min(hand.length - 1, ui.sel + 1);
    else if (key === 'enter' || key === ' ') {
      const card = hand[ui.sel];
      if (!card) return undefined;
      if (!myTurn) return flash(`Non è il tuo turno: tocca a ${nameOf(g, g.turnId)}`);
      if (!card.playable) return flash(`Non puoi giocare ${describe(card)}`);
      if (card.color === 'wild') ui.picking = { cardId: card.id };
      else socket.emit('play', { cardId: card.id });
    } else if (k === 'p') {
      if (p && p.type === 'stack') socket.emit('accept');
      else socket.emit('draw');
    } else if (k === 'a') socket.emit('pass');
    else if (k === 'u') socket.emit('uno');
    else if (k === 'b') {
      if (g.unoVulnerable && g.unoVulnerable !== s.you) socket.emit('catch', { targetId: g.unoVulnerable });
      else flash('Nessuno da beccare adesso');
    }
    return undefined;
  }

  function nameOf(g, id) {
    const pl = g.players.find((x) => x.id === id);
    return pl ? pl.name : '?';
  }

  // --- disegno ---
  function render() {
    if (closed) return;
    const { cols } = size();
    const lines = [];
    const title = `${paint('red', ` ${BOLD}UNO${RESET}${ESC}48;5;160m `)} ${DIM}da terminale · ${server}${RESET}`;
    lines.push(title, '');
    if (ui.phase === 'name') {
      lines.push('Come ti chiami?', `> ${ui.text}${INVERSE} ${RESET}`, '', `${DIM}Invio per confermare · Ctrl+C per uscire${RESET}`);
    } else if (ui.phase === 'menu') {
      lines.push(`Ciao ${BOLD}${ui.name}${RESET}!`, '', `  ${BOLD}C${RESET}  crea una stanza`, `  ${BOLD}E${RESET}  entra in una stanza con il codice`, `  ${BOLD}Q${RESET}  esci`);
    } else if (ui.phase === 'code') {
      lines.push('Codice della stanza (4 lettere):', `> ${ui.text}${INVERSE} ${RESET}`, '', `${DIM}Invio per entrare · Esc per tornare indietro${RESET}`);
    } else if (ui.phase === 'connecting') {
      lines.push('Mi collego…');
    } else if (state && !state.game) {
      renderLobby(lines);
    } else if (state) {
      renderTable(lines, cols);
    }
    if (ui.message) lines.push('', `${INVERSE} ${ui.message.text} ${RESET}`);
    // ridisegna tutto lo schermo, nascondendo il cursore
    write(`${ESC}?25l${ESC}H${ESC}2J${lines.map((l) => l + ESC + 'K').join('\r\n')}`);
  }

  function renderLobby(lines) {
    const s = state;
    const host = s.hostId === s.you;
    const modes = Object.entries(s.modes);
    const rules = Object.entries(s.houseRuleNames || {});
    lines.push(`Stanza ${INVERSE} ${s.code} ${RESET}   link per chi gioca dal browser: ${server.replace(/\/$/, '')}/uno/?room=${s.code}`, '');
    lines.push(`${BOLD}Modalità${RESET}`);
    modes.forEach(([k, name], i) => lines.push(`  ${host ? `${i + 1} ` : ''}${k === s.mode ? `${BOLD}● ${name}${RESET}` : `○ ${name}`}`));
    lines.push(`${BOLD}Regole della casa${RESET}`);
    rules.forEach(([k, name], i) => lines.push(`  ${host ? `${modes.length + i + 1} ` : ''}${s.houseRules[k] ? '[x]' : '[ ]'} ${name}`));
    lines.push(`${BOLD}Tempo per turno:${RESET} ${s.turnTime ? `${s.turnTime} secondi` : 'nessun limite'}`, '');
    lines.push(`${BOLD}Giocatori${RESET}`);
    for (const m of s.members) {
      const tags = [m.id === s.hostId ? 'host' : '', m.bot ? `computer ${m.level}` : '', m.connected ? '' : 'offline', m.id === s.you ? 'tu' : ''].filter(Boolean);
      lines.push(`  • ${m.name}${tags.length ? ` ${DIM}(${tags.join(', ')})${RESET}` : ''}`);
    }
    lines.push('');
    if (host) {
      lines.push(`${DIM}1-${modes.length} modalità · ${modes.length + 1}-${modes.length + rules.length} regole della casa · T tempo`);
      lines.push(`F/B/D aggiungi computer facile/normale/difficile · K togli un computer · S inizia · Q esci${RESET}`);
    } else {
      lines.push(`${DIM}Aspetta che l'host inizi la partita · Q esci${RESET}`);
    }
  }

  function renderTable(lines, cols) {
    const s = state;
    const g = s.game;
    const me = g.players.find((p) => p.id === s.you);
    const myTurn = g.turnId === s.you && !g.winner;
    const secs = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
    const turn = g.winner ? 'Mano finita' : myTurn ? `${BOLD}${INVERSE} È IL TUO TURNO ${RESET}` : `Turno di ${BOLD}${nameOf(g, g.turnId)}${RESET}`;
    const timer = secs != null && !g.winner ? `  ${secs <= 5 ? fg('red', `⏱ ${secs}s`) : `⏱ ${secs}s`}` : '';
    lines[0] = `${lines[0]}   ${DIM}Stanza ${s.code} · ${s.modes[g.mode]}${RESET}`;
    lines.push(`${turn}${timer}${g.nextId === s.you && !myTurn && !g.winner ? `  ${DIM}(poi tocchi a te)${RESET}` : ''}`, '');

    // avversari, nell'ordine di gioco a partire da dopo di me
    const meIdx = g.players.findIndex((p) => p.id === s.you);
    const ordered = meIdx === -1 ? g.players : [...g.players.slice(meIdx + 1), ...g.players.slice(0, meIdx)];
    for (const p of ordered) {
      const member = s.members.find((m) => m.id === p.id);
      const mark = p.id === g.turnId && !g.winner ? `${BOLD}▶ ` : '  ';
      let line = `${mark}${p.name}${member && member.bot ? ' [PC]' : ''}${RESET}  ${p.cardCount} ${p.cardCount === 1 ? 'carta' : 'carte'}`;
      if (p.saidUno) line += ` ${paint('red', ' UNO! ')}`;
      if (g.unoVulnerable === p.id) line += ` ${fg('red', '← non ha detto UNO! (B per beccarlo)')}`;
      if (p.backs) line += `  ${DIM}retro:${RESET} ${p.backs.map((b) => fg(b.color === 'wild' ? 'wild' : b.color, '■')).join('')}`;
      lines.push(line);
    }
    for (const name of g.eliminated || []) lines.push(`  ${DIM}${name} (eliminato)${RESET}`);
    lines.push('');

    // centro tavolo
    const top = g.top;
    const topColor = top.color === 'wild' && g.currentColor ? g.currentColor : top.color;
    const colorName = g.currentColor ? COLOR_NAMES[g.currentColor] : 'da scegliere';
    // mazzo e carta in tavola, alti tre righe come carte vere
    const back = paint('wild', '       ');
    const deckMid = `${ESC}48;5;16m${ESC}38;5;220m${BOLD}  UNO  ${RESET}`;
    const topBlank = paint(topColor, '       ');
    const topMid = paint(topColor, `${BOLD}${cardText(top, 7)}`);
    const info = [`${g.deckCount} carte`, `colore ${g.currentColor ? fg(g.currentColor, `■ ${colorName}`) : colorName}`, `giro ${g.direction === 1 ? '↻ orario' : '↺ antiorario'}`];
    lines.push(`  ${back}   ${topBlank}   ${info[0]}`);
    lines.push(`  ${deckMid}   ${topMid}   ${info[1]}`);
    lines.push(`  ${back}   ${topBlank}   ${info[2]}`);
    lines.push(`  ${DIM} mazzo    in tavola${RESET}`);
    if (g.side === 'dark') lines.push(`  ${fg('purple', 'Lato scuro di UNO Flip')}`);
    lines.push('');

    // ultime mosse
    for (const l of g.log.slice(-4)) lines.push(`  ${DIM}${l}${RESET}`);
    lines.push('');

    // la mia mano
    if (me) {
      lines.push(`${BOLD}La tua mano${RESET} (${g.hand.length})`);
      // ogni carta è larga 5: numero sopra (in negativo se selezionata), carta, freccia se giocabile
      const cells = g.hand.map((c, i) => {
        const num = String(i + 1).padStart(3).padEnd(5);
        const dim = !c.playable && myTurn ? DIM : '';
        return {
          top: i === ui.sel ? `${INVERSE}${BOLD}${num}${RESET}` : `${DIM}${num}${RESET}`,
          blank: `${dim}${paint(c.color, '     ')}`,
          card: `${dim}${paint(c.color, `${BOLD}${cardText(c, 5)}`)}`,
          mark: c.playable ? fg('yellow', '  ▲  ') : '     ',
        };
      });
      const perRow = Math.max(1, Math.floor((cols - 2) / 7));
      for (let r = 0; r < cells.length; r += perRow) {
        const row = cells.slice(r, r + perRow);
        for (const part of ['top', 'blank', 'card', 'blank', 'mark']) lines.push(' ' + row.map((c) => c[part]).join('  '));
      }
      const chosen = g.hand[ui.sel];
      if (chosen) lines.push(`  Selezionata: ${describe(chosen)}${chosen.playable ? '' : ` ${DIM}(non giocabile ora)${RESET}`}`);
    } else {
      lines.push(`${DIM}Sei fuori da questa mano: guardi gli altri${RESET}`);
    }
    lines.push('');

    // cosa fare adesso
    const p = myTurn ? g.pending : null;
    if (g.winner) {
      lines.push(`${BOLD}🏆 ${g.winner.id === s.you ? 'Hai vinto la mano!' : `${g.winner.name} vince la mano!`}${RESET}  (+${g.winner.points} punti)`);
      if (s.matchWinner) lines.push(`${BOLD}${s.matchWinner.name} vince la partita con ${s.matchWinner.score} punti!${RESET}`);
      lines.push(`Punteggi: ${[...s.members].sort((a, b) => b.score - a.score).map((m) => `${m.name} ${m.score}`).join(' · ')}  ${DIM}(si vince a ${s.targetScore})${RESET}`);
      lines.push(s.hostId === s.you ? `${DIM}N nuova mano · L torna alla sala d'attesa · Q esci${RESET}` : `${DIM}Aspetta l'host · Q esci${RESET}`);
    } else if (ui.picking || (p && (p.type === 'color' || p.type === 'roulette'))) {
      const what = p && p.type === 'roulette' ? 'Roulette: scegli il colore, peschi finché non esce' : 'Scegli il colore';
      lines.push(`${BOLD}${what}:${RESET} ${g.colors.map((c, i) => `${i + 1} ${paint(c, ` ${COLOR_NAMES[c]} `)}`).join('  ')}${ui.picking ? `  ${DIM}Esc annulla${RESET}` : ''}`);
    } else if (p && p.type === 'challenge') {
      lines.push(`${BOLD}${nameOf(g, p.from)} ti ha giocato un Jolly pesca!${RESET}  A accetta · S sfida (se bluffava pesca lui, se no peschi tu 2 carte in più)`);
    } else if (p && p.type === 'swap') {
      const others = g.players.filter((x) => x.id !== s.you);
      lines.push(`${BOLD}Con chi scambi la mano?${RESET}  ${others.map((x, i) => `${i + 1} ${x.name} (${x.cardCount})`).join(' · ')}`);
    } else if (p && p.type === 'stack') {
      lines.push(`${BOLD}+${p.amount} in arrivo!${RESET} Rispondi con una carta pesca da +${p.min} o più, oppure P per pescare ${p.amount} carte`);
    } else if (myTurn) {
      lines.push(g.hasDrawn ? 'Gioca la carta pescata (Invio) oppure A per passare' : 'Scegli una carta con ← → e premi Invio, oppure P per pescare');
    } else if (g.pending) {
      lines.push(`${DIM}${nameOf(g, g.turnId)} sta decidendo…${RESET}`);
    }
    if (!g.winner) lines.push(`${DIM}← → scegli · Invio gioca · P pesca · A passa · U grida UNO! · B becca chi non l'ha detto · Q esci${RESET}`);
  }

  write(`${ESC}?25l`);
  render();
  return { quit, render };
}

module.exports = { startTui, parseKeys };
