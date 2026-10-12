'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };

let state = null;
let pendingWildCard = null;

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
$('passBtn').onclick = () => socket.emit('pass');
$('unoBtn').onclick = () => socket.emit('uno');
$('cancelColor').onclick = () => {
  pendingWildCard = null;
  $('colorPicker').classList.add('hidden');
};
for (const b of document.querySelectorAll('#colorPicker .c')) {
  b.onclick = () => {
    if (pendingWildCard != null) socket.emit('play', { cardId: pendingWildCard, color: b.dataset.color });
    pendingWildCard = null;
    $('colorPicker').classList.add('hidden');
  };
}
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
    $('colorPicker').classList.remove('hidden');
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
  toast("Sei stato rimosso dalla stanza");
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
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = label;
  const c1 = document.createElement('span');
  c1.className = 'corner';
  c1.textContent = label;
  const c2 = c1.cloneNode(true);
  c2.className = 'corner br';
  el.append(c1, val, c2);
  return el;
}

function render() {
  const s = state;
  const isHost = s.hostId === s.you;
  const g = s.game;

  if (!g) {
    show('lobby');
    $('lobbyCode').textContent = s.code;
    $('shareLink').value = `${location.origin}${location.pathname}?room=${s.code}`;
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
    return;
  }

  show('table');
  $('tableCode').textContent = s.code;
  const myTurn = g.turnId === s.you && !g.winner;
  const turnPlayer = g.players.find((p) => p.id === g.turnId);
  $('turnInfo').textContent = g.winner ? 'Mano finita' : myTurn ? 'È il tuo turno!' : `Turno di ${turnPlayer ? turnPlayer.name : '…'}`;
  $('turnInfo').classList.toggle('mine', myTurn);

  // Avversari (in ordine di gioco a partire da dopo di me)
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
    for (let i = 0; i < Math.min(p.cardCount, 10); i++) {
      const m = document.createElement('div');
      m.className = 'mini';
      minis.append(m);
    }
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = `${p.cardCount} ${p.cardCount === 1 ? 'carta' : 'carte'}`;
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

  // Centro tavolo
  $('discard').innerHTML = '';
  if (g.top) {
    const top = cardEl(g.top);
    if (g.top.color === 'wild') {
      top.classList.remove('wild');
      top.classList.add(g.currentColor);
    }
    $('discard').append(top);
  }
  $('colorDot').style.background = `var(--${g.currentColor})`;
  $('deckCount').textContent = `${g.deckCount} carte`;
  $('direction').classList.toggle('ccw', g.direction === -1);
  $('deck').disabled = !myTurn || g.hasDrawn;
  $('deck').classList.toggle('can-draw', myTurn && !g.hasDrawn && !g.hand.some((c) => c.playable));
  $('passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));

  // La mia mano
  const hand = $('hand');
  hand.innerHTML = '';
  hand.classList.toggle('my-turn', myTurn);
  const sorted = [...g.hand].sort(compareCards);
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

  // Log
  const log = $('log');
  log.innerHTML = '';
  for (const line of g.log) {
    const li = document.createElement('li');
    li.textContent = line;
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;

  // Fine mano
  if (g.winner) {
    $('roundEnd').classList.remove('hidden');
    $('winnerText').textContent = g.winner.id === s.you ? '🎉 Hai vinto la mano!' : `🏆 ${g.winner.name} vince la mano!`;
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
    $('waitNext').classList.toggle('hidden', isHost);
  } else {
    $('roundEnd').classList.add('hidden');
  }
}

const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
function compareCards(a, b) {
  return COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value);
}
