/* BIOBUZZ Sim — app core: settings, robot library, match setup, human control, main loop. */
(function () {
'use strict';
const BB = window.BB, AI = window.BBAI, R = window.BBR, IN = window.BBIN, AU = window.BBAU, REC = window.BBREC, RP = window.BBRP;
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ settings (per-viewer, browser storage)
const DEF = {
  v: 2, mig: 3,
  robot: 'turret', slot: 'R0', start: 'audience', auto: 'full', partnerAuto: 'full', skill: 'normal', partner: 'auto', opp1: 'auto', opp2: 'auto',
  team: '2026', hp: 'auto', fouls: 'on', tip: 8,
  pRobot: 'turret', pSlot: 'R0', pTimer: 'free', pFlowers: 'open', pDefender: 'none', pHp: 'auto', pTip: 8,
  dMode: 'versus', dDev1: 'gp0', dDev2: 'gp1', dRobot1: 'turret', dRobot2: 'speed', dSkill: 'normal', dAuto: 'full', dAuto2: 'full',
  intakeMode: 'always', driveMode: 'field', aimAssist: 'on', turretResp: 'normal', stick: 'squared', deadzone: 0.1, rumble: true, autoFire: false,
  // the robot is driven with a gamepad; the keyboard can drive too once turned on in Cài đặt → Điều khiển
  kbDrive: false, kbTurn: 0.6, kbRamp: true,
  keys: clone(IN.DEFAULT_KEYS), pad: clone(IN.DEFAULT_PAD),
  cam: 'driver', quality: 'high', autoRes: true, fov: 50, camAdj: {}, fx: 'on', fps: false, arc: true, aimMap: false, legend: true, tips: true, labels: true,
  vol: 0.8, sfx: 0.8, voice: true,
  olName: '', olMode: 'versus', olBots: 'normal', olRobot: 'turret', olAuto: 'full',
  autoSel: '', played: 0,
};
function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } return null; }
const S = window.BBAPP = {
  set: clone(DEF), sim: null, mode: 'boot', paused: false, humans: [], cam: 'driver', step: 0, acc: 0, countdown: 0,
  hideUI: false, showArc: true, showTag: true, showAim: false, details: false, fpsOn: false, match: null, doneT: 0, shake: 0,
  aim: { key: '', pending: false, id: 0 }, frameMs: [], clockT: 0, camEdit: false,
};
(function loadSettings() {
  const s = store('biobuzz-sim-v2');
  if (s && s.v === 2) {
    Object.assign(S.set, s);
    S.set.keys = Object.assign(clone(IN.DEFAULT_KEYS), s.keys || {});
    for (const k of ['kbA', 'kbB', 'global']) S.set.keys[k] = Object.assign(clone(IN.DEFAULT_KEYS[k]), (s.keys || {})[k] || {});
    S.set.pad = Object.assign(clone(IN.DEFAULT_PAD), s.pad || {});
    if ((s.mig | 0) < 3) {
      // earlier builds: reset sat on Backspace (Vietnamese input methods type it themselves) and the keyboard drove by default
      if (S.set.keys.global.reset === 'Backspace') S.set.keys.global.reset = 'Delete';
      if (S.set.dDev1 === 'kbA') S.set.dDev1 = 'gp0';
      if (S.set.dDev2 === 'kbB') S.set.dDev2 = 'gp1';
      S.set.kbDrive = false;
    }
    if (!S.set.camAdj || typeof S.set.camAdj !== 'object') S.set.camAdj = {};
  }
  S.set.mig = 3;
})();
S.save = function () { store('biobuzz-sim-v2', S.set); };
S.defaults = DEF;

// ------------------------------------------------------------------ robot library: presets + the viewer's own designs
const LIB = S.lib = {
  custom: store('biobuzz-robots-v2') || [],
  list() {
    const pre = Object.keys(BB.PRESETS).map(k => ({ id: k, name: BB.PRESETS[k].name, preset: true, spec: BB.presetSpec(k) }));
    return pre.concat(LIB.custom.map(c => ({ id: c.id, name: c.spec.name, preset: false, spec: c.spec })));
  },
  get(id) {
    if (BB.PRESETS[id]) return BB.presetSpec(id);
    const c = LIB.custom.find(q => q.id === id);
    return c ? BB.normalizeSpec(c.spec) : BB.presetSpec('turret');
  },
  name(id) { const r = LIB.list().find(q => q.id === id); return r ? r.name : id; },
  exists(id) { return !!BB.PRESETS[id] || LIB.custom.some(q => q.id === id); },
  add(spec) { const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); const s = BB.normalizeSpec(spec); delete s.key; LIB.custom.push({ id, spec: s }); LIB.persist(); return id; },
  put(id, spec) { const c = LIB.custom.find(q => q.id === id); if (c) { const s = BB.normalizeSpec(spec); delete s.key; c.spec = s; LIB.persist(); } },
  remove(id) { LIB.custom = LIB.custom.filter(q => q.id !== id); LIB.persist(); },
  persist() { store('biobuzz-robots-v2', LIB.custom); },
};
// ------------------------------------------------------------------ AUTO programs: examples + the viewer's own (RED frame, turned 180° for BLUE)
const PLAN = AI.PLAN;
const AUTO_EXAMPLES = {
  ex_preload: { name: 'Mẫu · Bắn preload + PARK', start: { wall: 'l', s: -6, h: 0 }, steps: [
    { k: 'shoot', at: 'spot', to: 8 }, { k: 'park' }] },
  ex_garden: { name: 'Mẫu · Preload + GARDEN + PARK', start: { wall: 'a', s: -34, h: 0 }, steps: [
    { k: 'move', x: -46, y: -50, h: 'hive' }, { k: 'shoot', at: 'here', to: 5 },
    { k: 'collect', x: -63, y: -66, r: 12, n: 2, to: 7 }, { k: 'shoot', at: 'spot', to: 7 }, { k: 'park' }] },
  ex_late: { name: 'Mẫu · Chờ đồng đội rồi bắn', start: { wall: 'f', s: -47, h: 0 }, steps: [
    { k: 'until', t: 8 }, { k: 'move', x: -50, y: -46, h: 'hive' }, { k: 'shoot', at: 'here', to: 6 }, { k: 'park' }] },
};
const AUTOS = S.autos = {
  list: store('biobuzz-autos-v1') || [],                  // [{ id, plan }]
  all() {
    const ex = Object.keys(AUTO_EXAMPLES).map(id => ({ id, example: true, plan: PLAN.normalize(AUTO_EXAMPLES[id]) }));
    return ex.concat(AUTOS.list.map(a => ({ id: a.id, example: false, plan: PLAN.normalize(a.plan) })));
  },
  get(id) { if (AUTO_EXAMPLES[id]) return PLAN.normalize(AUTO_EXAMPLES[id]); const a = AUTOS.list.find(q => q.id === id); return a ? PLAN.normalize(a.plan) : null; },
  exists(id) { return !!AUTO_EXAMPLES[id] || AUTOS.list.some(q => q.id === id); },
  example(id) { return !!AUTO_EXAMPLES[id]; },
  add(plan) { const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); AUTOS.list.push({ id, plan: PLAN.normalize(plan) }); AUTOS.persist(); return id; },
  put(id, plan) { const a = AUTOS.list.find(q => q.id === id); if (a) { a.plan = PLAN.normalize(plan); AUTOS.persist(); } },
  remove(id) { AUTOS.list = AUTOS.list.filter(q => q.id !== id); AUTOS.persist(); },
  persist() { store('biobuzz-autos-v1', AUTOS.list); },
};
// what a stored AUTO choice means: a built-in routine, or one of the plans ("plan:<id>")
const ROUTINES = { full: 'Bắn + nhặt + PARK', preload: 'Bắn preload + PARK', leave: 'Chỉ LEAVE', none: 'Đứng yên', manual: 'Tự lái AUTO' };
S.ROUTINES = ROUTINES;
S.autoChoice = function (sel) {
  if (typeof sel === 'string' && sel.startsWith('plan:')) { const p = AUTOS.get(sel.slice(5)); return p ? { routine: 'plan', plan: p } : { routine: 'full' }; }
  return { routine: ROUTINES[sel] ? sel : 'full' };
};
S.autoName = function (sel) {
  if (typeof sel === 'string' && sel.startsWith('plan:')) { const p = AUTOS.get(sel.slice(5)); return p ? p.name : ROUTINES.full; }
  return ROUTINES[sel] || ROUTINES.full;
};

// share codes: BBZ1.<base64url of the spec JSON>
S.encodeSpec = function (spec) {
  const s = BB.normalizeSpec(spec); delete s.key;
  const json = JSON.stringify(s);
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'BBZ1.' + b64;
};
S.decodeSpec = function (code) {
  code = String(code || '').trim();
  if (!code.startsWith('BBZ1.')) throw new Error('Mã phải bắt đầu bằng BBZ1.');
  let b = code.slice(5).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
  const obj = JSON.parse(decodeURIComponent(escape(atob(b))));
  if (!obj || typeof obj !== 'object' || !obj.body || !obj.drive) throw new Error('Mã không chứa robot hợp lệ.');
  return BB.normalizeSpec(obj);
};
S.robotStats = function (spec) {
  const s = BB.normalizeSpec(spec), P = BB.deriveRobot(s), D = P.drive;
  const m = s.mass, r = D.rw * 0.0254, tau = BB.MOTORS[s.drive.motor].tau;
  const motorN = (s.drive.type === 'tank' ? 4 : 4) * tau / r, grip = D.mu * m * 9.81;
  const push = Math.min(motorN, grip);
  let rate = 0; for (const sh of s.shooters) rate += 5 * sh.feed;
  const sh0 = BB.makeShooter(s.shooters[0], 0);
  let range = 0;
  for (let d = 20; d <= 200; d += 4) { const sol = BB.shotLookup(sh0, 0, d); if (sol && sol.v / (sh0.fw.eta * sh0.fw.rIn) < sh0.fw.wf * 0.93) range = d; }
  const wf = BB.FLYWHEELS[s.shooters[0].wheel];
  return { speed: D.vf / 12, push, rate, range, cls: P.cls, acc: 1 / s.scatter, P, spinJ: wf ? wf.J[s.shooters[0].inertia] : 0 };
};

// ------------------------------------------------------------------ match construction
const OPP_AUTO = { easy: ['starter', 'wall'], normal: ['turret', 'speed'], hard: ['twin', 'swerve'] };
function pickRobot(id, fallback) { return id && id !== 'auto' && LIB.exists(id) ? LIB.get(id) : BB.presetSpec(fallback); }
function partnerFor(spec) {
  // a sensible partner: an arm if you have none, otherwise a fast scorer
  return spec.flower && spec.flower.arm !== 'none' ? 'speed' : 'flower';
}
const START_PAIR = { audience: 'alliance', alliance: 'audience', far: 'alliance' };
// online: the host's setup message becomes the same match description on both machines
S.matchFromSetup = function (su, role) {
  const autoOf = a => { if (a && typeof a === 'object') { try { return { routine: 'plan', plan: PLAN.expand(a) }; } catch (e) { return { routine: 'full' }; } } return { routine: ROUTINES[a] ? a : 'full' }; };
  const robots = su.robots.map(r => Object.assign({ alliance: r.al, slot: r.slot, spec: typeof r.spec === 'string' ? BB.presetSpec(BB.PRESETS[r.spec] ? r.spec : 'turret') : BB.normalizeSpec(r.spec),
    team: String(r.team || '0000').slice(0, 5), start: r.start || 'audience', human: !!r.who, skill: r.skill || 'normal' }, r.who ? autoOf(r.auto) : { routine: 'full' }));
  const humans = [];
  su.robots.forEach((r, i) => {
    if (!r.who) return;
    const local = (r.who === 'h') === (role === 'host');
    humans.push(local ? { ri: i, ctl: [{ dev: 'kbA+gp0+gp1', role: 'both' }], player: r.who === 'h' ? 1 : 2 } : { ri: i, ctl: [], player: r.who === 'h' ? 1 : 2, remote: true });
  });
  humans.sort((a, b) => (a.remote ? 1 : 0) - (b.remote ? 1 : 0));
  return { kind: 'online', robots, humans, opts: { seed: su.seed | 0, fouls: su.fouls !== 0, pollenToTip: su.tip || 8, hpManual: {} } };
};
S.buildMatch = function (kind) {
  if (kind === 'online' && S.online) return S.matchFromSetup(S.online, 'host');
  const st = S.set, robots = [], humans = [];
  let opts = { seed: (Math.random() * 1e9) | 0, fouls: st.fouls !== 'off', pollenToTip: st.tip, hpManual: {} };
  if (kind === 'match') {
    const al = st.slot[0], sl = +st.slot[1], oa = BB.other(al);
    const me = pickRobot(st.robot, 'turret');
    const mine = S.autoChoice(st.auto), pa = S.autoChoice(st.partnerAuto === 'manual' ? 'full' : st.partnerAuto);
    robots.push({ alliance: al, slot: sl, spec: me, team: (st.team || '2026').slice(0, 5), start: st.start, human: true, skill: 'normal', routine: mine.routine, plan: mine.plan });
    robots.push({ alliance: al, slot: 1 - sl, spec: pickRobot(st.partner, partnerFor(me)), team: '8081', start: START_PAIR[st.start] || 'alliance', skill: st.skill, routine: pa.routine, plan: pa.plan });
    const oa0 = OPP_AUTO[st.skill] || OPP_AUTO.normal;
    robots.push({ alliance: oa, slot: 0, spec: pickRobot(st.opp1, oa0[0]), team: '3141', start: 'audience', skill: st.skill });
    robots.push({ alliance: oa, slot: 1, spec: pickRobot(st.opp2, oa0[1]), team: '5927', start: 'alliance', skill: st.skill });
    humans.push({ ri: 0, ctl: [{ dev: 'kbA+gp0+gp1', role: 'both' }], player: 1 });
    opts.hpManual[al] = st.hp === 'manual';
  } else if (kind === 'practice') {
    const al = st.pSlot[0];
    robots.push({ alliance: al, slot: 0, spec: pickRobot(st.pRobot, 'turret'), team: (st.team || '2026').slice(0, 5), start: 'audience', human: true, routine: 'manual' });
    if (st.pDefender === 'wall') robots.push({ alliance: BB.other(al), slot: 0, spec: BB.presetSpec('wall'), team: '9999', start: 'alliance', skill: 'normal', defend: true });
    opts = Object.assign(opts, { mode: st.pTimer === 'free' ? 'free' : 'match', noTimer: st.pTimer === 'free', practice: true, flowersOpen: st.pFlowers === 'open', fouls: false, pollenToTip: st.pTip, hpManual: { [al]: st.pHp === 'manual' } });
    humans.push({ ri: 0, ctl: [{ dev: 'kbA+gp0+gp1', role: 'both' }], player: 1 });
  } else {
    const m = st.dMode, bot = st.dSkill !== 'none';
    const r1 = pickRobot(st.dRobot1, 'turret'), r2 = pickRobot(st.dRobot2, 'speed');
    const a1 = S.autoChoice(st.dAuto), a2 = S.autoChoice(m === 'codrive' ? st.dAuto : st.dAuto2);
    const A1 = { routine: a1.routine, plan: a1.plan }, A2 = { routine: a2.routine, plan: a2.plan };
    if (m === 'versus') {
      robots.push(Object.assign({ alliance: 'R', slot: 0, spec: r1, team: '1111', start: 'audience', human: true }, A1));
      robots.push(Object.assign({ alliance: 'B', slot: 0, spec: r2, team: '2222', start: 'audience', human: true }, A2));
      if (bot) { robots.push({ alliance: 'R', slot: 1, spec: BB.presetSpec(partnerFor(r1)), team: '8081', start: 'alliance', skill: st.dSkill }); robots.push({ alliance: 'B', slot: 1, spec: BB.presetSpec(partnerFor(r2)), team: '5927', start: 'alliance', skill: st.dSkill }); }
      humans.push({ ri: 0, ctl: [{ dev: st.dDev1, role: 'both' }], player: 1 }, { ri: 1, ctl: [{ dev: st.dDev2, role: 'both' }], player: 2 });
    } else if (m === 'coop') {
      robots.push(Object.assign({ alliance: 'R', slot: 0, spec: r1, team: '1111', start: 'audience', human: true }, A1));
      robots.push(Object.assign({ alliance: 'R', slot: 1, spec: r2, team: '2222', start: 'alliance', human: true }, A2));
      if (bot) { const o = OPP_AUTO[st.dSkill]; robots.push({ alliance: 'B', slot: 0, spec: BB.presetSpec(o[0]), team: '3141', start: 'audience', skill: st.dSkill }); robots.push({ alliance: 'B', slot: 1, spec: BB.presetSpec(o[1]), team: '5927', start: 'alliance', skill: st.dSkill }); }
      humans.push({ ri: 0, ctl: [{ dev: st.dDev1, role: 'both' }], player: 1 }, { ri: 1, ctl: [{ dev: st.dDev2, role: 'both' }], player: 2 });
    } else {
      robots.push(Object.assign({ alliance: 'R', slot: 0, spec: r1, team: '1111', start: 'audience', human: true }, A1));
      if (bot) {
        robots.push({ alliance: 'R', slot: 1, spec: BB.presetSpec(partnerFor(r1)), team: '8081', start: 'alliance', skill: st.dSkill });
        const o = OPP_AUTO[st.dSkill]; robots.push({ alliance: 'B', slot: 0, spec: BB.presetSpec(o[0]), team: '3141', start: 'audience', skill: st.dSkill }); robots.push({ alliance: 'B', slot: 1, spec: BB.presetSpec(o[1]), team: '5927', start: 'alliance', skill: st.dSkill });
      }
      humans.push({ ri: 0, ctl: [{ dev: st.dDev1, role: 'drive' }, { dev: st.dDev2, role: 'op' }], player: 1, codrive: true });
    }
  }
  return { kind, robots, humans, opts };
};
function attractMatch() {
  return { kind: 'attract', humans: [], opts: { seed: (Math.random() * 1e9) | 0, pollenToTip: 8 }, robots: [
    { alliance: 'R', slot: 0, spec: BB.presetSpec('turret'), team: '2026', start: 'audience', skill: 'hard' }, { alliance: 'R', slot: 1, spec: BB.presetSpec('flower'), team: '8081', start: 'alliance', skill: 'normal' },
    { alliance: 'B', slot: 0, spec: BB.presetSpec('twin'), team: '3141', start: 'audience', skill: 'hard' }, { alliance: 'B', slot: 1, spec: BB.presetSpec('swerve'), team: '5927', start: 'alliance', skill: 'normal' }] };
}
// start poses: a team plan brings its own; two robots of one alliance never start on top of each other
function startPoses(list) {
  const poses = list.map(r => (r.routine === 'plan' && r.plan ? PLAN.start(r.plan, r.alliance, BB.deriveRobot(r.spec)) : null));
  const boxOf = i => { const r = list[i], P = BB.deriveRobot(r.spec), p = poses[i] || BB.startPose(r.alliance, r.start || (r.slot === 0 ? 'audience' : 'alliance'), P); return { x: p.x, y: p.y, psi: p.psi, hx: P.hx, hy: P.hy }; };
  for (const al of ['R', 'B']) {
    const idx = list.map((r, i) => i).filter(i => list[i].alliance === al);
    if (idx.length < 2) continue;
    const [a, b] = idx;
    if (BB.boxGap(boxOf(a), boxOf(b)) > 1.5) continue;
    // move the robot without a plan (or the second one) to the standard spot farthest from the other
    const mv = !poses[a] && poses[b] ? a : b, keep = mv === a ? b : a, K = boxOf(keep), P = BB.deriveRobot(list[mv].spec);
    let best = null, bd = -1;
    for (const w of ['audience', 'alliance', 'far', 'alliance2']) {
      const p = BB.startPose(al, w, P), g = BB.boxGap(K, { x: p.x, y: p.y, psi: p.psi, hx: P.hx, hy: P.hy });
      if (g > bd) { bd = g; best = p; }
    }
    poses[mv] = best; list[mv].moved = true;
  }
  return poses;
}
function createSimFrom(M) {
  // the engine sorts nothing: keep red first so ids are stable
  const order = M.robots.map((r, i) => ({ r, i })).sort((a, b) => (a.r.alliance === b.r.alliance ? a.r.slot - b.r.slot : a.r.alliance === 'R' ? -1 : 1));
  const map = new Map(order.map((o, k) => [o.i, k]));
  const poses = startPoses(M.robots);
  const sim = BB.createSim(Object.assign({}, M.opts, { robots: order.map(o => ({ alliance: o.r.alliance, slot: o.r.slot, spec: o.r.spec, team: o.r.team, start: o.r.start, human: !!o.r.human, pose: poses[o.i] || undefined })) }));
  order.forEach((o, k) => {
    const r = sim.robots[k], src = o.r;
    const routine = src.human ? (src.routine === 'manual' ? 'none' : src.routine || 'full') : (src.routine === 'manual' ? 'full' : src.routine || 'full');
    AI.brainFor(sim, r, { skill: src.human ? 'normal' : src.skill, routine, plan: src.plan, human: !!src.human, defend: !!src.defend });
  });
  S.humans = M.humans.map(h => {
    const rb = sim.robots[map.get(h.ri)];
    const src = M.robots[h.ri];
    return { id: rb.id, ctl: h.ctl, player: h.player, codrive: !!h.codrive, manualAuto: src.routine === 'manual', field: S.set.driveMode === 'field', autoFire: S.set.autoFire, intake: true, lastIn: 0, remote: !!h.remote };
  });
  return sim;
}
S.createSimFrom = createSimFrom;

// ------------------------------------------------------------------ boot
function fatal(msg) { $('loading').hidden = true; $('fatal').hidden = false; $('fatalMsg').textContent = msg; }
function boot() {
  if (!window.THREE || !R || R.missing) { fatal('Không tải được thư viện 3D (three.js từ cdnjs). Kiểm tra kết nối mạng rồi tải lại trang.'); return; }
  try { R.init($('gl'), { quality: S.set.quality }); }
  catch (e) { fatal('Trình duyệt không mở được WebGL. Bật tăng tốc phần cứng hoặc thử Chrome/Edge bản mới.'); return; }
  AU.setLevels(S.set.vol, S.set.sfx, S.set.voice);
  if (window.BBFX) window.BBFX.setOptions(S.set);
  R.view.adj = clone(S.set.camAdj || {}); R.view.fov = S.set.fov || 50; R.dyn.on = S.set.autoRes !== false;
  IN.init(S.set, { playing: () => (S.mode === 'play' && !S.paused) || (S.mode === 'guest' && $('pause').hidden), key: onKey, pad: onPad, ime: onIme });
  window.BBUI.init();
  onResize(); window.addEventListener('resize', onResize);
  bindCanvas();
  bindCamEdit();
  $('padWarnKb').addEventListener('click', () => { S.set.kbDrive = true; S.save(); padNotice(); window.BBHUD.legend(); window.BBHUD.toast('Đã bật lái bằng bàn phím (tắt lại trong Cài đặt → Điều khiển)', 'g'); $('padWarnKb').blur(); });
  startAttract();
  $('loading').hidden = true;
  requestAnimationFrame(frame);
}
function onResize() { const c = $('gl'); R.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight); }
function onPad(on, gp) {
  window.BBUI.padState();
  padNotice();
  if (S.mode === 'play') { window.BBHUD.toast(on ? 'Đã nhận tay cầm: ' + String(gp.id || '').split('(')[0].trim() : 'Tay cầm đã ngắt', on ? 'g' : 'f'); window.BBHUD.legend(); }
}
// a Vietnamese input method is eating the drive keys
function onIme() {
  if (!S.set.kbDrive) return;
  window.BBHUD.toast('Bộ gõ tiếng Việt (Unikey/EVKey) đang bật nên phím lái bị nuốt: tắt bộ gõ (thường là Ctrl+Shift hoặc Alt+Z) hoặc chuyển sang tiếng Anh (E) rồi lái tiếp.', 'f');
}
// robot control is on the gamepad by default: say so when none is plugged in
function padNotice() {
  const el = $('padWarn'); if (!el) return;
  const local = S.humans.filter(h => !h.remote), needs = (S.mode === 'play' || S.mode === 'guest') && local.length > 0 && !S.set.kbDrive;
  el.hidden = !(needs && !IN.hasPad() && !IN.blocked);
  if (IN.blocked && needs) { el.hidden = false; $('padWarnText').textContent = 'Trình xem này chặn tay cầm: mở trang trong tab riêng, hoặc lái bằng bàn phím.'; }
  else $('padWarnText').textContent = 'Chưa thấy tay cầm: cắm vào rồi bấm một nút bất kỳ để lái.';
}
S.padNotice = padNotice;
// ------------------------------------------------------------------ camera angles: drag, slide, zoom in every view, remembered per view
function camModeNow() {
  if (S.mode === 'replay') return RP.camMode;
  if (S.mode === 'play' || S.mode === 'guest' || S.mode === 'results' || S.mode === 'guestResults') return S.mode === 'guestResults' ? 'broadcast' : S.cam;
  return null;
}
let camSaveT = 0;
function camPersist() { clearTimeout(camSaveT); camSaveT = setTimeout(() => { S.set.camAdj = clone(R.view.adj); S.save(); }, 400); }
S.camPersist = camPersist;
S.camResetView = function (all) {
  const m = camModeNow(); R.camReset(all ? null : m); camPersist();
  window.BBHUD.toast(all ? 'Đã đặt lại mọi góc camera' : 'Đã đặt lại góc camera');
};
function bindCanvas() {
  const c = $('gl'); let drag = null;
  const live = () => (S.mode === 'play' || S.mode === 'guest' || S.mode === 'replay') && !!camModeNow();
  c.addEventListener('contextmenu', e => { if (live()) e.preventDefault(); });
  c.addEventListener('pointerdown', e => {
    if (!live()) return;
    const kind = e.button === 2 || e.shiftKey || e.ctrlKey ? 'pan' : e.button === 1 ? 'zoom' : 'orbit';
    drag = { x: e.clientX, y: e.clientY, kind, id: e.pointerId };
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    R.view.drag = true; c.classList.add('dragging');
    if (e.button === 1) e.preventDefault();
  });
  c.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if ((dx || dy) && R.camInput(camModeNow(), drag.kind, dx, drag.kind === 'zoom' ? dy * 2 : dy)) camPersist();
  });
  const end = e => { if (drag && (!e || e.pointerId === drag.id)) { drag = null; R.view.drag = false; c.classList.remove('dragging'); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end); c.addEventListener('lostpointercapture', end);
  c.addEventListener('dblclick', () => { if (live()) S.camResetView(false); });
  c.addEventListener('wheel', e => {
    if (!live()) return;
    e.preventDefault();
    if (R.camInput(camModeNow(), 'zoom', 0, e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1))) camPersist();
  }, { passive: false });
}
// paused → "Chỉnh góc camera": the menu steps aside, mouse / keyboard / gamepad move the view, Esc or Xong returns
function bindCamEdit() {
  $('btnCamEdit').addEventListener('click', () => S.camEditMode(true));
  $('camEditDone').addEventListener('click', () => S.camEditMode(false));
  $('camEditReset').addEventListener('click', () => S.camResetView(false));
}
S.camEditMode = function (on) {
  S.camEdit = !!on;
  $('camEdit').hidden = !on;
  if (S.mode === 'guest') $('pause').hidden = !!on;
  else if (S.mode === 'play' && S.paused) $('pause').hidden = !!on;
  if (!on) { const b = $('btnCamEdit'); if (b && !$('pause').hidden) b.focus(); }
  else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
};
function camEditTick(dt) {
  const m = camModeNow(); if (!m) return;
  let ox = 0, oy = 0, px = 0, py = 0, zm = 0, done = false, reset = false;
  const k = c => IN.keys.has(c);
  ox += (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0); oy += (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
  px += (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0); py += (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0);
  zm += (k('PageDown') || k('Minus') || k('NumpadSubtract') ? 1 : 0) - (k('PageUp') || k('Equal') || k('NumpadAdd') ? 1 : 0);
  if (IN.edges.has('Escape') || IN.edges.has('Enter')) done = true;
  if (IN.edges.has('Digit0') || IN.edges.has('KeyR')) reset = true;
  const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
  for (const p of IN.pads) {
    ox += dz(p.axes[0] || 0); oy += dz(p.axes[1] || 0); px += dz(p.axes[2] || 0); py += dz(p.axes[3] || 0);
    zm += (p.val[IN.BTN.LT] || 0) - (p.val[IN.BTN.RT] || 0);
    if (p.edge[IN.BTN.A] || p.edge[IN.BTN.B] || p.edge[IN.BTN.START]) done = true;
    if (p.edge[IN.BTN.Y]) reset = true;
  }
  if (done) { S.camEditMode(false); return; }
  if (reset) { S.camResetView(false); return; }
  // sticks and keys steer the camera (right = look right, W = move forward); the mouse drags the scene
  let ch = false;
  if (ox || oy) ch = R.camInput(m, 'orbit', -ox * 320 * dt, oy * 240 * dt) || ch;
  if (px || py) ch = R.camInput(m, 'pan', -px * 420 * dt, -py * 420 * dt) || ch;
  if (zm) ch = R.camInput(m, 'zoom', 0, zm * 900 * dt) || ch;
  if (ch) camPersist();
}
function onKey(e, playing) {
  AU.unlock();
  if (S.mode === 'menu') window.BBUI.onKey(e);
  else if (S.mode === 'replay') RP.onKey(e);
  else if (S.mode === 'results' && e.code === 'Enter' && (!e.target || e.target.tagName !== 'BUTTON')) { e.preventDefault(); S.rematch(); }
}

// ------------------------------------------------------------------ modes
function startAttract() {
  S.mode = 'menu'; S.paused = false; S.match = null;
  $('labels').hidden = true;
  S.sim = createSimFrom(attractMatch()); R.build(S.sim); BB.startMatch(S.sim);
  for (let i = 0; i < 300 * 3; i++) { if (i % 5 === 0) S.sim.robots.forEach(r => AI.control(S.sim, r, 5 * BB.DT)); BB.advance(S.sim); }
  S.sim.events.length = 0;
  $('hud').hidden = true; $('results').hidden = true; $('pause').hidden = true; $('menu').hidden = false;
  R.setAimMap(null);
  R.updateCamera(S.sim, 'attract', null, 'R', 0, true);
  window.BBUI.show(window.BBUI.current || 'home');
}
S.toMenu = function (screen) {
  const NET = window.BBNET;
  // online: back to the room's lobby (the lobby screen has "Rời phòng")
  if (NET && NET.role && (S.lastKind === 'online' || S.mode === 'guest' || S.mode === 'guestResults')) { NET.toLobby(); startAttract(); window.BBUI.show('online'); return; }
  startAttract(); if (screen) window.BBUI.show(screen);
};
S.startAttract = startAttract;
S.start = function (kind) {
  AU.unlock();
  const M = S.buildMatch(kind);
  S.match = M;
  S.mode = 'play'; S.paused = false; S.doneT = 0; S.step = 0; S.acc = 0; S.aim.key = '';
  S.sim = createSimFrom(M); R.build(S.sim); REC.reset(S.sim);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $('menu').hidden = true; $('results').hidden = true; $('pause').hidden = true; $('hud').hidden = false;
  S.cam = S.humans.filter(h => !h.remote).length > 1 && !S.humans[0].codrive ? 'broadcast' : (S.set.cam || 'driver');
  S.showArc = S.set.arc; S.showTag = true; S.showAim = S.set.aimMap; S.fpsOn = S.set.fps; S.hideUI = false; S.details = false;
  R.setAimMap(null);
  const me = primary();
  R.updateCamera(S.sim, S.cam, me, me ? me.alliance : 'R', 0, true);
  window.BBHUD.setup();
  $('btnReset').hidden = kind !== 'practice';
  S.set.played = (S.set.played || 0) + 1; S.lastKind = kind; S.save();
  S.camEditMode(false);
  padNotice();
  if (S.sim.mode === 'free') { BB.startMatch(S.sim); S.countdown = 0; window.BBHUD.banner('LUYỆN TẬP', `không giới hạn thời gian · ${IN.keyName(S.set.keys.global.reset)} xếp lại sân`); AU.cue.tele(); }
  else {
    S.countdown = 3.2;
    const me0 = M.robots.find(r => r.human && r.routine === 'plan' && r.plan);
    window.BBHUD.banner('3', me0 ? 'AUTO: ' + me0.plan.name : 'chuẩn bị AUTO'); AU.cue.count();
    if (M.robots.some(r => r.moved)) window.BBHUD.toast('Hai robot cùng liên minh trùng chỗ xuất phát: robot còn lại được dời sang vị trí khác.', 'f');
  }
};
S.rematch = function () { if (S.lastKind === 'online' && window.BBNET) window.BBNET.rematch(); else if (S.lastKind) S.start(S.lastKind); };
function primary() { const h = S.humans[0]; return h && S.sim ? S.sim.robots[h.id] : null; }
S.primary = primary;
function togglePause() {
  if (S.mode !== 'play' || (S.sim && S.sim.phase === 'done')) return;
  S.paused = !S.paused; $('pause').hidden = !S.paused;
  if (!S.paused) S.camEditMode(false);
  window.BBUI.syncCam();
  if (window.BBNET && window.BBNET.role === 'host') window.BBNET.hostPaused(S.paused);
  if (S.paused) $('btnResume').focus();
}
S.togglePause = togglePause;
// practice: put every ball and both HIVEs back to the start of a match; robots stay where they are
S.resetField = function () {
  const old = S.sim; if (!old) return;
  const keep = old.robots.map(r => ({ x: r.x, y: r.y, psi: r.psi }));
  const M = S.match;
  const sim = createSimFrom(M);
  sim.robots.forEach((r, i) => { const k = keep[i]; if (!k) return; r.x = k.x; r.y = k.y; r.psi = k.psi; r.px = k.x; r.py = k.y; r.ppsi = k.psi; r.est = { x: k.x, y: k.y, psi: k.psi }; });
  S.sim = sim; R.build(sim); BB.startMatch(sim); REC.reset(sim);
  S.aim.key = ''; R.setAimMap(null);
  window.BBHUD.setup();
  window.BBHUD.toast('Đã xếp lại sân', 'g');
};
S.CAM_NAMES = { driver: 'Khu lái', follow: 'Theo robot', broadcast: 'Khán đài', top: 'Nhìn từ trên', pov: 'Camera robot', free: 'Tự do' };
S.setCam = function (c) {
  S.cam = c; if (S.humans.filter(h => !h.remote).length <= 1) { S.set.cam = c; S.save(); }
  window.BBHUD.toast('Góc nhìn: ' + S.CAM_NAMES[c] + (R.camAdjusted(c) ? ' (góc bạn đã chỉnh)' : ''));
  window.BBUI.syncCam();
};
const CAMS = ['driver', 'follow', 'broadcast', 'top', 'pov', 'free'];

// ------------------------------------------------------------------ human control (every rendered frame, straight before physics)
function mergeIn(list) {
  const out = { mx: 0, my: 0, turn: 0, hold: {}, press: {}, shootV: 0, any: false };
  for (const q of list) {
    if (Math.abs(q.mx) > Math.abs(out.mx)) out.mx = q.mx; if (Math.abs(q.my) > Math.abs(out.my)) out.my = q.my; if (Math.abs(q.turn) > Math.abs(out.turn)) out.turn = q.turn;
    Object.assign(out.hold, q.hold); Object.assign(out.press, q.press); out.shootV = Math.max(out.shootV, q.shootV); out.any = out.any || q.any;
  }
  return out;
}
function humanDrives(sim, h) { return sim.phase === 'tele' || sim.phase === 'free' || (sim.phase === 'auto' && h.manualAuto); }
function stationFrame(rb) { const s = rb.alliance === 'R' ? 1 : -1; return { fx: s, fy: 0, rx: 0, ry: -s }; }
function applyHuman(rb, h) {
  const sim = S.sim, set = S.set, remote = !!h.remote;
  // a remote (online) player: the guest's own toggles and settings arrive with the input
  const inp = remote ? (window.BBNET ? window.BBNET.remoteInput(h) : null) : mergeIn(h.ctl.map(c => IN.player(c.dev, c.role)));
  if (!inp) { rb.cmd.vx = 0; rb.cmd.vy = 0; rb.cmd.w = 0; rb.fireHeld = false; rb.shootAnywhere = false; return; }
  if (remote) {
    h.field = !inp.robotFrame; h.autoFire = !!inp.autoFire;
    rb.turretLock = !!inp.turretLock && rb.shooters.some(s => s.tur.has);
    if (inp.press.hp) { const hp = sim.hp[rb.alliance]; if (hp.manual) hp.req = 1; }
    rb.intakeOn = !!inp.hold.intake;
  } else {
    if (inp.press.driveMode) { h.field = !h.field; window.BBHUD.toast(h.field ? 'Lái theo sân' : 'Lái theo đầu robot'); }
    if (inp.press.autoFire) { h.autoFire = !h.autoFire; window.BBHUD.toast('Tự bắn khi khóa: ' + (h.autoFire ? 'BẬT' : 'TẮT')); AU.sfxs.toggle(h.autoFire); }
    if (inp.press.turretLock && rb.shooters.some(s => s.tur.has)) { rb.turretLock = !rb.turretLock; window.BBHUD.toast(rb.turretLock ? 'Turret khóa tay: dùng nút xoay turret' : 'Turret tự bám tag'); AU.sfxs.toggle(rb.turretLock); }
    if (inp.press.hp) {
      const hp = sim.hp[rb.alliance];
      if (!hp.manual) window.BBHUD.toast('Human player đang tự động (đổi trong phần thiết lập trận)');
      else { hp.req = 1; }
    }
    // intake
    if (set.intakeMode === 'toggle') { if (inp.press.intake) { h.intake = !h.intake; AU.sfxs.toggle(h.intake); } rb.intakeOn = h.intake; }
    else if (set.intakeMode === 'hold') rb.intakeOn = !!inp.hold.intake;
    else rb.intakeOn = true;
  }
  rb.outtake = !!inp.hold.outtake;
  if (rb.outtake) rb.intakeOn = false;
  rb.armHeld = !!inp.hold.arm;
  const shootHeld = !!inp.hold.shoot || inp.shootV > 0.35;
  rb.fireHeld = shootHeld || !!inp.hold.force;
  rb.shootAnywhere = !!inp.hold.force;
  rb.autoFire = h.autoFire;
  rb.turretNudge = (inp.hold.turretL ? 1 : 0) - (inp.hold.turretR ? 1 : 0);
  rb.turretFast = remote ? !!inp.turretFast : set.turretResp === 'fast';
  rb.noiseMul = 1;
  // drive
  let mx = inp.mx, my = inp.my;
  const mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; }
  let f;
  if (h.field) f = remote ? inp.frame : S.humans.filter(q => !q.remote).length > 1 && !h.codrive ? stationFrame(rb) : R.driveFrame(S.cam, rb);
  else f = { fx: Math.cos(rb.psi), fy: Math.sin(rb.psi), rx: Math.sin(rb.psi), ry: -Math.cos(rb.psi) };
  rb.cmd.vx = my * f.fx + mx * f.rx; rb.cmd.vy = my * f.fy + mx * f.ry;
  rb.cmd.w = -inp.turn;
  rb.cmd.slow = !!inp.hold.slow;
  // AprilTag aim assist for fixed shooters: holding shoot turns the chassis onto the target (the driver can still override)
  const fixed = rb.shooters.find(s => !s.tur.has);
  const capped = rb.shooters.find(s => s.tur.has && s.aim.valid && s.aim.limit);
  const assist = fixed || capped;
  if (assist && shootHeld && (remote ? inp.aimAssist : set.aimAssist === 'on') && Math.abs(inp.turn) < 0.3) {
    const A = assist.aim;
    const hv = BB.hiveOf(sim, rb.alliance), tp = BB.aimPointWorld(hv, hv.side);
    const az = A.valid ? A.az : Math.atan2(tp[1] - rb.est.y, tp[0] - rb.est.x);
    // a turret only needs the target back inside its travel; a fixed shooter needs the chassis on it
    const err = BB.wrap(az - (rb.est.psi + assist.faces));
    const want = assist.tur.has ? err - Math.sign(err) * Math.max(0, assist.tur.half - 0.5) : err;
    rb.cmd.w = Math.max(-1, Math.min(1, want * 3.2 - rb.w * 0.22));
  }
  if (inp.any) h.lastIn = sim.t;
  h.inp = inp;
}
function humanTick() {
  const sim = S.sim;
  for (const h of S.humans) {
    const rb = sim.robots[h.id];
    if (h.gone) { rb.brain.human = false; continue; }          // an online player who left: the bot drives
    if (humanDrives(sim, h)) { rb.brain.human = true; applyHuman(rb, h); }
    else if (sim.phase === 'auto' && !h.manualAuto) { /* your AUTO program is driving */ }
  }
}
function aiTick(dt) {
  const sim = S.sim;
  for (const rb of sim.robots) {
    const h = S.mode === 'play' ? S.humans.find(q => q.id === rb.id) : null;
    if (h && !h.gone && (humanDrives(sim, h) || sim.phase === 'trans')) continue;
    AI.control(sim, rb, dt);
  }
}

// ------------------------------------------------------------------ aim map (Web Worker built from the engine's own source)
function aimWorker() {
  if (S.worker !== undefined) return S.worker;
  try {
    const el = document.getElementById('src-engine');
    const src = el.textContent + '\n;self.onmessage=function(e){var r=self.BB.aimMap(e.data.q);self.postMessage({id:e.data.id,n:r.n,step:r.step,x0:r.x0,data:r.data},[r.data.buffer]);};';
    S.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    S.worker.onmessage = e => {
      const cb = S.aimCbs[e.data.id];
      if (cb) { delete S.aimCbs[e.data.id]; cb(e.data); return; }
      if (e.data.id === S.aim.id && S.showAim && S.mode === 'play') { R.setAimMap(e.data); S.aim.pending = false; }
    };
    S.worker.onerror = () => { S.worker = null; for (const k in S.aimCbs) { const q = S.aimCbs[k]; delete S.aimCbs[k]; q(null); } };
  } catch (e) { S.worker = null; }
  return S.worker;
}
S.aimCbs = {}; S.aimReq = 0;
// the AUTO editor's shot map, off the main thread when a worker is available
S.aimMapAsync = function (q, cb) {
  const w = aimWorker();
  if (!w) { setTimeout(() => { let r = null; try { r = BB.aimMap(q); } catch (e) { r = null; } cb(r); }, 0); return; }
  const id = 'ed' + (++S.aimReq);
  S.aimCbs[id] = cb; w.postMessage({ id, q });
};
function aimMapTick() {
  const me = primary();
  if (!S.showAim || !me || S.mode !== 'play') { if (R.aimOverlay) R.setAimMap(null); S.aim.key = ''; return; }
  const h = BB.hiveOf(S.sim, me.alliance);
  if (Math.abs(h.w) > 0.05) return;                     // wait for the HIVE to settle
  const sh = me.spec.shooters[0];
  const bt = me.hopper.length && me.hopper[0].ball.bt !== 0 ? me.hopper[0].ball.bt : 0;
  const key = me.id + ':' + h.side + ':' + (bt ? 1 : 0) + ':' + S.sim.hives.map(q => q.side).join(',');
  if (key === S.aim.key) return;
  S.aim.key = key; S.aim.id++;
  const q = { shooter: sh, alliance: me.alliance, bt, step: 4, hives: S.sim.hives.map(q2 => ({ hx: q2.hx, phi: q2.side * BB.HV.stop, side: q2.side })) };
  const w = aimWorker();
  if (w) { S.aim.pending = true; w.postMessage({ id: S.aim.id, q }); }
  else { const r = BB.aimMap(q); R.setAimMap(r); }
}

// ------------------------------------------------------------------ events: sound, callouts, rumble, toasts
function devOf(rbId) { const h = S.humans.find(q => q.id === rbId); return h ? h.ctl.map(c => c.dev).join('+') : ''; }
function handleEvents() {
  const sim = S.sim, H = window.BBHUD;
  if (S.mode !== 'play') { sim.events.length = 0; return; }
  const mineId = new Set(S.humans.filter(h => !h.remote).map(h => h.id));
  const myAl = new Set(S.humans.filter(h => !h.remote).map(h => sim.robots[h.id].alliance));
  for (const e of sim.events) {
    REC.event(sim, e);
    if (window.BBFX) window.BBFX.event(sim, e, mineId);
    if (window.BBNET && window.BBNET.role === 'host') window.BBNET.hostEvent(e);
    switch (e.type) {
      case 'phase':
        if (e.phase === 'auto') { H.banner('AUTO', 'robot chạy chương trình 30 giây'); AU.cue.start(); }
        if (e.phase === 'trans') { H.banner('HẾT AUTO', 'TELEOP sau 8 giây · đặt tay lên cần'); AU.cue.autoEnd(); }
        if (e.phase === 'tele') { H.banner('TELEOP', 'cầm lái!'); AU.cue.tele(); S.humans.forEach(h => IN.rumble(devOf(h.id), 0.4, 0.4, 180)); }
        if (e.phase === 'end') { H.banner('HẾT GIỜ', 'chờ bóng dừng để chấm điểm'); AU.cue.end(); }
        break;
      case 'pickup': AU.say('Drivers, pick up your controllers.'); H.toast('Drivers, pick up your controllers', 'g'); break;
      case 'lastMinute': H.banner('1:00', 'FLOWER bắt đầu tính · human player đưa hết NECTAR'); AU.cue.endgame(); break;
      case 'tip': {
        if (!e.counted) break;
        const mine = myAl.has(e.alliance);
        H.toast(`HIVE ${e.alliance === 'R' ? 'ĐỎ' : 'XANH'} TIP! +20${e.auto ? ' (AUTO)' : ''}`, e.alliance === 'R' ? 'r' : 'b');
        AU.sfxs.tip(mine); S.shake = 0.3;
        S.humans.forEach(h => { if (sim.robots[h.id].alliance === e.alliance) IN.rumble(devOf(h.id), 0.7, 0.5, 260); });
        break;
      }
      case 'foul': H.toast(`${e.rule} · ${e.kind === 'major' ? 'MAJOR' : 'MINOR'} ${e.alliance === 'R' ? 'ĐỎ' : 'XANH'}: ${e.text}`, 'f'); AU.cue.foul(); H.foulFlash(e.alliance); break;
      case 'rule': if (mineId.has(e.robot)) H.toast(e.text, 'f'); break;
      case 'fire': if (mineId.has(e.robot)) { AU.sfxs.shot(1); IN.rumble(devOf(e.robot), 0.15, 0.35, 60); } else AU.sfxs.shot(0.35); break;
      case 'made': if (mineId.has(e.robot)) AU.sfxs.made(); break;
      case 'intake': if (mineId.has(e.robot)) AU.sfxs.intake(); break;
      case 'dunkStart': if (mineId.has(e.robot)) AU.sfxs.arm(); break;
      case 'dunk': if (mineId.has(e.robot)) AU.sfxs.dunk(); break;
      case 'nectarIn': if (myAl.has(e.alliance)) { H.toast(`Human player đưa NECTAR vào LOADING ZONE (còn ${e.left})`, e.alliance === 'R' ? 'r' : 'b'); AU.sfxs.nectar(); } break;
      case 'out': H.toast(e.bt === 0 ? 'POLLEN văng khỏi sân: đặt lại sau 2 giây (10.8.2)' : 'NECTAR văng khỏi sân: trả về human player'); break;
      case 'reintro': break;
      case 'hpBlocked': if (myAl.has(e.alliance)) H.toast(e.why === 'empty' ? 'Human player đã hết NECTAR' : 'LOADING ZONE không còn chỗ trống để đặt NECTAR', 'f'); break;
      case 'impact': { const d = Math.hypot(R.cam.position.x - e.x, R.cam.position.y - e.z, R.cam.position.z + e.y); AU.impact(e.v, d, e.mat); break; }
    }
  }
  sim.events.length = 0;
  // robot-to-robot hits on your robot
  for (const c of sim._rr) {
    for (const h of S.humans) {
      if (c.a.id !== h.id && c.b.id !== h.id) continue;
      const rv = Math.hypot(c.a.vx - c.b.vx, c.a.vy - c.b.vy);
      if (rv > 25 && (!h.bumpT || sim.t - h.bumpT > 0.4)) { h.bumpT = sim.t; IN.rumble(devOf(h.id), Math.min(1, rv / 90), 0.3, 120); AU.sfxs.bump(rv); }
    }
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now; if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
  S.frameMs.push(dt * 1000); if (S.frameMs.length > 120) S.frameMs.shift();
  IN.poll();
  const sim = S.sim; if (!sim) { IN.endFrame(); return; }
  const UI = window.BBUI, H = window.BBHUD, FX = window.BBFX, NET = window.BBNET;
  if (S.mode === 'replay') { try { RP.frame(dt); if (FX) FX.update(RP.playing ? dt * RP.speed : 0, R.cam, RP.view); RP.render(dt); } finally { IN.endFrame(); R.dynTick(dt, Math.max(0, performance.now() - now)); } return; }
  if ((S.mode === 'guest' || S.mode === 'guestResults') && NET) {
    try { if (S.camEdit && S.mode === 'guest') camEditTick(dt); NET.guestFrame(dt); }
    catch (e) { S.netErrs = (S.netErrs || 0) + 1; if (S.netErrs === 1 && window.console) console.warn('online frame skipped:', e && e.message); }
    finally { IN.endFrame(); R.dynTick(dt, Math.max(0, performance.now() - now)); }
    return;
  }
  if (S.mode === 'menu') UI.frame(dt);
  if (S.mode === 'play' && S.camEdit) camEditTick(dt);
  else if (S.mode === 'play') {
    const g = IN.globals(activeKeySets());
    const nav = S.paused ? IN.menu() : null;
    if (g.pause || (nav && nav.back)) togglePause();
    if (S.paused && nav) UI.navigate(nav, $('pause'));
    if (!S.paused) {
      if (g.camera) S.setCam(CAMS[(CAMS.indexOf(S.cam) + 1) % CAMS.length]);
      for (let k = 1; k <= 5; k++) if (g['cam' + k]) S.setCam(['driver', 'follow', 'broadcast', 'top', 'pov'][k - 1]);
      if (g.arc) { S.showArc = !S.showArc; H.toast('Quỹ đạo dự đoán: ' + (S.showArc ? 'BẬT' : 'TẮT')); }
      if (g.tagCam) { S.showTag = !S.showTag; H.toast('Camera AprilTag: ' + (S.showTag ? 'BẬT' : 'TẮT')); }
      if (g.aimMap) { S.showAim = !S.showAim; S.aim.key = ''; H.toast(S.showAim ? 'Bản đồ ngắm: đang tính…' : 'Bản đồ ngắm: TẮT'); }
      if (g.hideUI) { S.hideUI = !S.hideUI; }
      if (g.fps) { S.fpsOn = !S.fpsOn; }
      if (g.reset && S.lastKind === 'practice') S.resetField();
      if (g.camReset) S.camResetView(false);
      S.details = !!g.detailsHeld;
    }
  } else if (S.mode === 'results') {
    const nav = IN.menu(); UI.navigate(nav, $('results'));
  }
  if (S.mode === 'play' && S.countdown > 0 && !S.paused) {
    const before = Math.ceil(S.countdown); S.countdown -= dt; const after = Math.ceil(S.countdown);
    if (after !== before && after > 0) { H.banner(String(after), 'chuẩn bị AUTO'); AU.cue.count(); }
    if (S.countdown <= 0) BB.startMatch(S.sim);
  }
  if (!S.paused) {
    if (S.mode === 'play') {
      // the 3 second countdown before TELEOP, like the field
      if (S.sim.phase === 'trans') { const left = BB.T_TELE0 - S.sim.t; const c = Math.ceil(left); if (c <= 3 && c !== S.lastCount) { S.lastCount = c; if (c > 0) { H.banner(String(c), 'TELEOP'); AU.cue.count(); } } }
      humanTick();
    }
    S.acc += dt; let n = 0;
    while (S.acc >= BB.DT && n < 30) {
      if (S.step % 5 === 0) aiTick(5 * BB.DT);
      R.snap(S.sim);                                    // the state before this step, for drawing between steps
      BB.advance(S.sim); S.step++; S.acc -= BB.DT; n++;
      if (S.mode === 'play' && S.step % 10 === 0) REC.tick(S.sim);
    }
    if (n >= 30) S.acc = 0;
  }
  handleEvents();
  if (S.mode === 'menu' && S.sim.phase === 'done') { S.attractT = (S.attractT || 0) + dt; if (S.attractT > 3) { S.attractT = 0; S.sim = createSimFrom(attractMatch()); R.build(S.sim); BB.startMatch(S.sim); } }
  if (S.mode === 'play' && S.sim.phase === 'done') { S.doneT += dt; if (S.doneT > 0.8) { S.mode = 'results'; S.camEditMode(false); REC.finish(S.sim); H.results(); if (window.BBFX) window.BBFX.celebrate(S.sim.final); if (window.BBNET) window.BBNET.hostDone(); } }
  // render: between the last two physics steps
  const me = S.mode === 'play' || S.mode === 'results' ? primary() : null;
  R.update(S.sim, S.paused ? 0 : dt, S.acc / BB.DT);
  if (FX) FX.update(S.paused ? 0 : dt, R.cam);
  S.scrT = (S.scrT || 0) - dt;
  if (S.scrT <= 0) { S.scrT = 0.5; R.drawScreen(S.sim, BB.provisional(S.sim), BB.matchClock(S.sim)); }
  R.updateCamera(S.sim, S.mode === 'menu' ? 'attract' : S.cam, me, me ? me.alliance : 'R', dt, false);
  if (S.shake > 0) { S.shake -= dt; const k = S.shake * 1.3; R.cam.position.x += (Math.random() - 0.5) * k; R.cam.position.y += (Math.random() - 0.5) * k; }
  R.showTrajectory(S.sim, me, S.mode === 'play' && S.showArc && !S.hideUI);
  if (S.mode === 'play') aimMapTick();
  const pips = S.mode === 'play' && S.showTag && !S.hideUI ? H.pipRects() : [];
  R.render(pips);
  if (S.mode === 'play') H.update(dt, pips);
  if (NET && NET.role) NET.tick(dt);
  IN.endFrame();
  R.dynTick(dt, Math.max(0, performance.now() - now));
}
function activeKeySets() {
  if (!S.set.kbDrive) return [];
  const sets = new Set();
  for (const h of S.humans) for (const c of h.ctl) for (const d of c.dev.split('+')) if (d === 'kbA' || d === 'kbB') sets.add(d);
  return Array.from(sets);
}
S.activeKeySets = activeKeySets;
// test hook: run one frame at a given timestamp (headless browsers throttle requestAnimationFrame)
S._frame = t => { const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; try { frame(t); } finally { window.requestAnimationFrame = raf; } };

// fonts first (robot signs and the HIVE logo are drawn on canvases)
const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1800))]) : Promise.resolve();
// then the official FIELD CAD (decoded once; the hand-built field stands in if it cannot be read)
const cadReady = () => (R && R.loadFieldCad ? Promise.race([R.loadFieldCad(), new Promise(r => setTimeout(() => r(false), 8000))]) : Promise.resolve(false));
fontsReady.then(cadReady).then(boot, boot);
})();
