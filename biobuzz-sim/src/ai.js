/* BIOBUZZ Sim — bot drivers v2 (AUTO programs + TELEOP AI) for any robot spec. Uses only engine state. */
(function (root) {
'use strict';
const BB = root.BB || (typeof require !== 'undefined' ? require('./engine.js') : null);
const { clamp, wrap, D2R, HALF, T_AUTO, T_END, T_FLOWER, ZONES, BT_POLLEN, G } = BB;

const SKILL = {
  easy: { speed: 0.62, react: 0.6, flower: false, moveShoot: false, noise: 2.8, defense: 0.4, dawdle: 1.0 },
  normal: { speed: 0.86, react: 0.25, flower: true, moveShoot: false, noise: 1.5, defense: 0.8, dawdle: 0.3 },
  hard: { speed: 1.0, react: 0.1, flower: true, moveShoot: true, noise: 1.0, defense: 1.0, dawdle: 0 },
};
const ARM_RANK = { none: 0, short: 1, long: 2 };

function brainFor(sim, rb, opt) {
  if (rb.brain) return rb.brain;
  opt = opt || {};
  const partner = sim.robots.find(o => o.alliance === rb.alliance && o !== rb);
  let role = 'tipper';
  const myArm = ARM_RANK[rb.P.arm], pArm = partner ? ARM_RANK[partner.P.arm] : -1;
  if (rb.spec.key === 'wall' || opt.defend) role = 'defense';
  else if (myArm > 0 && (myArm > pArm || (myArm === pArm && rb.slot === 1))) role = 'flower';
  const plan = opt.routine === 'plan' && opt.plan ? planFor(normalizePlan(opt.plan), rb.alliance) : null;
  rb.brain = { mode: 'shoot', target: null, spot: null, role, skill: SKILL[opt.skill || 'normal'], skillKey: opt.skill || 'normal',
    routine: plan ? 'plan' : opt.routine === 'plan' ? 'full' : opt.routine || 'full', plan, ps: null,
    think: 0, lastX: rb.x, lastY: rb.y, lastPsi: rb.psi, lastT: 0, detour: null, black: new Map(),
    spotT: 0, lockWait: 0, targetT: 0, retreat: null, defT: 0, human: !!opt.human, alwaysDefend: !!opt.defend, badSpots: [], goalD: 0, touchT: 0, noRam: new Map() };
  return rb.brain;
}

// ------------------------------------------------------------------ AUTO programs written by teams ("Chiến thuật AUTO")
// A plan is written in the RED frame, as seen from the red driver station (red ALLIANCE wall at x = -HALF), and turned
// 180° about the field centre for BLUE: the field has that symmetry (LOADING ZONES, GARDENS, upward CELLS, start walls).
// Steps: move (drive to a point), shoot (empty the robot), collect (pick balls inside a circle), wait, until (a match
// time), turn, park. Headings are degrees, 0 = facing away from your ALLIANCE wall, 90 = toward the far wall.
const PLAN_MAX = 24;
const START_WALL = { a: 'y-', l: 'x-', f: 'y+' };          // audience wall, own ALLIANCE wall, far wall
const pnum = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? clamp(v, lo, hi) : d; };
const half = v => Math.round(v * 2) / 2;
function normHeading(h, hive) {
  if (h === 'hive' && hive) return 'hive';
  if (h === null || h === undefined || h === '' || h === 'keep') return null;
  const v = +h; if (!Number.isFinite(v)) return null;
  const d = ((Math.round(v) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}
function normStep(s) {
  if (!s || typeof s !== 'object') return null;
  const L = HALF - 3;
  switch (s.k) {
    case 'move': return { k: 'move', x: half(pnum(s.x, -L, L, -40)), y: half(pnum(s.y, -L, L, 0)), h: normHeading(s.h, true), v: Math.round(pnum(s.v, 0.3, 1, 1) * 20) / 20, pass: !!s.pass, intake: s.intake !== false };
    case 'shoot': return { k: 'shoot', at: s.at === 'spot' ? 'spot' : 'here', to: Math.round(pnum(s.to, 1, 15, 5) * 2) / 2 };
    case 'collect': return { k: 'collect', x: half(pnum(s.x, -L, L, -50)), y: half(pnum(s.y, -L, L, -60)), r: Math.round(pnum(s.r, 6, 40, 16)), n: Math.round(pnum(s.n, 1, 4, 4)), to: Math.round(pnum(s.to, 1, 20, 8) * 2) / 2 };
    case 'wait': return { k: 'wait', s: Math.round(pnum(s.s, 0.1, 30, 1) * 10) / 10 };
    case 'until': return { k: 'until', t: Math.round(pnum(s.t, 0, 30, 10) * 10) / 10 };
    case 'turn': { const h = normHeading(s.h, true); return { k: 'turn', h: h === null ? 0 : h }; }
    case 'park': return { k: 'park' };
  }
  return null;
}
function normalizePlan(p) {
  p = p && typeof p === 'object' ? p : {};
  const st = p.start && typeof p.start === 'object' ? p.start : {};
  const wall = START_WALL[st.wall] ? st.wall : 'a';
  const steps = (Array.isArray(p.steps) ? p.steps : []).slice(0, PLAN_MAX).map(normStep).filter(Boolean);
  const pk = steps.findIndex(s => s.k === 'park'); if (pk >= 0) steps.length = pk + 1;      // nothing runs after PARK
  const s0 = wall === 'l' ? -6 : wall === 'f' ? -47 : -16;
  return { v: 1, name: String(p.name || 'AUTO').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'AUTO',
    start: { wall, s: half(pnum(st.s, -HALF, HALF, s0)), h: normHeading(st.h, false) || 0 }, steps };
}
// the start pose: back (or side) against the chosen wall, h degrees turned from facing into the field
function planStart(plan, al, P) {
  const st = plan.start, wall = START_WALL[st.wall] || 'y-';
  const inward = wall === 'y-' ? 90 : wall === 'y+' ? -90 : 0;
  const psi = wrap((inward + (st.h || 0)) * D2R), c = Math.abs(Math.cos(psi)), s = Math.abs(Math.sin(psi));
  const ex = c * P.hx + s * P.hy, ey = s * P.hx + c * P.hy;        // half extents of the frame along world x and y
  let x, y;
  if (wall === 'x-') { x = -HALF + ex + 0.2; y = clamp(st.s, -HALF + ey + 0.2, HALF - ey - 0.2); }
  else { x = clamp(st.s, -HALF + ex + 0.2, -ex - 0.3); y = wall === 'y-' ? -HALF + ey + 0.2 : HALF - ey - 0.2; }
  return al === 'B' ? { x: -x, y: -y, psi: wrap(psi + Math.PI) } : { x, y, psi };
}
// steps in the robot's own alliance frame, headings in radians
function planFor(plan, al) {
  const f = al === 'B' ? -1 : 1, rot = al === 'B' ? Math.PI : 0;
  const tr = h => (typeof h === 'number' ? wrap(h * D2R + rot) : h);
  return { name: plan.name, steps: plan.steps.map(s => { const o = Object.assign({}, s); if ('x' in s) { o.x = f * s.x; o.y = f * s.y; } if ('h' in s) o.h = tr(s.h); return o; }) };
}
// compact form for share codes and the online room: arrays, half-inch numbers
function planCompact(p) {
  const n = normalizePlan(p), H = h => (h === 'hive' ? 'h' : h);
  return { n: n.name, w: n.start.wall, s: n.start.s, h: n.start.h, p: n.steps.map(s => {
    switch (s.k) {
      case 'move': return ['m', s.x, s.y, H(s.h), Math.round(s.v * 100), (s.pass ? 1 : 0) | (s.intake ? 0 : 2)];
      case 'shoot': return ['b', s.at === 'spot' ? 1 : 0, s.to];
      case 'collect': return ['c', s.x, s.y, s.r, s.n, s.to];
      case 'wait': return ['w', s.s];
      case 'until': return ['u', s.t];
      case 'turn': return ['t', H(s.h)];
      default: return ['p'];
    }
  }) };
}
function planExpand(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || !Array.isArray(c.p)) throw new Error('Mã không chứa chương trình AUTO.');
  const H = h => (h === 'h' ? 'hive' : h);
  const steps = c.p.slice(0, PLAN_MAX).map(a => {
    if (!Array.isArray(a)) return null;
    switch (a[0]) {
      case 'm': return { k: 'move', x: a[1], y: a[2], h: H(a[3]), v: (+a[4] || 100) / 100, pass: !!((a[5] | 0) & 1), intake: !((a[5] | 0) & 2) };
      case 'b': return { k: 'shoot', at: a[1] ? 'spot' : 'here', to: a[2] };
      case 'c': return { k: 'collect', x: a[1], y: a[2], r: a[3], n: a[4], to: a[5] };
      case 'w': return { k: 'wait', s: a[1] };
      case 'u': return { k: 'until', t: a[1] };
      case 't': return { k: 'turn', h: H(a[1]) };
      case 'p': return { k: 'park' };
    }
    return null;
  });
  return normalizePlan({ name: c.n, start: { wall: c.w, s: c.s, h: c.h }, steps });
}
function b64u(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(b) { b = b.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return decodeURIComponent(escape(atob(b))); }
function planEncode(p) { return 'BBA1.' + b64u(JSON.stringify(planCompact(p))); }
function planDecode(code) {
  code = String(code || '').trim();
  if (!code.startsWith('BBA1.')) throw new Error('Mã AUTO phải bắt đầu bằng BBA1.');
  let obj; try { obj = JSON.parse(unb64u(code.slice(5))); } catch (e) { throw new Error('Mã bị cắt thiếu hoặc sai.'); }
  return planExpand(obj);
}
// what the editor warns about: G304 start, G402 centre line, points inside the frame, no PARK
function planCheck(plan, spec) {
  const P = BB.deriveRobot(spec), out = [], st = planStart(plan, 'R', P);
  const box = { x: st.x, y: st.y, psi: st.psi, hx: P.hx, hy: P.hy };
  if (BB.inZone(box, ZONES.loading.R)) out.push({ bad: true, text: 'Vị trí xuất phát chạm LOADING ZONE (G304 không cho phép).' });
  for (const f of BB.FLOWERS_DEF) if (BB.inZone(box, BB.flowerBox(f))) out.push({ bad: true, text: 'Vị trí xuất phát đè lên FLOWER.' });
  const diag = Math.hypot(P.hx, P.hy) + 0.8;
  plan.steps.forEach((s, i) => {
    if (s.x === undefined) return;
    if (s.x > -diag) out.push({ bad: false, text: `Bước ${i + 1}: điểm quá gần vạch giữa. Trong AUTO robot không được qua vạch (G402) nên sẽ dừng cách vạch ${diag.toFixed(0)} in.` });
    const leg = BB.legObstacles(P.h).some(L => segDist(s.x, s.y, L[0], L[1], L[2], L[3]) < Math.max(P.hx, P.hy));
    const bar = BB.FOOT_BARS.some(b => s.x > b.x0 - P.hx && s.x < b.x1 + P.hx && s.y > b.y0 - P.hx && s.y < b.y1 + P.hx);
    if ((leg || bar) && s.k === 'move') out.push({ bad: false, text: `Bước ${i + 1}: điểm đè lên chân khung HIVE, robot chỉ tới được sát bên cạnh.` });
  });
  if (!plan.steps.some(s => s.k === 'park')) out.push({ bad: false, text: 'Chưa có bước PARK: mất 5 điểm PARK AUTO (vẫn được LEAVE 3 điểm nếu rời tường).' });
  if (!plan.steps.some(s => s.k === 'shoot')) out.push({ bad: false, text: 'Chưa có bước Bắn: 4 POLLEN preload sẽ nằm yên trong robot.' });
  return out;
}
const PLAN = { MAX: PLAN_MAX, normalize: normalizePlan, start: planStart, forAlliance: planFor, compact: planCompact, expand: planExpand, encode: planEncode, decode: planDecode, check: planCheck };

// ------------------------------------------------------------------ geometry helpers
function timeLeft(sim) { return sim.phase === 'auto' ? T_AUTO - sim.t : T_END - sim.t; }
function vmax(rb) { return rb.P.drive.vf; }
function amax(rb) { return Math.min(0.7 * rb.P.drive.mu * G, 3.2 * rb.P.drive.Fs / rb.m); }
function travelTime(rb, x, y) { return Math.hypot(x - rb.x, y - rb.y) / (vmax(rb) * 0.6) + 0.4; }
function ownSide(rb) { return rb.alliance === 'R' ? -1 : 1; }
// G402: during AUTO stay on the own side (columns A-C red, D-F blue)
function sideClampX(sim, rb, x) {
  if (sim.phase !== 'auto') return x;
  const m = Math.max(rb.hx, rb.hy) + 1.5;
  return rb.alliance === 'R' ? Math.min(x, -m) : Math.max(x, m);
}
// two robots share one LOADING ZONE: split it by where each robot is coming from, once per parking run
function parkSlot(sim, rb) {
  const br = rb.brain;
  if (br.parkSlot !== undefined) return br.parkSlot;
  const z = ZONES.loading[rb.alliance], cy = (z.y0 + z.y1) / 2;
  const p = sim.robots.find(o => o !== rb && o.alliance === rb.alliance);
  let slot;
  if (p && p.brain && p.brain.mode === 'park' && p.brain.parkSlot !== undefined) slot = -p.brain.parkSlot;
  else if (p) { const a = Math.abs(rb.y - (cy - 10)) + Math.abs(p.y - (cy + 10)), b = Math.abs(rb.y - (cy + 10)) + Math.abs(p.y - (cy - 10)); slot = a <= b ? -1 : 1; }
  else slot = rb.y < cy ? -1 : 1;
  br.parkSlot = slot;
  return slot;
}
function parkSpot(sim, rb, auto, slot) {
  const z = ZONES.loading[rb.alliance];
  const wallX = rb.alliance === 'R' ? -HALF : HALF, inX = rb.alliance === 'R' ? 1 : -1;
  const cy = (z.y0 + z.y1) / 2 + (slot === undefined ? 0 : slot * 10);
  const off = rb.hx + (auto ? 3.4 : 2.5);                // AUTO: stay off the wall so LEAVE still counts
  const psi = Math.round(rb.psi / (Math.PI / 2)) * (Math.PI / 2);
  return { x: wallX + inX * off, y: cy, psi };
}
function hiveOf(sim, rb) { return BB.hiveOf(sim, rb.alliance); }
function aimPoint(sim, rb) { const h = hiveOf(sim, rb); return BB.aimPointWorld(h, h.side); }
function mainShooter(rb) { return rb.shooters[0]; }

function shootSpot(sim, rb) {
  const h = hiveOf(sim, rb), tp = BB.aimPointWorld(h, h.side), sg = h.side;
  let best = null, bestC = 1e9;
  const others = sim.robots.filter(o => o !== rb);
  const fixed = rb.shooters.every(s => s.type === 'fixed');
  for (const D of fixed ? [46, 52, 58] : [44, 52, 60]) for (const angD of [-42, -26, -10, 10, 26, 42]) {
    const a = angD * D2R;
    let x = tp[0] + Math.sin(a) * D; const y = tp[1] + sg * Math.cos(a) * D;
    if (Math.abs(x) > HALF - rb.hx - 2 || Math.abs(y) > HALF - rb.hx - 2) continue;
    if (sim.phase === 'auto' && (rb.alliance === 'R' ? x > -rb.hx - 1.5 : x < rb.hx + 1.5)) continue;
    let bad = false;
    for (const o of others) {
      if (Math.hypot(o.x - x, o.y - y) < rb.hx + o.hx + 4) { bad = true; break; }
      const ob = o.brain;
      if (ob && ob.spot && o.alliance === rb.alliance && Math.hypot(ob.spot.x - x, ob.spot.y - y) < 24) { bad = true; break; }
    }
    if (bad) continue;
    for (const f of sim.flowers) if (Math.hypot(f.x - x, f.y - y) < 17) bad = true;
    for (const q of rb.brain.badSpots) if (q.until > sim.t && Math.hypot(q.x - x, q.y - y) < 12) bad = true;
    if (bad) continue;
    if (!BB.shotFeasible(sim, rb.alliance, mainShooter(rb), x, y, BT_POLLEN)) continue;
    const c = travelTime(rb, x, y) + Math.abs(D - 50) * 0.01 + Math.abs(angD) * 0.004;
    if (c < bestC) { bestC = c; best = { x, y, D }; }
  }
  if (!best) best = { x: sideClampX(sim, rb, tp[0] + (rb.slot ? 16 : -16)), y: tp[1] + sg * 50, D: 50 };
  return best;
}


// ------------------------------------------------------------------ path planner: A* on a 4 in grid around HIVE legs, FLOWERS, walls and robots
const GS = 4, GN = 36, G0 = -72, INF = 1e9;
function cellOf(v) { return clamp(Math.floor((v - G0) / GS), 0, GN - 1); }
function cellC(i) { return G0 + (i + 0.5) * GS; }
function segDist(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay; let t = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1); t = clamp(t, 0, 1);
  return Math.hypot(px - ax - ex * t, py - ay - ey * t);
}
const STATIC = new Map();
function staticGrid(sim, rb) {
  const key = rb.hx + ',' + rb.hy + ',' + rb.h;
  let g = STATIC.get(key); if (g) return g;
  g = new Float32Array(GN * GN);
  const side = Math.max(rb.hx, rb.hy), diag = Math.hypot(rb.hx, rb.hy), rr = 0.5 * (side + diag);
  const legs = BB.legObstacles(rb.h);
  const wallM = Math.min(rb.hx, rb.hy) + 0.4;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const x = cellC(i), y = cellC(j); let c = 1;
    if (Math.abs(x) > HALF - wallM || Math.abs(y) > HALF - wallM) c = INF;
    else {
      for (const L of legs) { const d = segDist(x, y, L[0], L[1], L[2], L[3]); if (d < side + 1.0) c = INF; else if (d < rr + 1.5) c += 8; else if (d < rr + 7) c += 2.5; }
      for (const fl of sim.flowers) {
        const b = fl.box, ex = Math.max(b.x0 - x, 0, x - b.x1), ey = Math.max(b.y0 - y, 0, y - b.y1), d = Math.hypot(ex, ey);
        if (d < side + 0.8) c = INF; else if (d < side + 6) c += 2;
      }
      for (const b of BB.FOOT_BARS) {
        const ex = Math.max(b.x0 - x, 0, x - b.x1), ey = Math.max(b.y0 - y, 0, y - b.y1), d = Math.hypot(ex, ey);
        if (d < side + 0.8) c = INF; else if (d < side + 4) c += 2;
      }
    }
    g[j * GN + i] = c;
  }
  STATIC.set(key, g);
  return g;
}
function buildGrid(sim, rb, opt) {
  const br = rb.brain;
  const g = br.grid || (br.grid = new Float32Array(GN * GN));
  g.set(staticGrid(sim, rb));
  const side = Math.max(rb.hx, rb.hy);
  for (const o of sim.robots) {
    if (o === rb || (opt && opt.ram === o)) continue;
    // hard core where the frames must overlap, soft ring where they might (orientation-dependent)
    const R0 = Math.max(o.hx, o.hy) + side + 0.5, R = Math.hypot(o.hx, o.hy) + side + 0.5, R2 = R + 8;
    const i0 = cellOf(o.x - R2), i1 = cellOf(o.x + R2), j0 = cellOf(o.y - R2), j1 = cellOf(o.y + R2);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(cellC(i) - o.x, cellC(j) - o.y);
      if (d < R0) g[j * GN + i] = INF; else if (d < R) g[j * GN + i] += 10; else if (d < R2) g[j * GN + i] += 3;
    }
  }
  if (sim.phase === 'auto') {
    const s = ownSide(rb), m = Math.hypot(rb.hx, rb.hy) + 0.8;
    for (let i = 0; i < GN; i++) if (s * cellC(i) < m) for (let j = 0; j < GN; j++) g[j * GN + i] = INF;
  }
  return g;
}
function nearestFree(g, i, j) {
  if (g[j * GN + i] < INF) return j * GN + i;
  for (let r = 1; r < 8; r++) {
    let best = -1, bd = 1e9;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
      if (g[jj * GN + ii] < INF) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = jj * GN + ii; } }
    }
    if (best >= 0) return best;
  }
  return -1;
}
const _gs = new Float32Array(GN * GN), _from = new Int32Array(GN * GN), _closed = new Uint8Array(GN * GN);
const _heap = [];
function astar(g, s0, s1) {
  _gs.fill(1e30); _closed.fill(0); _heap.length = 0;
  const gi = s1 % GN, gj = (s1 / GN) | 0;
  const hfun = k => { const dx = Math.abs(k % GN - gi), dy = Math.abs(((k / GN) | 0) - gj); return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)); };
  const push = (k, f) => { _heap.push([f, k]); let c = _heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (_heap[p][0] <= _heap[c][0]) break; const t = _heap[p]; _heap[p] = _heap[c]; _heap[c] = t; c = p; } };
  const pop = () => { const top = _heap[0], last = _heap.pop(); if (_heap.length) { _heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < _heap.length && _heap[l][0] < _heap[m][0]) m = l; if (r < _heap.length && _heap[r][0] < _heap[m][0]) m = r; if (m === c) break; const t = _heap[m]; _heap[m] = _heap[c]; _heap[c] = t; c = m; } } return top; };
  _gs[s0] = 0; _from[s0] = -1; push(s0, hfun(s0));
  let n = 0;
  while (_heap.length && n++ < 4000) {
    const [, k] = pop(); if (_closed[k]) continue; _closed[k] = 1;
    if (k === s1) break;
    const ki = k % GN, kj = (k / GN) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = ki + di, jj = kj + dj; if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
      const q = jj * GN + ii; if (_closed[q] || g[q] >= INF) continue;
      if (di && dj && (g[kj * GN + ii] >= INF || g[jj * GN + ki] >= INF)) continue;   // no corner cutting
      const ng = _gs[k] + (di && dj ? 1.4142 : 1) * (g[q] + g[k]) * 0.5;
      if (ng < _gs[q]) { _gs[q] = ng; _from[q] = k; push(q, ng + hfun(q)); }
    }
  }
  if (!_closed[s1]) return null;
  const path = []; for (let k = s1; k >= 0; k = _from[k]) path.push(k);
  return path.reverse();
}
function lineFree(g, ax, ay, bx, by, skip) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 2);
  for (let k = 1; k <= n; k++) {
    const t = k / n; if (t * d < skip) continue;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (g[cellOf(y) * GN + cellOf(x)] >= INF) return false;
  }
  return true;
}
// where to steer now: the goal itself when the line is clear, else the furthest visible point of the A* path
function pathWaypoint(sim, rb, x, y, opt) {
  const br = rb.brain;
  if (!br.gridT || sim.t - br.gridT > 0.2) { buildGrid(sim, rb, opt); br.gridT = sim.t; }
  const g = br.grid;
  if (lineFree(g, rb.x, rb.y, x, y, 7)) { br.path = null; return null; }
  if (!br.path || Math.hypot(br.pathGoal[0] - x, br.pathGoal[1] - y) > 6 || sim.t - br.pathT > 0.4) {
    const s0 = nearestFree(g, cellOf(rb.x), cellOf(rb.y)), s1 = nearestFree(g, cellOf(x), cellOf(y));
    br.path = s0 >= 0 && s1 >= 0 ? astar(g, s0, s1) : null; br.pathGoal = [x, y]; br.pathT = sim.t;
    if (!br.path) return null;
  }
  const P = br.path;
  for (let k = P.length - 1; k >= 1; k--) {
    const wx = cellC(P[k] % GN), wy = cellC((P[k] / GN) | 0);
    if (lineFree(g, rb.x, rb.y, wx, wy, 7)) return k === P.length - 1 ? null : [wx, wy];
  }
  return [cellC(P[Math.min(1, P.length - 1)] % GN), cellC((P[Math.min(1, P.length - 1)] / GN) | 0)];
}

// ------------------------------------------------------------------ drive controller with avoidance
function goTo(sim, rb, x, y, psiT, opt) {
  opt = opt || {};
  const br = rb.brain, vm = vmax(rb);
  x = clamp(sideClampX(sim, rb, x), -HALF + rb.hx + 0.6, HALF - rb.hx - 0.6); y = clamp(y, -HALF + rb.hx + 0.6, HALF - rb.hx - 0.6);
  const dx = x - rb.x, dy = y - rb.y, d = Math.hypot(dx, dy);
  let vx = 0, vy = 0;
  let sx = x, sy = y;
  if (d > 10 && !opt.direct) { const w = pathWaypoint(sim, rb, x, y, opt); if (w) { sx = w[0]; sy = w[1]; } }
  const ex = sx - rb.x, ey = sy - rb.y, ed = Math.hypot(ex, ey) || 1;
  if (d > 0.4) {
    const v = Math.min(vm * br.skill.speed * (opt.speed || 1), Math.sqrt(2 * amax(rb) * 0.55 * d) + 2, d * 3.5 + 3);
    vx = ex / ed * v; vy = ey / ed * v;
  }
  for (const o of sim.robots) {
    if (o === rb || (opt.ram === o)) continue;
    const ox = rb.x - o.x, oy = rb.y - o.y, od = Math.hypot(ox, oy), R = rb.hx + o.hx + 12;
    if (od < R && od > 0.1) {
      const toward = (dx * -ox + dy * -oy) / (Math.max(d, 1) * od);
      if (toward > 0.2 || od < R - 8) {
        const k = (R - od) / R * vm * 0.9;
        vx += ox / od * k * 0.6; vy += oy / od * k * 0.6;
        const side = (ox * dy - oy * dx) > 0 ? 1 : -1;
        vx += -oy / od * k * 0.7 * side; vy += ox / od * k * 0.7 * side;
      }
    }
  }
  for (const f of sim.flowers) {
    if (opt.flowerOk === f.i) continue;
    const ox = rb.x - f.x, oy = rb.y - f.y, od = Math.hypot(ox, oy), R = rb.hx + 4.5;
    if (od < R && od > 0.1) { const k = (R - od) / R * vm * 0.8; vx += ox / od * k; vy += oy / od * k; }
  }
  for (const [lx, ly] of [[-22, -16], [-22, 16], [22, -16], [22, 16]]) {
    const ox = rb.x - lx, oy = rb.y - ly, od = Math.hypot(ox, oy), R = rb.hx + 3.5;
    if (od < R && od > 0.1) { const k = (R - od) / R * vm * 0.7; vx += ox / od * k; vy += oy / od * k; }
  }
  if (br.detour && sim.t < br.detour.until) { const ex = br.detour.x - rb.x, ey = br.detour.y - rb.y, ed = Math.hypot(ex, ey) || 1; vx = ex / ed * vm * 0.7; vy = ey / ed * vm * 0.7; }
  // G402: in AUTO never let any corner of the frame cross the centre line
  if (sim.phase === 'auto') {
    const s = ownSide(rb), c = Math.abs(Math.cos(rb.psi)), sn = Math.abs(Math.sin(rb.psi));
    const edge = s * rb.x - (c * rb.hx + sn * rb.hy) - 0.8;   // gap between the nearest corner and the line
    if (edge < 0) vx = s * Math.max(s * vx, -edge * 5 + 10);
    else if (s * vx < 0) vx = -s * Math.min(-s * vx, edge * 4);
  }
  br.goalD = d;
  const sp = Math.hypot(vx, vy);
  let cvx = sp > vm ? vx / sp : vx / vm, cvy = sp > vm ? vy / sp : vy / vm, cw = 0;
  if (rb.P.drive.type === 'tank') {
    // non-holonomic: turn toward the way we want to go, drive along the heading (backwards when that is shorter)
    const cs = Math.hypot(cvx, cvy);
    if (cs > 0.04 && d > 2.5) {
      let hd = Math.atan2(cvy, cvx), dir = 1;
      if (Math.abs(wrap(hd - rb.psi)) > 0.62 * Math.PI && d < 40) { hd = wrap(hd + Math.PI); dir = -1; }
      const err = wrap(hd - rb.psi), k = Math.max(0, Math.cos(err)); const f = cs * k * k * dir;
      cvx = Math.cos(rb.psi) * f; cvy = Math.sin(rb.psi) * f;
      cw = clamp(err * 2.6 - rb.w * 0.2, -1, 1);
    } else {
      cvx = 0; cvy = 0;
      if (psiT !== undefined && psiT !== null) cw = clamp(wrap(psiT - rb.psi) * 3 - rb.w * 0.2, -1, 1);
    }
  } else if (psiT !== undefined && psiT !== null) {
    const err = wrap(psiT - rb.psi);
    cw = clamp(err * 3.2 - rb.w * 0.18, -1, 1);
    if (Math.abs(err) > 1.1 && !opt.noSlowTurn) { cvx *= 0.45; cvy *= 0.45; }
  }
  rb.cmd.vx = cvx; rb.cmd.vy = cvy; rb.cmd.w = cw;
  rb.cmd.slow = false;
  return d;
}
function stuckCheck(sim, rb) {
  const br = rb.brain;
  if (sim.t - br.lastT > 1.4) {
    const moved = Math.hypot(rb.x - br.lastX, rb.y - br.lastY);
    const turned = Math.abs(wrap(rb.psi - br.lastPsi));
    const wants = br.goalD > 5 || (Math.abs(rb.cmd.w) > 0.6 && turned < 0.15);
    br.lastPsi = rb.psi;
    const parked = br.mode === 'park' && BB.inZone(rb, ZONES.loading[rb.alliance]);
    if (moved < 3.5 && wants && !parked && !(br.detour && sim.t < br.detour.until) && br.mode !== 'defend') {
      const e = escapeDir(sim, rb), a = Math.atan2(e[1], e[0]) + (sim.rng() - 0.5) * 1.2;
      br.detour = { x: sideClampX(sim, rb, rb.x + Math.cos(a) * 16), y: rb.y + Math.sin(a) * 16, until: sim.t + 0.7 };
      if (br.mode === 'shoot' && br.spot) { br.badSpots.push({ x: br.spot.x, y: br.spot.y, until: sim.t + 8 }); br.spot = null; }
      if (br.target && br.target.ball) br.black.set(br.target.ball.id, sim.t + 5);
      if (br.target && br.target.flower) br.black.set('f' + br.target.flower.i, sim.t + 4);
      br.target = null; br.think = 0;
    }
    br.lastX = rb.x; br.lastY = rb.y; br.lastT = sim.t;
  }
}
// away from whatever is closest: HIVE legs, FLOWERS, walls, robots
function escapeDir(sim, rb) {
  let ex = 0, ey = 0;
  const add = (px, py, R) => { const dx = rb.x - px, dy = rb.y - py, d = Math.hypot(dx, dy); if (d < R && d > 0.01) { const k = (R - d) / R; ex += dx / d * k; ey += dy / d * k; } };
  for (const L of BB.legObstacles(rb.h)) for (let q = 0; q <= 2; q++) add(L[0] + (L[2] - L[0]) * q / 2, L[1] + (L[3] - L[1]) * q / 2, rb.hx + 10);
  for (const fb of BB.FOOT_BARS) add(clamp(rb.x, fb.x0, fb.x1), clamp(rb.y, fb.y0, fb.y1), rb.hx + 6);
  for (const fl of sim.flowers) add(fl.x, fl.y, rb.hx + 10);
  for (const o of sim.robots) if (o !== rb) add(o.x, o.y, rb.hx + o.hx + 8);
  const w = HALF - rb.hx - 6;
  if (rb.x < -w) ex += 1; if (rb.x > w) ex -= 1; if (rb.y < -w) ey += 1; if (rb.y > w) ey -= 1;
  if (Math.hypot(ex, ey) < 0.05) { const a = sim.rng() * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }
  return [ex, ey];
}
// G421: never hold a PIN - back well off before the 3-count
function pinGuard(sim, rb) {
  const br = rb.brain;
  if (br.retreat && sim.t < br.retreat.until) {
    const r = br.retreat;
    goTo(sim, rb, r.x, r.y, null, { speed: 1 });
    rb.fireHeld = false;
    return true;
  }
  br.retreat = null;
  if ((rb.pinCount || 0) > 1.1) {
    let vic = null;
    for (const p of sim.pins.values()) if (p.a === rb && (!vic || p.count > vic.count)) vic = p;
    const o = vic ? vic.b : null;
    if (o) {
      br.retreat = retreatFrom(sim, rb, o, 50, 4.4);
      br.noRam.set(o.id, sim.t + 7);
      return true;
    }
  }
  return false;
}
function retreatFrom(sim, rb, o, dist, secs) {
  let best = null, bestS = -1e9;
  const lim = HALF - rb.hx - 1;
  for (let k = 0; k < 12; k++) {
    const a = Math.atan2(rb.y - o.y, rb.x - o.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;
    const x = clamp(o.x + Math.cos(a) * dist, -lim, lim), y = clamp(o.y + Math.sin(a) * dist, -lim, lim);
    let score = Math.hypot(x - o.x, y - o.y) - Math.hypot(x - rb.x, y - rb.y) * 0.6;
    for (const q of sim.robots) if (q !== rb && q !== o && Math.hypot(q.x - x, q.y - y) < 24) score -= 30;
    if (Math.abs(x) < 26 && Math.abs(y) < 21) score -= 10;
    if (score > bestS) { bestS = score; best = { x, y }; }
  }
  return { x: best.x, y: best.y, until: sim.t + secs };
}

// ------------------------------------------------------------------ targets
function pickBall(sim, rb, onlyNectar) {
  const br = rb.brain; let best = null, bestC = 1e9;
  const partner = sim.robots.find(o => o.alliance === rb.alliance && o !== rb);
  const gz = ZONES.garden;
  const auto = sim.phase === 'auto';
  const cand = [];
  for (const b of sim.balls) {
    if (b.state !== 'field' || b.flower >= 0 || b.z > b.r + 1.6 || Math.hypot(b.vx, b.vy) > 45 || !BB.legalFor(rb, b)) continue;
    if (Math.abs(b.x) > HALF - 0.8 || Math.abs(b.y) > HALF - 0.8 || (onlyNectar && b.bt === BT_POLLEN)) continue;
    if (auto && (rb.alliance === 'R' ? b.x > -(rb.hx * 2 + 4) : b.x < rb.hx * 2 + 4)) continue;
    if (Math.abs(b.x) < 25 && Math.abs(b.y) < 20) continue;         // under the HIVE frame
    cand.push(b);
  }
  for (const b of cand) {
    const bl = br.black.get(b.id); if (bl && bl > sim.t) continue;
    let c = travelTime(rb, b.x, b.y);
    const head = Math.abs(wrap(Math.atan2(b.y - rb.y, b.x - rb.x) - rb.psi)); c += head / 4 * 0.6;
    if (b.bt !== BT_POLLEN) c -= 0.45;
    const own = gz[rb.alliance], opp = gz[BB.other(rb.alliance)];
    if (b.x > own.x0 - 2 && b.x < own.x1 + 2 && b.y > own.y0 - 2.5 && b.y < own.y1 + 2.5) c += 1.2;
    if (b.x > opp.x0 - 2 && b.x < opp.x1 + 2 && b.y > opp.y0 - 2.5 && b.y < opp.y1 + 2.5) c -= 0.3;
    if (Math.abs(b.x) > HALF - 3 && Math.abs(b.y) > HALF - 3) c += 2.5;
    for (const f of sim.flowers) if (Math.hypot(b.x - f.x, b.y - f.y) < 7) c += 2;
    if (partner && partner.brain && partner.brain.target && partner.brain.target.ball === b) c += 3.5;
    for (const o of sim.robots) if (o.alliance !== rb.alliance && Math.hypot(o.x - b.x, o.y - b.y) < 16) c += 1.2;
    let near = 0; for (const q of cand) if (q !== b && Math.abs(q.x - b.x) < 14 && Math.abs(q.y - b.y) < 14) near++;
    c -= Math.min(near, 3) * 0.18;
    if (c < bestC) { bestC = c; best = b; }
  }
  return best ? { ball: best, cost: bestC } : null;
}
function flowerStation(rb, f, extra) {
  const d = rb.hx + 2.6 + (extra || 0);
  return { x: f.x + f.nx * d, y: f.y + f.ny * d, psi: Math.atan2(-f.ny, -f.nx) };
}
function flowerPullTarget(sim, rb) {
  if (!rb.P.flap || sim.phase === 'auto') return null;
  let best = null, bestC = 1e9;
  for (const f of sim.flowers) {
    const bl = rb.brain.black.get('f' + f.i); if (bl && bl > sim.t) continue;
    const bot = BB.flowerBottom(sim, f); if (!bot || bot.bt !== BT_POLLEN) continue;
    if (BB.flowerState(sim, f).owner === rb.alliance) continue;
    const st = flowerStation(rb, f, rb.P.intake.reach);
    if (sim.robots.some(o => o !== rb && Math.hypot(o.x - st.x, o.y - st.y) < rb.hx + o.hx + 2)) continue;
    const c = travelTime(rb, st.x, st.y) + 0.8;
    if (c < bestC) { bestC = c; best = Object.assign(st, { flower: f, cost: c }); }
  }
  return best;
}
function flowerDunkTarget(sim, rb) {
  let best = null, bestV = -1;
  const me = rb.alliance;
  for (const f of sim.flowers) {
    const bl = rb.brain.black.get('f' + f.i); if (bl && bl > sim.t) continue;
    const st = BB.flowerState(sim, f);
    if (st.height > 21.3 - 3.7) continue;
    let gain = st.owner === me ? 2 : 2 * (st.count + 1) + (st.owner ? 2 * st.count : 0);
    if (!st.bottom) gain += 5;
    const s = flowerStation(rb, f, 0);
    if (sim.robots.some(o => o !== rb && Math.hypot(o.x - s.x, o.y - s.y) < rb.hx + o.hx + 2)) continue;
    const v = gain / (1 + travelTime(rb, s.x, s.y));
    if (v > bestV) { bestV = v; best = Object.assign(s, { flower: f, gain }); }
  }
  return best;
}

// ------------------------------------------------------------------ main
function clearOutputs(rb) {
  rb.fireHeld = false; rb.forceFire = false; rb.armHeld = false; rb.outtake = false; rb.intakeOn = true; rb.autoFire = false;
  rb.turretLock = false; rb.turretNudge = 0;
}
function control(sim, rb, dt) {
  const br = brainFor(sim, rb);
  rb.noiseMul = br.human ? 1 : br.skill.noise;
  clearOutputs(rb);
  if (!rb.enabled) { rb.cmd.vx = rb.cmd.vy = rb.cmd.w = 0; return; }
  const auto = sim.phase === 'auto';
  if (auto && br.routine === 'plan' && br.plan) { runPlan(sim, rb, br, dt); return; }
  if (auto && br.routine === 'none') { rb.cmd.vx = rb.cmd.vy = rb.cmd.w = 0; return; }
  if (auto && br.routine === 'leave') {
    if (!br.leaveSpot) br.leaveSpot = { x: rb.x + Math.cos(rb.psi) * 16, y: rb.y + Math.sin(rb.psi) * 16 };
    goTo(sim, rb, br.leaveSpot.x, br.leaveSpot.y, rb.psi); return;
  }
  stuckCheck(sim, rb);
  if (pinGuard(sim, rb)) return;
  const tl = timeLeft(sim);
  if (auto && br.routine === 'preload' && rb.hopper.length === 0) { parkNow(sim, rb, true); return; }
  const endless = sim.phase === 'free' || sim.noTimer;
  const ps = parkSpot(sim, rb, auto);
  const parkDue = !endless && tl < travelTime(rb, ps.x, ps.y) * 1.25 + (auto ? 4.6 : 5.0) + (br.skillKey === 'easy' ? 1.5 : 0);
  if (parkDue) { parkNow(sim, rb, auto); return; }
  br.think -= dt;
  const h = hiveOf(sim, rb);
  if (br.pauseUntil && sim.t < br.pauseUntil) { rb.cmd.vx = rb.cmd.vy = rb.cmd.w = 0; br.goalD = 0; return; }
  if (br.think <= 0) {
    br.think = br.skill.react;
    const was = br.mode;
    plan(sim, rb, br, h, tl, auto);
    // less practiced drivers take a moment to re-orient after emptying the robot
    if (was === 'shoot' && br.mode !== 'shoot' && br.skill.dawdle > 0) br.pauseUntil = sim.t + br.skill.dawdle * (0.3 + sim.rng() * 0.9);
  }
  if (br.mode === 'collect' && br.target) actCollect(sim, rb, br);
  else if (br.mode === 'shoot') actShoot(sim, rb, br, h, dt);
  else if (br.mode === 'flower' && br.target) actFlower(sim, rb, br);
  else if (br.mode === 'defend') actDefend(sim, rb, br, dt);
  else {
    const tp = aimPoint(sim, rb);
    goTo(sim, rb, tp[0] + (rb.slot ? 18 : -18), tp[1] + h.side * 46, Math.atan2(tp[1] - rb.y, tp[0] - rb.x));
  }
  holdForFeed(rb);
}
// a ball is on its way into the flywheel: hold the velocity the shot was aimed with
function holdForFeed(rb) {
  if (!rb.shooters.some(s => s.feed.ball)) return;
  const vm = vmax(rb);
  if (rb.P.drive.type === 'tank') { const f = (rb.vx * Math.cos(rb.psi) + rb.vy * Math.sin(rb.psi)) / vm; rb.cmd.vx = Math.cos(rb.psi) * f; rb.cmd.vy = Math.sin(rb.psi) * f; }
  else { rb.cmd.vx = clamp(rb.vx / vm, -1, 1); rb.cmd.vy = clamp(rb.vy / vm, -1, 1); }
  rb.cmd.w = 0;
}
function parkNow(sim, rb, auto) {
  const br = rb.brain;
  if (br.mode !== 'park') br.parkSlot = undefined;
  br.mode = 'park';
  const ps = parkSpot(sim, rb, auto, parkSlot(sim, rb));
  // already scoring the PARK with the clock nearly out: stay put
  if (timeLeft(sim) < 1.6 && BB.inZone(rb, ZONES.loading[rb.alliance]) && (!auto || !BB.touchingWall(rb))) {
    rb.cmd.vx = rb.cmd.vy = rb.cmd.w = 0; br.goalD = 0; if (rb.hopper.length) rb.fireHeld = true; return;
  }
  const d = Math.hypot(ps.x - rb.x, ps.y - rb.y) > 36 ? goTo(sim, rb, ps.x, ps.y, null, { speed: 1 }) : goTo(sim, rb, ps.x, ps.y, ps.psi, { speed: 0.85, noSlowTurn: true });
  if (d < 1.2) { rb.cmd.vx = rb.cmd.vy = 0; }
  if (rb.hopper.length) rb.fireHeld = true;
  holdForFeed(rb);
}
function actCollect(sim, rb, br) {
  const T = br.target;
  if (T.ball) {
    const b = T.ball;
    if (b.state !== 'field' || b.flower >= 0 || !BB.legalFor(rb, b)) { br.target = null; br.think = 0; return; }
    const psi = Math.atan2(b.y - rb.y, b.x - rb.x), d = Math.hypot(b.x - rb.x, b.y - rb.y);
    const stand = rb.hx + rb.P.intake.reach - 2;
    goTo(sim, rb, b.x - Math.cos(psi) * stand, b.y - Math.sin(psi) * stand, d < 40 ? psi : null, { speed: d < 24 ? 0.65 : 1 });
    if (sim.t - br.targetT > (rb._static ? 3.5 : 5.5)) { br.black.set(b.id, sim.t + 6); br.target = null; }
    if (rb.hopper.length && rb.P.lead && br.skill.moveShoot && d > 26) rb.fireHeld = true;     // turret bots empty on the move
  } else if (T.flower) {
    const d = approach(sim, rb, T, T.flower.nx, T.flower.ny, { flowerOk: T.flower.i });
    if (d < 2) { rb.cmd.vx = -T.flower.nx * 0.12; rb.cmd.vy = -T.flower.ny * 0.12; }
    const bot = BB.flowerBottom(sim, T.flower);
    if (!bot || bot.bt !== BT_POLLEN || sim.t - br.targetT > 7) { if (sim.t - br.targetT > 7) br.black.set('f' + T.flower.i, sim.t + 5); br.target = null; br.think = 0; }
  }
}
function actShoot(sim, rb, br, h, dt) {
  if (!br.spot || br.spotSide !== h.side) { br.spot = shootSpot(sim, rb); br.spotSide = h.side; br.spotT = sim.t; br.lockWait = 0; }
  const tp = aimPoint(sim, rb), sh = mainShooter(rb);
  const d = Math.hypot(br.spot.x - rb.x, br.spot.y - rb.y);
  let psi;
  const allTurret = rb.shooters.every(s => s.type === 'turret');
  if (!allTurret) {
    const az = sh.aim.valid ? sh.aim.az : Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
    psi = d < 40 ? wrap(az - sh.faces) : null;
  } else {
    // turrets aim themselves: only turn when the HIVE is outside the turret's travel
    const az = Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
    const rel = wrap(az - rb.psi - sh.faces), lim = sh.tur.half - 0.35;
    psi = Math.abs(rel) > lim ? wrap(az - sh.faces - Math.sign(rel) * lim * 0.6) : null;
  }
  goTo(sim, rb, br.spot.x, br.spot.y, psi, { noSlowTurn: d < 8 });
  if (d < 3) { rb.cmd.vx *= 0.3; rb.cmd.vy *= 0.3; }
  const moving = br.skill.moveShoot && rb.P.lead && allTurret;
  const locked = rb.shooters.some(s => s.aim.locked && !s.aim.empty);
  if (d < 6 || moving || locked) rb.fireHeld = true;
  // a locked fixed shooter stops to take the shot instead of driving on to the spot
  if (locked && !rb.P.lead) { rb.cmd.vx = 0; rb.cmd.vy = 0; }
  if (d > 6 && sim.t - br.spotT > travelTime(rb, br.spot.x, br.spot.y) + 4) { br.badSpots.push({ x: br.spot.x, y: br.spot.y, until: sim.t + 8 }); br.spot = null; return; }
  if (d < 6) {
    br.lockWait += dt;
    if (br.lockWait > 3.5 && !rb.shooters.some(s => s.aim.valid)) { br.spot = null; br.lockWait = 0; }
    if (br.lockWait > 6) { br.spot = null; br.lockWait = 0; }
  }
}
function actFlower(sim, rb, br) {
  const T = br.target;
  // the stack may have grown since we chose this FLOWER: never drop into a full one
  if (rb.dunkT <= 0) {
    const st = BB.flowerState(sim, T.flower), next = rb.hopper.find(q => q.ball.bt !== BT_POLLEN) || rb.hopper[0];
    if (!next || st.height + 2 * next.ball.r > 21.3) { br.black.set('f' + T.flower.i, sim.t + 20); br.target = null; br.think = 0; return; }
  }
  const d = approach(sim, rb, T, T.flower.nx, T.flower.ny, { flowerOk: T.flower.i });
  // G410: NECTAR only goes in with one minute left
  const early = sim.t < T_FLOWER + 0.15 && sim.phase !== 'free';
  if (d < 14) rb.intakeOn = false;          // don't pull our own POLLEN back out of the bottom
  if (d < 3.2) { rb.cmd.vx = -T.flower.nx * 0.1; rb.cmd.vy = -T.flower.ny * 0.1; if (!early) { rb.armHeld = true; rb.intakeOn = false; } }
  if (rb.dunkT > 0 || early) br.targetT = sim.t;
  if (sim.t - br.targetT > 8) { br.black.set('f' + T.flower.i, sim.t + 5); br.target = null; br.think = 0; }
}
// legal defence: get in the way of the opponents' best shooter, lean on it, back off before a PIN count matters
function actDefend(sim, rb, br, dt) {
  let tgt = null, best = -1;
  for (const o of sim.robots) {
    if (o.alliance === rb.alliance) continue;
    const v = o.hopper.length + (o.shooters.some(s => s.aim.valid) ? 2 : 0);
    if (v > best) { best = v; tgt = o; }
  }
  if (!tgt) { br.mode = 'shoot'; return; }
  const cool = br.noRam.get(tgt.id);
  if (cool && cool > sim.t) {
    // shadow from a legal distance while the cool-down runs
    const h0 = BB.hiveOf(sim, tgt.alliance), tp0 = BB.aimPointWorld(h0, h0.side);
    const ux = tp0[0] - tgt.x, uy = tp0[1] - tgt.y, ud = Math.hypot(ux, uy) || 1;
    goTo(sim, rb, tgt.x + ux / ud * 44, tgt.y + uy / ud * 44, Math.atan2(tgt.y - rb.y, tgt.x - rb.x));
    return;
  }
  const touching = sim._rr.some(c => (c.a === rb && c.b === tgt) || (c.b === rb && c.a === tgt));
  br.touchT = touching ? br.touchT + dt : Math.max(0, br.touchT - dt * 0.5);
  if (br.touchT > 0.4 + 1.1 * br.skill.defense) { br.touchT = 0; br.retreat = retreatFrom(sim, rb, tgt, 50, 3.8); br.noRam.set(tgt.id, sim.t + 6.5); return; }
  const h = BB.hiveOf(sim, tgt.alliance), tp = BB.aimPointWorld(h, h.side);
  const ux = tp[0] - tgt.x, uy = tp[1] - tgt.y, ud = Math.hypot(ux, uy) || 1;
  br.defT += dt;
  const lean = (br.defT % 4.5) < 2.2 * br.skill.defense;
  const gx = tgt.x + ux / ud * (tgt.hx + rb.hx + (lean ? -1 : 8)), gy = tgt.y + uy / ud * (tgt.hx + rb.hx + (lean ? -1 : 8));
  goTo(sim, rb, gx, gy, Math.atan2(tgt.y - rb.y, tgt.x - rb.x), { ram: tgt, noSlowTurn: true });
  if (rb.hopper.length && rb.shooters.some(s => s.aim.locked)) rb.fireHeld = true;
}
function approach(sim, rb, T, nx, ny, opt) {
  const err = Math.abs(wrap(T.psi - rb.psi));
  const sx = T.x + nx * 9, sy = T.y + ny * 9;
  const dS = Math.hypot(sx - rb.x, sy - rb.y), dT = Math.hypot(T.x - rb.x, T.y - rb.y);
  const lat = Math.abs((rb.x - T.x) * ny - (rb.y - T.y) * nx);
  if ((err > 0.2 || lat > 2.5) && dT < 12 && dS > 1.5) { goTo(sim, rb, sx, sy, T.psi, Object.assign({ noSlowTurn: true, speed: 0.6 }, opt)); return 99; }
  if (dT > 12 && dS > 3) { goTo(sim, rb, sx, sy, dS < 24 ? T.psi : null, opt); return dT; }
  return goTo(sim, rb, T.x, T.y, T.psi, Object.assign({ speed: 0.55, noSlowTurn: true }, opt));
}
function plan(sim, rb, br, h, tl, auto) {
  const n = rb.hopper.length;
  const nect = rb.hopper.filter(q => q.ball.bt !== BT_POLLEN).length;
  const endless = sim.phase === 'free' || sim.noTimer;
  const prev = br.mode;
  // defence in TELEOP only, and only while there is something worth stopping
  if (!auto && br.role === 'defense' && (br.alwaysDefend || (!endless && sim.t < T_END - 12))) {
    if (n >= 3) { br.mode = 'shoot'; return; }
    br.mode = 'defend'; return;
  }
  const flowerTime = !auto && br.skill.flower && br.role === 'flower' && sim.t >= T_FLOWER - 4 && !endless && rb.P.arm !== 'none';
  if (flowerTime) {
    if (nect > 0 || (n > 0 && sim.flowers.some(f => BB.flowerState(sim, f).owner === rb.alliance))) {
      if (!br.target || !br.target.flower || br.mode !== 'flower') { br.target = flowerDunkTarget(sim, rb); br.targetT = sim.t; }
      br.mode = br.target ? 'flower' : 'shoot';
      return;
    }
    if (n < 4) { const t = pickBall(sim, rb, true); if (t && t.cost < tl - 3) { setTarget(sim, br, { ball: t.ball }); br.mode = 'collect'; return; } }
    if (n > 0) { br.mode = 'shoot'; return; }
    const t = pickBall(sim, rb, false);
    if (t) { setTarget(sim, br, { ball: t.ball }); br.mode = 'collect'; return; }
    br.mode = 'idle'; return;
  }
  const full = n >= 4;
  const opts = pickBall(sim, rb, false);
  const pull = n < 4 ? flowerPullTarget(sim, rb) : null;
  if (prev === 'shoot' && n > 0) return;
  if (full) { br.mode = 'shoot'; br.target = null; return; }
  if (n > 0) {
    const cost = opts ? opts.cost : 99;
    if (cost > 2.6 + (4 - n) * 0.25 || tl < 7) { br.mode = 'shoot'; br.target = null; return; }
  }
  if (auto && n === 0 && tl < 6) { br.mode = 'idle'; return; }
  if (opts && (!pull || opts.cost < pull.cost + 0.6)) { if (!br.target || br.target.ball !== opts.ball) setTarget(sim, br, { ball: opts.ball }); br.mode = 'collect'; return; }
  if (pull) { if (!br.target || br.target.flower !== pull.flower) setTarget(sim, br, pull); br.mode = 'collect'; return; }
  br.mode = n > 0 ? 'shoot' : 'idle';
}
function setTarget(sim, br, t) { br.target = t; br.targetT = sim.t; }

// ------------------------------------------------------------------ running a team's AUTO plan
// Each step drives through the same controller as the bots (A* around the frame, avoidance, G402 guard) and ends by
// itself or on its own time limit, so a plan that asks for the impossible still finishes its AUTO.
function stillCmd(rb, br) { rb.cmd.vx = rb.cmd.vy = rb.cmd.w = 0; br.goalD = 0; }
function planHeading(sim, rb, h) {
  if (h === 'hive') { const tp = aimPoint(sim, rb), sh = mainShooter(rb); return wrap(Math.atan2(tp[1] - rb.y, tp[0] - rb.x) - sh.faces); }
  return typeof h === 'number' ? h : null;
}
function holdAt(sim, rb, st, psi) {
  if (!st.hold) st.hold = { x: rb.x, y: rb.y };
  const d = goTo(sim, rb, st.hold.x, st.hold.y, psi, { direct: true, noSlowTurn: true });
  if (d < 1.2) { rb.cmd.vx *= 0.4; rb.cmd.vy *= 0.4; }
}
const STEP = {
  move(sim, rb, br, s, st) {
    if (st.limit === undefined) st.limit = sim.t + Math.max(2.5, travelTime(rb, s.x, s.y) * 2.4 + 2);
    if (!s.intake) rb.intakeOn = false;
    stuckCheck(sim, rb);
    const psi = planHeading(sim, rb, s.h);
    const d = goTo(sim, rb, s.x, s.y, s.pass ? (psi === null ? null : psi) : psi, { speed: s.v, noSlowTurn: !!s.pass });
    const herr = psi === null ? 0 : Math.abs(wrap(psi - rb.psi));
    if (s.pass) return d < 7 || sim.t > st.limit;
    if (d < 1.8 && herr < 0.07 && Math.hypot(rb.vx, rb.vy) < 10) return true;
    return sim.t > st.limit;
  },
  shoot(sim, rb, br, s, st, dt) {
    if (st.limit === undefined) st.limit = sim.t + s.to;
    const busy = rb.shooters.some(q => q.feed.ball);
    if (!rb.hopper.length && !busy) return true;
    if (sim.t > st.limit && !busy) return true;
    const h = hiveOf(sim, rb);
    if (s.at === 'spot') { actShoot(sim, rb, br, h, dt); holdForFeed(rb); return false; }
    // from right here: a fixed shooter turns the chassis onto the tag, a turret only turns when the HIVE is out of travel
    const tp = aimPoint(sim, rb), sh = mainShooter(rb);
    let psi = null;
    if (rb.shooters.some(q => !q.tur.has)) { const az = sh.aim.valid ? sh.aim.az : Math.atan2(tp[1] - rb.y, tp[0] - rb.x); psi = wrap(az - sh.faces); }
    else {
      const az = Math.atan2(tp[1] - rb.y, tp[0] - rb.x), rel = wrap(az - rb.psi - sh.faces), lim = sh.tur.half - 0.35;
      psi = Math.abs(rel) > lim ? wrap(az - sh.faces - Math.sign(rel) * lim * 0.6) : null;
    }
    holdAt(sim, rb, st, psi);
    rb.fireHeld = true;
    holdForFeed(rb);
    return false;
  },
  collect(sim, rb, br, s, st) {
    if (st.limit === undefined) st.limit = sim.t + s.to;
    if (rb.hopper.length >= Math.min(4, st.n0 + s.n) || sim.t > st.limit) return true;
    const T = br.target;
    const ok = b => b.state === 'field' && b.flower < 0 && b.z < b.r + 1.6 && BB.legalFor(rb, b) && Math.hypot(b.vx, b.vy) < 45;
    if (!T || !T.ball || !ok(T.ball) || sim.t - (st.pickT || -9) > 0.6) {
      st.pickT = sim.t;
      let best = null, bc = 1e9;
      for (const b of sim.balls) {
        if (!ok(b) || Math.hypot(b.x - s.x, b.y - s.y) > s.r + b.r) continue;
        if (Math.abs(b.x) > HALF - 0.8 || Math.abs(b.y) > HALF - 0.8) continue;
        if (rb.alliance === 'R' ? b.x > -(rb.hx * 2 + 4) : b.x < rb.hx * 2 + 4) continue;       // past the centre line in AUTO
        const bl = br.black.get(b.id); if (bl && bl > sim.t) continue;
        const c = travelTime(rb, b.x, b.y) + Math.abs(wrap(Math.atan2(b.y - rb.y, b.x - rb.x) - rb.psi)) * 0.15;
        if (c < bc) { bc = c; best = b; }
      }
      if (best && (!T || T.ball !== best)) setTarget(sim, br, { ball: best });
      if (!best) br.target = null;
    }
    if (!br.target) {
      // nothing left inside the circle: go and look, then move on
      const d = goTo(sim, rb, s.x, s.y, null, { speed: 0.8 });
      return d < Math.max(4, s.r * 0.5) || sim.t - st.t0 > 2.5;
    }
    stuckCheck(sim, rb);
    actCollect(sim, rb, br);
    return false;
  },
  wait(sim, rb, br, s, st) { if (st.limit === undefined) st.limit = sim.t + s.s; holdAt(sim, rb, st, null); return sim.t >= st.limit; },
  until(sim, rb, br, s, st) { holdAt(sim, rb, st, null); return sim.t >= s.t; },
  turn(sim, rb, br, s, st) {
    if (st.limit === undefined) st.limit = sim.t + 2.5;
    const psi = planHeading(sim, rb, s.h);
    holdAt(sim, rb, st, psi);
    return psi === null || (Math.abs(wrap(psi - rb.psi)) < 0.05 && Math.abs(rb.w) < 0.6) || sim.t > st.limit;
  },
  park(sim, rb) { parkNow(sim, rb, true); return false; },
};
// what a finished step achieved, for the editor's run log
function stepNote(sim, rb, s, st) {
  if (s.k === 'move') { const d = Math.hypot(rb.x - s.x, rb.y - s.y); return d > 4 ? { ok: false, text: `dừng cách điểm ${d.toFixed(0)} in` } : { ok: true, text: 'tới nơi' }; }
  if (s.k === 'shoot') {
    const n = rb.stats.shots - st.shots0;
    return n ? { ok: true, text: `bắn ${n} quả` } : { ok: !st.n0, text: st.n0 ? `không bắn được: ${String(mainShooter(rb).aim.reason || '').toLowerCase()}` : 'không còn bóng' };
  }
  if (s.k === 'collect') {
    if (st.n0 >= 4) return { ok: false, text: 'robot đang đầy 4 bóng, không nhặt thêm được' };
    const n = rb.stats.pickups - st.pick0; return { ok: n >= Math.min(s.n, 4 - st.n0), text: `nhặt ${n} quả` };
  }
  return { ok: true, text: '' };
}
function runPlan(sim, rb, br, dt) {
  const P = br.plan;
  const st = br.ps || (br.ps = { i: 0, t0: sim.t, n0: rb.hopper.length, shots0: rb.stats.shots, made0: rb.stats.made, pick0: rb.stats.pickups, log: [] });
  for (let guard = 0; guard < 6; guard++) {
    const s = P.steps[st.i];
    if (!s) { stillCmd(rb, br); st.done = true; return; }
    const f = STEP[s.k];
    if (!f || f(sim, rb, br, s, st, dt)) {
      st.log.push(Object.assign({ i: st.i, t0: st.t0, t: sim.t, timeout: st.limit !== undefined && sim.t > st.limit }, stepNote(sim, rb, s, st)));
      st.i++; st.t0 = sim.t; st.n0 = rb.hopper.length; st.shots0 = rb.stats.shots; st.made0 = rb.stats.made; st.pick0 = rb.stats.pickups;
      st.limit = undefined; st.hold = null; st.pickT = undefined;
      br.target = null; br.spot = null; br.lockWait = 0; br.detour = null;
      clearOutputs(rb);
      continue;
    }
    return;
  }
}

const AI = { control, brainFor, SKILL, parkSpot, shootSpot, goTo, PLAN };
if (typeof module !== 'undefined' && module.exports) module.exports = AI;
root.BBAI = AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
