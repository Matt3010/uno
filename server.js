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

// i vecchi link di UNO (/?room=XXXX) portano ancora alla stanza
app.get('/', (req, res, next) => (req.query.room ? res.redirect(`/uno/?room=${encodeURIComponent(req.query.room)}`) : next()));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

setupUno(io);

server.listen(PORT, () => {
  console.log(`Giochi online su http://localhost:${server.address().port}`);
});
