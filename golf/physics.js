'use strict';
// Golf: fisica 3D della pallina. La stessa usata dal browser e dai test.
// Il percorso è fatto di piastrelle quadrate con un'altezza (piane, rampe, burroni, ponti, conche);
// sopra ci sono muri (con un'altezza: in volo si scavalcano), funghi, zone (sabbia, acqua, acceleratori),
// pale che girano, muri che scorrono, mulini con la porta che si apre a tempo e portali.
(function (root) {
  const BALL_R = 0.12;
  const CUP_R = 0.22;
  const MAX_SPEED = 14; // m/s con la forza al massimo
  const CAPTURE_SPEED = 3.2; // più veloce di così la pallina passa sopra la buca
  const DT = 1 / 240;
  const G = 9.8;
  const REST_SPEED = 0.06;
  const WALL_BOUNCE = 0.72;
  const BUMPER_BOUNCE = 1.15;
  const OUT_DEPTH = 2; // sotto il punto più basso del percorso: caduta
  const BOWL_R = 1.2;
  const BOWL_DEPTH = 0.18;
  // attrito: frenata proporzionale alla velocità + frenata costante
  const FRICTION = { grass: [0.35, 0.85], sand: [2.6, 3] };
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // Prepara la buca (indice delle piastrelle); restituisce la buca stessa
  function prepare(hole) {
    const S = hole.tile;
    const map = new Map();
    let minY = Infinity;
    for (const t of hole.tiles) {
      t.x0 = t.gx * S;
      t.z0 = t.gz * S;
      // più piastrelle nella stessa cella: piani diversi uno sopra l'altro
      const k = `${t.gx},${t.gz}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
      minY = Math.min(minY, t.h0, t.h1 ?? t.h0);
    }
    Object.defineProperty(hole, '_map', { value: map, enumerable: false, configurable: true });
    Object.defineProperty(hole, '_minY', { value: minY, enumerable: false, configurable: true });
    for (const k of ['walls', 'bumpers', 'zones', 'spinners', 'sliders', 'windmills', 'portals']) hole[k] = hole[k] || [];
    return hole;
  }

  const STEP_UP = 0.35; // quanto può stare sopra la pallina un prato per essere "il suo" (rampe, conche)

  // Prato sotto la pallina in (x, z) all'altezza y: il più alto che non le sta sopra la testa.
  // Restituisce { h, gx, gz } (altezza e pendenza) oppure null se sotto c'è il vuoto.
  function groundAt(hole, x, z, y = Infinity) {
    const S = hole.tile;
    const list = hole._map.get(`${Math.floor(x / S)},${Math.floor(z / S)}`);
    if (!list) return null;
    let best = null;
    for (const t of list) {
      const g = tileGround(hole, t, x, z);
      if (g && g.h <= y - BALL_R + STEP_UP && (!best || g.h > best.h)) best = g;
    }
    return best;
  }

  function tileGround(hole, t, x, z) {
    const S = hole.tile;
    const [dx, dz] = DIRS[t.dir || 0];
    // u: quanto si è avanzati nella piastrella lungo la sua direzione; v: di traverso
    const lx = x - t.x0;
    const lz = z - t.z0;
    const u = dx ? (dx > 0 ? lx : S - lx) : (dz > 0 ? lz : S - lz);
    const v = dx ? lz : lx;
    let h = t.h0;
    let gx = 0;
    let gz = 0;
    if (t.kind === 'ramp') {
      const k = (t.h1 - t.h0) / S;
      h = t.h0 + k * u;
      gx = k * dx;
      gz = k * dz;
    } else if (t.kind === 'gap') {
      if (u < t.gap) return null;
    } else if (t.kind === 'bridge') {
      if (Math.abs(v - S / 2) > t.width / 2) return null;
    }
    if (t.bowl) {
      const ox = x - hole.cup[0];
      const oz = z - hole.cup[1];
      const d = Math.hypot(ox, oz);
      if (d < BOWL_R) {
        const f = 1 - d / BOWL_R;
        h -= BOWL_DEPTH * f * f;
        if (d > 1e-6) {
          const dd = (2 * BOWL_DEPTH * f) / BOWL_R; // la conca sale allontanandosi dalla buca
          gx += (dd * ox) / d;
          gz += (dd * oz) / d;
        }
      }
    }
    return { h, gx, gz, tile: t };
  }

  function createBall(hole, x, z, y) {
    // y: altezza del prato da cui si parte (serve quando ci sono più piani)
    const g = groundAt(hole, x, z, y == null ? Infinity : y + BALL_R + 0.01);
    return { x, y: (g ? g.h : 0) + BALL_R, z, vx: 0, vy: 0, vz: 0, grounded: true };
  }

  function shoot(ball, angle, power) {
    const p = Math.max(0, Math.min(1, power));
    ball.vx = Math.cos(angle) * p * MAX_SPEED;
    ball.vz = Math.sin(angle) * p * MAX_SPEED;
  }

  const hspeed = (b) => Math.hypot(b.vx, b.vz);

  function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  // zone (sabbia, acqua, acceleratori) del piano su cui sta la pallina
  function zonesAt(hole, x, z, floorH) {
    return hole.zones.filter((zn) => (zn.y == null || Math.abs(zn.y - floorH) < 0.6) && inPoly(x, z, zn.poly));
  }

  function spinnerSegment(s, t) {
    const a = (s.phase || 0) + s.speed * t;
    const hx = (Math.cos(a) * s.len) / 2;
    const hz = (Math.sin(a) * s.len) / 2;
    return [s.x - hx, s.z - hz, s.x + hx, s.z + hz];
  }

  // Muro che scorre avanti e indietro lungo l'asse (0 = x, 1 = z); il segmento è orientato lungo l'asse
  function sliderSegment(s, t) {
    const off = s.amp * Math.sin((s.phase || 0) + s.speed * t);
    const h = s.len / 2;
    return s.axis === 0
      ? [s.x + off - h, s.z, s.x + off + h, s.z]
      : [s.x, s.z + off - h, s.x, s.z + off + h];
  }

  // Mulino: le pale chiudono l'ingresso per una parte del giro
  function gateOpen(m, t) {
    const k = (((t + (m.phase || 0)) % m.period) + m.period) % m.period;
    return k / m.period < m.open;
  }

  function gateSegment(m) {
    const h = m.width / 2;
    // asse = direzione in cui si cammina: la porta sta di traverso
    return m.axis === 0 ? [m.x, m.z - h, m.x, m.z + h] : [m.x - h, m.z, m.x + h, m.z];
  }

  // Urto con un segmento; (svx, svz) è la velocità del muro nel punto di contatto
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
      nx = -dz;
      nz = dx;
    }
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    b.x = qx + nx * BALL_R;
    b.z = qz + nz * BALL_R;
    const vn = (b.vx - svx) * nx + (b.vz - svz) * nz;
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
    const s = hspeed(b);
    if (s > MAX_SPEED) {
      b.vx *= MAX_SPEED / s;
      b.vz *= MAX_SPEED / s;
    }
  }

  // gli ostacoli bassi (alti 0,4 sopra il prato) toccano la pallina solo se è lì vicino in altezza
  function nearFloor(b, y) {
    return b.y - BALL_R < y + 0.4 && b.y + BALL_R > y - 0.1;
  }

  function slopeAccel(hole, g, zones) {
    let ax = -G * g.gx;
    let az = -G * g.gz;
    for (const zn of zones) {
      if (zn.type === 'boost') {
        ax += zn.force[0];
        az += zn.force[1];
      }
    }
    return [ax, az];
  }

  // Un passo di simulazione al tempo t; restituisce 'sunk', 'water', 'out' o null
  function step(b, hole, dt, t) {
    const prevY = b.y;
    if (b.grounded) {
      const g = groundAt(hole, b.x, b.z, b.y);
      if (!g) {
        b.grounded = false;
      } else {
        const zones = zonesAt(hole, b.x, b.z, g.h);
        const [ax, az] = slopeAccel(hole, g, zones);
        const [k, c] = zones.some((zn) => zn.type === 'sand') ? FRICTION.sand : FRICTION.grass;
        b.vx += ax * dt;
        b.vz += az * dt;
        const s = hspeed(b);
        if (s > 0) {
          const ns = Math.max(0, s - (k * s + c) * dt);
          b.vx *= ns / s;
          b.vz *= ns / s;
        }
        // velocità verticale lungo il pendio: serve per decollare dalle rampe
        b.vy = b.vx * g.gx + b.vz * g.gz;
      }
    }
    if (!b.grounded) b.vy -= G * dt;

    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.y += b.vy * dt;

    const g = groundAt(hole, b.x, b.z, Math.max(b.y, prevY));
    if (b.grounded) {
      if (!g || g.h + BALL_R < b.y - 0.04) {
        b.grounded = false; // fine del prato o gradino in giù: si vola
      } else {
        b.y = g.h + BALL_R;
      }
    } else if (g && b.y - BALL_R <= g.h && prevY - BALL_R >= g.h - 0.25) {
      // atterraggio (se si arriva da sopra; da sotto si sbatte contro il bordo e si continua a cadere)
      b.y = g.h + BALL_R;
      if (b.vy < -2.5) {
        b.vy = -b.vy * 0.3; // piccolo rimbalzo
      } else {
        b.vy = 0;
        b.grounded = true;
      }
      b.vx *= 0.9;
      b.vz *= 0.9;
    }

    for (const w of hole.walls) {
      if (b.y - BALL_R < w.y1 && b.y + BALL_R > w.y0) collideSegment(b, w.seg);
    }
    const floorY = g ? g.h : b.y - BALL_R;
    for (const bump of hole.bumpers) if (nearFloor(b, bump.y ?? floorY)) collideBumper(b, bump);
    for (const sp of hole.spinners) {
      if (!nearFloor(b, sp.y ?? floorY)) continue;
      const rx = b.x - sp.x;
      const rz = b.z - sp.z;
      collideSegment(b, spinnerSegment(sp, t), -sp.speed * rz, sp.speed * rx);
    }
    for (const sl of hole.sliders) {
      if (!nearFloor(b, sl.y ?? floorY)) continue;
      const v = sl.amp * sl.speed * Math.cos((sl.phase || 0) + sl.speed * t);
      collideSegment(b, sliderSegment(sl, t), sl.axis === 0 ? v : 0, sl.axis === 1 ? v : 0);
    }
    for (const m of hole.windmills) {
      if (!gateOpen(m, t) && nearFloor(b, m.y ?? floorY)) collideSegment(b, gateSegment(m));
    }

    if (b.grounded) {
      for (const p of hole.portals) {
        if (Math.hypot(b.x - p.a[0], b.z - p.a[1]) < p.r) {
          // si esce dal portale d'arrivo un po' più avanti, nella stessa direzione
          const s = hspeed(b) || 1;
          b.x = p.b[0] + (b.vx / s) * (p.r + BALL_R + 0.05);
          b.z = p.b[1] + (b.vz / s) * (p.r + BALL_R + 0.05);
          const ng = groundAt(hole, b.x, b.z, (p.by ?? b.y) + BALL_R + 0.05);
          if (ng) b.y = ng.h + BALL_R;
          break;
        }
      }
      const zones = zonesAt(hole, b.x, b.z, b.y - BALL_R);
      if (zones.some((zn) => zn.type === 'water')) return 'water';
      const [cx, cz] = hole.cup;
      if (Math.hypot(b.x - cx, b.z - cz) < CUP_R && hspeed(b) < CAPTURE_SPEED) {
        b.x = cx;
        b.z = cz;
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        return 'sunk';
      }
    } else if (b.y < hole._minY - OUT_DEPTH) {
      return 'out';
    }
    return null;
  }

  function segDist(b, [x1, z1, x2, z2]) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const u = Math.max(0, Math.min(1, ((b.x - x1) * dx + (b.z - z1) * dz) / (dx * dx + dz * dz || 1e-9)));
    return Math.hypot(b.x - (x1 + u * dx), b.z - (z1 + u * dz));
  }

  // Un ostacolo che si muove (pala, muro che scorre, porta del mulino) sta toccando la pallina al tempo t?
  function touchingMoving(b, hole, t) {
    const g = groundAt(hole, b.x, b.z, b.y);
    const floorY = g ? g.h : b.y - BALL_R;
    const near = (o, seg) => nearFloor(b, o.y ?? floorY) && segDist(b, seg) < BALL_R + 0.005;
    return hole.spinners.some((o) => near(o, spinnerSegment(o, t)))
      || hole.sliders.some((o) => near(o, sliderSegment(o, t)))
      || hole.windmills.some((o) => !gateOpen(o, t) && near(o, gateSegment(o)));
  }

  // Ferma davvero: a terra, lenta e non su un pendio più forte dell'attrito
  function atRest(b, hole) {
    if (!b.grounded || hspeed(b) > REST_SPEED) return false;
    const g = groundAt(hole, b.x, b.z, b.y);
    if (!g) return false;
    const zones = zonesAt(hole, b.x, b.z, g.h);
    const [ax, az] = slopeAccel(hole, g, zones);
    const [, c] = zones.some((zn) => zn.type === 'sand') ? FRICTION.sand : FRICTION.grass;
    return Math.hypot(ax, az) <= c;
  }

  // Fa correre la pallina finché si ferma, va in buca, in acqua o cade (o finisce il tempo)
  function simulate(b, hole, { maxT = 30, t0 = 0, onStep } = {}) {
    let t = t0;
    const end = t0 + maxT;
    while (t < end) {
      const ev = step(b, hole, DT, t);
      t += DT;
      if (onStep) onStep(b, t);
      if (ev) return { event: ev, t };
      if (atRest(b, hole) && !touchingMoving(b, hole, t)) {
        b.vx = 0;
        b.vz = 0;
        b.vy = 0;
        return { event: 'rest', t };
      }
    }
    return { event: 'timeout', t };
  }

  const api = {
    BALL_R, CUP_R, MAX_SPEED, CAPTURE_SPEED, DT, BOWL_R, BOWL_DEPTH,
    prepare, groundAt, createBall, shoot, step, atRest, touchingMoving, simulate, inPoly,
    spinnerSegment, sliderSegment, gateOpen, gateSegment,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GolfPhysics = api;
})(this);
