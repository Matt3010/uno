'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const setupUno = require('./uno/server');
const setupGolf = require('./golf/server');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// i vecchi link di UNO (/?room=XXXX) portano ancora alla stanza
app.get('/', (req, res, next) => (req.query.room ? res.redirect(`/uno/?room=${encodeURIComponent(req.query.room)}`) : next()));
app.use(express.static(path.join(__dirname, 'public')));
// codice del golf usato anche dal browser (fisica e percorso) e la libreria 3D
for (const f of ['physics.js', 'course.js']) app.get(`/golf/lib/${f}`, (_req, res) => res.sendFile(path.join(__dirname, 'golf', f)));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.get('/health', (_req, res) => res.send('ok'));

setupUno(io);
setupGolf(io.of('/golf'));

server.listen(PORT, () => {
  console.log(`Giochi online su http://localhost:${server.address().port}`);
});
