'use strict';
// UNO Casinò: come dividere un mucchio di fiche in pile per taglio (usato dal browser e dai test)
(function (root) {
  const DENOMS = [100, 25, 10, 5, 1];
  const MAX_PILE = 8;

  function chipColumns(amount) {
    const cols = [];
    let rest = Math.max(0, Math.floor(amount || 0));
    for (const value of DENOMS) {
      const count = Math.floor(rest / value);
      if (!count) continue;
      cols.push({ value, count: Math.min(count, MAX_PILE) });
      if (count > MAX_PILE) break; // pila piena: il resto non si disegna
      rest -= count * value;
    }
    return cols;
  }

  const api = { chipColumns, DENOMS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Chips = api;
})(this);
