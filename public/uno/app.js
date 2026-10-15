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
let lastGame = null; // stato precedente, per animare i cambiamenti
let fromLobby = false; // l'ultima schermata era la sala d'attesa: la mano che arriva è appena iniziata
const seenMembers = new Set(); // chi è già comparso nella sala d'attesa (animato solo all'ingresso)
let timerDeadline = null; // fine del turno corrente (orologio locale)
let timerTotal = 0;
let timerBuzzed = false;
let playFlight = null; // carta giocata ancora in volo

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
$('addBotBtn').onclick = () => socket.emit('addBot', { level: $('botLevel').value });
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


function playCard(card) {
  if (!card.playable) return toast(cannotPlayReason(card));
  if (card.color === 'wild') {
    pendingWildCard = card.id;
    openColorPicker('play', 'Scegli un colore', state.game.colors);
  } else {
    socket.emit('play', { cardId: card.id });
  }
}

// Perché una carta non si può giocare (in parole semplici)
function cannotPlayReason(card) {
  const g = state.game;
  if (g.winner) return 'La mano è finita';
  if (g.turnId !== state.you) return `Non è il tuo turno: tocca a ${playerName(g, g.turnId)}`;
  const p = g.pending;
  if (p && p.type === 'stack') return `Puoi rispondere solo con una carta pesca da +${p.min} o più, altrimenti premi "Pesca ${p.amount} carte"`;
  if (p) return 'Prima completa la scelta in corso';
  if (g.hasDrawn) return 'Dopo aver pescato puoi giocare solo la carta appena pescata';
  const top = g.top;
  const color = g.currentColor ? COLOR_NAMES[g.currentColor] : '';
  return `Serve una carta ${color ? `${color} ` : ''}oppure con lo stesso simbolo di quella sulla pila (${describeCard(top)}). I Jolly vanno sempre bene.`;
}

// --- Regole spiegate nel gioco ---
const RULE_CARDS = {
  classic: [
    [{ color: 'red', value: 'skip' }, 'Salta: il giocatore dopo di te salta il turno.'],
    [{ color: 'blue', value: 'reverse' }, 'Inverti: cambia il senso di gioco (in 2 vale come Salta).'],
    [{ color: 'green', value: 'draw2' }, '+2: il giocatore dopo pesca 2 carte e salta il turno.'],
    [{ color: 'wild', value: 'wild' }, 'Jolly: si gioca su qualsiasi carta e scegli tu il colore.'],
    [{ color: 'wild', value: 'wild4' }, 'Jolly +4: scegli il colore e il successivo pesca 4. Vale solo se non hai carte del colore in tavola: chi lo riceve può sfidarti!'],
  ],
  flip: [
    [{ color: 'yellow', value: 'draw1' }, '+1 (lato chiaro): il successivo pesca 1 carta e salta il turno.'],
    [{ color: 'red', value: 'flip' }, 'Flip: si gira tutto! Mazzo, pila e mani passano all\'altro lato.'],
    [{ color: 'wild', value: 'wild2' }, 'Jolly +2 (lato chiaro): scegli il colore e il successivo pesca 2. Si può sfidare come il +4.'],
    [{ color: 'pink', value: 'draw5' }, '+5 (lato scuro): il successivo pesca 5 carte e salta il turno.'],
    [{ color: 'teal', value: 'skipall' }, 'Salta tutti (lato scuro): tutti saltano il turno e giochi di nuovo tu.'],
    [{ color: 'wild', value: 'wildcolor' }, 'Jolly pesca colore (lato scuro): scegli un colore, il successivo pesca finché non lo trova.'],
  ],
  nomercy: [
    [{ color: 'red', value: 'draw2' }, '+2 e +4 colorati: si accumulano! Chi li riceve può rispondere con una carta pesca uguale o più forte, altrimenti pesca tutto.'],
    [{ color: 'wild', value: 'wild6' }, 'Jolly +6 e +10: come sopra, ma ancora più cattivi.'],
    [{ color: 'wild', value: 'wildrev4' }, 'Jolly inverti +4: cambia senso di gioco e il nuovo successivo pesca 4.'],
    [{ color: 'blue', value: 'skipall' }, 'Salta tutti: giochi di nuovo tu.'],
    [{ color: 'green', value: 'discardall' }, 'Scarta tutto: butti insieme a lei tutte le carte di quel colore.'],
    [{ color: 'wild', value: 'roulette' }, 'Roulette dei colori: il successivo sceglie un colore e pesca finché non esce.'],
    [{ color: 'yellow', value: '7' }, '7: scambi la tua mano con un giocatore a scelta.'],
    [{ color: 'red', value: '0' }, '0: tutti passano la mano al giocatore successivo.'],
  ],
};

const RULE_TEXT = {
  classic: [
    'Vince la partita chi arriva per primo a 500 punti.',
    'Chi finisce le carte vince la mano e prende i punti delle carte rimaste agli altri.',
  ],
  flip: [
    'Ogni carta ha due facce: si inizia dal lato chiaro, la carta Flip porta tutti sul lato scuro (e viceversa).',
    'Vedi il retro delle carte degli avversari: sono le carte che avranno dopo il prossimo Flip!',
    'Vince la partita chi arriva per primo a 500 punti.',
  ],
  nomercy: [
    'Se non puoi giocare, peschi finché non trovi una carta giocabile (e devi giocarla).',
    'Con 25 carte in mano sei eliminato! Vince chi finisce le carte o resta l\'ultimo.',
    'Vince la partita chi arriva per primo a 1000 punti.',
  ],
};

const HOUSE_RULE_HELP = {
  stack: "Accumulo: a chi riceve un +2 o un +4 basta rispondere con una carta pesca uguale o più forte, e il totale passa al successivo. Chi non può pesca tutto. Con l'accumulo il Jolly +4 non si sfida.",
  sevenZero: '7-0: giocando un 7 scambi la mano con chi vuoi, giocando uno 0 tutti passano la mano al successivo.',
  drawUntil: 'Pesca finché puoi giocare: se non hai carte giocabili peschi finché non ne esce una, poi puoi giocarla o tenerla.',
};

// Come si presentano le regole della casa nella sala d'attesa
const HOUSE_RULE_UI = {
  stack: {
    title: 'Accumulo',
    text: '+2 su +2, +4 su +2 o +4: chi non risponde pesca tutto',
    art: [{ color: 'green', value: 'draw2' }, { color: 'blue', value: 'draw2' }, { color: 'wild', value: 'wild4' }],
  },
  sevenZero: {
    title: '7-0',
    text: 'Col 7 scambi la mano con chi vuoi, con lo 0 tutti la passano',
    art: [{ color: 'yellow', value: '7' }, { color: 'red', value: '0' }],
  },
  drawUntil: {
    title: 'Pesca finché puoi',
    text: 'Senza carte buone peschi finché non ne esce una giocabile',
    art: [null, null, { color: 'red', value: '5' }],
  },
};

function renderHouseRules(s, isHost) {
  const box = $('houseRules');
  box.innerHTML = '';
  const noMercy = s.mode === 'nomercy';
  $('houseHint').textContent = noMercy ? '' : isHost ? 'Facoltative: tocca per accenderle' : "Le sceglie l'host";
  if (noMercy) {
    const p = document.createElement('p');
    p.className = 'muted house-note';
    p.textContent = 'Nel No Mercy valgono già tutte.';
    box.append(p);
    return;
  }
  for (const key of Object.keys(s.houseRuleNames)) {
    const ui = HOUSE_RULE_UI[key];
    const on = !!s.houseRules[key];
    const b = document.createElement('button');
    b.className = 'house' + (on ? ' on' : '');
    b.disabled = !isHost;
    b.setAttribute('aria-pressed', String(on));
    const art = document.createElement('div');
    art.className = 'house-art';
    for (const c of ui.art) art.append(c ? cardEl(c) : backEl());
    const text = document.createElement('div');
    text.className = 'house-text';
    const t = document.createElement('b');
    t.textContent = ui.title;
    const d = document.createElement('span');
    d.textContent = ui.text;
    text.append(t, d);
    const sw = document.createElement('span');
    sw.className = 'switch';
    b.append(art, text, sw);
    b.onclick = () => socket.emit('rules', { key, on: !on });
    box.append(b);
  }
}

const BASIC_RULES = [
  'Al tuo turno gioca una carta dello <b>stesso colore</b> o con lo <b>stesso numero/simbolo</b> di quella in cima alla pila. Le carte che puoi giocare sono <b>evidenziate</b>.',
  'Se non hai carte giocabili (o non vuoi giocarle) <b>tocca il mazzo</b> per pescare.',
  'Quando stai per restare con una carta premi <b>UNO!</b>. Se te ne dimentichi, gli altri possono beccarti e peschi 2 carte.',
  'Se un altro dimentica di dire UNO compare il pulsante <b>"Non ha detto UNO!"</b>: premilo prima che giochi il successivo.',
  'Se è attivo il <b>timer</b> e il tempo scade, il gioco muove per te: peschi una carta e passi (e nelle scelte accetta o sceglie il colore di cui hai più carte).',
];

function showRules(mode) {
  $('rulesTitle').textContent = `Come si gioca: ${state.modes[mode]}`;
  const body = $('rulesBody');
  body.innerHTML = '';
  const section = (title) => {
    const h = document.createElement('h4');
    h.textContent = title;
    body.append(h);
  };
  section('Le basi');
  const ul = document.createElement('ul');
  ul.innerHTML = BASIC_RULES.map((r) => `<li>${r}</li>`).join('');
  body.append(ul);
  section('Carte speciali');
  for (const [card, text] of RULE_CARDS[mode]) {
    const row = document.createElement('div');
    row.className = 'rule-card';
    const t = document.createElement('p');
    t.textContent = text;
    row.append(cardEl(card), t);
    body.append(row);
  }
  section('Regole di questa modalità');
  const ul2 = document.createElement('ul');
  for (const r of RULE_TEXT[mode]) {
    const li = document.createElement('li');
    li.textContent = r;
    ul2.append(li);
  }
  body.append(ul2);
  // regole della casa accese per questa mano (o per la prossima)
  const rules = state.game ? state.game.rules : state.houseRules;
  const active = mode === 'nomercy' ? [] : Object.keys(state.houseRuleNames).filter((k) => rules && rules[k]);
  if (active.length) {
    section('Regole della casa');
    const ul3 = document.createElement('ul');
    for (const k of active) {
      const li = document.createElement('li');
      li.textContent = HOUSE_RULE_HELP[k];
      ul3.append(li);
    }
    body.append(ul3);
  }
  $('rulesBox').classList.remove('hidden');
  body.scrollTop = 0;
  store(`uno-rules-${mode}`, '1');
}
$('rulesBtn').onclick = () => showRules(state.mode);
$('rulesBtn2').onclick = () => showRules(state.game ? state.game.mode : state.mode);
$('closeRules').onclick = () => $('rulesBox').classList.add('hidden');

// Suggerimento su cosa fare adesso
function hintText(g, s, myTurn) {
  const me = g.players.find((p) => p.id === s.you);
  if (!me || g.winner) return '';
  if (g.unoVulnerable === s.you) return '⚠️ Ti resta una carta: premi subito UNO! prima che ti becchino';
  if (g.unoVulnerable && g.unoVulnerable !== s.you) {
    return `👀 ${playerName(g, g.unoVulnerable)} non ha detto UNO! Premi "Non ha detto UNO!" per fargli pescare 2 carte`;
  }
  if (!myTurn) return `Aspetta il tuo turno: ora tocca a ${playerName(g, g.turnId)}`;
  const p = g.pending;
  if (p && p.type === 'stack') return `Rispondi con una carta pesca evidenziata oppure premi "Pesca ${p.amount} carte"`;
  if (p) return '';
  if (g.hasDrawn) {
    return g.mode === 'nomercy'
      ? 'Hai trovato una carta giocabile: toccala per giocarla'
      : 'Puoi giocare la carta che hai pescato (evidenziata) oppure premere "Passa"';
  }
  const canPlay = g.hand.some((c) => c.playable);
  if (!canPlay) {
    return g.mode === 'nomercy'
      ? 'Nessuna carta giocabile: tocca il mazzo, peschi finché ne trovi una'
      : 'Nessuna carta giocabile: tocca il mazzo per pescare';
  }
  if (me.cardCount === 2 && !me.saidUno) return 'Tocca una carta evidenziata per giocarla. Ti resterà una carta: premi UNO!';
  return 'Tocca una carta evidenziata per giocarla, oppure il mazzo per pescare';
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

socket.on('state', (s) => {
  state = s;
  const prevDeadline = timerDeadline;
  timerDeadline = s.turnRemaining != null ? Date.now() + s.turnRemaining : null;
  timerTotal = (s.turnTime || 0) * 1000;
  if (!prevDeadline || !timerDeadline || Math.abs(prevDeadline - timerDeadline) > 1000) timerBuzzed = false;
  render();
  updateTimers();
});

// --- Timer del turno ---
function timerRingEl() {
  const r = document.createElement('div');
  r.className = 'timer-ring';
  r.innerHTML = '<span></span>';
  return r;
}

function updateTimers() {
  const rings = document.querySelectorAll('.timer-ring:not(.hidden)');
  if (!timerDeadline || !timerTotal) return;
  const left = Math.max(0, timerDeadline - Date.now());
  const secs = Math.ceil(left / 1000);
  for (const r of rings) {
    r.style.setProperty('--p', Math.min(1, left / timerTotal));
    r.querySelector('span').textContent = secs;
    r.classList.toggle('urgent', secs <= 5);
  }
  // ultimi 5 secondi del mio turno: avviso
  const g = state && state.game;
  if (g && g.turnId === state.you && !g.winner && secs <= 5 && secs > 0 && !timerBuzzed) {
    timerBuzzed = true;
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
    toast('⏱ Sbrigati! Restano 5 secondi');
  }
}
setInterval(updateTimers, 200);

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
  const inner = document.createElement('div');
  inner.className = 'inner';
  inner.append(c1, val, c2);
  el.append(inner);
  el.title = describeCard(card);
  return el;
}

function backEl() {
  const el = document.createElement('div');
  el.className = 'card back';
  el.innerHTML = '<div class="inner"><span class="logo-mini">UNO</span></div>';
  return el;
}

// Colore dell'avatar ricavato dal nome
const AVATAR_COLORS = ['#e8322f', '#1f6fdc', '#2fa84f', '#f47b16', '#7a3dc4', '#e8438f', '#0aa6a6', '#c79a00'];
function avatarEl(name) {
  const a = document.createElement('div');
  a.className = 'avatar';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  a.style.background = AVATAR_COLORS[h % AVATAR_COLORS.length];
  a.textContent = (name.trim()[0] || '?').toUpperCase();
  return a;
}

// Rotazione "casuale" ma stabile per le carte nella pila degli scarti
function pileTilt(id) {
  return { r: ((id * 47) % 31) - 15, x: ((id * 13) % 9) - 4, y: ((id * 7) % 7) - 3 };
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
  const tc = $('timerChoice');
  tc.innerHTML = '';
  for (const t of s.turnTimes) {
    const b = document.createElement('button');
    b.textContent = t ? `${t}s` : 'Off';
    b.className = t === s.turnTime ? 'selected' : '';
    b.disabled = !isHost;
    b.onclick = () => socket.emit('timer', t);
    tc.append(b);
  }
  renderHouseRules(s, isHost);
  const list = $('memberList');
  list.innerHTML = '';
  for (const m of s.members) {
    const li = document.createElement('li');
    if (!seenMembers.has(m.id)) {
      seenMembers.add(m.id);
      li.className = 'new';
    }
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = m.name + (m.id === s.you ? ' (tu)' : '');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = m.bot
      ? `🤖 computer · ${m.level}`
      : (m.id === s.hostId ? '👑 host' : '') + (m.connected ? '' : ' offline');
    li.append(avatarEl(m.name), name, tag);
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
  $('botRow').classList.toggle('hidden', !isHost);
  const sel = $('botLevel');
  if (!sel.options.length) {
    for (const [k, v] of Object.entries(s.botLevels)) sel.add(new Option(`Livello: ${v}`, k, k === 'normal', k === 'normal'));
  }
  $('addBotBtn').disabled = s.members.length >= 10;
  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = s.members.length < 2;
  $('startBtn').textContent = s.members.length < 2 ? 'Servono almeno 2 giocatori: invita un amico o aggiungi un computer' : 'Inizia partita';
  $('waitHost').classList.toggle('hidden', isHost);
}

function render() {
  const s = state;
  const isHost = s.hostId === s.you;
  const g = s.game;

  if (!g) {
    lastGame = null;
    fromLobby = true;
    closeColorPicker();
    for (const id of ['challengeBox', 'swapBox', 'roundEnd']) $(id).classList.add('hidden');
    return renderLobby(s, isHost);
  }

  const prevG = lastGame;
  const before = snapshotRects();
  show('table');
  document.documentElement.classList.toggle('dark-side', g.side === 'dark');
  $('tableCode').textContent = s.code;
  $('modeName').textContent = s.modes[g.mode];
  // al tavolo si vede quali regole della casa sono accese
  const houseOn = Object.keys(HOUSE_RULE_UI).filter((k) => g.rules && g.rules[k]);
  if (houseOn.length) {
    const tags = document.createElement('span');
    tags.className = 'house-tags';
    tags.textContent = `· 🏠 ${houseOn.map((k) => HOUSE_RULE_UI[k].title).join(', ')}`;
    $('modeName').append(tags);
  }
  const myTurn = g.turnId === s.you && !g.winner;
  const pend = g.pending;
  const myPending = myTurn && pend ? pend.type : null;
  const turnName = playerName(g, g.turnId);
  $('turnInfo').textContent = g.winner ? 'Mano finita' : myTurn ? 'È il tuo turno!' : `Turno di ${turnName}`;
  if (!g.winner && g.nextId && g.nextId !== g.turnId) {
    const then = document.createElement('small');
    then.className = 'then';
    then.textContent = g.nextId === s.you ? ' · poi tocca a te' : ` · poi ${playerName(g, g.nextId)}`;
    $('turnInfo').append(then);
  }
  $('turnInfo').classList.toggle('mine', myTurn);

  renderOpponents(s, g);

  // Centro tavolo
  const discard = $('discard');
  discard.innerHTML = '';
  g.pile.forEach((c, i) => {
    const el = cardEl(c);
    const t = pileTilt(c.id);
    el.style.transform = `translate(${t.x}px, ${t.y}px) rotate(${t.r}deg)`;
    if (i < g.pile.length - 1) el.classList.add('under');
    else {
      el.id = 'topCard';
      // un Jolly in cima prende il colore scelto
      if (c.color === 'wild' && g.currentColor) el.style.setProperty('--c', `var(--${g.currentColor})`);
    }
    discard.append(el);
  });
  $('colorDot').style.background = g.currentColor ? `var(--${g.currentColor})` : 'transparent';
  $('colorDot').style.color = g.currentColor ? `var(--${g.currentColor})` : 'transparent';
  $('deckCount').textContent = `${g.deckCount} carte`;
  $('direction').classList.toggle('ccw', g.direction === -1);

  // Mazzo: in Flip si vede il retro della prima carta
  const deck = $('deck');
  deck.className = 'card back';
  deck.innerHTML = '<div class="inner"><span class="logo-mini">UNO</span></div>';
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

  $('myTimer').classList.toggle('hidden', !(myTurn && s.turnRemaining != null));
  const hint = hintText(g, s, myTurn);
  $('hint').classList.toggle('hidden', !hint);
  $('hint').textContent = hint;
  $('hint').classList.toggle('urgent', hint.startsWith('⚠️') || hint.startsWith('👀'));
  // la prima volta che si gioca una modalità si aprono le regole
  if (!prevG && !g.winner && !load(`uno-rules-${g.mode}`)) showRules(g.mode);

  $('takeBtn').classList.toggle('hidden', !stackPending);
  if (stackPending) $('takeBtn').textContent = `Pesca ${pend.amount} carte`;
  $('passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn && !pend && g.mode !== 'nomercy'));

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
    el.dataset.id = c.id;
    if (c.playable) el.classList.add('playable');
    else if (myTurn) el.classList.add('dim');
    el.onclick = () => playCard(c);
    hand.append(el);
  }
  fanHand(hand);
  const me = g.players.find((p) => p.id === s.you);
  $('unoBtn').classList.toggle('hidden', !me);
  $('unoBtn').disabled = !me || me.saidUno || !(me.cardCount === 1 || (me.cardCount === 2 && myTurn));
  if (!me && !g.winner) {
    $('turnInfo').textContent = g.eliminated.length ? 'Sei fuori: guardi la partita' : $('turnInfo').textContent;
  }

  renderRoundEnd(s, g, isHost);
  if (prevG) animateChanges(prevG, g, s, before);
  // a ogni nuova mano i contatori ripartono da capo: lì conta qualunque salto o lancio
  const newHand = prevG && prevG.winner && !g.winner;
  // la prima mano partita dalla sala d'attesa annuncia anche il salto dato dalla prima carta
  const startedFromLobby = !prevG && fromLobby;
  fromLobby = false;
  if (g.skip && (startedFromLobby || (prevG && (newHand || !prevG.skip || prevG.skip.seq !== g.skip.seq)))) announceSkip(g, s);
  lastGame = g;
}

// --- Mano a ventaglio ---
function fanHand(hand) {
  const cards = [...hand.children];
  const n = cards.length;
  if (!n) return;
  const cardW = cards[0].offsetWidth;
  const avail = hand.clientWidth - 24;
  const step = n > 1 ? Math.min(cardW + 8, (avail - cardW) / (n - 1)) : 0;
  const mid = (n - 1) / 2;
  const maxRot = Math.min(14, n * 1.6);
  const maxDrop = Math.min(16, n * 1.5);
  cards.forEach((el, i) => {
    const t = mid ? (i - mid) / mid : 0;
    el.style.marginLeft = i ? `${step - cardW}px` : '0';
    el.style.setProperty('--r', `${t * maxRot}deg`);
    el.style.setProperty('--y', `${t * t * maxDrop}px`);
  });
}
window.addEventListener('resize', () => {
  if (state && state.game) fanHand($('hand'));
});

// --- Animazioni ---
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function snapshotRects() {
  const hand = {};
  for (const el of document.querySelectorAll('#hand .card')) hand[el.dataset.id] = el.getBoundingClientRect();
  const opp = {};
  for (const el of document.querySelectorAll('.opp[data-pid]')) opp[el.dataset.pid] = el.getBoundingClientRect();
  return { hand, opp, deck: $('deck').getBoundingClientRect() };
}

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Fa volare "el" dal rettangolo "from" fino a "to" (dove finisce con la trasformazione "endTransform")
function fly(el, from, to, { delay = 0, endTransform = '', startScale = 1, endOpacity = 1, onDone } = {}) {
  el.classList.add('flying');
  $('fx').append(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const end = center(to);
  const start = center(from);
  el.style.left = `${end.x - w / 2}px`;
  el.style.top = `${end.y - h / 2}px`;
  const anim = el.animate(
    [
      { transform: `translate(${start.x - end.x}px, ${start.y - end.y}px) scale(${startScale}) rotate(-25deg)`, opacity: 0.7 },
      { transform: `${endTransform} scale(1)`, opacity: endOpacity },
    ],
    { duration: 420, delay, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' },
  );
  anim.onfinish = () => {
    el.remove();
    if (onDone) onDone();
  };
}

// Annuncio grande di chi perde il turno, più un timbro su ciascuno di loro
let skipTimer = null;
function announceSkip(g, s) {
  const mine = g.skip.ids.includes(s.you);
  const banner = $('skipBanner');
  banner.textContent = `⏭ ${mine ? 'Salti il turno! ' : ''}${g.skip.text}`;
  banner.classList.toggle('mine', mine);
  banner.classList.remove('hidden');
  banner.style.animation = 'none';
  void banner.offsetWidth; // riparte l'animazione anche con due salti di fila
  banner.style.animation = '';
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => banner.classList.add('hidden'), 2600);
  if (mine && navigator.vibrate) navigator.vibrate([60, 60, 60]);
  for (const id of g.skip.ids) {
    const el = id === s.you ? $('hand') : document.querySelector(`.opp[data-pid="${id}"]`);
    if (el) burst('⏭ SALTA', el.getBoundingClientRect());
  }
}

function burst(text, rect) {
  const b = document.createElement('div');
  b.className = 'uno-burst';
  b.textContent = text;
  const c = center(rect);
  b.style.left = `${c.x}px`;
  b.style.top = `${c.y}px`;
  $('fx').append(b);
  setTimeout(() => b.remove(), 1300);
}

function confetti(amount) {
  const colors = ['--red', '--yellow', '--green', '--blue', '--pink', '--orange'];
  for (let i = 0; i < amount; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = `var(${colors[i % colors.length]})`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    p.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    p.style.animationDuration = `${2 + Math.random() * 2}s`;
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    $('fx').append(p);
    setTimeout(() => p.remove(), 5000);
  }
}

function animateChanges(prev, g, s, before) {
  if (reduceMotion || (prev.winner && !g.winner)) return; // nuova mano: niente animazioni

  if (!prev.winner && g.winner) confetti(g.winner.id === s.you ? 140 : 70);

  // Turno appena diventato mio: piccola vibrazione sul telefono
  if (g.turnId === s.you && prev.turnId !== s.you && !g.winner && navigator.vibrate) navigator.vibrate(40);

  const top = g.pile[g.pile.length - 1];
  const prevTop = prev.pile[prev.pile.length - 1];
  const flipped = prev.side !== g.side;
  const topEl = $('topCard');
  if (playFlight && (flipped || (top && prevTop && top.id !== prevTop.id))) {
    // una nuova giocata interrompe l'animazione della precedente
    playFlight.remove();
    playFlight = null;
  }
  if (flipped) {
    // Flip: ogni carta si gira in 3D, una dopo l'altra
    const cards = [...document.querySelectorAll('#discard .card, #hand .card')];
    cards.forEach((el, i) => {
      el.animate([{ rotate: 'y -90deg' }, { rotate: 'y 0deg' }], {
        duration: 380,
        delay: i * 45,
        easing: 'cubic-bezier(.2,.8,.3,1)',
        fill: 'backwards',
      });
    });
  } else if (top && prevTop && top.id !== prevTop.id && topEl) {
    // Carta giocata: vola dalla mano (o dall'avversario) alla pila
    const actor = prev.turnId;
    const from = (actor === s.you && before.hand[top.id]) || before.opp[actor] || before.deck;
    const clone = cardEl(top);
    if (top.color === 'wild' && g.currentColor) clone.style.setProperty('--c', `var(--${g.currentColor})`);
    topEl.style.visibility = 'hidden';
    playFlight = clone;
    fly(clone, from, $('discard').getBoundingClientRect(), {
      endTransform: topEl.style.transform,
      startScale: actor === s.you ? 1 : 0.5,
      onDone: () => {
        topEl.style.visibility = '';
        if (playFlight === clone) playFlight = null;
      },
    });
  }

  // Carte pescate: dal mazzo verso chi le prende (non per scambi di mano)
  const handsMoved = prev.pending && prev.pending.type === 'swap' || (top && top.value === '0' && (g.mode === 'nomercy' || g.rules.sevenZero) && top.id !== (prevTop && prevTop.id));
  for (const p of g.players) {
    const old = prev.players.find((x) => x.id === p.id);
    if (!old) continue;
    const target = p.id === s.you ? $('hand') : document.querySelector(`.opp[data-pid="${p.id}"]`);
    if (!target) continue;
    const gained = p.cardCount - old.cardCount;
    if (gained > 0 && !handsMoved) {
      const to = target.getBoundingClientRect();
      for (let i = 0; i < Math.min(gained, 6); i++) {
        fly(backEl(), before.deck, to, {
          delay: i * 90,
          startScale: 1,
          endTransform: p.id === s.you ? '' : 'scale(0.4)',
          endOpacity: p.id === s.you ? 1 : 0,
        });
      }
    }
    if (p.saidUno && !old.saidUno) burst('UNO!', target.getBoundingClientRect());
  }
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
    if (!g.winner && (p.id === g.turnId || p.id === g.nextId)) {
      const tag = document.createElement('div');
      tag.className = 'opp-tag' + (p.id === g.turnId ? ' now' : '');
      tag.textContent = p.id === g.turnId ? 'di turno' : 'poi';
      d.append(tag);
    }
    d.dataset.pid = p.id;
    if (p.id === g.turnId && !g.winner && s.turnRemaining != null) d.append(timerRingEl());
    const name = document.createElement('div');
    name.className = 'head';
    const nameText = document.createElement('span');
    nameText.className = 'name';
    nameText.textContent = p.name + (member && !member.connected ? ' 📴' : '') + (member && member.bot ? ' 🤖' : '');
    if (member && member.bot) nameText.title = `Computer (${member.level})`;
    name.append(avatarEl(p.name), nameText);
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
    $('winnerText').textContent = mw.id === s.you ? `Hai vinto la partita con ${mw.score} punti!` : `${mw.name} vince la partita con ${mw.score} punti!`;
  } else {
    $('winnerText').textContent = g.winner.id === s.you ? 'Hai vinto la mano!' : `${g.winner.name} vince la mano!`;
  }
  $('targetText').textContent = mw ? 'Fine partita' : `Vince la partita chi arriva a ${s.targetScore} punti`;
  $('nextRoundBtn').textContent = mw ? 'Nuova partita' : 'Nuova mano';
  const table = $('scoreTable');
  table.innerHTML = '';
  for (const m of [...s.members].sort((a, b) => b.score - a.score)) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = m.name + (m.bot ? ' 🤖' : '');
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
