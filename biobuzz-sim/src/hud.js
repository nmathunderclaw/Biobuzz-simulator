/* BIOBUZZ Sim — HUD: scoreboard, robot panels (turret dial, flywheel graph, battery), AprilTag camera, FLOWERs, TAB details, results. */
(function (root) {
'use strict';
const BB = root.BB, R = root.BBR, IN = root.BBIN;
const $ = id => document.getElementById(id);
const H = { t: 0, slowT: 0, flT: 0, bannerT: 0, panels: [], hist: [] };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function S() { return root.BBAPP; }
function setText(el, v) { const s = String(v); if (el && el.textContent !== s) el.textContent = s; }
function fmt(s) { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const AL_NAME = { R: 'ĐỎ', B: 'XANH' };
const REASON = { 'KHÓA': 'KHÓA', TRACKING: 'ĐANG BÁM' };

// ------------------------------------------------------------------ setup per match
H.setup = function () {
  const st = S(), sim = st.sim;
  for (const al of ['R', 'B']) {
    $('teams' + al).textContent = sim.robots.filter(r => r.alliance === al).map(r => r.team).join(' · ') || '—';
    $('nect' + al).innerHTML = '<i></i>'.repeat(5);
    $('tipsq' + al).innerHTML = '<i></i>'.repeat(7) + '<b class="mono">0</b>';
    const t = $('tipsq' + al).children; t[3].classList.add('rpt'); t[6].classList.add('rpt');
    $('foul' + al).hidden = true;
  }
  // robot panels + tag cameras for each human
  const locals = st.humans.filter(h => !h.remote);           // an online opponent/partner has no panel here
  H.panels = locals.map((h, k) => makePanel(sim.robots[h.id], h, k));
  $('panels').replaceChildren(...H.panels.map(p => p.el));
  $('pips').replaceChildren(...locals.map((h, k) => makePip(sim.robots[h.id], k)));
  $('pips').classList.toggle('two', locals.length > 1);
  // flowers
  const names = ['Xa · trái', 'Phải · xa', 'Gần · phải', 'Trái · gần'];
  $('fpRow').innerHTML = sim.flowers.map((f, i) => `<div class="fl"><div class="fl-tube" id="flt${i}"></div><span class="fl-own" id="flo${i}">—</span><span class="fl-name">${names[i]}</span></div>`).join('');
  // controls legend
  H.legend();
  // labels over robots
  $('labels').innerHTML = sim.robots.map(r => { const h = st.humans.find(q => q.id === r.id); return `<span class="rlbl ${r.alliance}${h && !h.remote ? ' me' : ''}${h && h.remote ? ' net' : ''}" id="lbl${r.id}">${esc(r.team)}${h && h.remote && h.name ? ' · ' + esc(h.name) : ''}<span class="pin" id="lpin${r.id}"></span></span>`; }).join('');
  $('details').hidden = true; $('coach').hidden = true; $('aimKey').hidden = true; $('flowerPanel').hidden = false;
  H.coachStep = -1; H.coachClosed = false;
  H.fouls = { R: 0, B: 0 };
  if (!H.bound) {
    H.bound = true;
    $('btnHide').addEventListener('click', () => { S().hideUI = !S().hideUI; $('btnHide').blur(); });
    $('coachX').addEventListener('click', () => { H.coachClosed = true; $('coach').hidden = true; });
  }
};
H.legend = function () {
  const st = S();
  if (!st.set.legend || !st.humans.length) { $('legend').innerHTML = ''; return; }
  const g = a => `<kbd>${esc(IN.keyName(st.set.keys.global[a]))}</kbd>`;
  const common = `${g('camera')} góc nhìn · kéo chuột xoay camera, lăn thu phóng (${g('camReset')} đặt lại) · ${g('aimMap')} bản đồ ngắm · ${g('details')} chi tiết · ${g('pause')} dừng · ${g('hideUI')} ẩn giao diện`;
  if (st.humans.filter(q => !q.remote).length > 1 && !st.humans[0].codrive) { $('legend').innerHTML = `<div>${common}</div>`; return; }
  const h = st.humans[0];
  const devOf = role => h.ctl.filter(c => c.role === role || c.role === 'both').map(c => c.dev).join('+');
  const kd = devOf('drive'), ko = devOf('op');
  const k = (dev, a) => `<kbd>${esc(IN.labelFor(dev, a) || '—')}</kbd>`;
  const kb = st.set.keys.kbA, isKb = kd.includes('kbA') && st.set.kbDrive && !IN.hasPad();
  const drive = isKb ? `<kbd>${IN.keyName(kb.driveF)}${IN.keyName(kb.driveL)}${IN.keyName(kb.driveB)}${IN.keyName(kb.driveR)}</kbd> lái · <kbd>${IN.keyName(kb.turnL)}</kbd><kbd>${IN.keyName(kb.turnR)}</kbd> xoay` : 'cần trái lái · cần phải xoay';
  $('legend').innerHTML = `<div>${drive} · ${k(kd, 'slow')} chậm · ${k(kd, 'driveMode')} lái theo sân/robot</div>
    <div>${k(ko, 'shoot')} bắn · ${k(ko, 'force')} bắn ngay · ${k(ko, 'intake')} intake · ${k(ko, 'outtake')} nhả · ${k(ko, 'arm')} cánh tay FLOWER</div>
    <div>${k(ko, 'turretLock')} khóa turret · ${k(ko, 'autoFire')} tự bắn khi khóa · ${k(ko, 'hp')} human player</div>
    <div>${common}</div>`;
};

// ------------------------------------------------------------------ robot panel
function dialSVG(sh) {
  // robot forward points up; the turret travel is drawn around its centre direction
  const half = sh.tur.has ? sh.tur.half : 0, c = sh.faces;
  const arc = (a0, a1, r) => {
    const p = a => [23 + r * Math.sin(a), 23 - r * Math.cos(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  // screen angle: clockwise from up = -(yaw) since +yaw turns left
  const a0 = -(c + half), a1 = -(c - half);
  const dead = sh.tur.has && half < Math.PI * 0.999 ? `<path class="dead" d="${arc(a1, a0 + 2 * Math.PI, 19)}"/>` : '';
  const rng = sh.tur.has ? `<path class="rng" d="${arc(a0, a1, 19)}"/>` : `<circle class="rng" cx="23" cy="23" r="19"/>`;
  return `<svg class="dial" viewBox="0 0 46 46" aria-hidden="true">${rng}${dead}<rect class="body" x="16" y="15" width="14" height="16" rx="2"/><path class="fwd" d="M23 9 l3 5 h-6 z"/><line class="ptr" x1="23" y1="23" x2="23" y2="6"/><circle class="tgt" cx="23" cy="4" r="2.4"/></svg>`;
}
const CTRL_NAME = { sdk: 'SDK', pidf: 'PIDF+FF', bang: 'BANG-BANG' };
function makePanel(rb, h, k) {
  const el = document.createElement('div'); el.className = 'rp';
  const who = S().humans.filter(q => !q.remote).length > 1 ? `P${h.player}${h.codrive ? ' + P2' : ''} · ` : '';
  const legal = rb.P.cls.legal;
  el.innerHTML = `<div class="rp-head"><span class="rp-name">${esc(rb.name)}</span><span class="badge ${legal ? 'ok' : 'bad'}">${legal ? 'HỢP LỆ FTC' : 'VƯỢT GIỚI HẠN'}</span></div>
    <div class="rp-sub"><span class="rp-slot ${rb.alliance}">${who}${AL_NAME[rb.alliance]} ${rb.slot + 1} · #${esc(rb.team)}</span></div>
    <div class="hopper"><i></i><i></i><i></i><i></i></div>
    <div class="chips st1"></div>
    <div class="chips st2"></div>
    ${rb.shooters.map((sh, i) => `<div class="shooter" data-i="${i}">${dialSVG(sh)}<div class="sh-info"><span class="sh-what mono"></span><span class="aim-state">—</span><span class="sh-fly mono"></span></div><canvas class="spark" width="240" height="30"></canvas></div>`).join('')}
    <div class="rp-hive"><div class="hv-row mono"><span class="hv-a"></span><b class="hv-b"></b></div><b class="bar"><i></i></b></div>
    <div class="rp-foot mono"><span class="sm"></span><span class="sp"></span></div>`;
  const q = s2 => el.querySelector(s2);
  return { el, rb: rb.id, h, hop: q('.hopper').children, c1: q('.chips.st1'), c2: q('.chips.st2'),
    sh: Array.from(el.querySelectorAll('.shooter')).map(n => ({ n, ptr: n.querySelector('.ptr'), tgt: n.querySelector('.tgt'), what: n.querySelector('.sh-what'), st: n.querySelector('.aim-state'), fly: n.querySelector('.sh-fly'), cv: n.querySelector('.spark'), hist: [], acc: 0 })),
    hvt: q('.hv-a'), hvp: q('.hv-b'), hvb: q('.rp-hive .bar i'), sm: q('.rp-foot .sm'), sp: q('.rp-foot .sp'), k1: '', k2: '', zoneT: 0, zone: null };
}
const BALL_NAME = ['POLLEN', 'NECTAR', 'NECTAR'];
function updatePanel(p, sim, fast, dt) {
  const rb = sim.robots[p.rb], h = p.h;
  for (let k = 0; k < 4; k++) {
    const q = rb.hopper[k]; const cls = q ? (q.ball.bt === 0 ? 'p' : q.ball.bt === 1 ? 'nr' : 'nb') + (q.t > 0 ? ' in' : '') : '';
    if (p.hop[k].className !== cls) p.hop[k].className = cls;
  }
  rb.shooters.forEach((sh, i) => {
    const v = p.sh[i]; if (!v) return;
    // flywheel history at a fixed 30 Hz so the graph spans 3 s at any frame rate
    v.acc += dt;
    while (v.acc >= 1 / 30) { v.acc -= 1 / 30; v.hist.push(sh.fw.w, sh.fw.wt); if (v.hist.length > 180) v.hist.splice(0, 2); }
    if (!fast) return;
    const A = sh.aim, deg = r => Math.abs(r * 180 / Math.PI).toFixed(0);
    const yaw = sh.faces + (sh.tur.has ? sh.tur.ang : 0);
    v.ptr.setAttribute('transform', `rotate(${(-yaw * 180 / Math.PI).toFixed(1)} 23 23)`);
    if (A.valid) { const rel = BB.wrap(A.az - rb.est.psi); v.tgt.setAttribute('transform', `rotate(${(-rel * 180 / Math.PI).toFixed(1)} 23 23)`); v.tgt.style.opacity = 1; }
    else v.tgt.style.opacity = 0.15;
    const next = BB.nextBallFor(rb, sh);
    setText(v.what, `${next < 0 ? 'TRỐNG' : BALL_NAME[next]} · ${sh.type === 'turret' ? 'TURRET' : 'SÚNG CỐ ĐỊNH'} · ${A.valid ? A.D.toFixed(0) + ' in' : '—'}`);
    let label;
    if (A.locked && !A.empty) label = 'KHÓA MỤC TIÊU';
    else if (A.valid && A.empty) label = 'HẾT BÓNG';
    else if (A.valid && !A.limit && Math.abs(A.yawErr) * 180 / Math.PI >= 1) label = `${sh.tur.has ? 'TURRET' : 'XOAY ROBOT'} CÒN ${deg(A.yawErr)}° ${A.yawErr > 0 ? 'TRÁI' : 'PHẢI'}`;
    else if (A.valid && A.limit) label = `GIỚI HẠN TURRET · XOAY ROBOT ${A.yawErr > 0 ? 'TRÁI' : 'PHẢI'}`;
    else label = REASON[A.reason] || A.reason;
    setText(v.st, label);
    const cls = 'aim-state' + (A.locked && !A.empty ? ' lock' : A.valid ? ' track' : '');
    if (v.st.className !== cls) v.st.className = cls;
    const k2 = sh.fw.eta * sh.fw.rIn;
    setText(v.fly, `${CTRL_NAME[sh.fw.ctrl] || ''} ${Math.round(sh.fw.w * k2)}/${Math.round(sh.fw.wt * k2)} in/s · hood ${(sh.hood.cur * 180 / Math.PI).toFixed(0)}°`);
    drawSpark(v, sh);
  });
  if (!fast) return;
  // status: park, shooting zone for the ball you would shoot next, NECTAR held
  const inZone = BB.inZone(rb, BB.ZONES.loading[rb.alliance]);
  p.zoneT -= 1 / 15;
  const sh0 = rb.shooters[0];
  if (p.zoneT <= 0) {
    p.zoneT = 0.25;
    const bt = BB.nextBallFor(rb, sh0), b2 = bt < 0 ? 0 : bt;
    const base = BB.shooterBase(rb, sh0, false);
    p.zone = { bt: b2, ok: BB.shotFeasible(sim, rb.alliance, sh0, base[0], base[1], b2) };
  }
  const nect = rb.hopper.filter(q => q.ball.bt !== 0).length;
  const c1 = [[inZone ? 'TRONG LOADING ZONE' : 'NGOÀI LOADING ZONE', inZone ? 'ok' : ''],
    [`${BALL_NAME[p.zone.bt]} ${p.zone.ok ? 'TRONG VÙNG BẮN' : 'NGOÀI VÙNG BẮN'}`, p.zone.ok ? 'ok' : 'bad'],
    [nect ? `NECTAR ×${nect}` : 'KHÔNG CÓ NECTAR', nect ? 'on' : '']];
  if (rb.pinCount > 0.3) c1.push([`ĐANG PIN ${rb.pinCount.toFixed(1)} s`, 'bad']);
  if (rb.loc.err > 3) c1.push([`LỆCH ĐỊNH VỊ ${rb.loc.err.toFixed(0)} in`, 'bad']);
  const full = rb.hopper.length >= 4;
  const c2 = [[full ? 'ĐẦY 4/4' : rb.outtake ? 'NHẢ BÓNG' : rb.intakeOn ? 'INTAKE' : 'INTAKE TẮT', full ? 'ok' : rb.intakeOn ? 'on' : ''],
    [h.autoFire ? 'TỰ BẮN KHI KHÓA' : 'BẮN TAY', h.autoFire ? 'on' : '']];
  if (rb.shooters.some(s2 => s2.tur.has)) c2.push([rb.turretLock ? 'TURRET CHỈNH TAY' : 'TURRET TỰ BÁM', rb.turretLock ? 'on' : '']);
  c2.push([h.field ? 'LÁI THEO SÂN' : 'LÁI THEO ROBOT', '']);
  if (rb.cmd.slow) c2.push(['CHẬM', 'on']);
  const hp = sim.hp[rb.alliance];
  if (hp.manual) c2.push([`HP: ${hp.left} NECTAR${BB.hpAllowed(sim, rb.alliance) ? '' : ' · KHÓA'}`, BB.hpAllowed(sim, rb.alliance) ? 'ok' : '']);
  const key1 = c1.map(c => c.join(':')).join('|'), key2 = c2.map(c => c.join(':')).join('|');
  if (key1 !== p.k1) { p.k1 = key1; p.c1.innerHTML = c1.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join(''); }
  if (key2 !== p.k2) { p.k2 = key2; p.c2.innerHTML = c2.map(([t, c]) => `<span class="chip dim ${c}">${t}</span>`).join(''); }
  const hv = BB.hiveOf(sim, rb.alliance), pct = Math.min(100, Math.round(BB.tipProgress(sim, hv) * 100));
  setText(p.hvt, `HIVE ${AL_NAME[rb.alliance]} · CELL ngửa ${hv.side < 0 ? 'phía khán đài' : 'phía xa'}`);
  setText(p.hvp, `${pct}% tới TIP`);
  p.hvb.style.width = pct + '%';
  setText(p.sm, `BẮN ${rb.stats.shots} · VÀO ${rb.stats.made}${rb.stats.shots ? ' · ' + Math.round(100 * rb.stats.made / rb.stats.shots) + '%' : ''}`);
  setText(p.sp, `${rb.bat.v.toFixed(1)} V · ${Math.hypot(rb.vx, rb.vy).toFixed(0)} in/s`);
  p.sp.classList.toggle('warn', rb.bat.v < 11.8);
}
function drawSpark(v, sh) {
  const c = v.cv, g = c.getContext('2d'), W = c.width, Hh = c.height;
  g.clearRect(0, 0, W, Hh);
  g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, 0, W, Hh);
  const hs = v.hist, n = hs.length / 2; if (n < 2) return;
  const k2 = sh.fw.eta * sh.fw.rIn, top = sh.fw.wf * 1.04 * k2, y = w => Hh - 2 - (w * k2 / top) * (Hh - 4);
  const xs = i => W - (n - 1 - i) / 89 * W;
  // band where the controller calls it "at speed"
  const wt = hs[hs.length - 1];
  if (wt > 0) { g.fillStyle = 'rgba(69,196,111,.12)'; const a = y(wt * (1 + sh.fw.band)), b = y(wt * (1 - sh.fw.band)); g.fillRect(0, a, W, b - a); }
  g.lineWidth = 1; g.strokeStyle = 'rgba(242,194,48,.85)'; g.setLineDash([3, 3]); g.beginPath();
  for (let i = 0; i < n; i++) { const yy = y(hs[2 * i + 1]); if (i) g.lineTo(xs(i), yy); else g.moveTo(xs(i), yy); }
  g.stroke(); g.setLineDash([]);
  g.strokeStyle = sh.aim.atSpeed ? '#7ce39c' : '#eaf1ec'; g.lineWidth = 1.6; g.beginPath();
  for (let i = 0; i < n; i++) { const yy = y(hs[2 * i]); if (i) g.lineTo(xs(i), yy); else g.moveTo(xs(i), yy); }
  g.stroke();
}

// ------------------------------------------------------------------ AprilTag camera
function makePip(rb, k) {
  const el = document.createElement('div'); el.className = 'pip';
  el.innerHTML = `<div class="pip-head"><span>${S().humans.filter(q => !q.remote).length > 1 ? 'P' + (k + 1) + ' · ' : ''}CAMERA · 36h11</span><span class="mono">—</span></div><div class="pip-view"><canvas></canvas></div>`;
  return el;
}
H.pipRects = function () {
  const st = S(), out = [];
  const c = $('gl').getBoundingClientRect();
  const views = $('pips').querySelectorAll('.pip-view');
  st.humans.forEach((h, k) => {
    const v = views[k]; if (!v) return;
    const r = v.getBoundingClientRect(); if (r.width < 10) return;
    out.push({ rb: st.sim.robots[h.id], k, view: v, rect: { x: r.left - c.left, y: c.bottom - r.bottom, w: r.width, h: r.height } });
  });
  return out;
};
function drawPip(pip) {
  const sim = S().sim, rb = pip.rb, cv = pip.view.querySelector('canvas');
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(r.width * dpr)), Hh = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, Hh);
  const hv = BB.hiveOf(sim, rb.alliance);
  const boxes = pip.cam ? R.projectTags(pip.cam, rb, rb.loc.tags || []) : [];
  const locked = rb.shooters.some(s => s.aim.locked);
  g.lineWidth = Math.max(1.5, W / 190); g.font = `600 ${Math.round(W / 26)}px "JetBrains Mono", monospace`;
  let mine = null;
  for (const bx of boxes) {
    const tgt = bx.tag.hive === hv && bx.tag.sg === hv.side;
    if (tgt && !mine) mine = bx;
    g.strokeStyle = tgt ? (locked ? '#5fe08a' : '#f2c230') : 'rgba(255,255,255,.7)';
    g.beginPath(); bx.pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](p[0] * W, p[1] * Hh)); g.closePath(); g.stroke();
    g.fillStyle = g.strokeStyle; g.fillText(String(bx.id), bx.pts[0][0] * W, bx.pts[0][1] * Hh - 4);
  }
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(W / 2 - 9, Hh / 2); g.lineTo(W / 2 + 9, Hh / 2); g.moveTo(W / 2, Hh / 2 - 9); g.lineTo(W / 2, Hh / 2 + 9); g.stroke();
  const tags = (rb.loc.tags || []).filter(t => t.tag.hive === hv && t.tag.sg === hv.side);
  const info = pip.view.parentElement.querySelector('.pip-head .mono');
  setText(info, tags.length ? `tx ${tags[0].tx.toFixed(1)}° ty ${tags[0].ty.toFixed(1)}° · ${tags.length} tag · ${tags[0].dist.toFixed(0)} in` : (rb.loc.tags.length ? 'tag CELL khác' : 'không thấy tag'));
  if (locked) { g.fillStyle = 'rgba(69,196,111,.95)'; g.font = `700 ${Math.round(W / 16)}px "Saira Condensed", sans-serif`; g.fillText('LOCKED', 8, Hh - 10); }
}

// ------------------------------------------------------------------ per frame
H.update = function (dt, pips) {
  const st = S(), sim = st.sim;
  H.t += dt; H.slowT -= dt; H.flT -= dt;
  const clk = BB.matchClock(sim);
  setText($('period'), clk.label);
  setText($('clock'), fmt(clk.secs));
  $('clock').classList.toggle('warn', (sim.phase === 'tele' && clk.secs <= 15) || sim.phase === 'trans');
  $('hud').classList.toggle('bare', st.hideUI);
  const fast = H.slowT <= 0;
  if (fast) {
    H.slowT = 1 / 15;
    const b = BB.provisional(sim);
    for (const al of ['R', 'B']) {
      setText($('score' + al), b[al].total);
      const tq = $('tipsq' + al).children, n = b[al].tips;
      for (let k = 0; k < 7; k++) tq[k].classList.toggle('on', k < n);
      setText(tq[7], n);
      const h = BB.hiveOf(sim, al), pct = Math.min(100, Math.round(BB.tipProgress(sim, h) * 100));
      $('bar' + al).style.width = pct + '%'; setText($('pct' + al), pct + '%');
      const nd = $('nect' + al).children; for (let k = 0; k < 5; k++) nd[k].classList.toggle('on', k < sim.hp[al].left);
      const hp = sim.hp[al], open = BB.hpAllowed(sim, al) && sim.phase !== 'trans';
      const last = sim.t >= BB.T_FLOWER && sim.phase !== 'free';
      $('hp' + al).innerHTML = `NECTAR ${AL_NAME[al]} · <span class="${open ? 'open' : ''}">${hp.left <= 0 ? 'HẾT' : last ? 'ĐƯA HẾT' : open ? (hp.manual ? 'ĐƯỢC ĐƯA ' + hp.credit : 'ĐANG ĐƯA') : 'KHÓA'}</span>`;
      const fo = sim.fouls[al].minor + sim.fouls[al].major, fe = $('foul' + al);
      if (fo) { fe.hidden = false; setText(fe, `LỖI ${sim.fouls[al].major}M ${sim.fouls[al].minor}m`); } else fe.hidden = true;
    }
    if (H.flT <= 0) { H.flT = 0.4; updateFlowers(b); }
    if (st.details) renderDetails(b);
  }
  $('details').hidden = !st.details;
  for (const p of H.panels) updatePanel(p, sim, fast, dt);
  for (const pip of pips) drawPip(pip);
  $('aimKey').hidden = !(st.showAim && !st.hideUI);
  if (st.showAim) setText($('aimKeyNote'), st.aim.pending ? 'đang tính…' : 'bắn đứng yên từ ô đó, chưa tính bóng dội vào');
  if (bannerOn()) { H.bannerT -= dt; if (H.bannerT <= 0) $('banner').hidden = true; }
  labels(sim);
  coach(sim);
  setText($('btnHide'), st.hideUI ? 'HIỆN GIAO DIỆN' : 'ẨN GIAO DIỆN');
  if (fast) {
    const names = { driver: 'KHU LÁI', follow: 'THEO ROBOT', broadcast: 'KHÁN ĐÀI', top: 'NHÌN TỪ TRÊN', pov: 'CAMERA ROBOT', free: 'TỰ DO' };
    const h0 = st.humans[0];
    const adj = R.camAdjusted && R.camAdjusted(st.cam) ? ' · GÓC ĐÃ CHỈNH (NHẤP ĐÚP ĐỂ ĐẶT LẠI)' : '';
    setText($('camLine'), `${names[st.cam] || ''}${h0 ? ' · ' + (h0.field ? 'LÁI THEO SÂN' : 'LÁI THEO ROBOT') : ''}${adj} · FTC 2026–27 · MANUAL V1`);
  }
  // FPS / frame time
  $('fps').hidden = !st.fpsOn;
  if (st.fpsOn && fast) {
    const f = st.frameMs, avg = f.reduce((a, c) => a + c, 0) / f.length, worst = Math.max(...f);
    const res = R.dyn && R.dyn.on ? ` · độ phân giải ${Math.round(R.dyn.scale * 100)}%` : '';
    setText($('fps'), `${(1000 / avg).toFixed(0)} fps · ${avg.toFixed(1)} ms · tệ nhất ${worst.toFixed(0)} ms · vật lý 300 Hz${res}`);
  }
};
function bannerOn() { return !$('banner').hidden; }
function updateFlowers(b) {
  const sim = S().sim;
  const open = sim.phase === 'free' || sim.flowersOpen || sim.t >= BB.T_FLOWER;
  document.querySelector('.fp-head').classList.toggle('open', open);
  setText($('fpState'), open ? 'đang tính điểm' : 'mở lúc 1:00');
  b.flowers.forEach((f, i) => {
    const tube = $('flt' + i); if (!tube) return;
    const html = f.stack.map(bt => `<i class="${bt === 1 ? 'r' : bt === 2 ? 'b' : ''}"></i>`).join('');
    if (tube._h !== html) { tube.innerHTML = html; tube._h = html; }
    const own = $('flo' + i);
    setText(own, f.owner ? AL_NAME[f.owner] + ' ' + (f.count * 2 + (f.bottom === f.owner ? 5 : 0)) : '—');
    own.className = 'fl-own' + (f.owner ? ' ' + f.owner.toLowerCase() : '');
  });
}
function labels(sim) {
  const st = S(); const show = st.set.labels && !st.hideUI && st.cam !== 'pov';
  $('labels').hidden = !show; if (!show) return;
  for (const rb of sim.robots) {
    const el = $('lbl' + rb.id); if (!el) continue;
    const q = R.poseOf ? R.poseOf(rb) : rb;
    const p = R.toScreen(q.x, q.y, rb.h + 9);
    if (!p.vis) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.left = p.x.toFixed(0) + 'px'; el.style.top = p.y.toFixed(0) + 'px';
    const pin = $('lpin' + rb.id); setText(pin, rb.pinCount > 0.3 ? `PIN ${rb.pinCount.toFixed(1)}` : '');
  }
}
// short tips during the first matches (close with ✕)
function coach(sim) {
  const st = S(), el = $('coach'), body = $('coachBody');
  if (H.coachClosed || !st.set.tips || (st.set.played || 0) > 3 || st.humans.filter(q => !q.remote).length !== 1 || st.hideUI) { el.hidden = true; return; }
  const rb = sim.robots[st.humans[0].id], h = st.humans[0], dev = h.ctl.map(c => c.dev).join('+');
  const k = a => `<kbd>${esc(IN.labelFor(dev, a))}</kbd>`, g = a => `<kbd>${esc(IN.keyName(st.set.keys.global[a]))}</kbd>`;
  let step, text;
  if (sim.phase === 'pre' || (sim.phase === 'auto' && !h.manualAuto) || sim.phase === 'trans') {
    step = 'intro';
    text = `<h4>TRẬN ĐẦU? VÀI ĐIỀU NÊN BIẾT</h4><ul>
      <li>${g('aimMap')} bản đồ ngắm: sàn tô xanh ở chỗ bắn vào được.</li>
      <li>${g('details')} bảng chi tiết: điểm từng mục, ai lái robot nào, lỗi.</li>
      <li>${k('force')} bắn ngay theo hướng turret đang chỉ. ${k('turretLock')} khóa turret để tự chỉnh.</li>
      <li>Tay cầm dùng được ngay: cắm vào rồi bấm một nút.</li>
      <li>Cài đặt → Điều khiển: intake giữ/bật tắt, gán lại mọi phím và nút.</li></ul>`;
  } else if (sim.phase === 'tele' || sim.phase === 'free' || sim.phase === 'auto') {
    const A = rb.shooters[0].aim;
    if (sim.t >= BB.T_FLOWER && rb.P.arm !== 'none' && sim.phase !== 'free') { step = 6; text = `Còn 1:00: áp sát FLOWER, giữ ${k('arm')} để cắm NECTAR. Sắp hết giờ thì về LOADING ZONE để PARK.`; }
    else if (!rb.hopper.length) { step = 2; text = 'Chạy qua bóng để hút vào (tối đa 4). POLLEN vàng ai cũng nhặt được, NECTAR chỉ nhặt màu mình.'; }
    else if (!A.valid) { step = 3; text = `Có bóng rồi. Tới chỗ có đường bắn (bấm ${g('aimMap')} để xem) tới khi camera thấy tag: đèn LED chuyển vàng. Lý do hiện tại: <b>${esc(A.reason)}</b>.`; }
    else if (!A.locked) { step = 4; text = `Giữ ${k('shoot')}: ${rb.shooters[0].tur.has ? 'turret tự quay' : 'robot tự xoay theo tag'}, bóng bay ra khi LED xanh (khóa).`; }
    else { step = 5; text = `Đã khóa. Giữ ${k('shoot')} để bắn liên tục. Bấm ${k('autoFire')} để robot tự bắn mỗi khi khóa.`; }
  } else { el.hidden = true; return; }
  if (step !== H.coachStep) { H.coachStep = step; body.innerHTML = text; }
  el.hidden = false;
}
function renderDetails(b) {
  const sim = S().sim;
  const rows = [['LEAVE', 'leave'], ['PARK (AUTO)', 'autoPark'], ['TIP (AUTO)', 'autoTip'], ['TIP (TELEOP)', 'teleTip'], ['Bóng trong CELL', 'cell'], ['FLOWER sở hữu', 'flower'], ['Bottom NECTAR', 'bottom'], ['GARDEN', 'garden'], ['PARK', 'telePark'], ['Lỗi của đối thủ', 'foul']];
  const score = `<div><h3>Điểm nếu dừng lúc này</h3><table class="dt"><tr><th></th><th class="R">ĐỎ</th><th class="B">XANH</th></tr>${rows.map(([n, k]) => `<tr><td>${n}</td><td>${b.R[k]}</td><td>${b.B[k]}</td></tr>`).join('')}<tr><td><b>Tổng</b></td><td><b>${b.R.total}</b></td><td><b>${b.B.total}</b></td></tr><tr><td>Số TIP · SWARM</td><td>${b.R.tips} · ${b.R.swarmPts}</td><td>${b.B.tips} · ${b.B.swarmPts}</td></tr></table></div>`;
  const robots = `<div><h3>Robot</h3><table class="dt"><tr><th>Đội</th><th>Bóng</th><th>Vào/bắn</th><th>Nhặt</th><th>Pin</th><th>Lệch</th></tr>${sim.robots.map(r => `<tr><td class="${r.alliance} nm">${esc(r.team)} · ${esc(r.name)}</td><td>${r.hopper.length}</td><td>${r.stats.made}/${r.stats.shots}</td><td>${r.stats.pickups}</td><td>${r.bat.v.toFixed(1)}</td><td>${r.loc.err.toFixed(1)}</td></tr>`).join('')}</table></div>`;
  const hv = sim.hives.map(h => `<tr><td class="${h.alliance}">HIVE ${AL_NAME[h.alliance]}</td><td>${h.side < 0 ? 'khán đài' : 'phía xa'}</td><td>${Math.round(BB.tipProgress(sim, h) * 100)}%</td><td>${BB.cellCounts(sim)[h.alliance]}</td></tr>`).join('');
  const log = sim.foulLog.slice(-8).reverse().map(f => `<div><span class="mono">${fmt(sim.phase === 'free' ? f.t : Math.max(0, BB.T_END - f.t))}</span>${f.rule} ${f.kind.toUpperCase()} ${AL_NAME[f.alliance]}: ${esc(f.text)}</div>`).join('') || '<div>Chưa có lỗi.</div>';
  const pins = Array.from(sim.pins.values()).map(p => `<div>${esc(p.a.team)} đang PIN ${esc(p.b.team)}: ${p.count.toFixed(1)} s</div>`).join('');
  $('details').innerHTML = score + robots + `<div><h3>HIVE</h3><table class="dt"><tr><th></th><th>CELL ngửa</th><th>Tới TIP</th><th>Bóng</th></tr>${hv}</table><h3 style="margin-top:12px">Trọng tài</h3><div class="flog">${pins}${log}</div></div>`;
}

// ------------------------------------------------------------------ toasts, banner, fouls
H.toast = function (text, cls) {
  const box = $('toasts'); if (!box || $('hud').hidden) return;
  const el = document.createElement('div'); el.className = 'toast ' + (cls || ''); el.textContent = text;
  box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 2800);
};
H.banner = function (big, small) {
  const b = $('banner'); b.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}`;
  b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  H.bannerT = 1.6;
};
H.foulFlash = function () { /* the scoreboard shows the count; kept as a hook */ };

// ------------------------------------------------------------------ results
H.results = function () {
  const st = S(), sim = st.sim, f = sim.final; if (!f) return;
  $('results').hidden = false; $('hud').hidden = true;
  setText($('resR'), f.R.total); setText($('resB'), f.B.total);
  $('resWinner').textContent = f.R.total > f.B.total ? 'ĐỎ THẮNG' : f.B.total > f.R.total ? 'XANH THẮNG' : 'HÒA';
  const rows = [['sec', 'AUTO'], ['LEAVE', 'leave'], ['PARK', 'autoPark'], ['HIVE TIP', 'autoTip'], ['sec', 'TELEOP'], ['HIVE TIP', 'teleTip'], ['Bóng còn trong CELL', 'cell'], ['FLOWER sở hữu', 'flower'], ['Bottom NECTAR', 'bottom'], ['GARDEN', 'garden'], ['PARK', 'telePark'], ['sec', 'KHÁC'], ['Lỗi của đối thủ', 'foul'], ['tot', '']];
  let html = '<thead><tr><th>Hạng mục</th><th>ĐỎ</th><th>XANH</th></tr></thead><tbody>';
  for (const [a, k] of rows) {
    if (a === 'sec') html += `<tr class="sec"><td colspan="3">${k}</td></tr>`;
    else if (a === 'tot') html += `<tr class="tot"><td class="lbl">Tổng điểm</td><td>${f.R.total}</td><td>${f.B.total}</td></tr>`;
    else html += `<tr><td class="lbl">${a}</td><td>${f.R[k]}</td><td>${f.B[k]}</td></tr>`;
  }
  const rp = d => `${d.rpTotal} <span class="rpb${d.rp.win ? '' : ' no'}">${d.rp.win === 3 ? 'THẮNG' : d.rp.win === 1 ? 'HÒA' : 'THUA'}</span><span class="rpb${d.rp.swarm ? '' : ' no'}">SWARM</span><span class="rpb${d.rp.poll1 ? '' : ' no'}">POLL 1</span><span class="rpb${d.rp.poll2 ? '' : ' no'}">POLL 2</span>`;
  html += `<tr class="sec"><td colspan="3">Ranking points</td></tr><tr><td class="lbl">Số TIP</td><td>${f.R.tips}</td><td>${f.B.tips}</td></tr><tr><td class="lbl">RP</td><td>${rp(f.R)}</td><td>${rp(f.B)}</td></tr></tbody>`;
  $('resTable').innerHTML = html;
  const mine = new Set(st.humans.filter(h => !h.remote).map(h => h.id));
  $('resRobots').innerHTML = `<thead><tr><th>Robot</th><th>Vào/bắn</th><th>%</th><th>Nhặt</th><th>FLOWER</th><th>Lỗi</th><th>Quãng</th></tr></thead><tbody>` + sim.robots.map(r => {
    const pc = r.stats.shots ? Math.round(100 * r.stats.made / r.stats.shots) + '%' : '–';
    return `<tr><td class="lbl"><span class="${r.alliance === 'R' ? 'R' : 'B'}">${esc(r.team)}</span> ${esc(r.name)}${mine.has(r.id) ? ' · bạn' : ''}</td><td>${r.stats.made}/${r.stats.shots}</td><td>${pc}</td><td>${r.stats.pickups}</td><td>${r.stats.dunks}</td><td>${r.stats.fouls}</td><td>${(r.stats.dist / 12).toFixed(0)} ft</td></tr>`;
  }).join('') + '</tbody>';
  $('resFouls').innerHTML = sim.foulLog.map(f2 => `<div>${esc(f2.rule)} ${esc(String(f2.kind).toUpperCase())} · ${AL_NAME[f2.alliance] || ''} · ${esc(f2.text)}</div>`).join('');
  $('labels').hidden = true;
  const RP = root.BBRP, guest = st.mode === 'guestResults';
  $('resMapRobot').innerHTML = sim.robots.map(r => `<button type="button" data-v="${r.id}" class="${r.alliance === 'R' ? 'red' : 'blue'}">${esc(r.team)}${mine.has(r.id) ? ' · bạn' : ''}</button>`).join('');
  const me = st.primary ? st.primary() : null;
  H.mapRobot = me ? me.id : 0;
  H.layers = H.layers || { heat: true, path: false, shots: true };
  $('resTabs').hidden = guest; $('btnReplay').hidden = guest; $('btnReplay').disabled = !RP || !RP.available();
  if (!H.resBound) {
    H.resBound = true;
    $('resTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) H.resTab(b.dataset.v); });
    $('resMapRobot').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; H.mapRobot = +b.dataset.v; H.drawMap(); });
    $('resMapLayers').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; H.layers[b.dataset.v] = !H.layers[b.dataset.v]; H.drawMap(); });
    window.addEventListener('resize', () => { if (!$('results').hidden) H.resTab(H.tab || 'sum'); });
  }
  H.resTab('sum');
  $('btnAgain').focus();
};
function clockAt(t) {
  if (t == null) return '—';
  if (t < BB.T_AUTO) return 'AUTO ' + fmt(BB.T_AUTO - t);
  if (t < BB.T_TELE0) return 'CHUYỂN TIẾP';
  return (t >= BB.T_FLOWER ? 'ENDGAME ' : 'TELEOP ') + fmt(BB.T_END - t);
}
H.resTab = function (tab) {
  H.tab = tab;
  $('resTabs').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === tab); b.setAttribute('aria-selected', b.dataset.v === tab ? 'true' : 'false'); });
  $('resSum').hidden = tab !== 'sum'; $('resFlow').hidden = tab !== 'flow'; $('resMap').hidden = tab !== 'map';
  const RP = root.BBRP; if (!RP) return;
  if (tab === 'flow') {
    RP.drawChart($('resChart'));
    const f = RP.flowStats();
    const sc = (a, b) => `<span class="R">${a}</span> – <span class="B">${b}</span>`;
    $('resFlowStats').innerHTML = f ? `
      <div class="fs"><span class="k">Hết AUTO</span><b>${sc(f.autoEnd[1], f.autoEnd[2])}</b><small>điểm tạm tính lúc 0:00 AUTO</small></div>
      <div class="fs"><span class="k">Dẫn xa nhất</span><b>${sc('+' + f.maxLead.R, '+' + f.maxLead.B)}</b><small>ĐỎ · XANH</small></div>
      <div class="fs"><span class="k">Đổi bên dẫn</span><b>${f.changes}</b><small>lần trong trận</small></div>
      <div class="fs"><span class="k">TIP đầu tiên</span><b style="font-size:15px">${clockAt(f.firstTip.R)} · ${clockAt(f.firstTip.B)}</b><small>ĐỎ · XANH (${f.tips.R} và ${f.tips.B} TIP)</small></div>` : '';
  }
  if (tab === 'map') H.drawMap();
};
H.drawMap = function () {
  const RP = root.BBRP, sim = S().sim; if (!RP || !sim) return;
  $('resMapRobot').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === H.mapRobot));
  $('resMapLayers').querySelectorAll('button').forEach(b => b.classList.toggle('on', !!H.layers[b.dataset.v]));
  const m = RP.drawMap($('resMapCv'), H.mapRobot, H.layers), rb = sim.robots[H.mapRobot];
  if (!m || !rb) { $('resMapSide').innerHTML = ''; return; }
  const pc = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
  const rows = [['Gần < 4 ft', m.bands[0]], ['Vừa 4–7 ft', m.bands[1]], ['Xa > 7 ft', m.bands[2]]];
  $('resMapSide').innerHTML = `<h3><span class="${rb.alliance === 'R' ? 'R' : 'B'}">#${esc(rb.team)}</span> · ${esc(rb.name)}</h3>
    <div class="ms-sub">${AL_NAME[rb.alliance]} ${rb.slot + 1} · ${Math.round(m.secs)} giây được lái</div>
    <div class="ms-grid">
      <div class="fs"><span class="k">Vào / bắn</span><b>${m.made}/${m.shots}</b><small>${pc(m.made, m.shots)} vào CELL</small></div>
      <div class="fs"><span class="k">Quãng đường</span><b>${(m.dist / 12).toFixed(0)} ft</b><small>${m.secs > 1 ? (m.dist / 12 / m.secs).toFixed(1) + ' ft/s trung bình' : ''}</small></div>
      <div class="fs"><span class="k">Ở nửa sân mình</span><b>${Math.round(m.own * 100)}%</b><small>thời gian</small></div>
      <div class="fs"><span class="k">Quanh LOADING ZONE</span><b>${Math.round(m.zone * 100)}%</b><small>thời gian</small></div>
    </div>
    <div class="ms-range"><div class="lab">Tỉ lệ vào theo cự ly tới HIVE</div>${rows.map(([n, b]) => `<div class="rr"><span>${n}</span><span class="rr-bar"><i style="width:${b.n ? Math.round(100 * b.made / b.n) : 0}%"></i></span><b>${b.n ? b.made + '/' + b.n : '–'}</b></div>`).join('')}</div>
    <div class="ms-key"><span><i class="dh"></i>đứng nhiều</span><span><i class="dm"></i>bắn vào</span><span><b class="dx">×</b>bắn trượt</span></div>`;
};

H.labels = labels; H.fmt = fmt;
root.BBHUD = H;
})(typeof globalThis !== 'undefined' ? globalThis : this);
