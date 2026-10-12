'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

const SYMBOLS = {
  skip: '⊘', reverse: '⇄', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5',
  skipall: '⊘⊘', flip: 'FLIP', discardall: '⇊',
  wild: '★', wild4: '+4', wild2: '+2', wildcolor: '+?',
  wildrev4: '⇄4', wild6: '+6', wild10: '+10', roulette: '?',
  slot: '🎰', dice: '🎲', raise: '💰',
};
const EMOJI_CARDS = ['slot', 'dice', 'raise'];
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
  gambling: [
    [{ color: 'wild', value: 'slot' }, 'Slot machine (Jolly): scegli il colore e tiri la leva. 7️⃣7️⃣7️⃣ = +100 fiches e gli altri pescano 3 · tris = +30 e gli altri pescano 2 · coppia = +10 e il successivo pesca 1 · niente = paghi 10 nel piatto e peschi 1.'],
    [{ color: 'red', value: 'dice' }, 'Dadi: doppio = vinci 10× il numero e rigiochi · 7 = gli altri pescano 1 · 10 o più = il successivo pesca 2 e salta · 4 o meno = peschi tu 2.'],
    [{ color: 'green', value: 'raise' }, 'Rilancio: tutti mettono altre 10 fiches nel piatto.'],
    [{ color: 'wild', value: 'wild4' }, 'Valgono anche tutte le carte del Classico (Salta, Inverti, +2, Jolly, Jolly +4).'],
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
  gambling: [
    'Le fiches sono finte, solo per gioco. Si parte con 100 fiches e a ogni mano tutti ne mettono 10 nel piatto.',
    'Chi finisce le carte prende il piatto più 2 fiches per ogni carta rimasta agli avversari.',
    'Se ti beccano senza UNO, oltre a pescare 2 carte paghi 10 fiches a chi ti ha beccato.',
    'Vince chi arriva a 500 fiches o resta l\'ultimo con le fiches.',
  ],
};

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
  if (EMOJI_CARDS.includes(card.value)) el.classList.add('emoji');
  else if (label.length > 2 || card.value === 'skipall') el.classList.add('long');
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
  slot: 'Slot machine', dice: 'Dadi', raise: 'Rilancio',
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
  // Casinò: piatto e fiches
  $('potBox').classList.toggle('hidden', g.pot == null);
  if (g.pot != null) $('potAmount').textContent = g.pot;
  const meP = g.players.find((p) => p.id === s.you);
  $('myChips').classList.toggle('hidden', !meP || meP.chips == null);
  if (meP && meP.chips != null) $('myChips').textContent = `🪙 ${meP.chips} fiches`;
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
  if (prevG && g.skip && (!prevG.skip || prevG.skip.seq !== g.skip.seq)) announceSkip(g, s);
  // Casinò: slot machine o dadi appena giocati
  $('casinoTable').classList.toggle('hidden', g.mode !== 'gambling');
  $('center').classList.toggle('casino', g.mode === 'gambling');
  if (g.event && (!prevG || !prevG.event || prevG.event.seq !== g.event.seq)) {
    if (prevG) showCasinoEvent(g);
    else showCasinoStatic(g);
  }
  lastGame = g;
}

// --- Casinò: slot machine e dadi sul tavolo ---
const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// rotazione del cubo che porta la faccia n davanti
const DIE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const DIE_TILT = { die1: -8, die2: 11 };
let msgTimer = null;
let resultTimer = null; // risultato in attesa che finisca l'animazione

function dieFace(el, n) {
  el.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('i');
    if (PIPS[n].includes(i)) pip.className = 'on';
    el.append(pip);
  }
}

// costruisce le 6 facce di ogni dado
for (const id of ['die1', 'die2']) {
  const cube = document.querySelector(`#${id} .cube`);
  for (let n = 1; n <= 6; n++) {
    // cubo interno pieno: chiude i buchi lasciati dagli angoli arrotondati delle facce
    const core = document.createElement('div');
    core.className = `core f${n}`;
    cube.append(core);
  }
  for (let n = 1; n <= 6; n++) {
    const face = document.createElement('div');
    face.className = `face f${n}`;
    dieFace(face, n);
    cube.append(face);
  }
}

function dieTransform(n) {
  const [x, y] = DIE_ROT[n];
  return `rotateX(${x}deg) rotateY(${y}deg)`;
}

function setDice(values) {
  ['die1', 'die2'].forEach((id, i) => {
    $(id).style.transform = `rotateZ(${DIE_TILT[id]}deg)`;
    document.querySelector(`#${id} .cube`).style.transform = dieTransform(values[i]);
  });
}

function setReels(symbols) {
  document.querySelectorAll('#slotMachine .strip').forEach((strip, i) => {
    strip.getAnimations().forEach((a) => a.cancel());
    strip.innerHTML = `<span>${symbols[i]}</span>`;
    strip.style.transform = '';
  });
}

function rollDice(values) {
  ['die1', 'die2'].forEach((id, i) => {
    const wrap = $(id);
    const cube = wrap.querySelector('.cube');
    const [x, y] = DIE_ROT[values[i]];
    const tilt = DIE_TILT[id];
    const dir = i ? 1 : -1;
    // il dado entra dal bordo del tavolo, rimbalza e si ferma
    wrap.animate(
      [
        { transform: `translate(${dir * 90}px, -70px) rotateZ(${tilt - 200}deg)`, opacity: 0 },
        { transform: `translate(${dir * 40}px, 4px) rotateZ(${tilt - 80}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dir * 14}px, -12px) rotateZ(${tilt - 25}deg)`, offset: 0.7 },
        { transform: `translate(${dir * 4}px, 0) rotateZ(${tilt - 6}deg)`, offset: 0.88 },
        { transform: `rotateZ(${tilt}deg)` },
      ],
      { duration: 1100, easing: 'ease-out' },
    );
    cube.animate(
      [{ transform: `rotateX(${x - 720 - i * 180}deg) rotateY(${y + 540 + i * 90}deg)` }, { transform: dieTransform(values[i]) }],
      { duration: 1100, easing: 'cubic-bezier(.15,.7,.3,1)' },
    );
    wrap.style.transform = `rotateZ(${tilt}deg)`;
    cube.style.transform = dieTransform(values[i]);
  });
  return 1100;
}

function spinSlot(final) {
  const lever = $('slotLever');
  lever.classList.remove('pull');
  void lever.offsetWidth; // riavvia l'animazione della leva
  lever.classList.add('pull');
  let longest = 0;
  document.querySelectorAll('#slotMachine .strip').forEach((strip, i) => {
    const current = strip.lastElementChild ? strip.lastElementChild.textContent : '7️⃣';
    strip.getAnimations().forEach((a) => a.cancel());
    const symbols = [current];
    for (let k = 0; k < 16 + i * 5; k++) symbols.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
    symbols.push(final[i]);
    strip.innerHTML = symbols.map((sym) => `<span>${sym}</span>`).join('');
    const duration = 1100 + i * 450;
    longest = Math.max(longest, duration);
    strip.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(calc(-${symbols.length - 1} * var(--reel-h)))` }],
      { duration, delay: 250, easing: 'cubic-bezier(.12,.6,.25,1.04)', fill: 'forwards' },
    );
  });
  return longest + 250;
}

function casinoMessage(text, jackpot) {
  const msg = $('casinoMsg');
  msg.textContent = text;
  msg.classList.add('show');
  $('slotMachine').classList.toggle('jackpot', !!jackpot);
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    msg.classList.remove('show');
    $('slotMachine').classList.remove('jackpot');
  }, 4500);
}

// Prima volta al tavolo (o riconnessione): mostra l'ultimo risultato senza animazioni
function showCasinoStatic(g) {
  const ev = g.event;
  if (!ev) return;
  if (ev.type === 'slot') setReels(ev.reels);
  else setDice(ev.dice);
}

function showCasinoEvent(g) {
  const ev = g.event;
  const who = playerName(g, ev.playerId);
  const jackpot = ev.text.startsWith('JACKPOT');
  let wait = 0;
  if (reduceMotion) {
    showCasinoStatic(g);
  } else if (ev.type === 'slot') {
    wait = spinSlot(ev.reels);
  } else {
    wait = rollDice(ev.dice);
  }
  casinoMessage(ev.type === 'slot' ? `🎰 ${who} tira la leva…` : `🎲 ${who} lancia i dadi…`);
  clearTimeout(resultTimer); // un nuovo lancio sostituisce il risultato del precedente
  resultTimer = setTimeout(() => {
    casinoMessage(`${ev.type === 'slot' ? '🎰' : '🎲'} ${ev.text}`, jackpot);
    if (jackpot) confetti(120);
  }, wait);
}
setDice([6, 6]);

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
  const handsMoved = prev.pending && prev.pending.type === 'swap' || (top && top.value === '0' && g.mode === 'nomercy' && top.id !== (prevTop && prevTop.id));
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
    if (p.chips != null) {
      const chips = document.createElement('div');
      chips.className = 'opp-chips' + (p.chips === 0 ? ' broke' : '');
      chips.textContent = `🪙 ${p.chips}`;
      d.append(chips);
    }
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
    const u = g.mode === 'gambling' ? 'fiches' : 'punti';
    $('winnerText').textContent = mw.id === s.you ? `Hai vinto la partita con ${mw.score} ${u}!` : `${mw.name} vince la partita con ${mw.score} ${u}!`;
  } else {
    $('winnerText').textContent = g.winner.id === s.you ? 'Hai vinto la mano!' : `${g.winner.name} vince la mano!`;
  }
  const casino = g.mode === 'gambling';
  const unit = casino ? 'fiches' : 'pt';
  if (casino && !mw) {
    $('winnerText').textContent += ` (+${g.winner.points} fiches)`;
  }
  $('targetText').textContent = mw
    ? 'Fine partita'
    : casino
      ? `Vince chi arriva a ${s.targetScore} fiches o resta l'ultimo con le fiches`
      : `Vince la partita chi arriva a ${s.targetScore} punti`;
  $('nextRoundBtn').textContent = mw ? 'Nuova partita' : 'Nuova mano';
  const table = $('scoreTable');
  table.innerHTML = '';
  for (const m of [...s.members].sort((a, b) => b.score - a.score)) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = m.name + (m.bot ? ' 🤖' : '');
    const b = document.createElement('td');
    b.textContent = `${m.score} ${unit}`;
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
