/* BIOBUZZ Sim — recorder, replays and post-match analysis. The same compact frame carries online snapshots. */
(function (root) {
'use strict';
const BB = root.BB, R = root.BBR, IN = root.BBIN;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PH = ['pre', 'auto', 'trans', 'tele', 'end', 'done', 'free'];
const HN = 16, RN = 36, HIDE = -1000;
const HZ = 30;                        // frames per second of physics time (every 10 steps at 300 Hz)
const MAX_FRAMES = HZ * 240;          // practice without a timer keeps the last 4 minutes
const FEED = { bt: 0 };
function S() { return root.BBAPP; }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function fmt(s) { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const size = (nR, nB) => HN + nR * RN + nB * 3;

// ------------------------------------------------------------------ frame: everything needed to draw one instant
// header: t, phase, balls, HIVE phi x2, NECTAR left x2, score x2, TIPs x2, tip progress x2, no timer, fouls x2
// robot:  x y psi, wheel speeds x4, swerve angle x4, swerve speed x4, flags, hopper x4, pin, 3 shooters x (turret, hood, flywheel, bits), shots, made, battery
// ball:   x y z (z = HIDE when held)
function capture(sim, sc) {
  const nR = sim.robots.length, nB = sim.balls.length, f = new Float32Array(size(nR, nB));
  f[0] = sim.t; f[1] = Math.max(0, PH.indexOf(sim.phase)); f[2] = nB;
  f[3] = sim.hives[0].phi; f[4] = sim.hives[1].phi;
  f[5] = sim.hp.R.left; f[6] = sim.hp.B.left;
  if (sc) { f[7] = sc.R; f[8] = sc.B; f[11] = sc.pR; f[12] = sc.pB; }
  f[9] = sim.tips.R.auto + sim.tips.R.tele; f[10] = sim.tips.B.auto + sim.tips.B.tele;
  f[13] = sim.noTimer ? 1 : 0;
  f[14] = sim.fouls.R.major * 100 + sim.fouls.R.minor; f[15] = sim.fouls.B.major * 100 + sim.fouls.B.minor;
  let o = HN;
  for (const rb of sim.robots) {
    f[o] = rb.x; f[o + 1] = rb.y; f[o + 2] = rb.psi;
    const wv = rb.wheelV;
    for (let k = 0; k < 4; k++) { f[o + 3 + k] = wv ? wv[k] || 0 : 0; const m = rb.swerve[k]; f[o + 7 + k] = m.ang; f[o + 11 + k] = m.v; }
    f[o + 15] = (rb.intakeOn ? 1 : 0) | (rb.outtake ? 2 : 0) | (rb.enabled ? 4 : 0) | (rb.dunkT > 0 ? 16 : 0) | (rb.flapT > 0 ? 32 : 0);
    for (let k = 0; k < 4; k++) { const q = rb.hopper[k]; f[o + 16 + k] = q ? q.ball.bt + 1 : 0; }
    f[o + 20] = rb.pinCount || 0;
    for (let k = 0; k < 3; k++) {
      const sh = rb.shooters[k], p = o + 21 + k * 4; if (!sh) continue;
      f[p] = sh.tur.has ? sh.tur.ang : 0; f[p + 1] = sh.hood.cur; f[p + 2] = sh.fw.w;
      f[p + 3] = (sh.feed.ball ? 1 : 0) | (sh.aim.locked ? 2 : 0) | (sh.aim.valid ? 4 : 0);
    }
    f[o + 33] = rb.stats.shots; f[o + 34] = rb.stats.made; f[o + 35] = rb.bat.v;
    o += RN;
  }
  for (const b of sim.balls) {
    if (b.state === 'field') { f[o] = b.x; f[o + 1] = b.y; f[o + 2] = b.z; } else f[o + 2] = HIDE;
    o += 3;
  }
  return f;
}
// a stand-in for the sim that the renderer, cameras and labels can read
function makeView(sim) {
  return {
    t: 0, phase: 'pre', noTimer: false, balls: [], bts: [], span: 1 / HZ,
    hives: sim.hives.map(h => ({ alliance: h.alliance, hx: h.hx, phi: h.phi, side: h.side })),
    hp: { R: { left: 5 }, B: { left: 5 } }, score: { R: 0, B: 0 }, tipsN: { R: 0, B: 0 }, pct: { R: 0, B: 0 }, foulN: { R: 0, B: 0 },
    robots: sim.robots.map(rb => ({
      id: rb.id, alliance: rb.alliance, team: rb.team, name: rb.name, P: rb.P, spec: rb.spec, h: rb.h, hx: rb.hx, hy: rb.hy, human: rb.human,
      x: rb.x, y: rb.y, psi: rb.psi, vx: 0, vy: 0, w: 0, wheelV: [0, 0, 0, 0], swerve: [0, 0, 0, 0].map(() => ({ ang: 0, v: 0 })),
      intakeOn: false, outtake: false, enabled: false, dunkT: 0, flapT: 0, pinCount: 0,
      hopper: [], _hq: [0, 1, 2, 3].map(() => ({ ball: { bt: 0 }, t: 0 })), loc: { tags: [], err: 0 },
      shooters: rb.shooters.map(sh => ({ i: sh.i, faces: sh.faces, mx: sh.mx, my: sh.my, mz: sh.mz,
        tur: { has: sh.tur.has, ang: 0, half: sh.tur.half }, hood: { cur: sh.hood.cur, kind: sh.hood.kind }, fw: { w: 0 }, feed: { ball: null }, aim: { locked: false, valid: false } })),
      stats: { shots: 0, made: 0 }, bat: { v: 12.6 },
    })),
  };
}
// draw the instant between frames A and B (f in 0..1)
function applyFrame(v, A, B, f) {
  if (!B) { B = A; f = 0; }
  const near = f < 0.5 ? A : B;
  const L = i => A[i] + (B[i] - A[i]) * f;
  v.t = L(0); v.phase = PH[near[1] | 0] || 'pre'; v.noTimer = near[13] > 0.5;
  v.hives[0].phi = L(3); v.hives[1].phi = L(4);
  v.hp.R.left = near[5]; v.hp.B.left = near[6];
  v.score.R = near[7]; v.score.B = near[8]; v.tipsN.R = near[9]; v.tipsN.B = near[10];
  v.pct.R = L(11); v.pct.B = L(12); v.foulN.R = near[14]; v.foulN.B = near[15];
  const nR = v.robots.length, inv = 1 / Math.max(1e-3, v.span);
  for (let r = 0; r < nR; r++) {
    const rb = v.robots[r], o = HN + r * RN;
    rb.x = L(o); rb.y = L(o + 1); rb.psi = A[o + 2] + wrap(B[o + 2] - A[o + 2]) * f;
    rb.vx = (B[o] - A[o]) * inv; rb.vy = (B[o + 1] - A[o + 1]) * inv; rb.w = wrap(B[o + 2] - A[o + 2]) * inv;
    for (let k = 0; k < 4; k++) { rb.wheelV[k] = L(o + 3 + k); const m = rb.swerve[k]; m.ang = A[o + 7 + k] + wrap(B[o + 7 + k] - A[o + 7 + k]) * f; m.v = L(o + 11 + k); }
    const fl = near[o + 15] | 0;
    rb.intakeOn = !!(fl & 1); rb.outtake = !!(fl & 2); rb.enabled = !!(fl & 4); rb.dunkT = fl & 16 ? 1 : 0; rb.flapT = fl & 32 ? 1 : 0;
    rb.hopper.length = 0;
    for (let k = 0; k < 4; k++) { const c = near[o + 16 + k] | 0; if (c > 0 && c < 4) { const q = rb._hq[k]; q.ball.bt = c - 1; rb.hopper.push(q); } }
    rb.pinCount = near[o + 20];
    for (let k = 0; k < rb.shooters.length && k < 3; k++) {
      const sh = rb.shooters[k], p = o + 21 + k * 4;
      sh.tur.ang = L(p); sh.hood.cur = L(p + 1); sh.fw.w = L(p + 2);
      const bits = near[p + 3] | 0;
      sh.feed.ball = bits & 1 ? FEED : null; sh.aim.locked = !!(bits & 2); sh.aim.valid = !!(bits & 4);
    }
    rb.stats.shots = near[o + 33]; rb.stats.made = near[o + 34]; rb.bat.v = L(o + 35);
  }
  const nB = near[2] | 0, nA = A[2] | 0, nBb = B[2] | 0, base = HN + nR * RN;
  while (v.balls.length < nB) {
    const i = v.balls.length, bt = v.bts[i] | 0;
    v.balls.push({ id: i, bt, r: BB.BALL_R[bt], state: 'held', x: 0, y: 0, z: 0, wx: 0, wy: 0, wz: 0 });
  }
  if (v.balls.length > nB) v.balls.length = nB;
  for (let i = 0; i < nB; i++) {
    const b = v.balls[i], j = base + i * 3;
    const ha = i >= nA || A[j + 2] <= HIDE + 1, hb = i >= nBb || B[j + 2] <= HIDE + 1;
    if (ha && hb) { b.state = 'held'; continue; }
    if (ha || hb) {
      const src = ha ? B : A;
      if ((ha && f < 0.5) || (hb && f >= 0.5)) { b.state = 'held'; continue; }
      b.state = 'field'; b.x = src[j]; b.y = src[j + 1]; b.z = src[j + 2]; continue;
    }
    b.state = 'field';
    b.x = A[j] + (B[j] - A[j]) * f; b.y = A[j + 1] + (B[j + 1] - A[j + 1]) * f; b.z = A[j + 2] + (B[j + 2] - A[j + 2]) * f;
    // spin for the renderer: rolling on the floor follows the motion, in the air it keeps what it had
    if (b.z < b.r + 0.4) { const vx = (B[j] - A[j]) * inv, vy = (B[j + 1] - A[j + 1]) * inv; b.wx = -vy / b.r; b.wy = vx / b.r; b.wz = 0; }
  }
  return v;
}

// ------------------------------------------------------------------ recorder (every match, in memory only)
const REC = { frames: [], bts: [], timeline: [], marks: [], shots: [], n: 0, sc: null, dropped: 0, final: null };
REC.reset = function (sim) {
  REC.frames = []; REC.bts = sim ? sim.balls.map(b => b.bt) : []; REC.timeline = []; REC.marks = []; REC.shots = [];
  REC.n = 0; REC.sc = { R: 0, B: 0, pR: 0, pB: 0 }; REC.dropped = 0; REC.final = null; REC.robots = sim ? sim.robots.map(r => ({ team: r.team, alliance: r.alliance, name: r.name })) : [];
};
REC.tick = function (sim) {          // called every 10 physics steps (30 Hz)
  if (sim.phase === 'pre' || sim.phase === 'done') return;
  while (REC.bts.length < sim.balls.length) REC.bts.push(sim.balls[REC.bts.length].bt);
  if (REC.n % 15 === 0) {
    const b = BB.provisional(sim);
    REC.sc = { R: b.R.total, B: b.B.total, pR: Math.min(1, BB.tipProgress(sim, sim.hives[0])), pB: Math.min(1, BB.tipProgress(sim, sim.hives[1])) };
    if (sim.phase !== 'end') REC.timeline.push([sim.t, b.R.total, b.B.total]);
  }
  REC.frames.push(capture(sim, REC.sc)); REC.n++;
  if (REC.frames.length > MAX_FRAMES) { REC.frames.splice(0, HZ); REC.dropped += HZ; }
};
REC.event = function (sim, e) {
  const t = e.t !== undefined ? e.t : sim.t;
  switch (e.type) {
    case 'fire': REC.shots.push({ t, robot: e.robot, x: e.x, y: e.y, ball: e.ball, made: false, bt: e.bt }); if (REC.shots.length > 2000) REC.shots.shift(); break;
    case 'made': for (let i = REC.shots.length - 1; i >= 0; i--) { const q = REC.shots[i]; if (q.ball === e.ball && !q.made) { q.made = true; q.mt = t; q.mp = [e.x, e.y, e.z]; q.al = e.alliance; break; } } break;
    case 'tip': if (e.counted) REC.marks.push({ t, type: 'tip', al: e.alliance }); break;
    case 'foul': REC.marks.push({ t, type: 'foul', al: e.alliance, kind: e.kind, rule: e.rule }); break;
  }
};
REC.finish = function (sim) {
  if (!sim.final) return;
  REC.final = { R: sim.final.R.total, B: sim.final.B.total };
  REC.timeline.push([BB.T_END, sim.final.R.total, sim.final.B.total]);
};

// ------------------------------------------------------------------ network packing (online snapshots reuse the frame)
const QH = [100, 1, 1, 1000, 1000, 1, 1, 1, 1, 1, 1, 100, 100, 1, 1, 1];
const QR = [10, 10, 1000, 10, 10, 10, 10, 100, 100, 100, 100, 10, 10, 10, 10, 1, 1, 1, 1, 1, 10, 1000, 1000, 1, 1, 1000, 1000, 1, 1, 1000, 1000, 1, 1, 1, 1, 100];
function pack(f, nR) {
  const out = new Array(f.length);
  for (let i = 0; i < HN; i++) out[i] = Math.round(f[i] * QH[i]);
  for (let r = 0; r < nR; r++) for (let k = 0; k < RN; k++) { const i = HN + r * RN + k; out[i] = Math.round(f[i] * QR[k]); }
  for (let i = HN + nR * RN; i < f.length; i += 3) {
    if (f[i + 2] <= HIDE + 1) { out[i] = 0; out[i + 1] = 0; out[i + 2] = -1; }
    else { out[i] = Math.round(f[i] * 10); out[i + 1] = Math.round(f[i + 1] * 10); out[i + 2] = Math.max(0, Math.round(f[i + 2] * 10)); }
  }
  return out;
}
function unpack(a, nR) {
  if (!Array.isArray(a) || a.length < HN + nR * RN) return null;
  const f = new Float32Array(a.length);
  for (let i = 0; i < HN; i++) f[i] = (+a[i] || 0) / QH[i];
  for (let r = 0; r < nR; r++) for (let k = 0; k < RN; k++) { const i = HN + r * RN + k; f[i] = (+a[i] || 0) / QR[k]; }
  for (let i = HN + nR * RN; i + 2 < a.length; i += 3) {
    if (+a[i + 2] < 0) { f[i + 2] = HIDE; continue; }
    f[i] = (+a[i] || 0) / 10; f[i + 1] = (+a[i + 1] || 0) / 10; f[i + 2] = (+a[i + 2] || 0) / 10;
  }
  f[2] = Math.max(0, Math.min(Math.floor((f.length - HN - nR * RN) / 3), f[2] > 0 ? Math.floor(f[2]) : 0));
  f[1] = Math.max(0, Math.min(PH.length - 1, Math.floor(f[1]) || 0));
  for (let i = 0; i < f.length; i++) if (!isFinite(f[i])) f[i] = 0;
  return f;
}

// ------------------------------------------------------------------ replay player
const CAM_NAMES = { auto: 'Tự động', broadcast: 'Khán đài', follow: 'Theo robot', pov: 'Camera robot', top: 'Từ trên', free: 'Tự do', driver: 'Khu lái' };
const CAMS = ['auto', 'broadcast', 'follow', 'pov', 'top', 'free'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const RP = { on: false, view: null, pos: 0, speed: 1, playing: true, cam: 'auto', focus: 0, from: null, dir: { hold: 0, cam: 'broadcast', rb: 0 }, first: 0 };
RP.available = () => REC.frames.length > HZ;
RP.start = function (from) {
  const st = S(); if (!RP.available() || !st.sim) return false;
  RP.view = makeView(st.sim); RP.view.bts = REC.bts;
  RP.from = from; RP.on = true; RP.speed = 1; RP.playing = true; RP.cam = 'auto'; RP.dir = { hold: 0, cam: 'broadcast', rb: 0 };
  RP.first = Math.max(0, REC.frames.findIndex(f => f[1] >= 1));
  RP.pos = from === 'pause' ? Math.max(RP.first, REC.frames.length - 1 - 10 * HZ) : RP.first;
  const me = st.primary(); RP.focus = me ? me.id : 0;
  st.mode = 'replay';
  $('hud').hidden = true; $('pause').hidden = true; $('results').hidden = true; $('replay').hidden = false;
  R.setAimMap(null); st.aim.key = '';
  RP.buildBar(); RP.prevT = undefined;
  RP.apply();
  R.updateCamera(RP.view, 'broadcast', null, 'R', 0, true);
  $('rpPlay').focus();
  return true;
};
RP.exit = function () {
  const st = S(); if (!RP.on) return;
  RP.on = false; $('replay').hidden = true;
  if (R.robots) R.robots.forEach(o => { o.g.visible = true; });
  document.querySelectorAll('#labels .rlbl.focus').forEach(el => el.classList.remove('focus'));
  if (RP.from !== 'pause') $('labels').hidden = true;
  if (RP.from === 'pause' && st.sim && st.sim.phase !== 'done') { st.mode = 'play'; st.paused = true; $('hud').hidden = false; $('pause').hidden = false; $('btnResume').focus(); }
  else { st.mode = 'results'; $('results').hidden = false; $('btnReplay').focus(); }
};
RP.apply = function () {
  const fr = REC.frames, n = fr.length; if (!n) return;
  const p = Math.max(0, Math.min(n - 1, RP.pos)), i = Math.floor(p), j = Math.min(n - 1, i + 1);
  applyFrame(RP.view, fr[i], fr[j], p - i);
};
RP.seek = function (dtSec) { RP.prevT = undefined; RP.pos = Math.max(RP.first, Math.min(REC.frames.length - 1, RP.pos + dtSec * HZ)); RP.apply(); };
RP.setSpeed = function (s) { RP.speed = s; RP.syncBar(); };
RP.setCam = function (c) { RP.cam = c; RP.dir.hold = 0; RP.syncBar(); };
RP.toggle = function () { if (!RP.playing && RP.pos >= REC.frames.length - 1.01) RP.pos = RP.first; RP.playing = !RP.playing; RP.syncBar(); };
RP.onKey = function (e) {
  const c = e.code;
  if (c === 'Escape') { e.preventDefault(); IN.edges.delete(c); RP.exit(); return; }
  const t = e.target; if (t && (t.tagName === 'INPUT' && t.type !== 'range') || (t && t.tagName === 'SELECT')) return;
  if (c === 'Space' || c === 'KeyK') { e.preventDefault(); const a = document.activeElement; if (a && a.tagName === 'BUTTON') a.blur(); RP.toggle(); }
  else if (c === 'ArrowLeft' || c === 'KeyJ') { e.preventDefault(); RP.seek(-5); }
  else if (c === 'ArrowRight' || c === 'KeyL') { e.preventDefault(); RP.seek(5); }
  else if (c === 'ArrowUp') { e.preventDefault(); const i = SPEEDS.indexOf(RP.speed); RP.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]); }
  else if (c === 'ArrowDown') { e.preventDefault(); const i = SPEEDS.indexOf(RP.speed); RP.setSpeed(SPEEDS[Math.max(0, i - 1)]); }
  else if (c === 'KeyC') { RP.setCam(CAMS[(CAMS.indexOf(RP.cam) + 1) % CAMS.length]); }
  else if (c === 'Tab') { e.preventDefault(); RP.focus = (RP.focus + 1) % RP.view.robots.length; RP.syncBar(); }
  else if (c === 'Comma') { RP.playing = false; RP.seek(-1 / HZ); RP.syncBar(); }
  else if (c === 'Period') { RP.playing = false; RP.seek(1 / HZ); RP.syncBar(); }
  IN.edges.delete(c);                                                  // handled here: not a game key on the next frame
};
function padInput() {
  for (const p of IN.pads) {
    const E = p.edge, B = IN.BTN;
    if (E[B.A] || E[B.START]) RP.toggle();
    if (E[B.B]) RP.exit();
    if (E[B.LB]) RP.seek(-5);
    if (E[B.RB]) RP.seek(5);
    if (E[B.DU]) { const i = SPEEDS.indexOf(RP.speed); RP.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]); }
    if (E[B.DD]) { const i = SPEEDS.indexOf(RP.speed); RP.setSpeed(SPEEDS[Math.max(0, i - 1)]); }
    if (E[B.Y]) RP.setCam(CAMS[(CAMS.indexOf(RP.cam) + 1) % CAMS.length]);
    if (E[B.X]) { RP.focus = (RP.focus + 1) % RP.view.robots.length; RP.syncBar(); }
    const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.35 && !RP.playing) RP.seek(ax * 0.03);
  }
}
// the auto director: follow whoever just shot, otherwise the broadcast view
function director(dt) {
  const d = RP.dir, t = RP.view.t;
  d.hold -= dt * RP.speed;
  if (d.hold > 0) return d;
  let shot = null;
  for (let i = REC.shots.length - 1; i >= 0; i--) { const s = REC.shots[i]; if (s.t <= t && s.t > t - 1.2) { shot = s; break; } if (s.t <= t - 1.2) break; }
  const tip = REC.marks.some(m => m.type === 'tip' && m.t > t - 0.4 && m.t < t + 1.4);
  if (tip) { d.cam = 'broadcast'; d.hold = 2.2; }
  else if (shot) { d.cam = 'follow'; d.rb = shot.robot; d.hold = 3.2; }
  else { d.cam = 'broadcast'; d.hold = 0.8; }
  return d;
}
RP.frame = function (dt) {
  padInput();
  const n = REC.frames.length;
  if (RP.playing) {
    RP.pos += dt * HZ * RP.speed;
    if (RP.pos >= n - 1) { RP.pos = n - 1; RP.playing = false; RP.syncBar(); }
  }
  RP.apply();
  const v = RP.view, FX = root.BBFX;
  // replay the sparks: CELL scores and HIVE TIPs crossed since the last frame
  if (FX && RP.playing && RP.prevT !== undefined && v.t > RP.prevT && v.t - RP.prevT < 1) {
    for (const m of REC.marks) if (m.type === 'tip' && m.t > RP.prevT && m.t <= v.t) FX.tip(m.al);
    for (let i = REC.shots.length - 1; i >= 0; i--) { const q = REC.shots[i]; if (q.t < RP.prevT - 4) break; if (q.made && q.mt > RP.prevT && q.mt <= v.t) FX.made(q.mp[0], q.mp[1], q.mp[2], q.al); }
  }
  RP.prevT = v.t;
  let mode = RP.cam, rb = v.robots[RP.focus] || v.robots[0];
  if (mode === 'auto') { const d = director(dt); mode = d.cam; rb = v.robots[d.rb] || rb; }
  RP.camMode = mode; RP.camRb = rb;
  return v;
};
RP.render = function (dt) {
  const v = RP.view, st = S();
  if (R.robots) R.robots.forEach(o => { o.g.visible = true; });        // the camera hides only the robot it rides on
  R.update(v, RP.playing ? dt * RP.speed : 0);
  const me = st.primary();
  R.updateCamera(v, RP.camMode, RP.camRb, me ? me.alliance : 'R', dt, false);
  R.showTrajectory(null, null, false);
  R.render([]);
  RP.hud();
};
RP.hud = function () {
  const v = RP.view, n = REC.frames.length;
  const clk = BB.matchClock(v);
  $('rpR').textContent = v.score.R; $('rpB').textContent = v.score.B;
  $('rpClock').textContent = (clk.label === 'KẾT THÚC' ? 'KẾT THÚC' : clk.label + ' ' + fmt(clk.secs));
  const cur = (RP.pos - RP.first) / HZ, tot = (n - 1 - RP.first) / HZ;
  $('rpTime').textContent = `${fmt(cur)} / ${fmt(tot)}`;
  const sk = $('rpSeek'); if (document.activeElement !== sk || !RP.dragging) sk.value = String(Math.round((RP.pos - RP.first) / Math.max(1, n - 1 - RP.first) * 1000));
  $('rpSlow').hidden = !(RP.speed < 1 && RP.playing);
  // labels over robots
  const lab = $('labels'); lab.hidden = false;
  for (const rb of v.robots) {
    const el = $('lbl' + rb.id); if (!el) continue;
    const p = R.toScreen(rb.x, rb.y, rb.h + 9);
    if (!p.vis || RP.camMode === 'pov') { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.left = p.x.toFixed(0) + 'px'; el.style.top = p.y.toFixed(0) + 'px';
    el.classList.toggle('focus', rb === RP.camRb && (RP.camMode === 'follow' || RP.camMode === 'pov'));
  }
  const cl = RP.cam === 'auto' ? `TỰ ĐỘNG · ${CAM_NAMES[RP.camMode]}${RP.camMode === 'follow' ? ' ' + RP.camRb.team : ''}` : CAM_NAMES[RP.cam] + (RP.cam === 'follow' || RP.cam === 'pov' ? ' · ' + (v.robots[RP.focus] || v.robots[0]).team : '');
  if ($('rpCamNow').textContent !== cl) $('rpCamNow').textContent = cl;
};
RP.buildBar = function () {
  const v = RP.view, n = REC.frames.length;
  $('rpRobots').innerHTML = v.robots.map(r => `<button type="button" data-v="${r.id}" class="${r.alliance === 'R' ? 'red' : 'blue'}">${esc(r.team)}</button>`).join('');
  // ticks for TIPs and fouls along the seek bar
  const span = Math.max(1, n - 1 - RP.first), t2i = t => { let lo = RP.first, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (REC.frames[m][0] < t) lo = m + 1; else hi = m; } return lo; };
  $('rpTicks').innerHTML = REC.marks.map(m => `<i class="${m.type} ${m.al}" style="left:${((t2i(m.t) - RP.first) / span * 100).toFixed(2)}%" title="${m.type === 'tip' ? 'TIP' : 'LỖI'}"></i>`).join('');
  RP.syncBar();
};
RP.syncBar = function () {
  $('rpPlay').textContent = RP.playing ? '❚❚' : '▶';
  $('rpPlay').setAttribute('aria-label', RP.playing ? 'Tạm dừng' : 'Phát');
  document.querySelectorAll('#rpSpeed button').forEach(b => b.classList.toggle('on', +b.dataset.v === RP.speed));
  document.querySelectorAll('#rpCam button').forEach(b => b.classList.toggle('on', b.dataset.v === RP.cam));
  document.querySelectorAll('#rpRobots button').forEach(b => b.classList.toggle('on', +b.dataset.v === RP.focus));
};
RP.bind = function () {
  $('rpPlay').addEventListener('click', RP.toggle);
  $('rpBack').addEventListener('click', () => RP.seek(-5));
  $('rpFwd').addEventListener('click', () => RP.seek(5));
  $('rpExit').addEventListener('click', RP.exit);
  $('rpSpeed').addEventListener('click', e => { const b = e.target.closest('button'); if (b) RP.setSpeed(+b.dataset.v); });
  $('rpCam').addEventListener('click', e => { const b = e.target.closest('button'); if (b) RP.setCam(b.dataset.v); });
  $('rpRobots').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; RP.focus = +b.dataset.v; if (RP.cam === 'auto' || RP.cam === 'broadcast' || RP.cam === 'top') RP.cam = 'follow'; RP.syncBar(); });
  const sk = $('rpSeek');
  sk.addEventListener('pointerdown', () => { RP.dragging = true; });
  window.addEventListener('pointerup', () => { RP.dragging = false; });
  sk.addEventListener('input', () => { const n = REC.frames.length; RP.prevT = undefined; RP.pos = RP.first + (+sk.value / 1000) * Math.max(1, n - 1 - RP.first); RP.apply(); });
};

// ------------------------------------------------------------------ post-match analysis
const COL = { red: '#e5484d', blue: '#3e8bff', redInk: '#ff8a8e', blueInk: '#86b6ff', honey: '#f2c230', ink: '#eaf1ec', ink2: '#a8b7af', ink3: '#72847b', line: '#243039', line2: '#33434e', green: '#45c46f', bad: '#ff6b6b' };
function setupCanvas(cv, hRatio) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(200, cv.clientWidth || cv.parentElement.clientWidth || 600);
  const H = hRatio ? Math.round(W * hRatio) : Math.max(160, cv.clientHeight || 240);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  if (hRatio) cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
RP.drawChart = function (cv) {
  const { g, W, H } = setupCanvas(cv);
  const tl = REC.timeline.slice();
  const padL = 38, padR = 50, padT = 22, padB = 30, T = BB.T_END;
  const X = t => padL + Math.max(0, Math.min(1, t / T)) * (W - padL - padR);
  let top = 50; for (const p of tl) top = Math.max(top, p[1], p[2]);
  top = Math.ceil(top * 1.08 / 50) * 50;
  const Y = s => padT + (1 - s / top) * (H - padT - padB);
  g.font = '600 11px "JetBrains Mono", monospace'; g.textBaseline = 'middle';
  // phases
  const bands = [[0, BB.T_AUTO, 'AUTO', 'rgba(242,194,48,.10)'], [BB.T_AUTO, BB.T_TELE0, '', 'rgba(255,255,255,.035)'], [BB.T_TELE0, BB.T_FLOWER, 'TELEOP', 'rgba(0,0,0,0)'], [BB.T_FLOWER, T, 'ENDGAME', 'rgba(242,194,48,.07)']];
  for (const [a, b, name, c] of bands) {
    g.fillStyle = c; g.fillRect(X(a), padT, X(b) - X(a), H - padT - padB);
    if (name) { g.fillStyle = COL.ink3; g.textAlign = 'left'; g.fillText(name, X(a) + 5, padT - 10); }
  }
  // grid
  g.strokeStyle = COL.line; g.lineWidth = 1; g.textAlign = 'right';
  for (let s = 0; s <= top; s += top > 300 ? 100 : 50) { const y = Math.round(Y(s)) + 0.5; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillStyle = COL.ink3; g.fillText(String(s), padL - 6, y); }
  // time axis in match-clock terms
  g.textAlign = 'center'; g.fillStyle = COL.ink3;
  for (const [t, lab] of [[0, '0:30'], [BB.T_AUTO, '0:00'], [BB.T_TELE0, '2:00'], [BB.T_TELE0 + 60, '1:00'], [T, '0:00']]) { g.fillText(lab, X(t), H - padB + 14); g.strokeStyle = COL.line2; g.beginPath(); g.moveTo(Math.round(X(t)) + 0.5, H - padB); g.lineTo(Math.round(X(t)) + 0.5, H - padB + 4); g.stroke(); }
  if (tl.length < 2) { g.fillStyle = COL.ink2; g.textAlign = 'center'; g.fillText('Chưa đủ dữ liệu', W / 2, H / 2); return; }
  // score lines (step: points arrive in jumps)
  const line = (k, color) => {
    g.strokeStyle = color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath();
    tl.forEach((p, i) => { const x = X(p[0]), y = Y(p[k]); if (!i) g.moveTo(x, y); else { g.lineTo(x, Y(tl[i - 1][k])); g.lineTo(x, y); } });
    g.stroke();
  };
  // lead shading between the lines
  for (let i = 1; i < tl.length; i++) {
    const a = tl[i - 1], b = tl[i], lead = a[1] - a[2];
    if (!lead) continue;
    g.fillStyle = lead > 0 ? 'rgba(229,72,77,.10)' : 'rgba(62,139,255,.10)';
    g.fillRect(X(a[0]), Y(Math.max(a[1], a[2])), X(b[0]) - X(a[0]), Y(Math.min(a[1], a[2])) - Y(Math.max(a[1], a[2])));
  }
  line(1, COL.red); line(2, COL.blue);
  // markers
  const at = (t, k) => { let v = 0; for (const p of tl) { if (p[0] > t) break; v = p[k]; } return v; };
  for (const m of REC.marks) {
    const x = X(m.t), k = m.al === 'R' ? 1 : 2, c = m.al === 'R' ? COL.red : COL.blue;
    if (m.type === 'tip') {
      const y = Y(at(m.t + 0.6, k));
      g.fillStyle = c; g.strokeStyle = '#0b1015'; g.lineWidth = 1.5;
      g.beginPath(); for (let q = 0; q < 6; q++) { const a = q / 6 * Math.PI * 2 + Math.PI / 6; g[q ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5); } g.closePath(); g.fill(); g.stroke();
    } else {
      const y = H - padB - 7;
      g.fillStyle = m.kind === 'major' ? COL.bad : COL.honey;
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4.5, y + 3); g.lineTo(x - 4.5, y + 3); g.closePath(); g.fill();
    }
  }
  // end labels
  const last = tl[tl.length - 1];
  g.font = '800 16px "Saira Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'left';
  let yR = Y(last[1]), yB = Y(last[2]); if (Math.abs(yR - yB) < 16) { const m = (yR + yB) / 2, s = yR < yB ? -1 : 1; yR = m + s * 8; yB = m - s * 8; }
  g.fillStyle = COL.redInk; g.fillText(String(last[1]), W - padR + 6, yR);
  g.fillStyle = COL.blueInk; g.fillText(String(last[2]), W - padR + 6, yB);
};
// summary numbers for the "flow" tab
RP.flowStats = function () {
  const tl = REC.timeline; if (tl.length < 2) return null;
  let maxLead = { R: 0, B: 0 }, changes = 0, prev = 0, firstTip = { R: null, B: null };
  for (const p of tl) {
    const d = p[1] - p[2];
    if (d > maxLead.R) maxLead.R = d; if (-d > maxLead.B) maxLead.B = -d;
    const s = Math.sign(d); if (s && prev && s !== prev) changes++; if (s) prev = s;
  }
  for (const m of REC.marks) if (m.type === 'tip' && firstTip[m.al] === null) firstTip[m.al] = m.t;
  const autoEnd = tl.filter(p => p[0] <= BB.T_AUTO + 0.01).pop() || [0, 0, 0];
  const tips = { R: REC.marks.filter(m => m.type === 'tip' && m.al === 'R').length, B: REC.marks.filter(m => m.type === 'tip' && m.al === 'B').length };
  return { maxLead, changes, firstTip, autoEnd, tips };
};
// field map: where a robot spent the match and where it shot from
function fieldBase(g, X, Y, s) {
  const H0 = BB.HALF;
  g.fillStyle = '#23282e'; g.fillRect(X(-H0), Y(H0), 141 * s, 141 * s);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for (let k = 1; k < 6; k++) { const q = -H0 + k * H0 / 3; g.beginPath(); g.moveTo(X(q), Y(H0)); g.lineTo(X(q), Y(-H0)); g.moveTo(X(-H0), Y(q)); g.lineTo(X(H0), Y(q)); g.stroke(); }
  g.strokeStyle = '#8b96a0'; g.lineWidth = 2; g.strokeRect(X(-H0), Y(H0), 141 * s, 141 * s);
  const zone = (z, c, fill) => { g.strokeStyle = c; g.lineWidth = 1.5; if (fill) { g.fillStyle = fill; g.fillRect(X(z.x0), Y(z.y1), (z.x1 - z.x0) * s, (z.y1 - z.y0) * s); } g.strokeRect(X(z.x0), Y(z.y1), (z.x1 - z.x0) * s, (z.y1 - z.y0) * s); };
  zone(BB.ZONES.loading.R, COL.red, 'rgba(229,72,77,.10)'); zone(BB.ZONES.loading.B, COL.blue, 'rgba(62,139,255,.10)');
  zone(BB.ZONES.garden.R, COL.red, 'rgba(229,72,77,.35)'); zone(BB.ZONES.garden.B, COL.blue, 'rgba(62,139,255,.35)');
  // the frame and both HIVEs (top view footprint)
  g.fillStyle = 'rgba(160,170,180,.18)'; g.fillRect(X(-24.7), Y(19.5), 49.4 * s, 39 * s);
  for (const al of ['R', 'B']) {
    const hx = BB.HV.xs[al];
    g.fillStyle = al === 'R' ? 'rgba(229,72,77,.35)' : 'rgba(62,139,255,.35)'; g.strokeStyle = al === 'R' ? COL.red : COL.blue;
    g.fillRect(X(hx - 10), Y(21.5), 20 * s, 43 * s); g.strokeRect(X(hx - 10), Y(21.5), 20 * s, 43 * s);
  }
  g.fillStyle = '#c9a227';
  for (const f of BB.FLOWERS_DEF) { g.beginPath(); g.arc(X(f.x), Y(f.y), 2.6 * s, 0, Math.PI * 2); g.fill(); }
  // alliance sides
  g.font = '700 11px "Saira Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = COL.redInk; g.save(); g.translate(X(-H0) - 8, Y(0)); g.rotate(-Math.PI / 2); g.fillText('ĐỎ', 0, 0); g.restore();
  g.fillStyle = COL.blueInk; g.save(); g.translate(X(H0) + 8, Y(0)); g.rotate(Math.PI / 2); g.fillText('XANH', 0, 0); g.restore();
  g.fillStyle = COL.ink3; g.fillText('KHÁN ĐÀI', X(0), Y(-H0) + 10);
}
RP.drawMap = function (cv, rid, layers) {
  const { g, W, H } = setupCanvas(cv, 1);
  const s = (W - 28) / 141, cx = W / 2, cy = H / 2;
  const X = x => cx + x * s, Y = y => cy - y * s;
  fieldBase(g, X, Y, s);
  const nR = REC.robots.length; if (rid < 0 || rid >= nR || !REC.frames.length) return null;
  const fr = REC.frames, o = HN + rid * RN;
  // heat: time spent per 3 in cell, while the robot could move
  const N = 47, cell = 141 / N, grid = new Float32Array(N * N);
  let tot = 0, own = 0, zoneT = 0, dist = 0, px = null, py = null;
  const al = REC.robots[rid].alliance, lz = BB.ZONES.loading[al];
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i], ph = f[1] | 0; if (ph !== 1 && ph !== 3 && ph !== 6) continue;
    const x = f[o], y = f[o + 1];
    if (px !== null) dist += Math.hypot(x - px, y - py); px = x; py = y;
    tot++; if ((al === 'R' && x < 0) || (al === 'B' && x > 0)) own++;
    if (x > lz.x0 - 9 && x < lz.x1 + 9 && y > lz.y0 - 9 && y < lz.y1 + 9) zoneT++;
    const gx = Math.floor((x + 70.5) / cell), gy = Math.floor((y + 70.5) / cell);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const qx = gx + dx, qy = gy + dy; if (qx < 0 || qy < 0 || qx >= N || qy >= N) continue;
      grid[qy * N + qx] += Math.exp(-(dx * dx + dy * dy) / 2.2);
    }
  }
  if (layers.heat && tot) {
    let mx = 0; for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
    const off = document.createElement('canvas'); off.width = N; off.height = N;
    const og = off.getContext('2d'), img = og.createImageData(N, N);
    for (let qy = 0; qy < N; qy++) for (let qx = 0; qx < N; qx++) {
      const v = Math.pow(grid[qy * N + qx] / (mx || 1), 0.85), k = ((N - 1 - qy) * N + qx) * 4;
      if (v < 0.06) continue;
      // honey -> orange -> hot red, faint where the robot only passed through
      img.data[k] = 255; img.data[k + 1] = Math.round(214 - v * 170); img.data[k + 2] = Math.round(64 - v * 50); img.data[k + 3] = Math.round(Math.min(1, v * 1.25) * 215);
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(off, X(-70.5), Y(70.5), 141 * s, 141 * s);
  }
  if (layers.path) {
    g.strokeStyle = 'rgba(234,241,236,.55)'; g.lineWidth = 1.2; g.beginPath(); let started = false;
    for (let i = 0; i < fr.length; i += 3) { const f = fr[i], ph = f[1] | 0; if (ph !== 1 && ph !== 3 && ph !== 6) { started = false; continue; } const x = X(f[o]), y = Y(f[o + 1]); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
    g.stroke();
  }
  const shots = REC.shots.filter(q => q.robot === rid);
  if (layers.shots) {
    for (const q of shots) {
      const x = X(q.x), y = Y(q.y);
      if (q.made) { g.fillStyle = COL.green; g.strokeStyle = '#0b1015'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { g.strokeStyle = COL.bad; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 3.2, y - 3.2); g.lineTo(x + 3.2, y + 3.2); g.moveTo(x + 3.2, y - 3.2); g.lineTo(x - 3.2, y + 3.2); g.stroke(); }
    }
  }
  // accuracy by range to your HIVE
  const hx = BB.HV.xs[al], bands = [[0, 48], [48, 84], [84, 999]].map(([a, b]) => { const q = shots.filter(z => { const d = Math.hypot(z.x - hx, z.y); return d >= a && d < b; }); return { n: q.length, made: q.filter(z => z.made).length }; });
  return { shots: shots.length, made: shots.filter(q => q.made).length, dist, own: tot ? own / tot : 0, zone: tot ? zoneT / tot : 0, bands, secs: tot / HZ };
};

root.BBREC = REC;
root.BBRP = Object.assign(RP, { capture, makeView, applyFrame, pack, unpack, HZ, HN, RN, HIDE, PH });
})(typeof globalThis !== 'undefined' ? globalThis : this);
