# UNO Online 🃏

Una copia di UNO giocabile online con gli amici, direttamente dal browser (anche da telefono).

- Stanze private con codice di 4 lettere e link da condividere
- Da 2 a 10 giocatori, tutto in tempo reale (Socket.IO)
- Regole classiche: Salta, Inverti, +2, Jolly, Jolly +4
- Pulsante **UNO!** e possibilità di "beccare" chi se lo dimentica (+2 carte)
- Punteggio cumulativo tra le mani, chat, riconnessione automatica se cade la linea

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

## Come si gioca

Le regole sono quelle **ufficiali** di UNO.

1. Uno crea la stanza e condivide il link (o il codice).
2. Gli altri entrano con il proprio nome; l'host preme **Inizia partita**.
   Chi distribuisce ruota a ogni mano e inizia il giocatore alla sua sinistra.
3. Al tuo turno clicca una carta evidenziata, oppure pesca una carta dal mazzo.
   Se la carta pescata è giocabile puoi giocarla subito o premere **Passa**.
4. **Jolly +4**: si può giocare sempre, ma è regolare solo se non hai carte del colore in tavola.
   Chi lo riceve può **accettare** (pesca 4 e salta il turno) o **sfidare**:
   - se era un bluff, le 4 carte le pesca chi l'ha giocato e chi ha sfidato gioca normalmente;
   - se era regolare, chi ha sfidato pesca 6 carte e salta il turno.
5. **Prima carta scoperta**: si applica il suo effetto (Salta, Inverti, +2; con il Jolly il primo
   giocatore sceglie il colore). Un Jolly +4 viene rimesso nel mazzo.
6. In 2 giocatori **Inverti** vale come **Salta**.
7. Quando stai per rimanere con una carta premi **UNO!** (prima o subito dopo aver giocato).
   Se te lo dimentichi, gli altri possono premere *"Non ha detto UNO!"* finché il giocatore
   successivo non agisce: peschi 2 carte.
8. Chi finisce le carte vince la mano e prende i punti delle carte rimaste agli altri
   (numeri = valore, azioni = 20, jolly = 50). Se l'ultima carta è un +2/+4, il giocatore
   successivo pesca comunque e quelle carte contano nei punti.
9. Vince la **partita** chi arriva per primo a **500 punti**.

## Sviluppo

```bash
npm test
```

- `game.js` – logica delle regole (indipendente dal server)
- `server.js` – server Express + Socket.IO, gestione stanze
- `public/` – client web (HTML/CSS/JS senza build)
