/* BIOBUZZ Sim — menus: match / practice / two-player setup, robot creator, settings and remapping, controller test, notes. */
(function (root) {
'use strict';
const BB = root.BB, R = root.BBR, IN = root.BBIN, AU = root.BBAU;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UI = { current: 'home' };
function S() { return root.BBAPP; }
function H() { return root.BBHUD; }

// ------------------------------------------------------------------ small controls
function syncSeg(el, v) { el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
UI.syncSegPublic = syncSeg;
// every "AUTO" picker: the built-in routines, then the example and own plans from Chiến thuật AUTO
function autoOptions(cur, withManual) {
  const R0 = S().ROUTINES, list = S().autos.all();
  const base = Object.keys(R0).filter(k => withManual || k !== 'manual').map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(R0[k])}</option>`).join('');
  const plans = list.map(a => `<option value="plan:${esc(a.id)}"${'plan:' + a.id === cur ? ' selected' : ''}>${esc(a.plan.name)}</option>`).join('');
  return `<optgroup label="Chương trình có sẵn">${base}</optgroup><optgroup label="Chiến thuật AUTO">${plans}</optgroup>`;
}
UI.autoSelects = function () {
  const set = S().set;
  for (const [id, key, manual] of [['mAuto', 'auto', true], ['mPAuto', 'partnerAuto', false], ['dAuto', 'dAuto', true], ['dAuto2', 'dAuto2', true], ['olAuto', 'olAuto', true]]) {
    const el = $(id); if (!el) continue;
    let cur = set[key];
    if (typeof cur === 'string' && cur.startsWith('plan:') && !S().autos.exists(cur.slice(5))) { cur = 'full'; set[key] = cur; }
    el.innerHTML = autoOptions(cur, manual);
    if (el.value !== cur) el.value = 'full';
  }
};
function autoSelect(id, key, after) {
  const el = $(id); if (!el) return;
  el.addEventListener('change', () => { S().set[key] = el.value; S().save(); AU.sfxs.ui(); if (after) after(el.value); });
}
function seg(id, key, after) {
  const el = $(id);
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !el.contains(b)) return; S().set[key] = b.dataset.v; syncSeg(el, b.dataset.v); S().save(); AU.sfxs.ui(); if (after) after(b.dataset.v); });
  syncSeg(el, S().set[key]);
}
function range(id, key, outId, after) {
  const el = $(id); el.value = S().set[key]; if (outId) $(outId).textContent = el.value;
  el.addEventListener('input', () => { S().set[key] = +el.value; if (outId) $(outId).textContent = el.value; S().save(); if (after) after(+el.value); });
}

// ------------------------------------------------------------------ robot cards
function bars(st) {
  const b = (n, v) => `<span class="bar">${n}<b><i style="width:${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%"></i></b></span>`;
  return `<span class="bars">${b('Tốc độ', st.speed / 12)}${b('Lực đẩy', st.push / 200)}${b('Nhịp bắn', st.rate / 10)}${b('Tầm bắn', st.range / 150)}${b('Chính xác', st.acc)}</span>`;
}
const statCache = new Map();
function statsFor(r) {
  const key = JSON.stringify(r.spec);
  let st = statCache.get(key); if (!st) { st = S().robotStats(r.spec); statCache.set(key, st); }
  return st;
}
function robotSub(spec) {
  const s = BB.normalizeSpec(spec);
  const d = { mecanum: 'Mecanum', swerve: 'Swerve', tank: 'Tank' }[s.drive.type];
  const sh = s.shooters.map(q => q.type === 'turret' ? 'turret' : 'súng cố định').join(' + ');
  const arm = s.flower.arm === 'none' ? '' : ' · arm ' + (s.flower.arm === 'long' ? 'dài' : 'ngắn');
  return `${d} ${BB.MOTORS[s.drive.motor].rpm} rpm · ${sh}${arm} · ${s.mass.toFixed(1)} kg`;
}
function robotPicker(id, key, compact, after) {
  const el = $(id);
  const draw = () => {
    const list = S().lib.list(), cur = S().set[key];
    el.innerHTML = list.map(r => {
      const st = compact ? null : statsFor(r);
      return `<button type="button" class="rcard${r.id === cur ? ' on' : ''}" data-v="${esc(r.id)}"><span class="rcard-name">${esc(r.name)}<em>${r.preset ? 'MẪU' : 'CỦA BẠN'}</em></span><span class="rcard-sub">${esc(robotSub(r.spec))}</span>${compact ? '' : bars(st)}</button>`;
    }).join('');
  };
  el.addEventListener('click', e => { const b = e.target.closest('.rcard'); if (!b) return; S().set[key] = b.dataset.v; S().save(); el.querySelectorAll('.rcard').forEach(x => x.classList.toggle('on', x === b)); AU.sfxs.ui(); if (after) after(); });
  UI.pickers.push(draw);
  draw();
}
UI.pickers = [];
function robotSelect(id, key) {
  const el = $(id);
  const draw = () => {
    const list = S().lib.list(), cur = S().set[key];
    el.innerHTML = `<option value="auto">Tự chọn theo độ khó</option>` + list.map(r => `<option value="${esc(r.id)}"${r.id === cur ? ' selected' : ''}>${esc(r.name)}${r.preset ? '' : ' (của bạn)'}</option>`).join('');
    if (!list.some(r => r.id === cur)) el.value = 'auto';
  };
  el.addEventListener('change', () => { S().set[key] = el.value; S().save(); });
  UI.pickers.push(draw);
  draw();
}
function classCheckHTML(spec) {
  const c = BB.classCheck(spec), s = BB.normalizeSpec(spec);
  return `<span class="cc ${c.motors <= 8 ? 'ok' : 'bad'}">Motor ${c.motors}/8</span><span class="cc ${c.servos <= 8 ? 'ok' : 'bad'}">Servo ${c.servos}/8</span><span class="cc ${c.size ? 'ok' : 'bad'}">Khung ${s.body.L}×${s.body.W}×${s.body.H} in</span><span class="cc ${c.legal ? 'ok' : 'bad'}">${c.legal ? 'Hợp lệ R102/R503' : 'Không hợp lệ'}</span>`;
}

// ------------------------------------------------------------------ navigation between screens
UI.show = function (name) {
  if (UI.current === 'auto' && name !== 'auto' && root.BBAE) root.BBAE.close();
  UI.current = name;
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'scr-' + name; });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.screen === name));
  if (name === 'garage') UI.garageOpen();
  if (name === 'match') { $('mCheck').innerHTML = classCheckHTML(S().lib.get(S().set.robot)); UI.autoSelects(); UI.matchNote(); }
  if (name === 'howto') UI.howKeys();
  if (name === 'settings') UI.settingsTab(UI.sTab || 'ctl');
  if (name === 'duo') { UI.autoSelects(); UI.duoDevices(); UI.duoKeys(); }
  if (name === 'practice') $('pResetKey').textContent = IN.keyName(S().set.keys.global.reset);
  if (name === 'home') UI.homeLast();
  if (name === 'online') { UI.pickers.forEach(f => f()); UI.autoSelects(); $('olName').value = S().set.olName || ''; ['olMode', 'olBots'].forEach(k => syncSeg($(k), S().set[k])); root.BBNET.probe(); root.BBNET.renderLobby(); }
  if (name === 'auto' && root.BBAE) root.BBAE.open();
  $('menuMain').scrollTop = 0;
};
// the start spot only matters for the built-in routines: a team plan brings its own
UI.matchNote = function () {
  const plan = String(S().set.auto || '').startsWith('plan:');
  $('mStart').closest('.field').classList.toggle('dim', plan);
  $('mStart').title = plan ? 'Chương trình AUTO tự chỉnh có vị trí xuất phát riêng' : '';
};
// two players on one computer: keyboard halves only when keyboard driving is on
UI.duoDevices = function () {
  const set = S().set, scr = $('scr-duo');
  scr.classList.toggle('nokb', !set.kbDrive);
  if (!set.kbDrive) { if (set.dDev1 === 'kbA' || set.dDev1 === 'kbB') set.dDev1 = set.dDev2 === 'gp0' ? 'gp1' : 'gp0'; if (set.dDev2 === 'kbA' || set.dDev2 === 'kbB') set.dDev2 = set.dDev1 === 'gp0' ? 'gp1' : 'gp0'; }
  syncSeg($('dDev1'), set.dDev1); syncSeg($('dDev2'), set.dDev2);
  $('dAuto2Field').hidden = set.dMode === 'codrive';
};
UI.homeLast = function () {
  const st = S().set;
  $('homeLast').textContent = `Trận nhanh: ${S().lib.name(st.robot)} ở ${st.slot[0] === 'R' ? 'ĐỎ' : 'XANH'} ${+st.slot[1] + 1}, bot ${({ easy: 'dễ', normal: 'vừa', hard: 'khó' })[st.skill]}. Đổi trong “Tùy chỉnh trận”.`;
};
UI.init = function () {
  document.querySelectorAll('[data-screen]').forEach(b => b.addEventListener('click', () => { AU.unlock(); AU.sfxs.ui(); UI.show(b.dataset.screen); }));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => UI.show('home')));
  $('btnQuick').addEventListener('click', () => S().start('match'));
  // match
  robotPicker('mRobot', 'robot', false, () => { $('mCheck').innerHTML = classCheckHTML(S().lib.get(S().set.robot)); });
  seg('mSlot', 'slot'); seg('mStart', 'start'); seg('mSkill', 'skill'); seg('mHp', 'hp'); seg('mFouls', 'fouls');
  UI.autoSelects();
  autoSelect('mAuto', 'auto', UI.matchNote); autoSelect('mPAuto', 'partnerAuto');
  robotSelect('mPartner', 'partner'); robotSelect('mOpp1', 'opp1'); robotSelect('mOpp2', 'opp2');
  const team = $('mTeam'); team.value = S().set.team;
  team.addEventListener('input', () => { team.value = team.value.replace(/\D/g, '').slice(0, 5); S().set.team = team.value || '2026'; S().save(); });
  range('mTip', 'tip', 'mTipOut');
  $('btnMatch').addEventListener('click', () => S().start('match'));
  // practice
  robotPicker('pRobot', 'pRobot', false);
  seg('pSlot', 'pSlot'); seg('pTimer', 'pTimer'); seg('pFlowers', 'pFlowers'); seg('pDefender', 'pDefender'); seg('pHp', 'pHp');
  range('pTip', 'pTip', 'pTipOut');
  $('btnPractice').addEventListener('click', () => S().start('practice'));
  // duo
  const duoNote = v => { $('dModeNote').textContent = ({ versus: 'Người 1 lái ĐỎ, người 2 lái XANH. Mỗi bên có thể thêm một bot đồng đội.', coop: 'Cả hai cùng liên minh ĐỎ, đấu 2 bot XANH.', codrive: 'Như FTC thật: người 1 (driver) lái khung gầm, người 2 (operator) lo bắn, intake, turret, cánh tay và human player.' })[v]; UI.duoKeys(); };
  seg('dMode', 'dMode', v => { duoNote(v); UI.duoDevices(); }); duoNote(S().set.dMode);
  seg('dDev1', 'dDev1', UI.duoKeys); seg('dDev2', 'dDev2', UI.duoKeys); seg('dSkill', 'dSkill');
  autoSelect('dAuto', 'dAuto'); autoSelect('dAuto2', 'dAuto2');
  robotPicker('dRobot1', 'dRobot1', true); robotPicker('dRobot2', 'dRobot2', true);
  $('btnDuo').addEventListener('click', () => {
    const st = S().set;
    if (st.dDev1 === st.dDev2) { $('dModeNote').textContent = 'Hai người cần hai thiết bị khác nhau.'; return; }
    const pads = IN.listPads().length, need = [st.dDev1, st.dDev2].filter(d => d.startsWith('gp')).map(d => +d.slice(2) + 1);
    if (need.length && pads < Math.max(...need)) { $('dModeNote').textContent = `Cần ${Math.max(...need)} tay cầm (đang thấy ${pads}). Cắm vào rồi bấm một nút để trình duyệt nhận${S().set.kbDrive ? '' : ', hoặc bật lái bằng bàn phím trong Cài đặt → Điều khiển'}.`; return; }
    S().start('duo');
  });
  // online
  const NET = root.BBNET;
  autoSelect('olAuto', 'olAuto', () => NET.cfgChanged());
  robotPicker('olRobot', 'olRobot', true, () => NET.cfgChanged());
  seg('olMode', 'olMode', () => NET.cfgChanged()); seg('olBots', 'olBots', () => NET.cfgChanged());
  NET.bind();
  // pause / results
  $('btnResume').addEventListener('click', () => { if (S().mode === 'guest') { $('pause').hidden = true; NET.guestMenu(false); } else S().togglePause(); });
  $('btnRestart').addEventListener('click', () => S().rematch());
  $('btnReset').addEventListener('click', () => { S().togglePause(); S().resetField(); });
  $('btnMenu').addEventListener('click', () => S().toMenu());
  $('btnAgain').addEventListener('click', () => S().rematch());
  $('btnMenu2').addEventListener('click', () => S().toMenu());
  const RP = root.BBRP;
  $('btnReplay').addEventListener('click', () => { if (!RP.start('results')) H().toast('Chưa có gì để xem lại'); });
  $('btnReplayPause').addEventListener('click', () => { if (!RP.start('pause')) H().toast('Chưa ghi đủ để xem lại', 'f'); });
  RP.bind();
  $('optCam').addEventListener('click', e => { const b = e.target.closest('button'); if (b) S().setCam(b.dataset.v); });
  // garage, settings
  UI.garageInit();
  $('sTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) UI.settingsTab(b.dataset.tab); });
  $('sReset').addEventListener('click', UI.settingsReset);
  UI.notes();
  UI.padState();
  UI.show('home');
};
UI.syncCam = function () { syncSeg($('optCam'), S().cam); };
UI.padState = function () {
  const list = IN.listPads(), el = $('padState');
  if (IN.blocked) { el.textContent = 'Trình xem chặn tay cầm: mở trang trong tab riêng'; el.className = 'pad-state'; return; }
  el.textContent = list.length ? `${list.length} tay cầm sẵn sàng` : 'Chưa có tay cầm (bấm 1 nút để nhận)';
  el.className = 'pad-state' + (list.length ? ' on' : '');
};
UI.onKey = function (e) {
  if (UI.current === 'auto' && root.BBAE && root.BBAE.onKey(e)) return;
  if (e.code === 'Escape' && UI.current !== 'home') { e.preventDefault(); UI.show('home'); return; }
  const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  if (e.code === 'Enter' && !typing && (!t || t.tagName !== 'BUTTON')) {
    const map = { home: 'match', match: 'match', practice: 'practice', duo: 'duo' };
    if (map[UI.current]) { e.preventDefault(); if (UI.current === 'duo') $('btnDuo').click(); else S().start(map[UI.current]); }
  }
};
// menus by gamepad: spatial focus moves, A clicks, B backs out, LB/RB change settings tabs
UI.frame = function (dt) {
  const nav = IN.menu();
  const screen = UI.current === 'home' ? $('menu') : $('menu');
  UI.navigate(nav, screen);
  if (nav.back) UI.show('home');
  if (nav.start && UI.current === 'home') S().start('match');
  if (UI.current === 'settings' && (nav.tabL || nav.tabR)) { const tabs = ['ctl', 'keys', 'view', 'sound'], i = tabs.indexOf(UI.sTab); UI.settingsTab(tabs[(i + (nav.tabR ? 1 : 3)) % 4]); }
  if (UI.current === 'pads') UI.padsFrame();
  if (UI.current === 'garage') R.renderPreview(dt);
  if (UI.current === 'auto' && root.BBAE) root.BBAE.frame(dt);
};
function focusables(root0) {
  return Array.from(root0.querySelectorAll('button, input, select, [tabindex="0"]')).filter(el => !el.disabled && el.offsetParent !== null && !el.closest('[hidden]'));
}
UI.navigate = function (nav, container) {
  if (!(nav.up || nav.down || nav.left || nav.right || nav.ok)) return;
  const act = document.activeElement;
  const els = focusables(container);
  if (!els.length) return;
  if (!act || !container.contains(act) || act === document.body) { els[0].focus(); return; }
  if (nav.ok) { if (act.tagName === 'BUTTON') act.click(); return; }
  if ((nav.left || nav.right) && act.tagName === 'INPUT' && act.type === 'range') {
    const st = +act.step || 1; act.value = +act.value + (nav.right ? st : -st); act.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if ((nav.left || nav.right) && act.tagName === 'SELECT') {
    act.selectedIndex = Math.max(0, Math.min(act.options.length - 1, act.selectedIndex + (nav.right ? 1 : -1))); act.dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  const r0 = act.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  const dx = nav.right ? 1 : nav.left ? -1 : 0, dy = nav.down ? 1 : nav.up ? -1 : 0;
  let best = null, bs = 1e9;
  for (const el of els) {
    if (el === act) continue;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const vx = x - cx, vy = y - cy, along = vx * dx + vy * dy; if (along <= 2) continue;
    const across = Math.abs(vx * dy - vy * dx);
    const sc = along + across * 2.2; if (sc < bs) { bs = sc; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); AU.sfxs.ui(); }
};

// ------------------------------------------------------------------ two players: who presses what
UI.duoKeys = function () {
  const st = S().set, m = st.dMode;
  const col = (title, dev, role) => {
    const acts = IN.ACTIONS.filter(a => a.kind !== 'axis' && (role === 'both' || a.role === role));
    const drive = role !== 'op' ? (dev.startsWith('gp') ? '<dt>Cần trái / phải</dt><dd>Lái / xoay</dd>' : `<dt><kbd>${IN.keyName(st.keys[dev].driveF)}${IN.keyName(st.keys[dev].driveL)}${IN.keyName(st.keys[dev].driveB)}${IN.keyName(st.keys[dev].driveR)}</kbd> <kbd>${IN.keyName(st.keys[dev].turnL)}</kbd><kbd>${IN.keyName(st.keys[dev].turnR)}</kbd></dt><dd>Lái / xoay</dd>`) : '';
    return `<div class="kcol"><h3>${title}</h3><dl>${drive}${acts.map(a => `<dt><kbd>${esc(IN.labelFor(dev, a.id) || '—')}</kbd></dt><dd>${a.label}</dd>`).join('')}</dl></div>`;
  };
  const r1 = m === 'codrive' ? 'drive' : 'both', r2 = m === 'codrive' ? 'op' : 'both';
  $('dKeys').innerHTML = col('Người 1' + (m === 'codrive' ? ' · driver' : ''), st.dDev1, r1) + col('Người 2' + (m === 'codrive' ? ' · operator' : ''), st.dDev2, r2);
};

// ------------------------------------------------------------------ robot creator
const G_SETS = [
  { set: 'Chung', rows: [
    { k: 'name', label: 'Tên', type: 'text' },
    { k: 'color', label: 'Màu thân', type: 'seg', opts: [['graphite', 'Than'], ['amber', 'Hổ phách'], ['sky', 'Trời'], ['mint', 'Bạc hà'], ['violet', 'Tím'], ['sand', 'Cát']] },
    { k: 'body.L', label: 'Dài (in)', type: 'range', min: 12, max: 18, step: 0.5 },
    { k: 'body.W', label: 'Rộng (in)', type: 'range', min: 12, max: 18, step: 0.5 },
    { k: 'body.H', label: 'Cao (in)', type: 'range', min: 8, max: 18, step: 0.5 },
    { k: 'mass', label: 'Khối lượng (kg)', type: 'range', min: 6, max: 25, step: 0.1 },
  ] },
  { set: 'Hệ dẫn động', rows: [
    { k: 'drive.type', label: 'Kiểu', type: 'seg', opts: [['mecanum', 'Mecanum'], ['swerve', 'Swerve'], ['tank', 'Tank']] },
    { k: 'drive.motor', label: 'Motor goBILDA 5203', type: 'select', opts: [['yj1620', '1620 rpm · 0,53 N·m'], ['yj1150', '1150 rpm · 0,77 N·m'], ['yj435', '435 rpm · 1,83 N·m'], ['yj312', '312 rpm · 2,38 N·m'], ['yj223', '223 rpm · 3,73 N·m'], ['yj117', '117 rpm · 6,71 N·m']] },
    { k: 'drive.wheel', label: 'Bánh (mm)', type: 'seg', opts: [['72', '72'], ['96', '96'], ['104', '104']], num: true },
  ] },
  { set: 'Intake', rows: [
    { k: 'intake.sides', label: 'Mặt hút', type: 'seg', opts: [['front', 'Trước'], ['both', 'Trước + sau']] },
    { k: 'intake.width', label: 'Bề rộng (in)', type: 'range', min: 8, max: 16, step: 0.5 },
    { k: 'intake.reach', label: 'Vươn ra ngoài (in)', type: 'range', min: 0, max: 3, step: 0.25 },
    { k: 'intake.picks', label: 'Nhặt được', type: 'seg', opts: [['both', 'Cả hai'], ['pollen', 'POLLEN'], ['nectar', 'NECTAR']] },
  ] },
  { set: 'Súng', shooters: true },
  { set: 'Camera & định vị', rows: [
    { k: 'camera.mount', label: 'Gắn camera', type: 'seg', opts: [['turret0', 'Trên turret 1'], ['front', 'Mặt trước'], ['back', 'Mặt sau']] },
    { k: 'camera.h', label: 'Độ cao (in)', type: 'range', min: 6, max: 28, step: 0.5 },
    { k: 'camera.pitch', label: 'Góc ngẩng (°)', type: 'range', min: 10, max: 45, step: 1 },
    { k: 'odo', label: 'Định vị', type: 'seg', opts: [['fusion', 'Odometry + tag'], ['odometry', 'Chỉ odometry'], ['tag', 'Chỉ tag']] },
    { k: 'lead', label: 'Bù vận tốc khi bắn', type: 'seg', opts: [['false', 'Tắt'], ['true', 'Bật']], bool: true },
  ] },
  { set: 'FLOWER', rows: [
    { k: 'flower.arm', label: 'Cánh tay', type: 'seg', opts: [['none', 'Không'], ['short', 'Ngắn · 0,85 s'], ['long', 'Dài · 0,42 s']] },
    { k: 'flower.flap', label: 'Flap rút POLLEN ở đáy', type: 'seg', opts: [['false', 'Không'], ['true', 'Có']], bool: true },
  ] },
  { set: 'Độ đều cơ khí', rows: [
    { k: 'scatter', label: 'Độ tản khi bắn (×)', type: 'range', min: 0.5, max: 3, step: 0.1, hint: '1,0 = robot làm kỹ (lệch hướng 0,8°, lệch góc 0,7°, lệch tốc 1,1%). 2,0 = bánh mòn, hood rơ.' },
  ] },
];
const SH_ROWS = [
  { k: 'type', label: 'Kiểu', type: 'seg', opts: [['turret', 'Turret'], ['fixed', 'Cố định']] },
  { k: 'balls', label: 'Bắn loại', type: 'seg', opts: [['both', 'Cả hai'], ['pollen', 'POLLEN'], ['nectar', 'NECTAR']] },
  { k: 'faces', label: 'Hướng mặc định', type: 'seg', opts: [['0', 'Trước'], ['90', 'Trái'], ['180', 'Sau'], ['270', 'Phải']], num: true },
  { k: 'range', label: 'Hành trình turret (°)', type: 'range', min: 90, max: 360, step: 10, when: sh => sh.type === 'turret' },
  { k: 'x', label: 'Vị trí dọc (in)', type: 'range', min: -7, max: 7, step: 0.5 },
  { k: 'y', label: 'Vị trí ngang (in)', type: 'range', min: -7, max: 7, step: 0.5 },
  { k: 'z', label: 'Độ cao nòng (in)', type: 'range', min: 8, max: 28, step: 0.5 },
  { k: 'hood', label: 'Hood', type: 'seg', opts: [['fixed', 'Cố định'], ['flap', 'Lật 2 nấc'], ['adjustable', 'Chỉnh servo']] },
  { k: 'hoodDeg', label: 'Góc hood (°)', type: 'range', min: 45, max: 80, step: 1, when: sh => sh.hood !== 'adjustable' },
  { k: 'wheel', label: 'Bánh flywheel (mm)', type: 'seg', opts: [['96', '96'], ['72', '72']], num: true },
  { k: 'dual', label: 'Hai bánh (ít xoáy)', type: 'seg', opts: [['false', 'Một'], ['true', 'Hai']], bool: true },
  { k: 'motors', label: 'Motor 6000 rpm', type: 'seg', opts: [['1', '1'], ['2', '2']], num: true },
  { k: 'inertia', label: 'Quán tính flywheel', type: 'seg', opts: [['light', 'Nhẹ'], ['medium', 'Vừa'], ['heavy', 'Nặng']] },
  { k: 'ctrl', label: 'Bộ điều khiển', type: 'seg', opts: [['sdk', 'SDK setVelocity'], ['pidf', 'PIDF + FF'], ['bang', 'Bang-bang']] },
  { k: 'band', label: 'Ngưỡng “đủ tốc” (±%)', type: 'range', min: 0.01, max: 0.1, step: 0.005, pct: true },
  { k: 'feed', label: 'Tốc độ nạp (×)', type: 'range', min: 0.5, max: 4, step: 0.1 },
];
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] = a[ks[i]] || {}; a[ks[ks.length - 1]] = v; }
function rowHTML(r, v, prefix) {
  const id = prefix + r.k.replace(/\./g, '_');
  if (r.type === 'text') return `<div class="grow span2"><label for="${id}">${r.label}</label><input id="${id}" class="input" data-k="${r.k}" maxlength="24" value="${esc(v)}"></div>`;
  if (r.type === 'select') return `<div class="grow span2"><label for="${id}">${r.label}</label><select id="${id}" class="select" data-k="${r.k}">${r.opts.map(([a, b]) => `<option value="${a}"${String(v) === a ? ' selected' : ''}>${b}</option>`).join('')}</select></div>`;
  if (r.type === 'seg') return `<div class="grow span2"><span class="gl">${r.label}</span><div class="seg seg-sm" data-k="${r.k}" data-num="${r.num ? 1 : ''}" data-bool="${r.bool ? 1 : ''}">${r.opts.map(([a, b]) => `<button type="button" data-v="${a}" class="${String(v) === a ? 'on' : ''}">${b}</button>`).join('')}</div></div>`;
  const shown = r.pct ? '±' + (v * 100).toFixed(1) + '%' : (+v).toFixed(r.step < 1 ? (r.step < 0.1 ? 2 : 1) : 0);
  return `<div class="grow"><label for="${id}">${r.label}</label><input id="${id}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" data-k="${r.k}" data-pct="${r.pct ? 1 : ''}"><output>${shown}</output></div>${r.hint ? `<p class="ghint">${r.hint}</p>` : ''}`;
}
UI.garageInit = function () {
  UI.g = { id: S().set.gSel || S().set.robot || 'turret', spec: null, t: 0 };
  $('gList').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; UI.gSelect(b.dataset.v); });
  const form = $('gForm');
  form.addEventListener('input', e => { const el = e.target; if (!el.dataset.k) return; let v = el.type === 'range' ? +el.value : el.value; if (el.type === 'range' && el.nextElementSibling) el.nextElementSibling.textContent = el.dataset.pct ? '±' + (v * 100).toFixed(1) + '%' : String(+(+v).toFixed(2)); UI.gEdit(el.dataset.k, v, el.dataset.sh); });
  form.addEventListener('change', e => { const el = e.target; if (el.tagName === 'SELECT' && el.dataset.k) UI.gEdit(el.dataset.k, el.value, el.dataset.sh); });
  form.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'addsh') { UI.gMutate(s => { if (s.shooters.length < 3) s.shooters.push(JSON.parse(JSON.stringify(s.shooters[s.shooters.length - 1]))); }, true); return; }
    if (b.dataset.act === 'delsh') { UI.gMutate(s => { if (s.shooters.length > 1) s.shooters.splice(+b.dataset.sh, 1); }, true); return; }
    const sg = b.closest('.seg'); if (!sg || !sg.dataset.k) return;
    let v = b.dataset.v; if (sg.dataset.num) v = +v; if (sg.dataset.bool) v = v === 'true';
    sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    UI.gEdit(sg.dataset.k, v, sg.dataset.sh, true);
  });
  $('gNew').addEventListener('click', () => { const s = BB.presetSpec('starter'); s.name = 'ROBOT MỚI'; const id = S().lib.add(s); UI.gSelect(id); UI.gNote('Đã tạo robot mới từ mẫu KHỞI ĐẦU.'); });
  $('gDup').addEventListener('click', () => { const s = JSON.parse(JSON.stringify(UI.g.spec)); s.name = (s.name + ' 2').slice(0, 24); const id = S().lib.add(s); UI.gSelect(id); UI.gNote('Đã nhân bản.'); });
  $('gCopy').addEventListener('click', () => {
    const code = S().encodeSpec(UI.g.spec), inp = $('gCode'); inp.value = code;
    const done = () => UI.gNote('Đã chép mã. Gửi cho bạn bè để họ dán vào ô “Dán mã chia sẻ”.');
    try { navigator.clipboard.writeText(code).then(done, () => { inp.focus(); inp.select(); UI.gNote('Trình duyệt không cho chép tự động: mã đã được bôi đen, bấm Ctrl+C.'); }); }
    catch (e) { inp.focus(); inp.select(); UI.gNote('Mã đã được bôi đen, bấm Ctrl+C.'); }
  });
  $('gImport').addEventListener('click', () => {
    try { const s = S().decodeSpec($('gCode').value); const id = S().lib.add(s); UI.gSelect(id); UI.gNote(`Đã nhập “${s.name}”.`); }
    catch (e) { UI.gNote('Không đọc được mã: ' + e.message); }
  });
  $('gTry').addEventListener('click', () => { S().set.pRobot = UI.g.id; S().save(); UI.refreshPickers(); S().start('practice'); });
  $('gDel').addEventListener('click', () => { if (BB.PRESETS[UI.g.id]) return; $('gConfirmText').textContent = `Xóa “${UI.g.spec.name}”? Không khôi phục được.`; $('gConfirm').hidden = false; $('gConfirmNo').focus(); });
  $('gConfirmNo').addEventListener('click', () => { $('gConfirm').hidden = true; });
  $('gConfirmYes').addEventListener('click', () => {
    const id = UI.g.id; S().lib.remove(id); $('gConfirm').hidden = true;
    for (const k of ['robot', 'pRobot', 'dRobot1', 'dRobot2', 'partner', 'opp1', 'opp2']) if (S().set[k] === id) S().set[k] = k === 'partner' || k.startsWith('opp') ? 'auto' : 'turret';
    S().save(); UI.gSelect('turret'); UI.gNote('Đã xóa.');
  });
};
UI.gNote = function (t) { $('gCodeOut').textContent = t; };
UI.garageOpen = function () {
  R.initPreview($('pvCanvas'));
  if (!S().lib.exists(UI.g.id)) UI.g.id = 'turret';
  UI.gSelect(UI.g.id);
};
UI.gSelect = function (id) {
  UI.g.id = id; UI.g.spec = S().lib.get(id); S().set.gSel = id; S().save();
  const list = S().lib.list();
  $('gList').innerHTML = list.map(r => `<button type="button" data-v="${esc(r.id)}" class="${r.id === id ? 'on' : ''}${r.preset ? '' : ' custom'}">${esc(r.name)}</button>`).join('');
  $('gDel').disabled = !!BB.PRESETS[id];
  UI.gForm(); UI.gRefresh(true);
  UI.refreshPickers();
};
UI.gForm = function () {
  const s = UI.g.spec, preset = !!BB.PRESETS[UI.g.id];
  let html = preset ? `<p class="note">Đây là robot mẫu. Chỉnh bất kỳ thông số nào sẽ tạo bản sao của bạn.${BB.PRESETS[UI.g.id].desc ? ' ' + esc(BB.PRESETS[UI.g.id].desc) : ''}</p>` : '';
  for (const g of G_SETS) {
    if (g.shooters) {
      html += `<fieldset class="gset"><legend>Súng (${s.shooters.length}/3)</legend>`;
      s.shooters.forEach((sh, i) => {
        html += `<div class="gsub"><span>Súng ${i + 1}</span>${s.shooters.length > 1 ? `<button type="button" class="ghost sm danger" data-act="delsh" data-sh="${i}">Bỏ súng này</button>` : ''}</div>`;
        for (const r of SH_ROWS) { if (r.when && !r.when(sh)) continue; html += rowHTML(r, sh[r.k], 'g' + i + '_').replace(/data-k="/g, `data-sh="${i}" data-k="`); }
      });
      if (s.shooters.length < 3) html += `<button type="button" class="ghost sm" data-act="addsh">Thêm súng</button>`;
      html += `</fieldset>`;
      continue;
    }
    html += `<fieldset class="gset"><legend>${g.set}</legend>${g.rows.map(r => rowHTML(r, getPath(s, r.k), 'g_')).join('')}</fieldset>`;
  }
  $('gForm').innerHTML = html;
};
UI.gMutate = function (fn, rebuildForm) {
  if (BB.PRESETS[UI.g.id]) {
    const s = JSON.parse(JSON.stringify(UI.g.spec)); s.name = (s.name + ' (của bạn)').slice(0, 24);
    const id = S().lib.add(s); UI.g.id = id; UI.g.spec = S().lib.get(id);
    UI.gNote('Đã tạo bản sao để chỉnh.');
    rebuildForm = true;
    fn(UI.g.spec); UI.g.spec = BB.normalizeSpec(UI.g.spec); S().lib.put(UI.g.id, UI.g.spec);
    UI.gSelect(id);
    return;
  }
  fn(UI.g.spec);
  UI.g.spec = BB.normalizeSpec(UI.g.spec);
  S().lib.put(UI.g.id, UI.g.spec);
  if (rebuildForm) UI.gForm();
  UI.gRefresh(false);
};
UI.gEdit = function (k, v, sh, structural) {
  UI.gMutate(s => { if (sh !== undefined && sh !== '') s.shooters[+sh][k] = v; else setPath(s, k, v); }, structural && (k === 'type' || k === 'hood'));
  if (k === 'name') { const b = $('gList').querySelector('button.on'); if (b) b.textContent = v; }
};
UI.gRefresh = function (now) {
  const s = UI.g.spec;
  $('gCheck').innerHTML = classCheckHTML(s);
  const st = S().robotStats(s);
  const cell = (k, v) => `<div class="st"><span class="k">${k}</span><b>${v}</b></div>`;
  $('gStats').innerHTML = cell('Tốc độ', st.speed.toFixed(1) + ' ft/s') + cell('Lực đẩy', st.push.toFixed(0) + ' N') + cell('Nhịp bắn', st.rate.toFixed(1) + '/s') +
    cell('Tầm xa', st.range ? (st.range >= 200 ? '200+ in' : st.range + ' in') : '—') + cell('Motor/servo', `${st.cls.motors}/${st.cls.servos}`) + cell('Chính xác', '×' + (1 / st.acc).toFixed(1));
  clearTimeout(UI.g.t);
  UI.g.t = setTimeout(() => R.previewSpec(s, 'R', S().set.team), now ? 0 : 120);
};
UI.refreshPickers = function () { statCache.clear(); UI.pickers.forEach(f => f()); };

// ------------------------------------------------------------------ settings
const SET_ROWS = {
  ctl: [
    { k: 'kbDrive', b: 'Lái robot bằng bàn phím', s: 'Mặc định chỉ tay cầm lái robot; bàn phím vẫn dùng cho phím tắt (góc nhìn, tạm dừng…). Bật lên nếu không có tay cầm. Nhớ tắt bộ gõ tiếng Việt (Unikey, EVKey) khi lái bằng phím, nếu không W A S D bị nuốt.', opts: [[false, 'Tắt (chỉ tay cầm)'], [true, 'Bật']] },
    { k: 'kbTurn', b: 'Tốc độ xoay bằng phím', s: 'Phím chỉ có bật/tắt nên xoay toàn lực rất khó ngắm; mặc định 60% công suất xoay.', range: [0.3, 1, 0.05], when: s => s.kbDrive },
    { k: 'kbRamp', b: 'Tăng tốc mượt khi lái bằng phím', s: 'Nhấn phím là cần “đẩy” dần lên trong 0,16 s thay vì giật ngay 100%; nhả là dừng nhanh.', opts: [[true, 'Bật'], [false, 'Tắt']], when: s => s.kbDrive },
    { k: 'intakeMode', b: 'Intake', s: 'Luôn chạy (tự dừng khi đủ 4 bóng), giữ nút để chạy, hoặc bấm để bật/tắt.', opts: [['always', 'Luôn chạy'], ['hold', 'Giữ'], ['toggle', 'Bật/tắt']] },
    { k: 'driveMode', b: 'Kiểu lái mặc định', s: 'Theo sân: đẩy cần lên là robot chạy ra xa bạn. Theo robot: lên là tiến theo đầu robot.', opts: [['field', 'Theo sân'], ['robot', 'Theo robot']] },
    { k: 'aimAssist', b: 'Tự căn tag (súng cố định)', s: 'Giữ nút bắn là khung gầm tự xoay theo AprilTag, như auto-align của FRC. Xoay cần phải để giành lại quyền.', opts: [['on', 'Bật'], ['off', 'Tắt']] },
    { k: 'turretResp', b: 'Tốc độ turret', s: 'Nhanh gấp 4 lần: như servo tốc độ cao, dễ vượt lố hơn.', opts: [['normal', 'Chuẩn'], ['fast', 'Nhanh']] },
    { k: 'autoFire', b: 'Tự bắn khi khóa (mặc định)', s: 'Có thể bật/tắt trong trận bằng nút Tự bắn.', opts: [[false, 'Tắt'], [true, 'Bật']] },
    { k: 'stick', b: 'Độ nhạy cần', s: 'Bình phương hoặc lập phương cho điều khiển tinh ở tốc độ thấp.', opts: [['linear', 'Tuyến tính'], ['squared', 'Bình phương'], ['cubic', 'Lập phương']] },
    { k: 'deadzone', b: 'Vùng chết cần', s: 'Tăng lên nếu robot tự trôi khi không chạm cần.', range: [0, 0.3, 0.01] },
    { k: 'rumble', b: 'Rung tay cầm', s: 'Khi bắn, va chạm, HIVE TIP (Chrome, Edge).', opts: [[true, 'Bật'], [false, 'Tắt']] },
  ],
  view: [
    { k: 'cam', b: 'Góc nhìn mặc định', s: 'Đổi trong trận bằng C hoặc 1–5.', opts: [['driver', 'Khu lái'], ['follow', 'Theo robot'], ['broadcast', 'Khán đài'], ['top', 'Từ trên'], ['pov', 'Camera robot']] },
    { k: 'camAdjRow', b: 'Chỉnh góc camera', s: 'Trong trận kéo chuột trái để xoay, Shift + kéo (hoặc chuột phải) để dời, lăn chuột để thu phóng, nhấp đúp để đặt lại; hoặc Tạm dừng → “Chỉnh góc camera này” (dùng được cả phím và tay cầm). Mỗi góc nhìn nhớ riêng.', button: ['camResetAll', 'Đặt lại mọi góc'] },
    { k: 'fov', b: 'Góc nhìn rộng (FOV)', s: 'Độ mở ống kính cho mọi góc nhìn trừ camera robot. Mặc định 50°.', range: [36, 80, 1], unit: '°' },
    { k: 'quality', b: 'Đồ họa', s: 'Đẹp nhất: khử răng cưa MSAA 4×, đèn và LED phát sáng (bloom), bóng đổ mềm 4096, đèn flash trên khán đài; cần card đồ họa rời. Cân bằng: bóng đổ, không hậu kỳ. Nhanh nhất: tắt bóng đổ, độ phân giải 1× để giảm trễ.', opts: [['ultra', 'Đẹp nhất'], ['high', 'Cân bằng'], ['low', 'Nhanh nhất']] },
    { k: 'autoRes', b: 'Tự giảm độ phân giải khi giật', s: 'Khi card đồ họa không kịp 55 khung/giây, trang tự vẽ ít điểm ảnh hơn (tới 55%) để hình mượt, rồi tăng lại khi dư sức. Xem mức hiện tại ở đồng hồ FPS.', opts: [[true, 'Bật'], [false, 'Tắt']] },
    { k: 'fx', b: 'Hiệu ứng', s: 'Tia lửa khi bóng vào CELL, bùng nổ khi HIVE TIP, vệt bóng bay, pháo giấy cuối trận.', opts: [['on', 'Bật'], ['off', 'Tắt']] },
    { k: 'arc', b: 'Quỹ đạo dự đoán', s: 'Đường nét đứt: bóng sẽ bay thế nào nếu bắn ngay lúc này.', opts: [[true, 'Hiện'], [false, 'Ẩn']] },
    { k: 'aimMap', b: 'Bản đồ ngắm lúc vào trận', s: 'Tô màu sàn theo xác suất vào CELL đang ngửa.', opts: [[false, 'Tắt'], [true, 'Bật']] },
    { k: 'labels', b: 'Số đội trên robot', s: '', opts: [[true, 'Hiện'], [false, 'Ẩn']] },
    { k: 'legend', b: 'Dải phím tắt', s: '', opts: [[true, 'Hiện'], [false, 'Ẩn']] },
    { k: 'tips', b: 'Gợi ý trận đầu', s: 'Hộp hướng dẫn trong 3 trận đầu tiên.', opts: [[true, 'Hiện'], [false, 'Ẩn']] },
    { k: 'fps', b: 'Đồng hồ FPS', s: 'Khung hình/giây và thời gian khung tệ nhất.', opts: [[false, 'Ẩn'], [true, 'Hiện']] },
  ],
  sound: [
    { k: 'vol', b: 'Âm lượng tổng', s: '', range: [0, 1, 0.05] },
    { k: 'sfx', b: 'Tiếng robot và bóng', s: '', range: [0, 1, 0.05] },
    { k: 'voice', b: 'Lời hô của sân', s: '“Drivers, pick up your controllers” trước TELEOP (giọng tiếng Anh của trình duyệt).', opts: [[true, 'Bật'], [false, 'Tắt']] },
  ],
};
UI.settingsTab = function (tab) {
  UI.sTab = tab;
  $('sTabs').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
  const body = $('sBody'), set = S().set;
  if (tab === 'keys') { UI.remapTable(); return; }
  const shown = v => (Math.abs(v) < 10 && v % 1 ? (+v).toFixed(2) : String(v));
  body.innerHTML = SET_ROWS[tab].filter(r => !r.when || r.when(set)).map(r => {
    const ctl = r.button ? `<button type="button" class="ghost sm" data-act="${r.button[0]}">${r.button[1]}</button>`
      : r.range ? `<div class="srange"><input type="range" id="s_${r.k}" data-k="${r.k}" min="${r.range[0]}" max="${r.range[1]}" step="${r.range[2]}" value="${set[r.k]}"><output class="mono">${shown(set[r.k])}${r.unit || ''}</output></div>`
        : `<div class="seg seg-sm" data-k="${r.k}">${r.opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(set[r.k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="srow"><div class="sl"><b>${r.b}</b>${r.s ? `<span>${r.s}</span>` : ''}</div>${ctl}</div>`;
  }).join('');
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'camResetAll') { R.camReset(null); S().set.camAdj = {}; S().save(); b.textContent = 'Đã đặt lại'; AU.sfxs.ui(); return; }
    const sg = b.closest('.seg'); if (!sg) return;
    const row = SET_ROWS[tab].find(r => r.k === sg.dataset.k); const opt = row.opts.find(o => String(o[0]) === b.dataset.v);
    set[row.k] = opt[0]; syncSeg(sg, b.dataset.v); UI.applySetting(row.k); S().save(); AU.sfxs.ui();
    if (SET_ROWS[tab].some(r => r.when)) UI.settingsTab(tab);            // rows that depend on this one
  };
  body.oninput = e => {
    const el = e.target; if (!el.dataset.k) return;
    set[el.dataset.k] = +el.value; const row = SET_ROWS[tab].find(r => r.k === el.dataset.k);
    const out = el.parentElement.querySelector('output'); if (out) out.textContent = shown(+el.value) + (row && row.unit || '');
    UI.applySetting(el.dataset.k); S().save();
  };
};
UI.applySetting = function (k) {
  const set = S().set;
  if (k === 'quality') R.setQuality(set.quality);
  if ((k === 'quality' || k === 'fx') && root.BBFX) root.BBFX.setOptions(set);
  if (k === 'vol' || k === 'sfx' || k === 'voice') { AU.unlock(); AU.setLevels(set.vol, set.sfx, set.voice); if (k !== 'voice') AU.sfxs.shot(0.6); }
  if (k === 'autoRes') { R.dyn.on = set.autoRes !== false; R.dyn.scale = 1; if (R.size) R.resize(R.size.w, R.size.h); }
  if (k === 'fov') R.view.fov = set.fov;
  if (k === 'kbDrive') { IN.keys.clear(); if (S().padNotice) S().padNotice(); UI.duoDevices(); }
};
UI.settingsReset = function () {
  const set = S().set, d = S().defaults;
  for (const k of ['intakeMode', 'driveMode', 'aimAssist', 'turretResp', 'stick', 'deadzone', 'rumble', 'autoFire', 'cam', 'quality', 'fx', 'fps', 'arc', 'aimMap', 'legend', 'tips', 'labels', 'vol', 'sfx', 'voice', 'kbDrive', 'kbTurn', 'kbRamp', 'autoRes', 'fov']) set[k] = d[k];
  set.keys = JSON.parse(JSON.stringify(IN.DEFAULT_KEYS)); set.pad = JSON.parse(JSON.stringify(IN.DEFAULT_PAD));
  set.camAdj = {}; R.camReset(null); R.view.fov = set.fov; R.dyn.on = set.autoRes !== false;
  S().save(); R.setQuality(set.quality); if (root.BBFX) root.BBFX.setOptions(set); AU.setLevels(set.vol, set.sfx, set.voice);
  UI.duoDevices();
  UI.settingsTab(UI.sTab);
};
UI.remapTable = function () {
  const set = S().set, body = $('sBody');
  const padName = n => n ? (IN.BTN_NAME[IN.BTN[n]] || n) : '—';
  const rows = IN.ACTIONS.map(a => `<tr><td>${a.label}</td><td><button type="button" class="kbtn" data-set="kbA" data-a="${a.id}">${esc(IN.keyName(set.keys.kbA[a.id]))}</button></td><td><button type="button" class="kbtn" data-set="kbB" data-a="${a.id}">${esc(IN.keyName(set.keys.kbB[a.id]))}</button></td><td>${a.kind === 'axis' ? '<span class="note">cần</span>' : `<button type="button" class="kbtn" data-set="pad" data-a="${a.id}">${esc(padName(set.pad[a.id]))}</button>`}</td></tr>`).join('');
  const gl = IN.GLOBALS.map(a => `<tr><td>${a.label}</td><td colspan="2"><button type="button" class="kbtn" data-set="global" data-a="${a.id}">${esc(IN.keyName(set.keys.global[a.id]))}</button></td><td>${['pause', 'camera', 'aimMap', 'arc', 'details'].includes(a.id) ? `<button type="button" class="kbtn" data-set="pad" data-a="${a.id}">${esc(padName(set.pad[a.id]))}</button>` : ''}</td></tr>`).join('');
  body.innerHTML = `<p class="note">Bấm vào ô rồi nhấn phím hoặc nút tay cầm mới. Phím đã dùng ở chỗ khác sẽ được đổi chỗ. Esc để hủy.</p>
    <div class="tbl-wrap"><table class="remap"><thead><tr><th>Việc</th><th>Người 1 · phím trái</th><th>Người 2 · phím phải</th><th>Tay cầm</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="tbl-wrap"><table class="remap"><thead><tr><th>Chung</th><th colspan="2">Phím</th><th>Tay cầm</th></tr></thead><tbody>${gl}</tbody></table></div>`;
  body.oninput = null;
  body.onclick = e => {
    const b = e.target.closest('.kbtn'); if (!b) return;
    document.querySelectorAll('.kbtn.wait').forEach(x => x.classList.remove('wait'));
    b.classList.add('wait'); b.textContent = 'nhấn…';
    const which = b.dataset.set, act = b.dataset.a;
    IN.capture = res => {
      if (res.key === 'Escape') { UI.remapTable(); return; }
      if (which === 'pad') {
        if (res.button === undefined) { UI.remapTable(); return; }
        const name = Object.keys(IN.BTN).find(n => IN.BTN[n] === res.button); if (!name) { UI.remapTable(); return; }
        const prev = set.pad[act];
        for (const a in set.pad) if (set.pad[a] === name && a !== act) set.pad[a] = prev || '';
        set.pad[act] = name;
      } else {
        if (res.key === undefined) { UI.remapTable(); return; }
        const tbl = set.keys[which], prev = tbl[act];
        // swap with any action already on this key (same player, or the global keys)
        for (const s2 of ['kbA', 'kbB', 'global']) for (const a in set.keys[s2]) if (set.keys[s2][a] === res.key && !(s2 === which && a === act)) { if (s2 === which || s2 === 'global' || which === 'global') set.keys[s2][a] = prev; }
        tbl[act] = res.key;
      }
      S().save(); UI.remapTable();
    };
  };
};

// ------------------------------------------------------------------ how to play: default controls from the live bindings
UI.howKeys = function () {
  const set = S().set, k = (dev, a) => `<kbd>${esc(IN.labelFor(dev, a) || '—')}</kbd>`, g = a => `<kbd>${esc(IN.keyName(set.keys.global[a]))}</kbd>`;
  const kb = set.keys.kbA;
  const list = dev => IN.ACTIONS.filter(a => a.kind !== 'axis').map(a => `<dt>${k(dev, a.id)}</dt><dd>${a.label}</dd>`).join('');
  const kbCol = set.kbDrive ? `<div><h4>Bàn phím</h4><dl><dt><kbd>${IN.keyName(kb.driveF)}${IN.keyName(kb.driveL)}${IN.keyName(kb.driveB)}${IN.keyName(kb.driveR)}</kbd></dt><dd>Lái</dd><dt><kbd>${IN.keyName(kb.turnL)}</kbd><kbd>${IN.keyName(kb.turnR)}</kbd></dt><dd>Xoay</dd>${list('kbA')}</dl></div>`
    : `<div><h4>Bàn phím</h4><p class="note">Đang tắt lái robot bằng bàn phím (mặc định chỉ tay cầm). Bật trong Cài đặt → Điều khiển → “Lái robot bằng bàn phím”.</p></div>`;
  $('howKeys').innerHTML = `<div><h4>Tay cầm</h4><dl><dt>Cần trái</dt><dd>Lái</dd><dt>Cần phải</dt><dd>Xoay</dd>${list('gp0')}</dl></div>${kbCol}
    <div><h4>Chung (bàn phím)</h4><dl>${IN.GLOBALS.map(a => `<dt>${g(a.id)}</dt><dd>${a.label}</dd>`).join('')}<dt>Chuột</dt><dd>Kéo: xoay góc nhìn · Shift/chuột phải: dời · lăn: thu phóng · nhấp đúp: đặt lại</dd></dl></div>`;
};

// ------------------------------------------------------------------ controller test
UI.padsFrame = function () {
  const pads = IN.pads, grid = $('padGrid');
  $('padsNote').textContent = IN.blocked ? 'Trang này đang bị chặn Gamepad API. Mở artifact trong một tab trình duyệt riêng để dùng tay cầm.'
    : pads.length ? 'Nút sáng khi bấm. Cò (LT/RT) hiện theo lực bấm, cần hiện chấm di chuyển.' : 'Chưa thấy tay cầm. Cắm vào rồi bấm một nút bất kỳ.';
  if (grid.childElementCount !== pads.length) {
    grid.innerHTML = pads.map((p, i) => `<div class="padcard" id="pc${i}"><h3>Tay cầm ${i + 1}: ${esc(p.id)}</h3>${padSVG()}<div class="axes mono"></div>${p.mapping !== 'standard' ? '<p class="note">Tay cầm này không dùng “standard mapping”: nút có thể lệch chỗ. Thử chế độ X (XInput).</p>' : ''}</div>`).join('');
  }
  pads.forEach((p, i) => {
    const card = $('pc' + i); if (!card) return;
    card.querySelectorAll('[data-b]').forEach(n => n.classList.toggle('on', !!p.btn[+n.dataset.b]));
    const st = (sel, x, y) => { const d = card.querySelector(sel); d.setAttribute('cx', (+d.dataset.cx + x * 11).toFixed(1)); d.setAttribute('cy', (+d.dataset.cy + y * 11).toFixed(1)); };
    st('.dot.l', p.axes[0] || 0, p.axes[1] || 0); st('.dot.r', p.axes[2] || 0, p.axes[3] || 0);
    card.querySelector('.trigf.l').setAttribute('width', (34 * (p.val[6] || 0)).toFixed(1));
    card.querySelector('.trigf.r').setAttribute('width', (34 * (p.val[7] || 0)).toFixed(1));
    const ax = card.querySelector('.axes'); const s = `LX ${(p.axes[0] || 0).toFixed(2)} LY ${(p.axes[1] || 0).toFixed(2)} RX ${(p.axes[2] || 0).toFixed(2)} RY ${(p.axes[3] || 0).toFixed(2)} LT ${(p.val[6] || 0).toFixed(2)} RT ${(p.val[7] || 0).toFixed(2)}`;
    if (ax.textContent !== s) ax.textContent = s;
  });
};
function padSVG() {
  const b = (i, x, y, r, t) => `<circle class="pb" data-b="${i}" cx="${x}" cy="${y}" r="${r}"/><text class="pt" x="${x}" y="${y + 3}" text-anchor="middle">${t}</text>`;
  const rect = (i, x, y, w, h, t) => `<rect class="pb" data-b="${i}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><text class="pt" x="${x + w / 2}" y="${y + h / 2 + 3}" text-anchor="middle">${t}</text>`;
  return `<svg viewBox="0 0 300 170" aria-hidden="true">
    <rect class="trig" x="40" y="4" width="34" height="9" rx="2"/><rect class="trigf l" x="40" y="4" width="0" height="9" rx="2"/><text class="pt" x="30" y="12">LT</text>
    <rect class="trig" x="226" y="4" width="34" height="9" rx="2"/><rect class="trigf r" x="226" y="4" width="0" height="9" rx="2"/><text class="pt" x="264" y="12">RT</text>
    ${rect(4, 40, 18, 44, 12, 'LB')}${rect(5, 216, 18, 44, 12, 'RB')}
    <path class="stk" d="M40 40 h220 q30 0 36 60 q6 60 -36 60 q-30 0 -52 -30 h-116 q-22 30 -52 30 q-42 0 -36 -60 q6 -60 36 -60 z"/>
    <circle class="stk" cx="82" cy="78" r="18"/><circle class="dot l" data-cx="82" data-cy="78" cx="82" cy="78" r="6"/>
    <circle class="stk" cx="186" cy="118" r="18"/><circle class="dot r" data-cx="186" data-cy="118" cx="186" cy="118" r="6"/>
    ${b(10, 82, 104, 6, 'L3')}${b(11, 186, 144, 6, 'R3')}
    ${rect(12, 108, 100, 12, 12, '↑')}${rect(13, 108, 124, 12, 12, '↓')}${rect(14, 96, 112, 12, 12, '←')}${rect(15, 120, 112, 12, 12, '→')}
    ${b(3, 224, 60, 9, 'Y')}${b(2, 206, 78, 9, 'X')}${b(1, 242, 78, 9, 'B')}${b(0, 224, 96, 9, 'A')}
    ${rect(8, 128, 70, 18, 10, 'Bk')}${rect(9, 156, 70, 18, 10, 'St')}
  </svg>`;
}

// ------------------------------------------------------------------ accuracy notes
UI.notes = function () {
  $('notesBody').innerHTML = `
  <p>Mục tiêu: cảm giác lái và bắn giống robot FTC thật đủ để luyện chiến thuật và thói quen lái. Dưới đây là những gì được mô phỏng theo số liệu, và chỗ nào phải ước lượng.</p>
  <h3>Sân và luật</h3>
  <ul class="rule-list">
    <li>Mô hình 3D của sân dựng thẳng từ file CAD chính thức của FIRST (Field CAD STEP v26-27.2, trang Playing Field Resources): tấm thảm với đường ghép răng cưa thật, tường polycarbonate và thanh ray, khung chữ A, hai HIVE, bốn FLOWER, băng dính và khay NECTAR. Chi tiết ốc vít được lược bỏ, các chi tiết đúc phức tạp được giảm lưới.</li>
    <li>Va chạm theo đúng các số đo trong CAD: thảm ±70,6 in, tường cao 11,64 in trên mặt thảm, HIVE (trục 43,95 in, dừng ở ±30°) với CELL ngũ giác rộng 20 in, sâu 12 in; khung có thanh chân cao 2,15 in; FLOWER có 4 ống HIPS, vòng trên lỗ 4 in ở 21,4 in, vòng giữa lỗ 3,38 in (POLLEN lọt qua, NECTAR bị giữ lại), vòng dưới giữ POLLEN, thanh chặn phía tường; LOADING ZONE, GARDEN và khu liên minh theo mép băng dính.</li>
    <li>AprilTag 36h11 (3,25 in): mỗi đáy CELL có một tấm 4 tag xếp một hàng (ID 30–33 và 34–37 bên đỏ, 38–41 và 42–45 bên xanh) đúng vị trí và thứ tự của Hình 9-15 đến 9-17.</li>
    <li>Đồng hồ trận (AUTO 30 s, chuyển tiếp 8 s, TELEOP 2:00), bảng điểm Table 10-2/10-3, RP (SWARM ≥ 16, POLLINATOR ≥ 4 và ≥ 7 TIP).</li>
    <li>Trọng tài tự động: G402 (AUTO sang phần sân đối thủ và va chạm), G410 (NECTAR vào FLOWER trước 1:00), G421 (đếm 3 giây khi PIN, dừng đếm khi cách 2 ft), G426 (human player đưa NECTAR sớm), G409 chỉ nhắc nhở. Trọng tài thật còn xét “cố ý” (STRATEGIC), ở đây không có.</li>
    <li>Ngưỡng lật: Field Setup Guide 12.3 yêu cầu CELL rỗng lật với 8 POLLEN (hoặc 3 NECTAR + 3 POLLEN) và giữ ở 7 POLLEN (hoặc 3 NECTAR + 2 POLLEN). Mô-men giữ HIVE được hiệu chỉnh bằng chính bộ vật lý này để khớp các mốc đó.</li>
  </ul>
  <h3>Bóng</h3>
  <ul class="rule-list">
    <li>POLLEN 2,80 in / 24,9 g, NECTAR 3,62 in / 41,3 g (AndyMark am-5851, am-5852). Vỏ đục lỗ: hệ số cản C<sub>D</sub> 0,45, lực Magnus C<sub>L</sub> = 0,22 × tỉ số xoáy, xoáy tắt dần 3 s.</li>
    <li>Va chạm dùng bộ giải xung lực tuần tự 300 Hz, 8 vòng lặp, có ma sát Coulomb, lăn và hệ số nảy riêng cho sàn, tường, khung, CELL, FLOWER, robot. Các hệ số nảy và ma sát là ước lượng hợp lý, chưa đo trên bóng thật.</li>
  </ul>
  <h3>Robot</h3>
  <ul class="rule-list">
    <li>Mô-tơ goBILDA 5203 Yellow Jacket: mô-men và tốc độ không tải theo bảng của hãng, dòng kẹt 9,2 A. Lực bánh = mô-men × (điện áp/12 − tốc độ/tốc độ không tải), giới hạn bởi ma sát (mecanum 0,72, tank 0,95, swerve 1,0).</li>
    <li>Pin NiMH 12 V: 13,2 V khi hở mạch, điện trở trong kể cả dây ≈ 0,10 Ω, sụt thêm theo dung lượng đã dùng. Kéo nhiều dòng thì bánh và flywheel đều yếu đi.</li>
    <li>Flywheel: quán tính theo bánh 96/72 mm và đĩa thép, bộ điều khiển SDK setVelocity (PI ~20 Hz, không feedforward), PIDF + feedforward (100 Hz) hoặc bang-bang. Mỗi quả bóng lấy đi động năng của bánh, nên bắn liên tục làm tụt tốc.</li>
    <li>Độ tản mỗi quả (robot làm kỹ): hướng 0,8°, góc 0,7°, tốc 1,1%. Hood chỉnh servo tự bù theo tốc độ bánh lúc bóng chạm.</li>
    <li>Định vị: bánh odometry có sai số tỉ lệ ~0,3% và nhiễu tích lũy, cộng dồn khi va chạm; AprilTag kéo vị trí về đúng khi robot chạy chậm và thấy tag.</li>
    <li>Khung robot va chạm như hộp chữ nhật 2D (không lật, không leo). Cơ cấu bên trong rút gọn: bóng vào hopper sau 0,14 s, nạp vào flywheel 0,1 s.</li>
  </ul>
  <h3>Chiến thuật AUTO tự lập trình</h3>
  <ul class="rule-list">
    <li>Mỗi bước chạy bằng đúng bộ điều khiển của bot: tìm đường A* quanh khung HIVE và FLOWER, tránh robot khác, không bao giờ để góc khung vượt vạch giữa trong AUTO (G402). Bước nào không làm được (điểm nằm trong khung, không có đường bắn) sẽ tự dừng khi hết thời gian của nó để chương trình chạy tiếp.</li>
    <li>“Chạy thử” dùng nguyên bộ vật lý của trận nhưng chỉ có robot của bạn trên sân; trong trận thật ba robot kia có thể chặn đường hoặc làm HIVE lật sớm hơn. Bản đồ bắn tính 5 cú bắn đứng yên cho mỗi ô 4 in vào CELL đang ngửa lúc đầu trận.</li>
    <li>Bên XANH dùng cùng chương trình xoay 180° quanh tâm sân, vì sân BIOBUZZ đối xứng tâm (LOADING ZONE, GARDEN, CELL ngửa, tường xuất phát).</li>
  </ul>
  <h3>Hình và điều khiển</h3>
  <ul class="rule-list">
    <li>Vật lý chạy 300 bước/giây, màn hình vẽ vị trí nội suy giữa hai bước gần nhất (trễ tối đa 3,3 ms) nên chuyển động mượt ở mọi tần số màn hình 60–240 Hz.</li>
    <li>Khi card đồ họa không theo kịp, trang tự giảm độ phân giải vẽ (tới 55%) thay vì để khung hình giật; tắt được trong Cài đặt → Hiển thị.</li>
    <li>Mặc định chỉ tay cầm lái robot. Lái bằng bàn phím bật trong Cài đặt → Điều khiển; phím được “đẩy dần” như cần analog và xoay ở 60% công suất cho dễ ngắm. Bộ gõ tiếng Việt (Unikey, EVKey, Telex của Windows) viết lại các phím W, A, S, D, F, R, X, J, Z nên cần tắt khi lái bằng phím; trang sẽ nhắc khi phát hiện.</li>
  </ul>
  <h3>Camera và ngắm</h3>
  <ul class="rule-list">
    <li>Camera 640 px, trường nhìn 63° × 49°. Tag chỉ được nhận khi đủ lớn (≥ 14 px), không quá nghiêng và không bị robot hay CELL khác che.</li>
    <li>Bảng bắn tính bằng đúng bộ tích phân của bóng (cản + Magnus), nên quỹ đạo dự đoán trùng với quỹ đạo thật khi không có nhiễu. Bản đồ ngắm thử 5 cú bắn đứng yên cho mỗi ô 4 in, không tính bóng dội vào.</li>
  </ul>
  <p class="src">Nguồn: FIRST Tech Challenge 2026–2027 Competition Manual (V1) và Team Update 01–02; BIOBUZZ Field CAD (STEP v26-27.2, 15/9/2026); FIRST Tech Challenge Field Setup Guide mục 12.3; trang sản phẩm goBILDA 5203 Series Yellow Jacket; AndyMark am-5851 và am-5852. Giao diện tham khảo tính năng của <a href="https://turtle-sim.com/" target="_blank" rel="noopener">turtle-sim.com</a>.</p>`;
};

root.BBUI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
