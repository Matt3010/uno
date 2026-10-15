'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const setupUno = require('./uno/server');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// la pagina iniziale è UNO; i vecchi link (/?room=XXXX) portano ancora alla stanza
app.get('/', (req, res) => res.redirect(req.query.room ? `/uno/?room=${encodeURIComponent(req.query.room)}` : '/uno/'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

setupUno(io);

server.listen(PORT, () => {
  console.log(`UNO online su http://localhost:${server.address().port}`);
  // con SSH_PORT si può giocare anche dal terminale:  ssh -p 2222 nome@indirizzo
  if (process.env.SSH_PORT) {
    require('./terminal/ssh').startSshServer({
      port: Number(process.env.SSH_PORT),
      gameServer: `http://localhost:${server.address().port}`,
    });
  }
});
