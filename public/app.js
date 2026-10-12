'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

const SYMBOLS = {
  skip: '⊘', reverse: '⇄', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: '⊘⊘', flip: 'FLIP', discardall: '⇊',
  wild: '★', wild4: '+4', wild2: '+2', wildcolor: '+?',
  wildrev4: '⇄4', wild6: '+6', wild10: '+10', roulette: '?',
};
const VALUE_NAMES = {
  wild4: 'Jolly +4', wild2: 'Jolly +2', wildcolor: 'Jolly pesca colore',
};
const COLOR_NAMES = {
  red: 'rosso', yellow: 'giallo', green: 'verde', blue: 'blu',
  pink: 'rosa', teal: 'azzurro', orange: 'arancione', purple: 'viola',
};

let state = null;
let pendingWildCard = null; // carta Jolly selezionata in attesa del colore
let colorPickerMode = null; // 'play' | 'pending'

// --- Persistenza locale (nome e riconnessione) ---
function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) { /* storage non disponibile */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

$('name').value = load('uno-name') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('codeInput').value = urlRoom.toUpperCase();

function getName() {
  const n = $('name').value.trim();
  if (!n) {
    toast('Inserisci il tuo nome');
    $('name').focus();
    return null;
  }
  store('uno-name', n);
  return n;
}

function show(screen) {
  for (const s of ['home', 'lobby', 'table']) $(s).classList.toggle('hidden', s !== screen);
  if (screen !== 'table') document.documentElement.classList.remove('dark-side');
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// --- Azioni home / lobby ---
$('createBtn').onclick = () => {
  const name = getName();
  if (name) socket.emit('create', { name });
};
$('joinBtn').onclick = () => {
  const name = getName();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) return toast('Inserisci un codice di 4 lettere');
  socket.emit('join', { code, name });
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => socket.emit('start');
$('nextRoundBtn').onclick = () => socket.emit('start');
// torna in sala d'attesa, dove l'host può scegliere un'altra modalità
$('changeModeBtn').onclick = () => socket.emit('lobby');
for (const b of document.querySelectorAll('#modeList .mode')) {
  b.onclick = () => {
    if (state && state.hostId === state.you) socket.emit('mode', b.dataset.mode);
  };
}
$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('shareLink').value);
    toast('Link copiato!');
  } catch (_) {
    $('shareLink').select();
    toast('Copia il link manualmente');
  }
};
function leave() {
  if (!confirm('Vuoi davvero uscire dalla stanza?')) return;
  socket.emit('leave');
  store('uno-session', null);
  state = null;
  history.replaceState(null, '', location.pathname);
  show('home');
}
$('leaveBtn').onclick = leave;
$('leaveBtn2').onclick = leave;

// --- Azioni di gioco ---
$('deck').onclick = () => socket.emit('draw');
$('takeBtn').onclick = () => socket.emit('accept');
$('passBtn').onclick = () => socket.emit('pass');
$('unoBtn').onclick = () => socket.emit('uno');
$('acceptBtn').onclick = () => socket.emit('accept');
$('challengeBtn').onclick = () => socket.emit('challenge');

function openColorPicker(mode, title, colors) {
  colorPickerMode = mode;
  $('colorTitle').textContent = title;
  $('cancelColor').classList.toggle('hidden', mode !== 'play');
  const box = $('colorButtons');
  box.innerHTML = '';
  for (const color of colors) {
    const b = document.createElement('button');
    b.className = `c ${color}`;
    b.title = COLOR_NAMES[color];
    b.onclick = () => {
      if (colorPickerMode === 'play') socket.emit('play', { cardId: pendingWildCard, color });
      else socket.emit('color', { color });
      closeColorPicker();
    };
    box.append(b);
  }
  $('colorPicker').classList.remove('hidden');
}
function closeColorPicker() {
  colorPickerMode = null;
  pendingWildCard = null;
  $('colorPicker').classList.add('hidden');
}
$('cancelColor').onclick = closeColorPicker;

$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text) socket.emit('chat', text);
  $('chatInput').value = '';
};

function playCard(card) {
  if (!card.playable) return;
  if (card.color === 'wild') {
    pendingWildCard = card.id;
    openColorPicker('play', 'Scegli un colore', state.game.colors);
  } else {
    socket.emit('play', { cardId: card.id });
  }
}

// --- Eventi dal server ---
socket.on('connect', () => {
  // Riconnessione automatica alla stanza precedente
  const saved = load('uno-session');
  if (saved) {
    try {
      const { code, playerId } = JSON.parse(saved);
      socket.emit('join', { code, playerId, name: load('uno-name') });
    } catch (_) { store('uno-session', null); }
  }
});

socket.on('joined', ({ code, playerId }) => {
  store('uno-session', JSON.stringify({ code, playerId }));
  history.replaceState(null, '', `?room=${code}`);
});

socket.on('error-msg', (msg) => {
  toast(msg);
  if (msg === 'Stanza non trovata') store('uno-session', null);
});

socket.on('kicked', () => {
  store('uno-session', null);
  state = null;
  show('home');
  toast('Sei stato rimosso dalla stanza');
});

socket.on('chat', ({ name, text }) => {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = name + ': ';
  li.append(b, document.createTextNode(text));
  $('chatLog').append(li);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
});

socket.on('state', (s) => {
  state = s;
  render();
});

// --- Rendering ---
function cardEl(card, tag = 'div') {
  const el = document.createElement(tag);
  el.className = `card ${card.color}`;
  const label = SYMBOLS[card.value] || card.value;
  if (label.length > 2 || card.value === 'skipall') el.classList.add('long');
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = label;
  const c1 = document.createElement('span');
  c1.className = 'corner';
  c1.textContent = label;
  const c2 = c1.cloneNode(true);
  c2.className = 'corner br';
  el.append(c1, val, c2);
  el.title = describeCard(card);
  return el;
}

const CARD_NAMES = {
  skip: 'Salta', reverse: 'Inverti', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: 'Salta tutti', flip: 'Flip', discardall: 'Scarta tutto', wild: 'Jolly',
  wildrev4: 'Jolly inverti +4', wild6: 'Jolly +6', wild10: 'Jolly +10', roulette: 'Roulette dei colori',
  ...VALUE_NAMES,
};
function describeCard(c) {
  const v = CARD_NAMES[c.value] || c.value;
  return c.color === 'wild' ? v : `${v} ${COLOR_NAMES[c.color] || ''}`;
}

function playerName(g, id) {
  const p = g.players.find((x) => x.id === id);
  return p ? p.name : '?';
}

function renderLobby(s, isHost) {
  show('lobby');
  $('lobbyCode').textContent = s.code;
  $('shareLink').value = `${location.origin}${location.pathname}?room=${s.code}`;
  for (const b of document.querySelectorAll('#modeList .mode')) {
    b.classList.toggle('selected', b.dataset.mode === s.mode);
    b.disabled = !isHost;
  }
  $('modeHint').textContent = isHost ? 'Scegli la modalità di gioco' : "La modalità la sceglie l'host";
  const list = $('memberList');
  list.innerHTML = '';
  for (const m of s.members) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = m.name + (m.id === s.you ? ' (tu)' : '');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = (m.id === s.hostId ? '👑 host' : '') + (m.connected ? '' : ' offline');
    li.append(name, tag);
    if (isHost && m.id !== s.you) {
      const k = document.createElement('button');
      k.className = 'kick';
      k.title = 'Rimuovi';
      k.textContent = '✕';
      k.onclick = () => socket.emit('kick', { targetId: m.id });
      li.append(k);
    }
    list.append(li);
  }
  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = s.members.length < 2;
  $('startBtn').textContent = s.members.length < 2 ? 'Servono almeno 2 giocatori' : 'Inizia partita';
  $('waitHost').classList.toggle('hidden', isHost);
}

function render() {
  const s = state;
  const isHost = s.hostId === s.you;
  const g = s.game;

  if (!g) {
    closeColorPicker();
    for (const id of ['challengeBox', 'swapBox', 'roundEnd']) $(id).classList.add('hidden');
    return renderLobby(s, isHost);
  }

  show('table');
  document.documentElement.classList.toggle('dark-side', g.side === 'dark');
  $('tableCode').textContent = s.code;
  $('modeName').textContent = s.modes[g.mode];
  const myTurn = g.turnId === s.you && !g.winner;
  const pend = g.pending;
  const myPending = myTurn && pend ? pend.type : null;
  const turnName = playerName(g, g.turnId);
  $('turnInfo').textContent = g.winner ? 'Mano finita' : myTurn ? 'È il tuo turno!' : `Turno di ${turnName}`;
  $('turnInfo').classList.toggle('mine', myTurn);

  renderOpponents(s, g);

  // Centro tavolo
  $('discard').innerHTML = '';
  if (g.top) {
    const top = cardEl(g.top);
    if (g.top.color === 'wild' && g.currentColor) {
      top.classList.remove('wild');
      top.classList.add(g.currentColor);
    }
    $('discard').append(top);
  }
  $('colorDot').style.background = g.currentColor ? `var(--${g.currentColor})` : 'transparent';
  $('deckCount').textContent = `${g.deckCount} carte`;
  $('direction').classList.toggle('ccw', g.direction === -1);

  // Mazzo: in Flip si vede il retro della prima carta
  const deck = $('deck');
  deck.className = 'card back';
  deck.innerHTML = '<span>UNO</span>';
  if (g.deckBack) {
    const b = cardEl(g.deckBack);
    deck.className = b.className + ' deck-face';
    deck.innerHTML = b.innerHTML;
    deck.title = `Pesca (sull'altro lato: ${describeCard(g.deckBack)})`;
  } else {
    deck.title = 'Pesca';
  }
  const stackPending = myPending === 'stack';
  const canDraw = myTurn && !g.hasDrawn && (!pend || stackPending);
  deck.disabled = !canDraw;
  deck.classList.toggle('can-draw', canDraw && !g.hand.some((c) => c.playable));

  // Info sulla decisione in corso (visibile a tutti)
  const info = $('pendingInfo');
  info.classList.toggle('hidden', !pend || !!g.winner);
  if (pend) info.textContent = pendingText(g, pend, myTurn, turnName);

  $('takeBtn').classList.toggle('hidden', !stackPending);
  if (stackPending) $('takeBtn').textContent = `Pesca ${pend.amount} carte`;
  $('passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn && g.mode !== 'nomercy'));

  // Scelta colore richiesta dal gioco (prima carta Jolly, Flip, roulette)
  if (myPending === 'color' || myPending === 'roulette') {
    if (colorPickerMode !== 'pending') {
      const title = myPending === 'roulette'
        ? 'Roulette: scegli il colore. Peschi finché non esce!'
        : 'Scegli il colore';
      openColorPicker('pending', title, g.colors);
    }
  } else if (colorPickerMode === 'pending' || (colorPickerMode === 'play' && !myTurn)) {
    closeColorPicker();
  }

  // Sfida al Jolly pesca
  $('challengeBox').classList.toggle('hidden', myPending !== 'challenge');
  if (myPending === 'challenge') {
    const card = VALUE_NAMES[g.top.value] || 'Jolly';
    const penalty = pend.kind === 'untilColor' ? `peschi finché non esce il ${COLOR_NAMES[pend.color]}` : `peschi ${pend.amount} carte`;
    const penaltyLose = pend.kind === 'untilColor' ? `peschi finché non esce il ${COLOR_NAMES[pend.color]} e altre 2 carte` : `peschi ${pend.amount + 2} carte`;
    $('challengeText').textContent = `${playerName(g, pend.from)} ti ha giocato un ${card}`;
    $('acceptBtn').textContent = 'Accetta';
    $('challengeHelp').textContent =
      `Se accetti ${penalty} e salti il turno. Se sfidi ed era un bluff (aveva una carta del colore precedente), ` +
      `la penalità tocca a chi l'ha giocato. Se invece era regolare, ${penaltyLose}.`;
  }

  // Scambio mani
  $('swapBox').classList.toggle('hidden', myPending !== 'swap');
  if (myPending === 'swap') {
    const list = $('swapList');
    list.innerHTML = '';
    for (const p of g.players) {
      if (p.id === s.you) continue;
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `${p.name} (${p.cardCount} ${p.cardCount === 1 ? 'carta' : 'carte'})`;
      b.onclick = () => socket.emit('swap', { targetId: p.id });
      list.append(b);
    }
  }

  // La mia mano
  const hand = $('hand');
  hand.innerHTML = '';
  hand.classList.toggle('my-turn', myTurn);
  const order = [...g.colors, 'wild'];
  const sorted = [...g.hand].sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color) || valueRank(a) - valueRank(b));
  for (const c of sorted) {
    const el = cardEl(c, 'button');
    if (c.playable) el.classList.add('playable');
    else if (myTurn) el.classList.add('dim');
    el.onclick = () => playCard(c);
    hand.append(el);
  }
  const me = g.players.find((p) => p.id === s.you);
  $('unoBtn').classList.toggle('hidden', !me);
  $('unoBtn').disabled = !me || me.saidUno || !(me.cardCount === 1 || (me.cardCount === 2 && myTurn));
  if (!me && !g.winner) {
    $('turnInfo').textContent = g.eliminated.length ? 'Sei fuori: guardi la partita' : $('turnInfo').textContent;
  }

  // Log
  const log = $('log');
  log.innerHTML = '';
  for (const line of g.log) {
    const li = document.createElement('li');
    li.textContent = line;
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;

  renderRoundEnd(s, g, isHost);
}

function pendingText(g, pend, myTurn, turnName) {
  const who = myTurn ? 'Tu devi' : `${turnName} deve`;
  switch (pend.type) {
    case 'stack':
      return `🔥 +${pend.amount} in arrivo! ${who} rilanciare con un +${pend.min} o più, oppure pescare ${pend.amount} carte`;
    case 'challenge':
      return `${who} decidere se accettare o sfidare il Jolly di ${playerName(g, pend.from)}`;
    case 'roulette':
      return `🎯 Roulette dei colori: ${myTurn ? 'tu scegli' : `${turnName} sceglie`} un colore e pesca finché non esce`;
    case 'swap':
      return `🔁 ${myTurn ? 'Scegli' : `${turnName} sceglie`} con chi scambiare la mano`;
    case 'color':
      return `🎨 ${myTurn ? 'Scegli' : `${turnName} sceglie`} il colore`;
    default:
      return '';
  }
}

function renderOpponents(s, g) {
  const opp = $('opponents');
  opp.innerHTML = '';
  const meIdx = g.players.findIndex((p) => p.id === s.you);
  const ordered = meIdx === -1 ? g.players : [...g.players.slice(meIdx + 1), ...g.players.slice(0, meIdx)];
  for (const p of ordered) {
    const member = s.members.find((m) => m.id === p.id);
    const d = document.createElement('div');
    d.className = 'opp' + (p.id === g.turnId && !g.winner ? ' turn' : '') + (member && !member.connected ? ' offline' : '');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name + (member && !member.connected ? ' 📴' : '');
    const minis = document.createElement('div');
    minis.className = 'mini-cards';
    const shown = Math.min(p.cardCount, 12);
    for (let i = 0; i < shown; i++) {
      const m = document.createElement('div');
      m.className = 'mini';
      // UNO Flip: si vede l'altra faccia delle carte avversarie
      const back = p.backs && p.backs[i];
      if (back) {
        m.classList.add('face', back.color);
        m.textContent = SYMBOLS[back.value] || back.value;
        m.title = describeCard(back);
      }
      minis.append(m);
    }
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = `${p.cardCount} ${p.cardCount === 1 ? 'carta' : 'carte'}`;
    if (g.mode === 'nomercy' && p.cardCount >= 20) count.textContent += ' ⚠️';
    d.append(name, minis, count);
    if (p.saidUno) {
      const b = document.createElement('div');
      b.className = 'uno-badge';
      b.textContent = 'UNO';
      d.append(b);
    }
    if (g.unoVulnerable === p.id && meIdx !== -1) {
      const c = document.createElement('button');
      c.className = 'btn small catch';
      c.textContent = 'Non ha detto UNO!';
      c.onclick = () => socket.emit('catch', { targetId: p.id });
      d.append(c);
    }
    opp.append(d);
  }
  for (const name of g.eliminated) {
    const d = document.createElement('div');
    d.className = 'opp out';
    d.innerHTML = '<div class="name"></div><div class="count">eliminato 💀</div>';
    d.querySelector('.name').textContent = name;
    opp.append(d);
  }
}

function renderRoundEnd(s, g, isHost) {
  if (!g.winner) {
    $('roundEnd').classList.add('hidden');
    return;
  }
  $('roundEnd').classList.remove('hidden');
  const mw = s.matchWinner;
  if (mw) {
    $('winnerText').textContent = mw.id === s.you ? `🎉 Hai vinto la partita con ${mw.score} punti!` : `🏆 ${mw.name} vince la partita con ${mw.score} punti!`;
  } else {
    $('winnerText').textContent = g.winner.id === s.you ? '🎉 Hai vinto la mano!' : `🏆 ${g.winner.name} vince la mano!`;
  }
  $('targetText').textContent = mw ? 'Fine partita' : `Vince la partita chi arriva a ${s.targetScore} punti`;
  $('nextRoundBtn').textContent = mw ? 'Nuova partita' : 'Nuova mano';
  const table = $('scoreTable');
  table.innerHTML = '';
  for (const m of [...s.members].sort((a, b) => b.score - a.score)) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = m.name;
    const b = document.createElement('td');
    b.textContent = `${m.score} pt`;
    tr.append(a, b);
    table.append(tr);
  }
  $('nextRoundBtn').classList.toggle('hidden', !isHost);
  $('nextRoundBtn').disabled = s.members.length < 2;
  $('changeModeBtn').classList.toggle('hidden', !isHost);
  $('waitNext').classList.toggle('hidden', isHost);
}

const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'skipall', 'reverse', 'discardall',
  'draw1', 'draw2', 'draw4', 'draw5', 'flip', 'wild', 'roulette', 'wild2', 'wild4', 'wildrev4', 'wild6', 'wildcolor', 'wild10'];
function valueRank(c) {
  return VALUE_ORDER.indexOf(c.value);
}
