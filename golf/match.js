'use strict';
// Golf: una partita. Tutti giocano insieme la stessa buca; vince chi in totale fa meno colpi.
const { generateCourse, HOLES } = require('./course');

const MAX_STROKES = 10;

class GolfError extends Error {}

class GolfMatch {
  constructor(players, { seed, holes = HOLES } = {}) {
    this.seed = seed;
    this.course = generateCourse(seed, holes);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.holeIndex = 0;
    this.over = false;
    this.strokes = {};
    this.done = {};
    for (const p of this.players) this.strokes[p.id] = [0];
  }

  get hole() {
    return this.course[this.holeIndex];
  }

  check(id) {
    if (this.over) throw new GolfError('La partita è finita');
    if (!this.strokes[id]) throw new GolfError('Non sei in partita');
    if (this.done[id]) throw new GolfError('Hai già finito questa buca');
  }

  add(id, n) {
    const s = this.strokes[id];
    s[this.holeIndex] = Math.min(MAX_STROKES, s[this.holeIndex] + n);
  }

  shot(id) {
    this.check(id);
    if (this.strokes[id][this.holeIndex] >= MAX_STROKES) throw new GolfError('Hai finito i colpi');
    this.add(id, 1);
  }

  sunk(id) {
    this.check(id);
    this.done[id] = true;
  }

  // in acqua: un colpo di penalità e si riparte da dove si era tirato
  water(id) {
    this.check(id);
    this.add(id, 1);
  }

  // la pallina si è fermata fuori dalla buca: all'ultimo colpo disponibile la buca è finita
  rest(id) {
    this.check(id);
    if (this.strokes[id][this.holeIndex] >= MAX_STROKES) this.done[id] = true;
  }

  timeUp() {
    for (const p of this.players) {
      if (this.done[p.id]) continue;
      this.strokes[p.id][this.holeIndex] = MAX_STROKES;
      this.done[p.id] = true;
    }
  }

  holeOver() {
    return this.players.every((p) => this.done[p.id]);
  }

  nextHole() {
    if (this.holeIndex >= this.course.length - 1) {
      this.over = true;
      return;
    }
    this.holeIndex++;
    this.done = {};
    for (const p of this.players) this.strokes[p.id][this.holeIndex] = 0;
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    delete this.done[id];
  }

  totals() {
    const t = {};
    for (const [id, list] of Object.entries(this.strokes)) t[id] = list.reduce((a, b) => a + b, 0);
    return t;
  }

  ranking() {
    const t = this.totals();
    return this.players.map((p) => ({ id: p.id, name: p.name, total: t[p.id] })).sort((a, b) => a.total - b.total);
  }
}

module.exports = { GolfMatch, GolfError, MAX_STROKES };
