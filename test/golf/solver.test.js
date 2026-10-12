'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateCourse } = require('../../golf/course');
const { solveHole } = require('../../golf/solver');

// Un giocatore automatico deve riuscire a finire ogni buca generata: nessuna buca impossibile
test('ogni buca generata si può finire', () => {
  for (let seed = 1; seed <= 3; seed++) {
    generateCourse(seed).forEach((hole, i) => {
      const r = solveHole(hole, { maxShots: 15 });
      assert.ok(r.sunk, `seme ${seed}, buca ${i + 1}: non finita in ${r.shots} colpi`);
    });
  }
});
