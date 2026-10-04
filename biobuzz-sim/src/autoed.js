/* BIOBUZZ Sim — AUTO strategy editor: a team draws its 30 s program on a top-down field and runs it with the real physics. */
(function (root) {
'use strict';
const BB = root.BB, AI = root.BBAI, AU = root.BBAU;
const PLAN = AI.PLAN, HALF = BB.HALF, D2R = BB.D2R;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function S() { return root.BBAPP; }
function UIx() { return root.BBUI; }

const KIND = { move: 'Đi tới', shoot: 'Bắn', collect: 'Nhặt bóng', turn: 'Xoay', wait: 'Chờ', until: 'Chờ tới giây', park: 'PARK' };
const HEADS = [['keep', 'giữ hướng'], ['hive', 'hướng súng về HIVE'], ['0', '0° nhìn vào sân'], ['45', '45° chếch trái'], ['90', '90° trái'], ['135', '135°'], ['180', '180° quay lưng'], ['-135', '−135°'], ['-90', '−90° phải'], ['-45', '−45° chếch phải']];
const HEADS_TURN = HEADS.filter(h => h[0] !== 'keep');
const COL = { red: '#e5484d', blue: '#3e8bff', honey: '#f2c230', pollen: '#e9b714', green: '#45c46f', ink: '#eaf1ec', ink2: '#a8b7af', ink3: '#72847b', line: '#33434e', warn: '#f2a43a' };

const E = { id: null, plan: null, sel: -1, run: null, heat: null, heatKey: '', drag: null, hover: null, speed: 1, spec: null, bound: false, dpr: 1 };
root.BBAE = E;

// ------------------------------------------------------------------ plan library helpers
function lib() { return S().autos; }
function pickDefault() {
  const want = S().set.autoSel;
  if (want && lib().exists(want)) return want;
  const a = S().set.auto; if (typeof a === 'string' && a.startsWith('plan:') && lib().exists(a.slice(5))) return a.slice(5);
  return lib().all()[0].id;
}
function load(id) {
  if (!lib().exists(id)) id = lib().all()[0].id;
  E.id = id; E.plan = lib().get(id); E.sel = -1; stopRun(); E.lastRun = null;
  S().set.autoSel = id; S().save();
  renderAll();
}
// editing an example makes the viewer's own copy first, like the robot workshop
function mutate(fn, opts) {
  opts = opts || {};
  if (lib().example(E.id)) {
    const p = JSON.parse(JSON.stringify(E.plan)); p.name = (p.name.replace(/^Mẫu · /, '') + ' (của bạn)').slice(0, 40);
    fn(p); const id = lib().add(p);
    E.id = id; E.plan = lib().get(id); S().set.autoSel = id; S().save();
    note('Đã tạo bản sao của bạn để chỉnh (chương trình mẫu giữ nguyên).');
    stopRun(); E.lastRun = null; renderAll(); UIx().autoSelects(); return;
  }
  fn(E.plan);
  E.plan = PLAN.normalize(E.plan);
  if (!opts.noSave) lib().put(E.id, E.plan);
  if (E.lastRun && !opts.keepRun) E.lastRun = null;
  if (!opts.light) renderAll(); else { drawMap(); renderWarn(); }
  if (opts.lists) UIx().autoSelects();
}
function note(t) { $('aeNote').textContent = t || ''; }

// ------------------------------------------------------------------ map geometry: seen from the RED driver station
// screen up = +x (away from the red wall), screen right = -y (toward the audience)
function mv() { const cv = $('aeMap'), W = cv.width, pad = W * 0.035, sc = (W - 2 * pad) / (2 * HALF); return { W, sc, cx: W / 2, cy: W / 2, cv }; }
function px(v, x, y) { return [v.cx - y * v.sc, v.cy - x * v.sc]; }
function fld(v, sx, sy) { return [-(sy - v.cy) / v.sc, -(sx - v.cx) / v.sc]; }
// distances the numeric inputs show: from your ALLIANCE wall (x) and from the audience wall (y)
const toA = x => +(x + HALF).toFixed(1), fromA = a => a - HALF;
function footprint(x, y, psi, hx, hy) {
  const c = Math.cos(psi), s = Math.sin(psi);
  return [[hx, hy], [hx, -hy], [-hx, -hy], [-hx, hy]].map(([a, b]) => [x + c * a - s * b, y + s * a + c * b]);
}
function specNow() { return E.spec || BB.presetSpec('turret'); }
function robotP() { return BB.deriveRobot(specNow()); }
// where the robot is at each step, walking the plan (for drawing and for defaults)
function walk() {
  const P = robotP(), st = PLAN.start(E.plan, 'R', P), out = [];
  let x = st.x, y = st.y, psi = st.psi;
  const zone = BB.ZONES.loading.R;
  E.plan.steps.forEach((s, i) => {
    const from = { x, y };
    if (s.k === 'move' || s.k === 'collect') { x = s.x; y = s.y; }
    if (s.k === 'park') { x = zone.x0 + P.hx + 3.4; y = (zone.y0 + zone.y1) / 2; }
    if ((s.k === 'move' || s.k === 'turn') && typeof s.h === 'number') psi = s.h * D2R;
    out.push({ i, s, from, x, y, psi });
  });
  return { st, P, nodes: out };
}

// ------------------------------------------------------------------ drawing
function sizeCanvas() {
  const cv = $('aeMap'); if (!cv) return;
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(200, Math.round(r.width * dpr));
  if (cv.width !== w || cv.height !== w) { cv.width = w; cv.height = w; }
  E.dpr = dpr;
}
function drawMap() {
  const cv = $('aeMap'); if (!cv || !E.plan) return;
  sizeCanvas();
  const v = mv(), g = cv.getContext('2d'), k = E.dpr, W = v.W;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#151b21'; g.fillRect(0, 0, W, W);
  const P0 = (x, y) => px(v, x, y);
  const poly = (pts, fill, stroke, lw) => { g.beginPath(); pts.forEach((p, i) => { const q = P0(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = (lw || 1) * k; g.stroke(); } };
  const rect = (x0, x1, y0, y1, fill, stroke, lw) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, stroke, lw);
  // tiles
  const TS = 2 * HALF / 6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) rect(-HALF + i * TS, -HALF + (i + 1) * TS, -HALF + j * TS, -HALF + (j + 1) * TS, (i + j) % 2 ? '#2a3038' : '#2d343c', '#23292f', 1);
  // opponent half (G402)
  rect(0, HALF, -HALF, HALF, 'rgba(6,9,12,.45)');
  g.save(); g.beginPath(); { const a = P0(HALF, HALF), b = P0(0, -HALF); g.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); } g.clip();
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 6 * k;
  for (let d = -W; d < W * 2; d += 22 * k) { g.beginPath(); g.moveTo(d, 0); g.lineTo(d + W, W); g.stroke(); }
  g.restore();
  // heat map (shot chance from standing still at the start of AUTO)
  if (E.heat && $('aeHeat').checked) {
    const h = E.heat, n = h.n;
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
      const val = h.data[iy * n + ix]; if (!(val > 0)) continue;
      const x = h.x0 + ix * h.step, y = h.x0 + iy * h.step;
      if (x > 0) continue;
      const c = val < 0.5 ? `rgba(229,${Math.round(72 + val * 244)},60,${0.28 + val * 0.4})` : `rgba(${Math.round(229 - (val - 0.5) * 320)},${Math.round(194 + (val - 0.5) * 60)},${val > 0.9 ? 111 : 70},${0.35 + val * 0.35})`;
      rect(x - h.step / 2, x + h.step / 2, y - h.step / 2, y + h.step / 2, c);
    }
  }
  // centre line
  { const a = P0(0, HALF), b = P0(0, -HALF); g.setLineDash([6 * k, 5 * k]); g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
  // tape: LOADING ZONES and GARDENS
  for (const al of ['R', 'B']) {
    const z = BB.ZONES.loading[al], gz = BB.ZONES.garden[al], c = al === 'R' ? COL.red : COL.blue;
    rect(z.x0, z.x1, z.y0, z.y1, al === 'R' ? 'rgba(229,72,77,.16)' : 'rgba(62,139,255,.12)', c, 2);
    rect(gz.x0, gz.x1, gz.y0, gz.y1, c);
  }
  // walls: your ALLIANCE wall at the bottom
  const wall = (x0, y0, x1, y1, c, w) => { const a = P0(x0, y0), b = P0(x1, y1); g.strokeStyle = c; g.lineWidth = w * k; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
  wall(-HALF, -HALF, -HALF, HALF, COL.red, 5); wall(HALF, -HALF, HALF, HALF, COL.blue, 5);
  wall(-HALF, -HALF, HALF, -HALF, '#8a98a3', 3); wall(-HALF, HALF, HALF, HALF, '#8a98a3', 3);
  // HIVE frame: the A legs and foot bars at floor level, the two HIVEs with the CELL that faces up at the start
  g.lineCap = 'round';
  for (const L of BB.LEGS) wall(L[0], L[1], L[3], L[4], '#7e8a94', 3);
  for (const b of BB.FOOT_BARS) rect(b.x0, b.x1, b.y0, b.y1, '#59646d');
  const hy = BB.HV.aOut * Math.cos(BB.HV.stop);
  const sim0 = E.run ? E.run.sim : null;
  for (const al of ['R', 'B']) {
    const hx = BB.HV.xs[al], side = sim0 ? BB.hiveOf(sim0, al).side : (al === 'R' ? -1 : 1), c = al === 'R' ? 'rgba(229,72,77,' : 'rgba(62,139,255,';
    rect(hx - 10.24, hx + 10.24, -hy, hy, 'rgba(210,220,228,.10)', 'rgba(210,220,228,.55)', 1.5);
    rect(hx - 10.24, hx + 10.24, side > 0 ? BB.HV.aIn * 0.87 : -hy, side > 0 ? hy : -BB.HV.aIn * 0.87, c + '.5)', c + '1)', 1.5);
  }
  { const sd = sim0 ? BB.hiveOf(sim0, 'R').side : -1, q = P0(BB.HV.xs.R, sd * (hy + 7)); g.fillStyle = COL.red; g.font = `700 ${11 * k}px "Saira Condensed", sans-serif`; g.textAlign = 'center'; g.fillText('CELL ngửa', q[0], q[1] + 4 * k); }
  // FLOWERS
  for (const f of BB.FLOWERS_DEF) { const b = BB.flowerBox(f); rect(b.x0, b.x1, b.y0, b.y1, '#1f6b31'); const q = P0(f.x, f.y); g.fillStyle = '#2f9a3d'; g.beginPath(); g.arc(q[0], q[1], 3.3 * v.sc, 0, 7); g.fill(); g.strokeStyle = COL.honey; g.lineWidth = 1.5 * k; g.stroke(); }
  // balls: live ones during a run, the starting layout otherwise
  if (sim0) {
    for (const b of sim0.balls) {
      if (b.state !== 'field') continue;
      const q = P0(b.x, b.y), air = b.z > b.r + 2;
      g.fillStyle = b.bt === 0 ? COL.pollen : b.bt === 1 ? COL.red : COL.blue;
      g.globalAlpha = air ? 0.55 : 1;
      g.beginPath(); g.arc(q[0], q[1], Math.max(2.2 * k, b.r * v.sc), 0, 7); g.fill();
      g.globalAlpha = 1;
    }
  } else {
    for (const al of ['R', 'B']) { const s = al === 'R' ? -1 : 1, c = HALF - BB.BALL_R[0] - 0.02; for (let i = 0; i < 4; i++) { const q = P0(s * (c - i * 2.89), s * c); g.fillStyle = COL.pollen; g.beginPath(); g.arc(q[0], q[1], BB.BALL_R[0] * v.sc, 0, 7); g.fill(); } }
  }
  drawPlan(g, v, k);
  if (E.run) drawRun(g, v, k);
  // your driver station label
  g.fillStyle = COL.red; g.font = `700 ${12 * k}px "Saira Condensed", sans-serif`; g.textAlign = 'center';
  g.fillText('KHU LÁI ĐỎ (BẠN)', W / 2, W - 3 * k);
  g.fillStyle = COL.blue; g.fillText('XANH', W / 2, 11 * k);
  g.save(); g.translate(W - 5 * k, W / 2); g.rotate(Math.PI / 2); g.fillStyle = COL.ink3; g.fillText('KHÁN ĐÀI', 0, 0); g.restore();
  { const q = P0(HALF * 0.5, 0); g.fillStyle = 'rgba(255,255,255,.35)'; g.font = `700 ${11 * k}px "Saira Condensed", sans-serif`; g.fillText('PHẦN SÂN ĐỐI THỦ · AUTO KHÔNG ĐƯỢC SANG (G402)', q[0], q[1] - HALF * 0.3 * v.sc); }
}
function drawRobot(g, v, k, x, y, psi, hx, hy, fill, stroke, lw) {
  const pts = footprint(x, y, psi, hx, hy).map(p => px(v, p[0], p[1]));
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = (lw || 2) * k; g.stroke(); }
  // heading arrow
  const c = px(v, x, y), f = px(v, x + Math.cos(psi) * hx * 0.95, y + Math.sin(psi) * hx * 0.95);
  g.strokeStyle = '#fff'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(f[0], f[1]); g.stroke();
  const a = Math.atan2(f[1] - c[1], f[0] - c[0]), L = 6 * k;
  g.beginPath(); g.moveTo(f[0], f[1]); g.lineTo(f[0] - Math.cos(a - 0.5) * L, f[1] - Math.sin(a - 0.5) * L); g.moveTo(f[0], f[1]); g.lineTo(f[0] - Math.cos(a + 0.5) * L, f[1] - Math.sin(a + 0.5) * L); g.stroke();
}
function drawPlan(g, v, k) {
  const W = walk(), P = W.P, st = W.st;
  const running = !!E.run;
  // start pose
  drawRobot(g, v, k, st.x, st.y, st.psi, P.hx, P.hy, running ? 'rgba(229,72,77,.12)' : 'rgba(229,72,77,.35)', E.drag && E.drag.what === 'start' ? COL.honey : COL.red, 2);
  // path
  g.lineJoin = 'round';
  let last = px(v, st.x, st.y);
  const tgt = BB.aimPointWorld({ hx: BB.HV.xs.R, phi: -BB.HV.stop, side: -1 }, -1);
  for (const n of W.nodes) {
    const s = n.s, sel = n.i === E.sel, colr = sel ? COL.honey : 'rgba(234,241,236,.85)';
    const here = px(v, n.x, n.y);
    if (s.k === 'move' || s.k === 'collect' || s.k === 'park') {
      g.strokeStyle = sel ? COL.honey : 'rgba(234,241,236,.7)'; g.lineWidth = (sel ? 3 : 2) * k;
      if (s.k === 'move' && s.pass) g.setLineDash([2 * k, 4 * k]); else if (s.k === 'park') g.setLineDash([7 * k, 4 * k]);
      g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(here[0], here[1]); g.stroke(); g.setLineDash([]);
      last = here;
    }
    if (s.k === 'collect') { g.setLineDash([4 * k, 4 * k]); g.strokeStyle = sel ? COL.honey : COL.green; g.lineWidth = 2 * k; g.beginPath(); g.arc(here[0], here[1], s.r * v.sc, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(69,196,111,.10)'; g.fill(); }
    if (s.k === 'shoot') {
      // dashed line toward the CELL facing up at the start of the match
      const t = px(v, tgt[0], tgt[1]);
      g.strokeStyle = sel ? COL.honey : 'rgba(242,194,48,.6)'; g.setLineDash([3 * k, 3 * k]); g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(here[0], here[1]); g.lineTo(t[0], t[1]); g.stroke(); g.setLineDash([]);
    }
  }
  // nodes on top, numbered like the list
  for (const n of W.nodes) {
    const s = n.s, sel = n.i === E.sel, p = px(v, n.x, n.y);
    const r = (s.k === 'move' || s.k === 'collect' ? 9 : 7) * k;
    let ox = 0, oy = 0;
    if (s.k !== 'move' && s.k !== 'collect' && s.k !== 'park') {
      // actions happen where the robot is: fan them out around that point so every number stays visible
      const same = W.nodes.filter(q => q.i < n.i && q.s.k !== 'move' && q.s.k !== 'collect' && q.s.k !== 'park' && Math.hypot(q.x - n.x, q.y - n.y) < 0.5).length;
      const a = -Math.PI / 4 + same * 0.9; ox = Math.cos(a) * 17 * k; oy = Math.sin(a) * 17 * k;
    }
    const cx = p[0] + ox, cy = p[1] + oy;
    g.fillStyle = sel ? COL.honey : s.k === 'shoot' ? '#d9a21a' : s.k === 'collect' ? COL.green : s.k === 'park' ? '#8e6bd8' : s.k === 'move' ? '#eaf1ec' : '#59646d';
    g.strokeStyle = '#0b1015'; g.lineWidth = 2 * k;
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.stroke();
    g.fillStyle = sel || s.k === 'move' ? '#0b1015' : '#fff'; g.font = `700 ${10 * k}px "JetBrains Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n.i + 1), cx, cy + 0.5 * k); g.textBaseline = 'alphabetic';
    if (s.k === 'move' && typeof s.h === 'number') {
      const a = px(v, n.x + Math.cos(s.h * D2R) * 14, n.y + Math.sin(s.h * D2R) * 14);
      g.strokeStyle = sel ? COL.honey : 'rgba(234,241,236,.6)'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(a[0], a[1]); g.stroke();
    }
    n.hit = { x: cx, y: cy, r: r + 4 * k };
  }
  E.nodes = W.nodes; E.startBox = W.st;
}
function drawRun(g, v, k) {
  const R = E.run, rb = R.rb;
  // trail
  if (R.trail.length > 1) {
    g.strokeStyle = 'rgba(69,196,111,.9)'; g.lineWidth = 2.5 * k; g.beginPath();
    R.trail.forEach((p, i) => { const q = px(v, p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke();
  }
  // shots: from where the robot fired, green when the ball went in
  for (const s of R.shots) {
    const a = px(v, s.x, s.y);
    g.strokeStyle = s.made ? COL.green : s.done ? COL.warn : '#fff'; g.lineWidth = 2 * k;
    g.beginPath(); g.arc(a[0], a[1], 4.5 * k, 0, 7); g.stroke();
  }
  drawRobot(g, v, k, rb.x, rb.y, rb.psi, rb.hx, rb.hy, 'rgba(229,72,77,.78)', '#fff', 1.5);
}

// ------------------------------------------------------------------ steps list
function num(v, d) { return Number.isFinite(+v) ? +v : d; }
function headSel(val, list, name) {
  const cur = val === null || val === undefined ? 'keep' : String(val);
  const has = list.some(h => h[0] === cur);
  return `<select data-p="${name}">${list.map(([a, b]) => `<option value="${a}"${a === cur ? ' selected' : ''}>${b}</option>`).join('')}${has ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}°</option>`}</select>`;
}
function stepParams(s) {
  const xy = `<label title="Khoảng cách từ tường liên minh của bạn (inch)">cách tường mình <input type="number" data-p="a" step="0.5" min="3" max="${(HALF * 2 - 3).toFixed(0)}" value="${toA(s.x)}"></label><label title="Khoảng cách từ tường phía khán đài (inch)">cách khán đài <input type="number" data-p="b" step="0.5" min="3" max="${(HALF * 2 - 3).toFixed(0)}" value="${toA(s.y)}"></label>`;
  switch (s.k) {
    case 'move': return `${xy}<label>hướng ${headSel(s.h, HEADS, 'h')}</label><label>tốc độ <input type="range" data-p="v" min="0.3" max="1" step="0.05" value="${s.v}"> <b class="mono">${Math.round(s.v * 100)}%</b></label><label><input type="checkbox" data-p="pass"${s.pass ? ' checked' : ''}> đi lướt qua</label><label><input type="checkbox" data-p="intake"${s.intake ? '' : ' checked'}> tắt intake</label>`;
    case 'shoot': return `<select data-p="at"><option value="here"${s.at === 'here' ? ' selected' : ''}>bắn tại chỗ</option><option value="spot"${s.at === 'spot' ? ' selected' : ''}>tự tìm chỗ bắn gần nhất</option></select><label>tối đa <input type="number" data-p="to" min="1" max="15" step="0.5" value="${s.to}"> s</label>`;
    case 'collect': return `${xy}<label>bán kính <input type="range" data-p="r" min="6" max="40" step="1" value="${s.r}"> <b class="mono">${s.r} in</b></label><label>số bóng <select data-p="n">${[1, 2, 3, 4].map(n => `<option${n === s.n ? ' selected' : ''}>${n}</option>`).join('')}</select></label><label>tối đa <input type="number" data-p="to" min="1" max="20" step="0.5" value="${s.to}"> s</label>`;
    case 'turn': return `<label>tới ${headSel(s.h, HEADS_TURN, 'h')}</label>`;
    case 'wait': return `<label><input type="number" data-p="s" min="0.1" max="30" step="0.1" value="${s.s}"> giây</label>`;
    case 'until': return `<label>tới giây <input type="number" data-p="t" min="0" max="30" step="0.1" value="${s.t}"> của AUTO</label>`;
    case 'park': return '<span>Về LOADING ZONE của mình, cách tường cho LEAVE vẫn tính, đứng yên tới hết AUTO. Các bước sau PARK không chạy.</span>';
  }
  return '';
}
function stepHint(s) {
  if (s.k === 'shoot') return s.at === 'spot' ? 'bắn hết bóng đang giữ' : 'bắn hết bóng đang giữ, không rời chỗ';
  if (s.k === 'collect') return `nhặt ${s.n} quả trong vòng tròn`;
  if (s.k === 'move') return s.pass ? 'điểm đi qua' : 'dừng tại điểm';
  return '';
}
function renderSteps() {
  const box = $('aeSteps'), steps = E.plan.steps, res = E.lastRun ? E.lastRun.log : null;
  const curRun = E.run && E.run.rb.brain.ps ? E.run.rb.brain.ps.i : -1;
  box.innerHTML = steps.map((s, i) => {
    const r = res ? res.find(q => q.i === i) : null, L = E.lastRun;
    let resTxt = '';
    if (r) resTxt = `<span class="ae-res${r.ok ? '' : ' bad'}">${(r.t - r.t0).toFixed(1)} s${r.text ? ' · ' + esc(r.text) : ''}${r.timeout && s.k !== 'wait' && s.k !== 'until' ? ' · hết giờ' : ''}</span>`;
    else if (L && i === L.i && s.k === 'park') resTxt = L.park ? '<span class="ae-res">đang PARK lúc hết AUTO: +5</span>' : '<span class="ae-res bad">chưa vào tới LOADING ZONE khi hết AUTO</span>';
    else if (L && i === L.i) resTxt = '<span class="ae-res bad">đang chạy dở thì hết 30 s</span>';
    else if (L) resTxt = '<span class="ae-res bad">không tới lượt</span>';
    return `<div class="ae-step${i === E.sel ? ' sel' : ''}${i === curRun ? ' run' : ''}${r && !r.ok ? ' fail' : ''}" data-i="${i}">
      <span class="ae-num">${i + 1}</span>
      <div class="ae-body"><div class="ae-head"><span class="ae-kind">${KIND[s.k]}</span><span class="ae-sum">${stepHint(s)}</span>${resTxt}</div><div class="ae-params">${stepParams(s)}</div></div>
      <div class="ae-tools"><button type="button" data-t="up" aria-label="Lên"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" data-t="down" aria-label="Xuống"${i === steps.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-t="dup" aria-label="Nhân bản bước">⧉</button><button type="button" class="del" data-t="del" aria-label="Xóa bước">✕</button></div>
    </div>`;
  }).join('');
  $('aeAdd').querySelector('[data-add="park"]').disabled = steps.some(s => s.k === 'park');
  const full = steps.length >= PLAN.MAX;
  $('aeAdd').querySelectorAll('button').forEach(b => { if (full) b.disabled = true; });
}
function renderWarn() {
  const w = PLAN.check(E.plan, specNow());
  $('aeWarn').innerHTML = w.map(q => `<li class="${q.bad ? 'bad' : ''}">${esc(q.text)}</li>`).join('');
}
function renderHead() {
  const list = lib().all();
  $('aeList').innerHTML = `<optgroup label="Chương trình mẫu">${list.filter(a => a.example).map(a => `<option value="${esc(a.id)}"${a.id === E.id ? ' selected' : ''}>${esc(a.plan.name)}</option>`).join('')}</optgroup>` +
    (list.some(a => !a.example) ? `<optgroup label="Của bạn">${list.filter(a => !a.example).map(a => `<option value="${esc(a.id)}"${a.id === E.id ? ' selected' : ''}>${esc(a.plan.name)}</option>`).join('')}</optgroup>` : '');
  $('aeName').value = E.plan.name;
  $('aeDel').disabled = lib().example(E.id);
  const rl = S().lib.list(), cur = S().set.aeRobot && S().lib.exists(S().set.aeRobot) ? S().set.aeRobot : S().set.robot;
  $('aeRobot').innerHTML = rl.map(r => `<option value="${esc(r.id)}"${r.id === cur ? ' selected' : ''}>${esc(r.name)}${r.preset ? '' : ' (của bạn)'}</option>`).join('');
  E.spec = S().lib.get(cur);
  root.BBUI.syncSegPublic($('aeWall'), E.plan.start.wall);
  root.BBUI.syncSegPublic($('aeHead'), String(E.plan.start.h));
  const chosen = S().set.auto === 'plan:' + E.id;
  $('aeUse').innerHTML = chosen ? 'Đang dùng cho trận của bạn <span>✓</span>' : 'Dùng cho trận của tôi';
}
function renderAll() {
  if (!E.plan) return;
  renderHead(); renderSteps(); renderWarn(); drawMap(); heatRequest();
  if (!E.run) renderResult();
}

// ------------------------------------------------------------------ preview run with the real engine
function stopRun() { E.run = null; $('aeRun') && ($('aeRun').innerHTML = 'Chạy thử <span>30 s</span>'); }
function startRun() {
  const plan = E.plan, spec = specNow(), P = BB.deriveRobot(spec);
  const sim = BB.createSim({ seed: 11 + (E.runN = (E.runN || 0) + 1), robots: [{ alliance: 'R', slot: 0, spec, pose: PLAN.start(plan, 'R', P), team: S().set.team || '2026' }] });
  const rb = sim.robots[0];
  AI.brainFor(sim, rb, { routine: 'plan', plan, skill: 'normal' });
  BB.startMatch(sim);
  E.run = { sim, rb, trail: [[rb.x, rb.y]], shots: [], acc: 0, steps: 0, fouls: [] };
  E.lastRun = null;
  $('aeRun').innerHTML = 'Dừng <span>Esc</span>';
  AU.sfxs.ui();
}
function runTick(dt) {
  const R = E.run; if (!R) return;
  const sim = R.sim, rb = R.rb;
  const speed = E.speed;
  let n;
  if (speed === 0) n = 700;                      // "Tức thì": as fast as the frame allows
  else { R.acc += Math.min(0.1, dt) * speed; n = Math.floor(R.acc / BB.DT); R.acc -= n * BB.DT; }
  for (let i = 0; i < n && sim.phase === 'auto'; i++) {
    if (R.steps % 5 === 0) AI.control(sim, rb, 5 * BB.DT);
    BB.advance(sim); R.steps++;
    if (R.steps % 9 === 0) R.trail.push([rb.x, rb.y]);
    for (const e of sim.events) {
      if (e.type === 'fire') R.shots.push({ x: e.x, y: e.y, ball: e.ball, made: false, t: sim.t });
      else if (e.type === 'made') { const s = R.shots.find(q => q.ball === e.ball); if (s) s.made = true; }
      else if (e.type === 'foul') R.fouls.push(e);
    }
    sim.events.length = 0;
    for (const s of R.shots) if (!s.done && sim.t - s.t > 2.5) s.done = true;
  }
  $('aeClock').textContent = `${Math.min(30, sim.t).toFixed(1)} / 30 s`;
  if (sim.phase !== 'auto') finishRun();
}
function finishRun() {
  const R = E.run, sim = R.sim, rb = R.rb;
  const snap = sim.autoSnap || { R: { leave: 0, park: 0 } };
  const b = BB.provisional(sim).R;
  const ps = rb.brain.ps, lastPark = ps && E.plan.steps[ps.i] && E.plan.steps[ps.i].k === 'park';
  E.lastRun = { log: (ps && ps.log || []).slice(), done: !!(ps && (ps.done || (lastPark && snap.R.park))), i: ps ? ps.i : 0,
    leave: snap.R.leave, park: snap.R.park, tips: sim.tips.R.auto, shots: rb.stats.shots, made: rb.stats.made, picks: rb.stats.pickups,
    pts: b.leave + b.autoPark + b.autoTip, fouls: R.fouls.slice(), cell: BB.cellCounts(sim).R };
  // keep the last frame on the map, but stop animating
  E.frozen = R; E.run = null;
  $('aeRun').innerHTML = 'Chạy lại <span>30 s</span>';
  renderSteps(); renderResult(); drawMapFrozen();
}
function drawMapFrozen() { const f = E.frozen; if (!f) { drawMap(); return; } E.run = f; drawMap(); E.run = null; }
function renderResult() {
  const box = $('aeResult'), L = E.lastRun;
  if (!L) { box.innerHTML = '<p class="note">Bấm <b>Chạy thử</b> để robot chạy đúng chương trình này bằng bộ vật lý của trận (một mình trên sân): xem nó bắn, nhặt, PARK tới đâu và mỗi bước mất bao lâu.</p>'; return; }
  const fs = (k, v, sub) => `<div class="fs"><span class="k">${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const acc = L.shots ? Math.round(100 * L.made / L.shots) + '%' : '—';
  box.innerHTML = `<div class="ae-score">${fs('Điểm AUTO', L.pts, `LEAVE ${L.leave ? 3 : 0} · PARK ${L.park ? 5 : 0} · TIP ${L.tips * 20}`)}${fs('Bắn / vào', `${L.shots} / ${L.made}`, 'chính xác ' + acc)}${fs('Nhặt thêm', L.picks, 'quả')}${fs('Bước xong', `${Math.min(L.log.length + (L.done && L.log.length < E.plan.steps.length ? 1 : 0), E.plan.steps.length)} / ${E.plan.steps.length}`, L.done ? 'chạy hết chương trình' : 'hết 30 s giữa chừng')}</div>` +
    (L.fouls.length ? `<p class="note" style="color:var(--warn)">Bị thổi: ${L.fouls.map(f => esc(f.rule + ' ' + f.text)).join('; ')}</p>` : '') +
    `<p class="note">Bóng trong CELL lúc hết AUTO: ${L.cell} (tính 2 điểm mỗi quả khi hết trận). Trong trận thật có thêm 3 robot khác trên sân nên đường đi có thể bị chặn.</p>`;
}

// ------------------------------------------------------------------ shot map (where a stationary shot scores at the start of AUTO)
function heatRequest() {
  if (!$('aeHeat').checked) return;
  const spec = specNow();
  const key = JSON.stringify(spec.shooters[0]) + spec.name;
  if (key === E.heatKey) return;
  E.heatKey = key; E.heat = null;
  const hv = ['R', 'B'].map(al => ({ hx: BB.HV.xs[al], phi: (al === 'R' ? -1 : 1) * BB.HV.stop, side: al === 'R' ? -1 : 1 }));
  const q = { shooter: spec.shooters[0], alliance: 'R', bt: 0, step: 4, hives: hv };
  $('aeClock').textContent = 'đang tính bản đồ bắn…';
  S().aimMapAsync(q, r => { if (E.heatKey !== key) return; E.heat = r; $('aeClock').textContent = ''; if (E.frozen && !E.run) drawMapFrozen(); else drawMap(); });
}

// ------------------------------------------------------------------ map pointer: add, select, drag
function hitNode(sx, sy) {
  if (!E.nodes) return -1;
  let best = -1, bd = 1e9;
  for (const n of E.nodes) { if (!n.hit) continue; const d = Math.hypot(n.hit.x - sx, n.hit.y - sy); if (d < n.hit.r && d < bd) { bd = d; best = n.i; } }
  return best;
}
function hitStart(fx, fy) {
  const st = E.startBox, P = robotP(); if (!st) return false;
  const c = Math.cos(st.psi), s = Math.sin(st.psi), dx = fx - st.x, dy = fy - st.y;
  return Math.abs(c * dx + s * dy) < P.hx + 2 && Math.abs(-s * dx + c * dy) < P.hy + 2;
}
function evPos(e) { const cv = $('aeMap'), r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; }
const LIM = HALF - 3;
function clampOwn(x, y) { return [Math.max(-LIM, Math.min(-2, x)), Math.max(-LIM, Math.min(LIM, y))]; }
function bindMap() {
  const cv = $('aeMap');
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !E.plan) return;
    if (E.run || E.frozen) { E.frozen = null; stopRun(); drawMap(); }
    const [sx, sy] = evPos(e), v = mv(), [fx, fy] = fld(v, sx, sy);
    const hit = hitNode(sx, sy);
    if (hit >= 0) {
      E.sel = hit; renderSteps(); scrollToSel();
      const s = E.plan.steps[hit];
      if (s.k === 'move' || s.k === 'collect') { E.drag = { what: 'node', i: hit, moved: false }; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); }
      drawMap(); return;
    }
    if (hitStart(fx, fy)) { E.drag = { what: 'start', moved: false }; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); drawMap(); return; }
    if (Math.abs(fx) > HALF || Math.abs(fy) > HALF) return;
    // a new "drive to" point after the selected step
    if (E.plan.steps.length >= PLAN.MAX) { note(`Tối đa ${PLAN.MAX} bước.`); return; }
    const [x, y] = clampOwn(fx, fy);
    if (fx > -2) note('Trong AUTO robot không được sang phần sân đối thủ (G402): điểm được đặt sát vạch giữa.');
    insertStep({ k: 'move', x, y, h: null, v: 1, pass: false, intake: true });
    AU.sfxs.ui();
  });
  cv.addEventListener('pointermove', e => {
    const [sx, sy] = evPos(e), v = mv(), [fx, fy] = fld(v, sx, sy);
    const inside = Math.abs(fx) <= HALF && Math.abs(fy) <= HALF;
    $('aeCoord').textContent = inside ? `cách tường liên minh ${toA(fx).toFixed(0)} in · cách tường khán đài ${toA(fy).toFixed(0)} in` : '';
    if (!E.drag) { cv.classList.toggle('grab', hitNode(sx, sy) >= 0 || hitStart(fx, fy)); return; }
    E.drag.moved = true;
    if (E.drag.what === 'node') {
      const [x, y] = clampOwn(fx, fy), s = E.plan.steps[E.drag.i];
      s.x = Math.round(x * 2) / 2; s.y = Math.round(y * 2) / 2;
      drawMap();
    } else {
      // slide along the nearest of your three walls
      const dA = Math.abs(fy + HALF), dL = Math.abs(fx + HALF), dF = Math.abs(HALF - fy);
      const wall = dL <= dA && dL <= dF ? 'l' : dA <= dF ? 'a' : 'f';
      E.plan.start.wall = wall; E.plan.start.s = Math.round((wall === 'l' ? fy : Math.min(0, fx)) * 2) / 2;
      drawMap(); root.BBUI.syncSegPublic($('aeWall'), wall);
    }
  });
  const end = () => {
    if (!E.drag) return;
    const d = E.drag; E.drag = null; cv.classList.remove('grabbing');
    if (d.moved) mutate(() => {}, {}); else drawMap();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!E.drag) $('aeCoord').textContent = ''; });
}
function scrollToSel() { const el = $('aeSteps').querySelector('.ae-step.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); }
function insertStep(step) {
  const at = E.sel >= 0 ? E.sel + 1 : E.plan.steps.length;
  // PARK stays last
  const pk = E.plan.steps.findIndex(s => s.k === 'park');
  const pos = pk >= 0 && at > pk ? pk : at;
  mutate(p => { p.steps.splice(pos, 0, step); });
  E.sel = Math.min(pos, E.plan.steps.length - 1);
  renderSteps(); drawMap(); scrollToSel();
}
function defaultStep(k) {
  const W = walk(), n = E.sel >= 0 && W.nodes[E.sel] ? W.nodes[E.sel] : W.nodes.length ? W.nodes[W.nodes.length - 1] : { x: W.st.x, y: W.st.y };
  const [x, y] = clampOwn(n.x + 14, n.y);
  switch (k) {
    case 'move': return { k, x, y, h: null, v: 1, pass: false, intake: true };
    case 'shoot': return { k, at: 'here', to: 5 };
    case 'collect': return { k, x: -60, y: -63, r: 14, n: 4, to: 8 };
    case 'turn': return { k, h: 'hive' };
    case 'wait': return { k, s: 1 };
    case 'until': return { k, t: 15 };
    case 'park': return { k };
  }
  return null;
}

// ------------------------------------------------------------------ wiring
function bind() {
  if (E.bound) return; E.bound = true;
  bindMap();
  $('aeList').addEventListener('change', () => load($('aeList').value));
  $('aeNew').addEventListener('click', () => {
    const id = lib().add({ name: 'AUTO của tôi', start: { wall: 'a', s: -16, h: 0 }, steps: [{ k: 'shoot', at: 'spot', to: 7 }, { k: 'park' }] });
    load(id); UIx().autoSelects(); note('Đã tạo chương trình mới: bấm lên sân để thêm điểm đến.');
  });
  $('aeDup').addEventListener('click', () => {
    const p = JSON.parse(JSON.stringify(E.plan)); p.name = (p.name.replace(/^Mẫu · /, '') + ' 2').slice(0, 40);
    load(lib().add(p)); UIx().autoSelects(); note('Đã nhân bản.');
  });
  $('aeDel').addEventListener('click', () => { if (lib().example(E.id)) return; $('aeConfirmText').textContent = `Xóa “${E.plan.name}”? Không khôi phục được.`; $('aeConfirm').hidden = false; $('aeConfirmNo').focus(); });
  $('aeConfirmNo').addEventListener('click', () => { $('aeConfirm').hidden = true; });
  $('aeConfirmYes').addEventListener('click', () => {
    const id = E.id; lib().remove(id); $('aeConfirm').hidden = true;
    const set = S().set;
    for (const k of ['auto', 'partnerAuto', 'dAuto', 'dAuto2', 'olAuto']) if (set[k] === 'plan:' + id) set[k] = 'full';
    S().save(); load(lib().all()[0].id); UIx().autoSelects(); note('Đã xóa.');
  });
  $('aeName').addEventListener('input', () => { const v = $('aeName').value; mutate(p => { p.name = v; }, { light: true, keepRun: true }); const o = $('aeList').querySelector(`option[value="${CSS.escape(E.id)}"]`); if (o) o.textContent = E.plan.name; });
  $('aeName').addEventListener('change', () => { renderHead(); UIx().autoSelects(); });
  $('aeRobot').addEventListener('change', () => { S().set.aeRobot = $('aeRobot').value; S().save(); E.spec = S().lib.get($('aeRobot').value); E.lastRun = null; E.frozen = null; stopRun(); renderAll(); });
  $('aeWall').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const w = b.dataset.v; mutate(p => { if (p.start.wall !== w) { p.start.wall = w; p.start.s = w === 'l' ? -6 : w === 'f' ? -47 : -16; } }); });
  $('aeHead').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mutate(p => { p.start.h = +b.dataset.v; }); });
  $('aeAdd').addEventListener('click', e => { const b = e.target.closest('button[data-add]'); if (!b || b.disabled) return; const s = defaultStep(b.dataset.add); if (s) { insertStep(s); AU.sfxs.ui(); } });
  const steps = $('aeSteps');
  steps.addEventListener('click', e => {
    const card = e.target.closest('.ae-step'); if (!card) return;
    const i = +card.dataset.i, t = e.target.closest('[data-t]');
    if (t && !t.disabled) {
      const k = t.dataset.t;
      mutate(p => {
        const s = p.steps;
        if (k === 'up' && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; E.sel = i - 1; }
        else if (k === 'down' && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; E.sel = i + 1; }
        else if (k === 'del') { s.splice(i, 1); E.sel = Math.min(i, s.length - 1); if (!s.length) E.sel = -1; }
        else if (k === 'dup' && s.length < PLAN.MAX && s[i].k !== 'park') { s.splice(i + 1, 0, JSON.parse(JSON.stringify(s[i]))); E.sel = i + 1; }
      });
      AU.sfxs.ui(); return;
    }
    if (E.sel !== i && !e.target.closest('input, select, label')) { E.sel = i; renderSteps(); drawMap(); }
    else if (E.sel !== i) { E.sel = i; steps.querySelectorAll('.ae-step').forEach(c => c.classList.toggle('sel', +c.dataset.i === i)); drawMap(); }
  });
  const edit = (e, final) => {
    const el = e.target, p = el.dataset && el.dataset.p; if (!p) return;
    const card = el.closest('.ae-step'); if (!card) return;
    const i = +card.dataset.i;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    mutate(pl => {
      const s = pl.steps[i]; if (!s) return;
      if (p === 'a') s.x = fromA(num(val, toA(s.x)));
      else if (p === 'b') s.y = fromA(num(val, toA(s.y)));
      else if (p === 'h') s.h = val === 'keep' ? null : val === 'hive' ? 'hive' : num(val, 0);
      else if (p === 'intake') s.intake = !val;
      else if (p === 'pass') s.pass = !!val;
      else if (p === 'at') s.at = val;
      else s[p] = num(val, s[p]);
    }, { light: !final });
    if (!final && el.type === 'range') { const b = el.parentElement.querySelector('b'); if (b) b.textContent = p === 'v' ? Math.round(+val * 100) + '%' : Math.round(+val) + ' in'; }
  };
  steps.addEventListener('input', e => { if (e.target.type === 'range') edit(e, false); });
  steps.addEventListener('change', e => { edit(e, true); });
  // run / speed / heat map
  $('aeRun').addEventListener('click', () => { if (E.run) { stopRun(); E.frozen = null; drawMap(); renderSteps(); return; } E.frozen = null; startRun(); });
  $('aeSpeed').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; E.speed = +b.dataset.v; S().set.aeSpeed = E.speed; S().save(); root.BBUI.syncSegPublic($('aeSpeed'), b.dataset.v); });
  $('aeHeat').addEventListener('change', () => { S().set.aeHeat = $('aeHeat').checked; S().save(); if ($('aeHeat').checked) heatRequest(); if (E.frozen && !E.run) drawMapFrozen(); else drawMap(); });
  // share, use, try
  $('aeCopy').addEventListener('click', () => {
    const code = PLAN.encode(E.plan), inp = $('aeCode'); inp.value = code;
    const done = () => note('Đã chép mã. Đồng đội dán vào ô này rồi bấm Nhập.');
    try { navigator.clipboard.writeText(code).then(done, () => { inp.focus(); inp.select(); note('Trình duyệt không cho chép tự động: mã đã được bôi đen, bấm Ctrl+C.'); }); }
    catch (err) { inp.focus(); inp.select(); note('Mã đã được bôi đen, bấm Ctrl+C.'); }
  });
  $('aeImport').addEventListener('click', () => {
    try { const p = PLAN.decode($('aeCode').value); load(lib().add(p)); UIx().autoSelects(); note(`Đã nhập “${p.name}”.`); }
    catch (err) { note('Không đọc được mã: ' + err.message); }
  });
  $('aeUse').addEventListener('click', () => {
    S().set.auto = 'plan:' + E.id; S().save(); UIx().autoSelects(); renderHead();
    note('Trận “Đấu trận” của bạn sẽ chạy chương trình này trong AUTO (đổi lại ở màn hình Đấu trận).'); AU.sfxs.ui();
  });
  $('aeTry').addEventListener('click', () => { S().set.auto = 'plan:' + E.id; S().save(); stopRun(); E.frozen = null; S().start('match'); });
  window.addEventListener('resize', () => { if (UIx().current === 'auto') { if (E.frozen && !E.run) drawMapFrozen(); else drawMap(); } });
}
E.open = function () {
  bind();
  E.speed = S().set.aeSpeed === undefined ? 1 : +S().set.aeSpeed;
  root.BBUI.syncSegPublic($('aeSpeed'), String(E.speed));
  $('aeHeat').checked = !!S().set.aeHeat;
  if (!E.plan || !lib().exists(E.id)) load(pickDefault()); else renderAll();
  requestAnimationFrame(() => { if (E.frozen && !E.run) drawMapFrozen(); else drawMap(); });
};
E.close = function () { stopRun(); };
E.frame = function (dt) {
  if (!E.run) return;
  runTick(dt);
  if (E.run) {
    drawMap();
    const i = E.run.rb.brain.ps ? E.run.rb.brain.ps.i : -1;
    if (i !== E.shownI) { E.shownI = i; $('aeSteps').querySelectorAll('.ae-step').forEach(c => c.classList.toggle('run', +c.dataset.i === i)); }
  }
};
E.onKey = function (e) {
  if (e.code === 'Escape' && E.run) { e.preventDefault(); stopRun(); E.frozen = null; drawMap(); renderSteps(); return true; }
  return false;
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
