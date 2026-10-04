/* BIOBUZZ Sim — input: keyboard halves, gamepads (standard mapping), bindings and remapping, menu navigation. */
(function (root) {
'use strict';

// player actions: kind 'axis' (analog from keys/sticks), 'hold', 'press'; role 'drive' (driver) or 'op' (operator)
const ACTIONS = [
  { id: 'driveF', label: 'Lái tới', kind: 'axis', role: 'drive' }, { id: 'driveB', label: 'Lái lùi', kind: 'axis', role: 'drive' },
  { id: 'driveL', label: 'Lái sang trái', kind: 'axis', role: 'drive' }, { id: 'driveR', label: 'Lái sang phải', kind: 'axis', role: 'drive' },
  { id: 'turnL', label: 'Xoay trái', kind: 'axis', role: 'drive' }, { id: 'turnR', label: 'Xoay phải', kind: 'axis', role: 'drive' },
  { id: 'slow', label: 'Chạy chậm (ngắm tinh)', kind: 'hold', role: 'drive' }, { id: 'driveMode', label: 'Lái theo sân / theo robot', kind: 'press', role: 'drive' },
  { id: 'shoot', label: 'Bắn (khi đã khóa)', kind: 'hold', role: 'op' }, { id: 'force', label: 'Bắn ngay (bỏ qua khóa)', kind: 'hold', role: 'op' },
  { id: 'intake', label: 'Intake', kind: 'hold', role: 'op' }, { id: 'outtake', label: 'Nhả bóng', kind: 'hold', role: 'op' },
  { id: 'arm', label: 'Cánh tay FLOWER', kind: 'hold', role: 'op' }, { id: 'autoFire', label: 'Tự bắn khi khóa', kind: 'press', role: 'op' },
  { id: 'turretLock', label: 'Khóa turret (tự chỉnh tay)', kind: 'press', role: 'op' },
  { id: 'turretL', label: 'Turret sang trái', kind: 'hold', role: 'op' }, { id: 'turretR', label: 'Turret sang phải', kind: 'hold', role: 'op' },
  { id: 'hp', label: 'Human player đưa NECTAR', kind: 'press', role: 'op' },
];
const GLOBALS = [
  { id: 'pause', label: 'Tạm dừng' }, { id: 'details', label: 'Bảng chi tiết (giữ)' }, { id: 'camera', label: 'Đổi góc nhìn' },
  { id: 'cam1', label: 'Góc nhìn: khu lái' }, { id: 'cam2', label: 'Góc nhìn: theo robot' }, { id: 'cam3', label: 'Góc nhìn: khán đài' },
  { id: 'cam4', label: 'Góc nhìn: từ trên' }, { id: 'cam5', label: 'Góc nhìn: camera robot' }, { id: 'camReset', label: 'Đặt lại thu phóng' },
  { id: 'arc', label: 'Quỹ đạo dự đoán' }, { id: 'tagCam', label: 'Khung camera AprilTag' }, { id: 'aimMap', label: 'Bản đồ ngắm' },
  { id: 'hideUI', label: 'Ẩn giao diện' }, { id: 'fps', label: 'Đồng hồ FPS' }, { id: 'reset', label: 'Xếp lại sân (luyện tập)' },
];
const DEFAULT_KEYS = {
  kbA: { driveF: 'KeyW', driveB: 'KeyS', driveL: 'KeyA', driveR: 'KeyD', turnL: 'KeyQ', turnR: 'KeyE', slow: 'KeyZ', driveMode: 'KeyM',
    shoot: 'Space', force: 'KeyR', intake: 'ShiftLeft', outtake: 'KeyX', arm: 'KeyF', autoFire: 'KeyY', turretLock: 'KeyB', turretL: 'ArrowLeft', turretR: 'ArrowRight', hp: 'KeyH' },
  kbB: { driveF: 'KeyI', driveB: 'KeyK', driveL: 'KeyJ', driveR: 'KeyL', turnL: 'KeyU', turnR: 'KeyO', slow: 'Slash', driveMode: 'Equal',
    shoot: 'Enter', force: 'KeyP', intake: 'ShiftRight', outtake: 'Period', arm: 'Semicolon', autoFire: 'BracketRight', turretLock: 'Quote', turretL: 'Comma', turretR: 'BracketLeft', hp: 'Minus' },
  // reset lives on Delete: Vietnamese input methods (Unikey, EVKey) type Backspace themselves while rewriting letters
  global: { pause: 'Escape', details: 'Tab', camera: 'KeyC', cam1: 'Digit1', cam2: 'Digit2', cam3: 'Digit3', cam4: 'Digit4', cam5: 'Digit5',
    arc: 'KeyV', tagCam: 'KeyT', aimMap: 'KeyG', hideUI: 'KeyN', fps: 'Backquote', reset: 'Delete', camReset: 'Digit0' },
};
// standard gamepad buttons
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, DU: 12, DD: 13, DL: 14, DR: 15 };
const BTN_NAME = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'Home'];
const DEFAULT_PAD = { shoot: 'RT', intake: 'LT', outtake: 'LB', force: 'RB', arm: 'A', hp: 'X', slow: 'LS', turretLock: 'RS', turretL: 'DL', turretR: 'DR', driveMode: 'BACK', autoFire: '',
  pause: 'START', camera: 'Y', aimMap: 'B', arc: 'DU', details: 'DD' };

function keyName(code) {
  if (!code) return '—';
  const m = { Space: 'Space', ShiftLeft: 'Shift trái', ShiftRight: 'Shift phải', ControlLeft: 'Ctrl trái', ControlRight: 'Ctrl phải', AltLeft: 'Alt', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

const IN = {
  ACTIONS, GLOBALS, DEFAULT_KEYS, DEFAULT_PAD, BTN, BTN_NAME, keyName,
  keys: new Set(), edges: new Set(), pads: [], padPrev: [], blocked: false, capture: null, set: null,
  // keyboard drive axes after the ramp (one state per keyboard half), and input-method sightings
  kb: { kbA: { mx: 0, my: 0, t: 0 }, kbB: { mx: 0, my: 0, t: 0 } }, lastPoll: 0, imeT: -1e9, imeN: 0,
};
// browser shortcuts we must never trigger while playing (Ctrl+W closes the tab, etc.)
const BLOCK = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Slash', 'Quote', 'Backquote']);
// A Vietnamese input method is rewriting keys: Unikey/EVKey inject the finished letter as a packet with no key code,
// the Windows Telex keyboard reports "Process" / 229. Either way W, A, S, D, E, F, R, X, J, Z stop reaching the game.
function imeKey(e) { return e.isComposing || e.keyCode === 229 || e.key === 'Process' || (!e.code && typeof e.key === 'string' && e.key.length === 1); }
IN.init = function (settings, hooks) {
  IN.set = settings; IN.hooks = hooks || {};
  window.addEventListener('keydown', e => {
    if (IN.capture) {
      e.preventDefault(); e.stopPropagation();
      if (!e.code) return;                                   // an input method's packet: wait for a real key
      const cb = IN.capture; IN.capture = null; cb({ key: e.code });
      return;
    }
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') && t.type !== 'range' && t.type !== 'checkbox';
    if (typing && e.code !== 'Escape') return;
    const playing = IN.hooks.playing && IN.hooks.playing();
    if (imeKey(e)) {
      if (playing) { e.preventDefault(); IN.imeN++; const now = performance.now(); if (now - IN.imeT > 8000 && IN.hooks.ime) IN.hooks.ime(); IN.imeT = now; }
      return;
    }
    if (playing && (BLOCK.has(e.code) || IN.bound(e.code))) e.preventDefault();
    if (!e.repeat) IN.edges.add(e.code);
    IN.keys.add(e.code);
    if (IN.hooks.key) IN.hooks.key(e, playing);
  }, true);
  window.addEventListener('keyup', e => { if (e.code) IN.keys.delete(e.code); });
  window.addEventListener('blur', () => { IN.keys.clear(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) IN.keys.clear(); });
  window.addEventListener('gamepadconnected', e => { IN.hooks.pad && IN.hooks.pad(true, e.gamepad); });
  window.addEventListener('gamepaddisconnected', e => { IN.hooks.pad && IN.hooks.pad(false, e.gamepad); });
};
IN.bound = function (code) {
  const k = IN.set.keys;
  for (const set of IN.set.kbDrive ? ['kbA', 'kbB', 'global'] : ['global']) for (const a in k[set]) if (k[set][a] === code) return true;
  return false;
};
// is any connected gamepad present right now (for the "no controller" notice)
IN.hasPad = function () { return IN.listPads().length > 0; };
IN.listPads = function () {
  try { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(g => g && g.connected !== false) : []; }
  catch (e) { IN.blocked = true; return []; }
};
// keyboard axes: keys are all-or-nothing, so ramp them like a driver easing a stick (release and reversal are quick)
function slew(cur, tgt, dt, rise) {
  if (rise <= 0) return tgt;
  if (tgt === 0 || (cur !== 0 && Math.sign(cur) !== Math.sign(tgt))) {
    const n = cur - Math.sign(cur) * dt / 0.07;
    cur = Math.sign(n) === Math.sign(cur) ? n : 0;
    if (tgt === 0 || cur !== 0) return cur;
  }
  const n = cur + Math.sign(tgt) * dt / rise;
  return Math.abs(n) > Math.abs(tgt) ? tgt : n;
}
function kbTick(dt) {
  const set = IN.set; if (!set || !set.keys) return;
  const rise = set.kbRamp === false ? 0 : 0.16, turn = Math.max(0.2, Math.min(1, +set.kbTurn || 0.6));
  for (const d of ['kbA', 'kbB']) {
    const b = set.keys[d], k = c => !!c && IN.keys.has(c), s = IN.kb[d];
    const tx = (k(b.driveR) ? 1 : 0) - (k(b.driveL) ? 1 : 0), ty = (k(b.driveF) ? 1 : 0) - (k(b.driveB) ? 1 : 0), tt = ((k(b.turnR) ? 1 : 0) - (k(b.turnL) ? 1 : 0)) * turn;
    s.mx = slew(s.mx, tx, dt, rise); s.my = slew(s.my, ty, dt, rise); s.t = slew(s.t, tt, dt, rise * 1.4);
  }
}
// once per frame: snapshot gamepads (buttons + edges), advance the keyboard ramps
IN.poll = function () {
  const now = performance.now(), dt = IN.lastPoll ? Math.min(0.1, Math.max(0, (now - IN.lastPoll) / 1000)) : 0;
  IN.lastPoll = now;
  kbTick(dt);
  const list = IN.listPads();
  IN.pads = list.map((gp, i) => {
    const prev = IN.padPrev[i] || [];
    const btn = gp.buttons.map(b => b ? (b.pressed || b.value > 0.35) : false);
    const val = gp.buttons.map(b => b ? b.value : 0);
    const edge = btn.map((b, k) => b && !prev[k]);
    IN.padPrev[i] = btn;
    return { gp, id: gp.id, axes: gp.axes.slice(0, 4), btn, val, edge, mapping: gp.mapping };
  });
  IN.padPrev.length = IN.pads.length;
  if (IN.capture) {
    for (const p of IN.pads) { const k = p.edge.findIndex(Boolean); if (k >= 0) { const cb = IN.capture; IN.capture = null; cb({ button: k }); break; } }
  }
};
IN.endFrame = function () { IN.edges.clear(); };
function curve(v) {
  const dz = IN.set.deadzone == null ? 0.1 : IN.set.deadzone;
  const a = Math.abs(v); if (a < dz) return 0;
  let u = (a - dz) / (1 - dz);
  const c = IN.set.stick || 'squared';
  if (c === 'squared') u = u * u; else if (c === 'cubic') u = 0.25 * u + 0.75 * u * u * u;
  return Math.sign(v) * Math.min(1, u);
}
function padBtn(p, name) { const k = BTN[name]; return k === undefined || !p ? false : !!p.btn[k]; }
function padEdge(p, name) { const k = BTN[name]; return k === undefined || !p ? false : !!p.edge[k]; }
function padVal(p, name) { const k = BTN[name]; return k === undefined || !p ? 0 : p.val[k] || 0; }
// read one player's controls from a device string: kbA, kbB, gp0, gp1, or 'kbA+gp0'
IN.player = function (dev, role) {
  const out = { mx: 0, my: 0, turn: 0, hold: {}, press: {}, shootV: 0, any: false };
  const parts = dev.split('+');
  const useDrive = role !== 'op', useOp = role !== 'drive';
  for (const d of parts) {
    if (d === 'kbA' || d === 'kbB') {
      if (!IN.set.kbDrive) continue;                       // robot on the keyboard is off (Cài đặt → Điều khiển); global keys still work
      const b = IN.set.keys[d], k = c => IN.keys.has(c), e = c => IN.edges.has(c);
      if (useDrive) {
        const s = IN.kb[d];
        if (Math.abs(s.mx) > Math.abs(out.mx)) out.mx = s.mx; if (Math.abs(s.my) > Math.abs(out.my)) out.my = s.my;
        if (Math.abs(s.t) > Math.abs(out.turn)) out.turn = s.t;
      }
      for (const a of ACTIONS) {
        if (a.kind === 'axis') continue;
        if ((a.role === 'drive' && !useDrive) || (a.role === 'op' && !useOp)) continue;
        const code = b[a.id]; if (!code) continue;
        if (a.kind === 'hold' && k(code)) out.hold[a.id] = true;
        if (e(code)) out.press[a.id] = true;
      }
      if (out.hold.shoot) out.shootV = 1;
    } else if (d.startsWith('gp')) {
      const p = IN.pads[+d.slice(2)]; if (!p) continue;
      const map = IN.set.pad;
      if (useDrive) {
        const mx = curve(p.axes[0] || 0), my = -curve(p.axes[1] || 0), t = curve(p.axes[2] || 0);
        if (Math.abs(mx) > Math.abs(out.mx)) out.mx = mx; if (Math.abs(my) > Math.abs(out.my)) out.my = my; if (Math.abs(t) > Math.abs(out.turn)) out.turn = t;
      }
      for (const a of ACTIONS) {
        if (a.kind === 'axis') continue;
        if ((a.role === 'drive' && !useDrive) || (a.role === 'op' && !useOp)) continue;
        const name = map[a.id]; if (!name) continue;
        if (a.kind === 'hold' && padBtn(p, name)) out.hold[a.id] = true;
        if (padEdge(p, name)) out.press[a.id] = true;
      }
      if (map.shoot) out.shootV = Math.max(out.shootV, padVal(p, map.shoot));
    }
  }
  out.any = !!(out.mx || out.my || out.turn || Object.keys(out.hold).length || Object.keys(out.press).length);
  return out;
};
// global (UI) presses this frame from every keyboard and gamepad; keys bound to an active player win
IN.globals = function (activeSets) {
  const out = {};
  const g = IN.set.keys.global;
  const taken = new Set();
  for (const set of activeSets || []) { const b = IN.set.keys[set]; if (b) for (const a in b) taken.add(b[a]); }
  for (const a in g) {
    const c = g[a]; if (!c || taken.has(c)) continue;
    if (IN.edges.has(c)) out[a] = true;
    if (a === 'details' && IN.keys.has(c)) out.detailsHeld = true;
  }
  const map = IN.set.pad;
  for (const p of IN.pads) {
    for (const a of ['pause', 'camera', 'aimMap', 'arc', 'details']) if (map[a] && padEdge(p, map[a])) out[a] = true;
    if (map.details && padBtn(p, map.details)) out.detailsHeld = true;
  }
  return out;
};
// menus: D-pad / left stick move focus, A selects, B goes back
IN.menu = function () {
  const out = { up: false, down: false, left: false, right: false, ok: false, back: false, tabL: false, tabR: false };
  for (const [i, p] of IN.pads.entries()) {
    const st = IN.menuStick[i] || (IN.menuStick[i] = { y: 0, x: 0, t: 0 });
    const ay = p.axes[1] || 0, ax = p.axes[0] || 0, now = performance.now();
    const ny = ay < -0.6 ? -1 : ay > 0.6 ? 1 : 0, nx = ax < -0.6 ? -1 : ax > 0.6 ? 1 : 0;
    if ((ny && (ny !== st.y || now - st.t > 260)) || (nx && (nx !== st.x || now - st.t > 260))) { if (ny < 0) out.up = true; if (ny > 0) out.down = true; if (nx < 0) out.left = true; if (nx > 0) out.right = true; st.t = now; }
    st.y = ny; st.x = nx;
    if (p.edge[BTN.DU]) out.up = true; if (p.edge[BTN.DD]) out.down = true; if (p.edge[BTN.DL]) out.left = true; if (p.edge[BTN.DR]) out.right = true;
    if (p.edge[BTN.A]) out.ok = true; if (p.edge[BTN.B]) out.back = true;
    if (p.edge[BTN.LB]) out.tabL = true; if (p.edge[BTN.RB]) out.tabR = true;
    if (p.edge[BTN.START]) out.start = true;
  }
  return out;
};
IN.menuStick = [];
IN.rumble = function (dev, strong, weak, ms) {
  if (!IN.set.rumble) return;
  for (const d of (dev || '').split('+')) {
    if (!d.startsWith('gp')) continue;
    const p = IN.pads[+d.slice(2)]; if (!p || !p.gp) continue;
    const va = p.gp.vibrationActuator;
    try { if (va && va.playEffect) va.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) { /* not supported */ }
  }
};
IN.labelFor = function (dev, action) {
  const parts = [];
  for (const d of dev.split('+')) {
    if (d === 'kbA' || d === 'kbB') { if (!IN.set.kbDrive) continue; const c = IN.set.keys[d][action]; if (c) parts.push(keyName(c)); }
    else if (d.startsWith('gp')) { const n = IN.set.pad[action]; if (n) parts.push(n === 'LS' ? 'L3' : n === 'RS' ? 'R3' : n === 'BACK' ? 'Back' : n === 'START' ? 'Start' : n === 'DU' ? 'D↑' : n === 'DD' ? 'D↓' : n === 'DL' ? 'D←' : n === 'DR' ? 'D→' : n); }
  }
  return Array.from(new Set(parts)).join(' / ');
};

root.BBIN = IN;
})(typeof globalThis !== 'undefined' ? globalThis : this);
