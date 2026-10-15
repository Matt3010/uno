# UNO Online 🃏

Una copia di UNO giocabile online con gli amici, direttamente dal browser (anche da telefono).

- Stanze private con codice di 4 lettere e link da condividere
- Da 2 a 10 giocatori, tutto in tempo reale (Socket.IO)
- Tre modalità: **UNO Classico**, **UNO Flip** e **UNO Show 'Em No Mercy**
- Pulsante **UNO!** e possibilità di "beccare" chi se lo dimentica (+2 carte)
- Punteggio cumulativo tra le mani, riconnessione automatica se cade la linea
- **Giocatori computer** da aggiungere insieme agli amici (Facile, Normale, Difficile): pensano qualche
  secondo, dicono UNO (a volte se lo dimenticano) e beccano chi non lo dice
- **Timer per turno** (Off / 15 / 30 / 60 secondi, scelto dall'host): allo scadere il gioco muove da solo
  (pesca e passa; nelle scelte accetta, sceglie il colore più presente in mano o scambia con chi ha meno carte)
- Aiuto nel gioco: pulsante **❓ Regole** con le carte spiegate, suggerimenti su cosa fare a ogni turno
  e spiegazione quando tocchi una carta che non puoi giocare

## Giocare in locale

```bash
npm install
npm start
```

Apri <http://localhost:3000>. Per giocare con amici sulla stessa rete Wi‑Fi, fagli aprire
`http://<IP-del-tuo-pc>:3000`.

## Metterlo online (gratis) per giocare con gli amici

### Opzione 1 – Render.com (consigliata)

1. Vai su <https://render.com> e accedi con GitHub.
2. **New → Blueprint** e scegli questo repository (usa `render.yaml`),
   oppure **New → Web Service** con build `npm ci --omit=dev` e start `npm start`.
3. Dopo il deploy avrai un indirizzo tipo `https://uno-online.onrender.com`: condividilo con gli amici.

> Il piano gratuito si "addormenta" dopo un po' di inattività: il primo accesso può richiedere ~30 secondi.

### Opzione 2 – Docker (Fly.io, Railway, VPS…)

```bash
docker build -t uno-online .
docker run -p 3000:3000 uno-online
```

### Opzione 3 – Tunnel veloce dal tuo PC

Con il server avviato in locale: `npx localtunnel --port 3000` oppure
`cloudflared tunnel --url http://localhost:3000`, e condividi l'URL che ti viene dato.

## Giocare dal terminale

C'è anche una versione **da terminale**, a colori, che si collega allo **stesso server** del sito: chi gioca
dal terminale sta nella stessa stanza di chi gioca dal browser.

### Modo 1 – dal tuo computer (serve Node.js)

```bash
git clone https://github.com/Matt3010/uno.git && cd uno
npm install
npm run terminale
# opzionali: --nome Mario --stanza ABCD
```

Si collega al sito **https://uno.scanferlamatteo.work** (stesse stanze di chi gioca dal browser).
Per un altro server: `npm run terminale -- --server https://altro-sito` (in locale: `--server http://localhost:3000`).

### Modo 2 – via SSH, senza installare niente

Chi vuole giocare scrive solo:

```bash
ssh -p 2222 mario@indirizzo-del-server
```

e si ritrova nel gioco col nome `mario`. Non serve password e non dà accesso al server: si può solo giocare.
Per attivarlo avvia il server con la variabile `SSH_PORT`:

```bash
SSH_PORT=2222 npm start
# oppure con Docker:
docker run -p 3000:3000 -p 2222:2222 -e SSH_PORT=2222 uno-online
```

Serve un posto dove la porta 2222 sia raggiungibile da fuori: un VPS, un PC di casa con la porta
inoltrata dal router, un tunnel TCP (es. `ngrok tcp 2222`) o un hosting che permette porte TCP (es. Fly.io).
Il piano gratuito di Render **non** lo permette (solo siti web): lì usa il modo 1.

### Tasti

- **← →** scegli la carta · **Invio** giocala · **P** pesca · **A** passa
- **U** grida UNO! · **B** becca chi non l'ha detto · **Q** (due volte) esci
- Nella sala d'attesa l'host usa **1-3** per la modalità, **4-6** per le regole della casa, **T** per il tempo,
  **F/B/D** per aggiungere computer facili/normali/difficili e **S** per iniziare

## Come si gioca

1. Uno crea la stanza e condivide il link (o il codice).
2. L'host sceglie la modalità; gli altri entrano con il proprio nome e l'host preme **Inizia partita**.
   Chi distribuisce ruota a ogni mano e inizia il giocatore alla sua sinistra.
3. Al tuo turno clicca una carta evidenziata, oppure pesca dal mazzo.
4. Quando stai per rimanere con una carta premi **UNO!** (prima o subito dopo aver giocato).
   Se te lo dimentichi, gli altri possono premere *"Non ha detto UNO!"* finché il giocatore
   successivo non agisce: peschi 2 carte.
5. Chi finisce le carte vince la mano e prende i punti delle carte rimaste agli altri.
   A fine mano l'host può passare a un'altra modalità (i punteggi si azzerano).

### UNO Classico (108 carte, si vince a 500 punti)

- Carte: numeri 0-9, Salta, Inverti, +2, Jolly, Jolly +4. In 2 giocatori **Inverti** vale come **Salta**.
- Se la carta pescata è giocabile puoi giocarla subito o premere **Passa**.
- **Jolly +4**: si può giocare sempre, ma è regolare solo se non hai carte del colore in tavola.
  Chi lo riceve può **accettare** (pesca 4 e salta il turno) o **sfidare**: se era un bluff le 4 carte
  le pesca chi l'ha giocato, se era regolare chi sfida pesca 6 carte e salta il turno.
- **Prima carta scoperta**: si applica il suo effetto (con il Jolly il primo giocatore sceglie il colore);
  un Jolly +4 torna nel mazzo.
- Se l'ultima carta è un +2/+4, il giocatore successivo pesca comunque e quelle carte contano nei punti.
- Punti: numeri = valore, azioni = 20, jolly = 50.

### UNO Flip (112 carte a doppia faccia, si vince a 500 punti)

- **Lato chiaro** (rosso, giallo, verde, blu): numeri 1-9, **+1**, Salta, Inverti, **Flip**, Jolly, **Jolly +2**.
- **Lato scuro** (rosa, azzurro, arancione, viola): numeri 1-9, **+5**, Inverti, **Salta tutti**
  (giochi di nuovo), **Flip**, Jolly, **Jolly pesca colore** (il successivo pesca finché non esce il colore scelto).
- **Flip**: si girano mazzo, pila degli scarti e tutte le mani; si gioca sulla nuova carta in cima.
  Se è un Jolly, il colore lo sceglie chi ha giocato il Flip.
- Vedi il **retro** delle carte degli avversari e della prima carta del mazzo (cioè la loro altra faccia).
- Jolly +2 e Jolly pesca colore si possono **sfidare** come il +4 classico
  (se la sfida fallisce chi sfida pesca la penalità più 2 carte).
- Punti contati sul lato in gioco: +1 = 10; +5, Salta, Inverti, Flip = 20; Salta tutti = 30;
  Jolly = 40; Jolly +2 = 50; Jolly pesca colore = 60.

### UNO Show 'Em No Mercy (168 carte, si vince a 1000 punti)

- Carte colorate: numeri 0-9, Salta, Inverti, +2, **+4**, **Salta tutti**, **Scarta tutto**
  (scarti con lei tutte le carte di quel colore). Jolly: **Jolly inverti +4**, **+6**, **+10**, **Roulette dei colori**.
- **Accumulo**: a un +2/+4/+6/+10 puoi rispondere con una carta pesca di valore **uguale o superiore**
  (il colore non conta). Chi non può o non vuole rilanciare pesca il totale e salta il turno.
- **Roulette dei colori**: il giocatore successivo sceglie un colore e pesca finché non esce.
- **7**: scambi la mano con un giocatore a scelta. **0**: tutti passano la mano nella direzione di gioco.
- **Si pesca finché non si trova una carta giocabile**, che poi va giocata.
- **Regola della pietà**: con **25 carte** o più sei eliminato. Vince chi finisce le carte o resta l'ultimo.
- Niente sfide sui Jolly: si possono giocare sempre.
- Punti: numeri = valore, azioni colorate = 20, jolly = 50, ogni giocatore eliminato = 250.

## Sviluppo

```bash
npm test
```

- `server.js` – server Express + Socket.IO (la pagina iniziale porta a `/uno/`)
- `uno/game.js` – logica delle regole (indipendente dal server)
- `uno/server.js` – stanze, turni, timer e giocatori computer
- `uno/bot.js` – giocatori computer (scelta della mossa per livello)
- `public/uno/` – client web (HTML/CSS/JS senza build)
- `terminal/` – versione da terminale (`tui.js`), comando locale (`cli.js`) e server SSH (`ssh.js`)
- `test/` – test automatici (`npm test`)
