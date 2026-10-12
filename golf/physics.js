'use strict';
// Golf: fisica della pallina sul piano (x, z). La stessa usata dal browser e dai test.
// Una buca è fatta di muri (segmenti), funghi (cerchi), zone (sabbia, acqua, discese) e pale che girano.
(function (root) {
  const BALL_R = 0.12;
  const CUP_R = 0.22;
  const MAX_SPEED = 14; // m/s con la forza al massimo
  const CAPTURE_SPEED = 3.2; // più veloce di così la pallina passa sopra la buca
  const DT = 1 / 240;
  const REST_SPEED = 0.06;
  const WALL_BOUNCE = 0.75;
  const BUMPER_BOUNCE = 1.15;
  // attrito: frenata proporzionale alla velocità + frenata costante
  const FRICTION = { grass: [0.6, 0.9], sand: [2.8, 3.2] };

  function createBall(x, z) {
    return { x, z, vx: 0, vz: 0 };
  }

  function shoot(ball, angle, power) {
    const p = Math.max(0, Math.min(1, power));
    ball.vx = Math.cos(angle) * p * MAX_SPEED;
    ball.vz = Math.sin(angle) * p * MAX_SPEED;
  }

  function speed(ball) {
    return Math.hypot(ball.vx, ball.vz);
  }

  function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  // Tutti i muri fissi della buca: bordi del pavimento più i muri interni
  const cache = new WeakMap();
  function segments(hole) {
    let segs = cache.get(hole);
    if (segs) return segs;
    segs = [];
    if (hole.floor) {
      const f = hole.floor;
      for (let i = 0; i < f.length; i++) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        segs.push([a[0], a[1], b[0], b[1]]);
      }
    }
    for (const w of hole.walls || []) segs.push(w);
    cache.set(hole, segs);
    return segs;
  }

  // Estremi della pala al tempo t (gira attorno al proprio centro)
  function spinnerSegment(s, t) {
    const a = (s.phase || 0) + s.speed * t;
    const hx = (Math.cos(a) * s.len) / 2;
    const hz = (Math.sin(a) * s.len) / 2;
    return [s.x - hx, s.z - hz, s.x + hx, s.z + hz];
  }

  function zoneAt(hole, x, z, type) {
    for (const zone of hole.zones || []) if (zone.type === type && inPoly(x, z, zone.poly)) return zone;
    return null;
  }

  function slopeForce(hole, x, z) {
    let fx = 0;
    let fz = 0;
    for (const zone of hole.zones || []) {
      if (zone.type === 'slope' && inPoly(x, z, zone.poly)) {
        fx += zone.force[0];
        fz += zone.force[1];
      }
    }
    return [fx, fz];
  }

  // Urto con un segmento; (svx, svz) è la velocità del muro nel punto di contatto (per le pale)
  function collideSegment(b, seg, svx = 0, svz = 0) {
    const [x1, z1, x2, z2] = seg;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((b.x - x1) * dx + (b.z - z1) * dz) / len2));
    const qx = x1 + u * dx;
    const qz = z1 + u * dz;
    let nx = b.x - qx;
    let nz = b.z - qz;
    const d = Math.hypot(nx, nz);
    if (d >= BALL_R) return false;
    if (d < 1e-9) {
      // proprio sopra il segmento: si spinge via perpendicolarmente
      nx = -dz;
      nz = dx;
    }
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    b.x = qx + nx * BALL_R;
    b.z = qz + nz * BALL_R;
    const rvx = b.vx - svx;
    const rvz = b.vz - svz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      b.vx -= (1 + WALL_BOUNCE) * vn * nx;
      b.vz -= (1 + WALL_BOUNCE) * vn * nz;
    }
    return true;
  }

  function collideBumper(b, c) {
    let nx = b.x - c.x;
    let nz = b.z - c.z;
    const d = Math.hypot(nx, nz);
    const min = c.r + BALL_R;
    if (d >= min) return;
    if (d < 1e-9) {
      nx = 1;
      nz = 0;
    } else {
      nx /= d;
      nz /= d;
    }
    b.x = c.x + nx * min;
    b.z = c.z + nz * min;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + BUMPER_BOUNCE) * vn * nx;
      b.vz -= (1 + BUMPER_BOUNCE) * vn * nz;
    }
    const s = speed(b);
    if (s > MAX_SPEED) {
      b.vx *= MAX_SPEED / s;
      b.vz *= MAX_SPEED / s;
    }
  }

  // Un passo di simulazione al tempo t; restituisce 'sunk', 'water' o null
  function step(b, hole, dt, t) {
    const [fx, fz] = slopeForce(hole, b.x, b.z);
    const [k, c] = zoneAt(hole, b.x, b.z, 'sand') ? FRICTION.sand : FRICTION.grass;
    b.vx += fx * dt;
    b.vz += fz * dt;
    const s = speed(b);
    if (s > 0) {
      const ns = Math.max(0, s - (k * s + c) * dt);
      b.vx *= ns / s;
      b.vz *= ns / s;
    }
    b.x += b.vx * dt;
    b.z += b.vz * dt;

    for (const seg of segments(hole)) collideSegment(b, seg);
    for (const bump of hole.bumpers || []) collideBumper(b, bump);
    for (const sp of hole.spinners || []) {
      const seg = spinnerSegment(sp, t);
      // velocità della pala nel punto più vicino alla pallina: omega × r
      const rx = b.x - sp.x;
      const rz = b.z - sp.z;
      collideSegment(b, seg, -sp.speed * rz, sp.speed * rx);
    }

    if (zoneAt(hole, b.x, b.z, 'water')) return 'water';
    const [cx, cz] = hole.cup;
    if (Math.hypot(b.x - cx, b.z - cz) < CUP_R && speed(b) < CAPTURE_SPEED) {
      b.x = cx;
      b.z = cz;
      b.vx = 0;
      b.vz = 0;
      return 'sunk';
    }
    return null;
  }

  // Ferma davvero: lenta e non su una discesa più forte dell'attrito
  function atRest(b, hole) {
    if (speed(b) > REST_SPEED) return false;
    if (!hole) return true;
    const [fx, fz] = slopeForce(hole, b.x, b.z);
    const [, c] = zoneAt(hole, b.x, b.z, 'sand') ? FRICTION.sand : FRICTION.grass;
    return Math.hypot(fx, fz) <= c;
  }

  // Fa correre la pallina finché si ferma, va in buca o in acqua (o finisce il tempo)
  function simulate(b, hole, { maxT = 30, t0 = 0, onStep } = {}) {
    let t = t0;
    const end = t0 + maxT;
    while (t < end) {
      const ev = step(b, hole, DT, t);
      t += DT;
      if (onStep) onStep(b, t);
      if (ev) return { event: ev, t };
      if (atRest(b, hole)) {
        b.vx = 0;
        b.vz = 0;
        return { event: 'rest', t };
      }
    }
    return { event: 'timeout', t };
  }

  const api = {
    BALL_R, CUP_R, MAX_SPEED, CAPTURE_SPEED, DT,
    createBall, shoot, speed, step, atRest, simulate, inPoly, segments, spinnerSegment,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GolfPhysics = api;
})(this);
