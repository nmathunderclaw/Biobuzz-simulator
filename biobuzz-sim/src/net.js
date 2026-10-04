/* BIOBUZZ Sim — online play over the artifact's room: the host runs the physics, the guest drives its robot and watches snapshots. */
(function (root) {
'use strict';
const BB = root.BB, R = root.BBR, IN = root.BBIN, AU = root.BBAU, RP = root.BBRP;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function S() { return root.BBAPP; }
function H() { return root.BBHUD; }
const APP = 'bbz', VER = 1, SNAP_MS = 50, IN_MS = 33;
const CODE_CH = 'abcdefghjkmnpqrstuvwxyz23456789';
const HOLD_BITS = ['slow', 'shoot', 'force', 'intake', 'outtake', 'arm', 'turretL', 'turretR'];
const B_AUTOFIRE = 256, B_TLOCK = 512, B_ASSIST = 1024, B_TFAST = 2048, B_ROBOT = 4096;
const OPP = { easy: ['starter', 'wall'], normal: ['turret', 'speed'], hard: ['twin', 'swerve'] };
const PHASES = RP.PH;
const EV = { phase: 1, pickup: 2, lastMinute: 3, tip: 4, foul: 5, rule: 6, fire: 7, made: 8, intake: 9, dunkStart: 10, dunk: 11, nectarIn: 12, out: 13, hpBlocked: 14 };

const NET = { role: null, room: null, lobby: undefined, code: '', gid: 0, status: '', ev: [], evSeq: 0, lastSend: 0, snapSeq: 0, G: null, setup: null, guestPeer: null, hostPeer: null, others: [], connected: false };

// ------------------------------------------------------------------ helpers
const clamp1 = v => Math.max(-1, Math.min(1, +v || 0));
function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16) || 'Người chơi'; }
function myName() { return cleanName(S().set.olName || 'Người chơi'); }
function randomCode() { let s = ''; const a = new Uint32Array(4); (root.crypto || window.crypto).getRandomValues(a); for (let i = 0; i < 4; i++) s += CODE_CH[a[i] % CODE_CH.length]; return s; }
function bytes(o) { const j = JSON.stringify(o); let n = 0; for (let i = 0; i < j.length; i++) { const c = j.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3; } return n; }
// a robot travels as a preset key or as a normalized spec holding only the fields the engine reads
const SPEC_KEYS = ['name', 'body', 'mass', 'color', 'drive', 'intake', 'shooters', 'camera', 'flower', 'odo', 'lead', 'scatter'];
function cleanSpec(raw) {
  const n = BB.normalizeSpec(raw), s = {};
  for (const k of SPEC_KEYS) s[k] = n[k];
  s.name = String(s.name || 'ROBOT').replace(/[\u0000-\u001f]/g, '').slice(0, 24);
  return bytes(s) <= 1400 ? s : null;
}
function robotPayload(id) {
  if (BB.PRESETS[id]) return id;
  try { return cleanSpec(S().lib.get(id)) || 'turret'; } catch (e) { return 'turret'; }
}
function sanitizeRobot(r) {
  if (typeof r === 'string') return BB.PRESETS[r] ? r : 'turret';
  if (!r || typeof r !== 'object' || Array.isArray(r) || !r.body || !r.drive) return 'turret';
  try { return cleanSpec(r) || 'turret'; } catch (e) { return 'turret'; }
}
function specOf(p) { return typeof p === 'string' ? BB.presetSpec(p) : BB.normalizeSpec(p); }
// an AUTO travels as a routine name or as a team plan in its compact form (capped so the room presence stays small)
const ROUTINE_KEYS = ['full', 'preload', 'leave', 'none', 'manual'];
function autoPayload(sel) {
  const c = S().autoChoice(sel);
  if (c.routine !== 'plan') return c.routine;
  try { const cp = root.BBAI.PLAN.compact(c.plan); return bytes(cp) <= 700 ? cp : 'full'; } catch (e) { return 'full'; }
}
function sanitizeAuto(a) {
  if (typeof a === 'string' || a === undefined || a === null) return ROUTINE_KEYS.includes(a) ? a : 'full';
  try { const cp = root.BBAI.PLAN.compact(root.BBAI.PLAN.expand(a)); return bytes(cp) <= 700 ? cp : 'full'; } catch (e) { return 'full'; }
}
NET.sanitizeAuto = sanitizeAuto;
function partnerKey(p) { const s = specOf(p); return s.flower && s.flower.arm !== 'none' ? 'speed' : 'flower'; }
function errText(e) {
  const c = e && e.code;
  if (c === 'not_permitted') return 'Tài khoản này không được dùng phòng chơi ở trang này.';
  if (c === 'limit_reached') return 'Đang mở quá nhiều phòng, thử lại sau ít phút.';
  if (c === 'not_granted' || c === 'revoked') return 'Trình xem này không kết nối được phòng chơi (cần đăng nhập và được chia sẻ trang).';
  return 'Không kết nối được phòng chơi, thử lại.';
}
function setStatus(t, bad) { NET.status = t; const el = $('olStatus'); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); } }

// ------------------------------------------------------------------ room access (fails soft: the page works alone)
NET.getLobby = async function () {
  if (NET.lobby) return NET.lobby;
  const c = root.claude;
  if (!c || typeof c.use !== 'function') return null;
  if (!NET.lobbyP) NET.lobbyP = Promise.resolve().then(() => c.use('room')).catch(() => null);
  const room = await NET.lobbyP;
  if (room) NET.lobby = room; else NET.lobbyP = null;          // null can be temporary: ask again next time
  return room;
};
NET.probe = async function () {
  const box = $('olAvail'); if (!box) return;
  if (NET.role) { box.hidden = true; return; }
  box.hidden = false; box.textContent = 'Đang kiểm tra kết nối phòng chơi…'; box.className = 'ol-avail';
  const lobby = await NET.getLobby();
  if (!lobby) {
    box.textContent = 'Chơi online chỉ chạy khi trang mở trong Claude, bạn đã đăng nhập và người kia được bạn chia sẻ trang (người vào bằng link công khai không kết nối được). Các chế độ khác vẫn chơi bình thường.';
    box.className = 'ol-avail bad'; $('olCreate').disabled = true; $('olJoin').disabled = true; return;
  }
  box.textContent = 'Sẵn sàng. Tạo phòng rồi gửi mã 4 ký tự cho bạn cùng chơi.'; box.className = 'ol-avail ok';
  $('olCreate').disabled = false; $('olJoin').disabled = false;
};
async function pres(patch) {
  if (!NET.room) return;
  NET.mine = Object.assign({}, NET.mine || {}, patch);
  for (const k in patch) if (patch[k] === null) delete NET.mine[k];
  try { await NET.room.presence(patch); }
  catch (e) {
    if (e && e.code === 'invalid_argument') { NET.tooBig = (NET.tooBig || 0) + 1; if (NET.tooBig === 1 && root.console) console.warn('room presence refused:', e.message); }
  }
}
function watch(room) {
  NET.unsub = [room.onPeers(() => { readPeers(); NET.renderLobby(); }, e => { setStatus(errText(e), true); }), room.onConnection(c => { NET.connected = c; NET.renderLobby(); })];
}
function readPeers() {
  const room = NET.room; if (!room) return;
  const list = room.peers().filter(p => !p.isMe && p.kind === 'viewer' && p.presence && p.presence.app === APP && p.presence.v === VER);
  const now = performance.now();
  if (NET.role === 'guest') {
    const hp = list.find(p => p.presence.role === 'host' && (!NET.hostPeerId || p.peer === NET.hostPeerId)) || null;
    if (hp && !NET.hostPeerId) NET.hostPeerId = hp.peer;
    // a reconnect can drop a peer for a moment: give it a few seconds before calling the room closed
    if (!hp && NET.hadHost) { if (!NET.hostMissing) NET.hostMissing = now; else if (now - NET.hostMissing > 4000) hostGone(); return; }
    NET.hostMissing = 0;
    if (hp) NET.hadHost = true;
    NET.hostPeer = hp;
    NET.others = list.filter(p => p.presence.role === 'guest');
  } else if (NET.role === 'host') {
    const guests = list.filter(p => p.presence.role === 'guest');
    const want = NET.guestPeer ? NET.guestPeer.peer : NET.inMatch() ? NET.guestPeerId : null;
    const cur = want ? guests.find(p => p.peer === want) : null;
    if (cur) { NET.guestPeer = cur; NET.guestMissing = 0; }
    else if (NET.guestPeer) {
      if (!NET.guestMissing) NET.guestMissing = now;
      else if (now - NET.guestMissing > 4000) { const before = NET.guestPeer; NET.guestPeer = null; NET.guestMissing = 0; guestGone(before); }
    }
    if (!NET.guestPeer && !NET.inMatch()) NET.guestPeer = guests[0] || null;
    NET.others = guests.filter(p => !NET.guestPeer || p.peer !== NET.guestPeer.peer);
  }
}
NET.inMatch = () => S().lastKind === 'online' && (S().mode === 'play' || S().mode === 'results') && !!NET.setup;

// ------------------------------------------------------------------ create / join / leave
NET.create = async function () {
  AU.unlock(); setStatus('Đang tạo phòng…');
  const lobby = await NET.getLobby(); if (!lobby) { setStatus('Không kết nối được phòng chơi ở trình xem này.', true); return; }
  const code = randomCode();
  let room; try { room = await lobby.join('bbz-' + code); } catch (e) { setStatus(errText(e), true); return; }
  NET.room = room; NET.role = 'host'; NET.code = code; NET.gid = 0; NET.setup = null; NET.mine = {}; NET.guestPeer = null;
  watch(room);
  await pres({ app: APP, v: VER, role: 'host', name: myName(), st: 'lobby', cfg: lobbyCfg() });
  setStatus('Đã tạo phòng. Gửi mã cho người chơi cùng.');
  NET.renderLobby();
};
NET.join = async function (raw) {
  AU.unlock();
  const code = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (code.length !== 4) { setStatus('Mã phòng gồm 4 ký tự.', true); return; }
  setStatus('Đang vào phòng ' + code.toUpperCase() + '…');
  const lobby = await NET.getLobby(); if (!lobby) { setStatus('Không kết nối được phòng chơi ở trình xem này.', true); return; }
  let room; try { room = await lobby.join('bbz-' + code); } catch (e) { setStatus(errText(e), true); return; }
  NET.room = room; NET.role = 'guest'; NET.code = code; NET.mine = {}; NET.hadHost = false; NET.hostPeer = null; NET.hostPeerId = null; NET.hostMissing = 0; NET.G = null; NET.leftGid = 0; NET.badGid = 0;
  watch(room);
  await pres({ app: APP, v: VER, role: 'guest', name: myName(), team: String(S().set.team || '2222').slice(0, 5), robot: robotPayload(S().set.olRobot), auto: autoPayload(S().set.olAuto), gid: 0 });
  NET.joinT = performance.now();
  NET.renderLobby();
  // no host after a few seconds: a wrong code
  setTimeout(() => { if (NET.role === 'guest' && NET.code === code && !NET.hadHost) { readPeers(); if (!NET.hadHost) { NET.leave(true); setStatus('Không thấy phòng ' + code.toUpperCase() + '. Kiểm tra lại mã.', true); } } }, 6000);
};
NET.leave = function (silent) {
  const room = NET.room;
  if (NET.unsub) NET.unsub.forEach(u => { try { u(); } catch (e) { /* gone */ } });
  NET.unsub = null;
  if (room) room.leave().catch(() => {});
  Object.assign(NET, { role: null, room: null, code: '', setup: null, G: null, guestPeer: null, hostPeer: null, hostPeerId: null, hostMissing: 0, guestMissing: 0, guestPeerId: null, others: [], ev: [], mine: {}, leftGid: 0, badGid: 0 });
  S().online = null;
  const again = $('btnAgain'); if (again) { again.disabled = false; again.textContent = 'Đấu lại'; }
  NET.guestMenu(false);
  if (!silent) setStatus('Đã rời phòng.');
  NET.renderLobby();
};
function hostGone() {
  const mode = S().mode;
  NET.leave(true);
  if (mode === 'guest' || mode === 'guestResults') { S().startAttract(); root.BBUI.show('online'); }
  setStatus('Chủ phòng đã rời phòng.', true);
}
function guestGone(peer) {
  const st = S(), name = cleanName(peer.presence && peer.presence.name);
  if (st.lastKind === 'online' && st.sim) {
    const h = st.humans.find(q => q.remote);
    if (h && !h.gone && (st.mode === 'play' || st.mode === 'results')) { h.gone = true; H().toast(`${name} đã rời phòng: bot lái thay`, 'f'); }
  }
  NET.renderLobby();
}
function lobbyCfg() { const s = S().set; return { mode: s.olMode, bots: s.olBots, robot: robotPayload(s.olRobot), team: String(s.team || '1111').slice(0, 5) }; }
NET.cfgChanged = function () {
  if (NET.role === 'host' && !NET.inMatch()) pres({ cfg: lobbyCfg(), name: myName() });
  if (NET.role === 'guest') pres({ robot: robotPayload(S().set.olRobot), auto: autoPayload(S().set.olAuto), name: myName(), team: String(S().set.team || '2222').slice(0, 5) });
  NET.renderLobby();
};

// ------------------------------------------------------------------ lobby view
function robotName(p) { try { return specOf(p).name; } catch (e) { return '?'; } }
NET.renderLobby = function () {
  const idle = $('olIdle'), lob = $('olLobby'); if (!idle || !lob) return;
  idle.hidden = !!NET.role; lob.hidden = !NET.role;
  if (!NET.role) return;
  $('olRoomCode').textContent = NET.code.toUpperCase();
  const set = S().set, rows = [];
  const modeTxt = m => (m === 'coop' ? 'cùng đội' : 'đối đầu');
  const botTxt = b => ({ none: 'không bot', easy: 'bot dễ', normal: 'bot vừa', hard: 'bot khó' })[b] || '';
  if (NET.role === 'host') {
    rows.push(`<li class="me"><b>${esc(myName())}</b> · chủ phòng · ${esc(robotName(robotPayload(set.olRobot)))}</li>`);
    if (NET.guestPeer) rows.push(`<li><b>${esc(cleanName(NET.guestPeer.presence.name))}</b> · ${esc(robotName(sanitizeRobot(NET.guestPeer.presence.robot)))}${NET.guestPeer.guest ? ' · khách' : ''}</li>`);
    for (const o of NET.others) rows.push(`<li class="dim">${esc(cleanName(o.presence.name))} · đang xem</li>`);
    $('olWait').textContent = NET.guestPeer ? `Trận ${modeTxt(set.olMode)}, ${botTxt(set.olBots)}. Bạn lái ĐỎ 1${set.olMode === 'coop' ? ', người kia ĐỎ 2' : ', người kia XANH 1'}.` : 'Đang chờ người chơi thứ hai vào bằng mã phòng…';
    $('olStart').hidden = false; $('olStart').disabled = !NET.guestPeer || !NET.connected;
  } else {
    const hp = NET.hostPeer, cfg = hp && hp.presence.cfg;
    if (hp) rows.push(`<li><b>${esc(cleanName(hp.presence.name))}</b> · chủ phòng${cfg ? ' · ' + esc(robotName(sanitizeRobot(cfg.robot))) : ''}</li>`);
    rows.push(`<li class="me"><b>${esc(myName())}</b> · bạn · ${esc(robotName(robotPayload(set.olRobot)))}</li>`);
    $('olWait').textContent = !hp ? 'Đang tìm chủ phòng…' : cfg ? `Chủ phòng chọn: trận ${modeTxt(cfg.mode)}, ${botTxt(cfg.bots)}. Chờ chủ phòng bấm Bắt đầu.` : 'Chờ chủ phòng bấm Bắt đầu.';
    $('olStart').hidden = true;
  }
  $('olPeers').innerHTML = rows.join('');
  $('olConn').textContent = NET.connected ? 'đã kết nối' : 'đang kết nối…';
  $('olConn').className = 'ol-conn' + (NET.connected ? ' ok' : '');
};

// ------------------------------------------------------------------ host: match, snapshots, events, remote input
NET.startMatch = function () {
  if (NET.role !== 'host') return;
  readPeers();
  const gp = NET.guestPeer; if (!gp) { setStatus('Chưa có người chơi thứ hai.', true); return; }
  const set = S().set, mode = set.olMode === 'coop' ? 'coop' : 'versus', bots = OPP[set.olBots] ? set.olBots : 'none';
  const hostSpec = robotPayload(set.olRobot), guestSpec = sanitizeRobot(gp.presence.robot);
  const tH = String(set.team || '1111').replace(/\D/g, '').slice(0, 5) || '1111', tG = String(gp.presence.team || '2222').replace(/\D/g, '').slice(0, 5) || '2222';
  const hostAuto = autoPayload(set.olAuto), guestAuto = sanitizeAuto(gp.presence.auto);
  const robots = [{ al: 'R', slot: 0, spec: hostSpec, team: tH, start: 'audience', who: 'h', auto: hostAuto }];
  if (mode === 'coop') {
    robots.push({ al: 'R', slot: 1, spec: guestSpec, team: tG === tH ? '2222' : tG, start: 'alliance', who: 'g', auto: guestAuto });
    if (bots !== 'none') robots.push({ al: 'B', slot: 0, spec: OPP[bots][0], team: '3141', start: 'audience', skill: bots }, { al: 'B', slot: 1, spec: OPP[bots][1], team: '5927', start: 'alliance', skill: bots });
  } else {
    robots.push({ al: 'B', slot: 0, spec: guestSpec, team: tG === tH ? '2222' : tG, start: 'audience', who: 'g', auto: guestAuto });
    if (bots !== 'none') robots.push({ al: 'R', slot: 1, spec: partnerKey(hostSpec), team: '8081', start: 'alliance', skill: bots }, { al: 'B', slot: 1, spec: partnerKey(guestSpec), team: '5927', start: 'alliance', skill: bots });
  }
  NET.gid++;
  NET.setup = { gid: NET.gid, seed: (Math.random() * 1e9) | 0, mode, bots, fouls: 1, tip: 8, robots, names: { h: myName(), g: cleanName(gp.presence.name) } };
  // the whole setup rides in the host's presence next to the snapshots: team plans give way first if it gets too big
  if (bytes(NET.setup) > 2600) { robots.forEach(r => { if (r.auto && typeof r.auto === 'object') r.auto = 'full'; }); setStatus('Robot + chương trình AUTO quá lớn để gửi qua phòng: trận này dùng AUTO mặc định.', true); }
  NET.guestPeerId = gp.peer;
  S().online = NET.setup;
  NET.ev = []; NET.evSeq = 0; NET.snapSeq = 0; NET.lastSend = 0; NET.lastHp = undefined; NET.acked = false;
  S().start('online');
  const rh = S().humans.find(h => h.remote); if (rh) { rh.name = NET.setup.names.g; H().setup(); }
  NET.n0 = S().sim.balls.length;
  NET.sendSnapshot(true);
};
NET.rematch = function () {
  if (NET.role !== 'host') return;
  readPeers();
  if (NET.guestPeer) NET.startMatch();
  else { NET.toLobby(); S().startAttract(); root.BBUI.show('online'); setStatus('Người chơi thứ hai đã rời. Chờ người mới vào phòng.', true); }
};
// back to the room's lobby without leaving the room
NET.toLobby = function () {
  if (NET.role === 'host') {
    NET.setup = null; S().online = null;
    pres({ st: 'lobby', s: null, fin: null, setup: null, ev: null, bx: null, gp: null, cd: null, cfg: lobbyCfg(), name: myName() });
  } else if (NET.role === 'guest') {
    NET.leftGid = NET.G ? NET.G.gid : NET.leftGid || 0; NET.G = null;
  }
  const again = $('btnAgain'); if (again) { again.disabled = false; again.textContent = 'Đấu lại'; }
  NET.guestMenu(false);
  NET.renderLobby();
};
NET.tick = function () {
  if (NET.role === 'host') { NET.hostFrame(); return; }
  if (NET.role === 'guest' && S().mode === 'menu') {
    readPeers();
    const pr = NET.hostPeer && NET.hostPeer.presence;
    if (pr && pr.st !== 'lobby' && pr.setup && (pr.setup.gid | 0) > (NET.leftGid || 0) && (pr.setup.gid | 0) !== NET.badGid) guestBuild(pr.setup, pr.gp);
  }
};
// the host's setup is untrusted: check its shape before building anything from it
function validSetup(su) {
  if (!su || typeof su !== 'object' || !Array.isArray(su.robots) || su.robots.length < 1 || su.robots.length > 4) return false;
  const seen = new Set(); let g = 0;
  for (const r of su.robots) {
    if (!r || (r.al !== 'R' && r.al !== 'B') || (r.slot !== 0 && r.slot !== 1)) return false;
    const k = r.al + r.slot; if (seen.has(k)) return false; seen.add(k);
    if (r.who === 'g') g++;
    if (r.who !== undefined && r.who !== 'h' && r.who !== 'g') return false;
  }
  return g === 1 && (su.gid | 0) > 0;
}
function cleanSetup(su) {
  return { gid: su.gid | 0, seed: su.seed | 0, fouls: su.fouls ? 1 : 0, tip: Math.max(6, Math.min(11, su.tip | 0 || 8)), mode: su.mode === 'coop' ? 'coop' : 'versus',
    names: { h: cleanName(su.names && su.names.h), g: cleanName(su.names && su.names.g) },
    robots: su.robots.map(r => ({ al: r.al, slot: r.slot, spec: sanitizeRobot(r.spec), team: String(r.team || '').replace(/\D/g, '').slice(0, 5) || '0000', start: ['audience', 'alliance', 'far'].includes(r.start) ? r.start : 'audience', who: r.who, skill: ['easy', 'normal', 'hard'].includes(r.skill) ? r.skill : 'normal', auto: r.who ? sanitizeAuto(r.auto) : 'full' })) };
}
NET.hostPaused = function () { NET.lastSend = 0; };
NET.hostEvent = function (e) {
  if (NET.role !== 'host' || !NET.setup) return;
  const st = S(), gid = (st.humans.find(h => h.remote) || {}).id;
  let rec = null;
  const al = a => (a === 'B' ? 1 : 0);
  switch (e.type) {
    case 'phase': rec = [EV.phase, PHASES.indexOf(e.phase)]; break;
    case 'pickup': rec = [EV.pickup]; break;
    case 'lastMinute': rec = [EV.lastMinute]; break;
    case 'tip': if (e.counted) rec = [EV.tip, al(e.alliance), e.auto ? 1 : 0]; break;
    case 'foul': rec = [EV.foul, al(e.alliance), e.kind === 'major' ? 1 : 0, String(e.rule || '').slice(0, 8), String(e.text || '').slice(0, 90)]; break;
    case 'rule': if (e.robot === gid) rec = [EV.rule, String(e.text || '').slice(0, 90)]; break;
    case 'fire': rec = [EV.fire, e.robot]; break;
    case 'made': rec = [EV.made, e.robot, Math.round(e.x * 10), Math.round(e.y * 10), Math.round(e.z * 10), al(e.alliance)]; break;
    case 'intake': if (e.robot === gid) rec = [EV.intake]; break;
    case 'dunkStart': if (e.robot === gid) rec = [EV.dunkStart]; break;
    case 'dunk': rec = [EV.dunk, e.robot, e.flower, e.bt]; break;
    case 'nectarIn': rec = [EV.nectarIn, al(e.alliance), e.left]; break;
    case 'out': rec = [EV.out, e.bt]; break;
    case 'hpBlocked': rec = [EV.hpBlocked, al(e.alliance), e.why === 'empty' ? 0 : 1]; break;
  }
  if (!rec) return;
  NET.ev.push([++NET.evSeq].concat(rec));
  if (NET.ev.length > 12) NET.ev.shift();
};
function finPayload(sim) {
  const pick = d => ({ leave: d.leave, autoPark: d.autoPark, autoTip: d.autoTip, teleTip: d.teleTip, cell: d.cell, flower: d.flower, bottom: d.bottom, garden: d.garden, telePark: d.telePark, foul: d.foul, total: d.total, tips: d.tips, rpTotal: d.rpTotal, rp: d.rp });
  return { f: { R: pick(sim.final.R), B: pick(sim.final.B) }, rs: sim.robots.map(r => [r.stats.shots, r.stats.made, r.stats.pickups, r.stats.dunks, r.stats.fouls, Math.round(r.stats.dist)]),
    fl: sim.foulLog.slice(-10).map(f => ({ rule: String(f.rule).slice(0, 8), kind: f.kind, alliance: f.alliance, text: String(f.text || '').slice(0, 90), t: Math.round(f.t || 0) })) };
}
NET.sendSnapshot = function (force) {
  const st = S(), sim = st.sim, now = performance.now();
  if (!force && now - NET.lastSend < SNAP_MS) return;
  NET.lastSend = now;
  if (!NET.setup || st.lastKind !== 'online' || !sim) return;
  const done = st.mode === 'results';
  const patch = { st: done ? 'done' : st.paused ? 'paused' : 'play', gid: NET.gid, sq: ++NET.snapSeq, c: Math.round(now), e: NET.lastTg || 0,
    ev: NET.ev.slice(-10), cd: st.countdown > 0 ? Math.ceil(st.countdown) : 0, gp: NET.guestPeerId || null };
  const f = RP.capture(sim, root.BBREC.sc);
  patch.s = RP.pack(f, sim.robots.length);
  patch.bx = sim.balls.slice(NET.n0).map(b => b.bt);
  patch.setup = NET.setup; patch.cfg = null;
  patch.fin = done && sim.final ? finPayload(sim) : null;
  // keep inside the 4 KiB presence: drop what a guest already has, then trim
  let merged = Object.assign({}, NET.mine, patch);
  if (bytes(merged) > 3900 && NET.acked) { patch.setup = null; merged = Object.assign({}, NET.mine, patch); delete merged.setup; }
  if (bytes(merged) > 3900) { patch.ev = patch.ev.slice(-4); merged.ev = patch.ev; }
  if (bytes(merged) > 3900 && done) { patch.s = null; delete merged.s; }
  pres(patch);
};
NET.hostFrame = function () {
  if (NET.role !== 'host' || !NET.room) return;
  readPeers();
  const gp = NET.guestPeer && NET.guestPeer.presence;
  if (gp && gp.gid === NET.gid && NET.gid) { NET.acked = true; if (+gp.tg) NET.lastTg = +gp.tg; }
  // a guest who stops sending (menu open, tab hidden) hands the robot to the bot until input comes back
  const st = S(), h = st.lastKind === 'online' ? st.humans.find(q => q.remote) : null;
  if (h && st.mode === 'play' && st.sim && (st.sim.phase === 'tele' || st.sim.phase === 'trans') && !st.paused) {
    const live = !!(NET.guestPeer && Array.isArray(gp.i) && gp.gid === NET.gid && Date.now() - NET.guestPeer.updatedAt < 1500);
    const now = performance.now();
    if (live) { h.idleSince = 0; if (h.gone) { h.gone = false; H().toast(`${h.name || 'Người chơi 2'} lái lại`, 'g'); } }
    else if (!h.idleSince) h.idleSince = now;
    else if (!h.gone && now - h.idleSince > 3000) { h.gone = true; H().toast(`${h.name || 'Người chơi 2'} không gửi tay lái: bot lái tạm`, 'f'); }
  }
  if (NET.inMatch()) NET.sendSnapshot(false);
};
// the guest's latest input, as the same shape the local controls produce
NET.remoteInput = function (h) {
  const gp = NET.guestPeer; if (!gp || h.gone) return null;
  const pr = gp.presence, a = pr.i;
  if (!Array.isArray(a) || pr.gid !== NET.gid) return null;
  if (Date.now() - gp.updatedAt > 1500) return null;                 // stale (updatedAt is the viewer's Date.now clock): stop the robot
  const bits = a[5] | 0, hold = {}, press = {};
  HOLD_BITS.forEach((k, i) => { if (bits & (1 << i)) hold[k] = true; });
  const hpN = a[6] | 0; if (NET.lastHp !== undefined && hpN !== NET.lastHp) press.hp = true; NET.lastHp = hpN;
  NET.lastTg = +pr.tg || 0;
  let fx = (a[3] | 0) / 1000, fy = (a[4] | 0) / 1000; const L = Math.hypot(fx, fy); if (L > 0.01) { fx /= L; fy /= L; } else { fx = h.frameFx || 1; fy = 0; }
  const mx = clamp1((a[0] | 0) / 100), my = clamp1((a[1] | 0) / 100), turn = clamp1((a[2] | 0) / 100), shootV = Math.max(0, clamp1((a[7] | 0) / 100));
  return { mx, my, turn, hold, press, shootV, any: !!(mx || my || turn || bits & 255 || press.hp), frame: { fx, fy, rx: fy, ry: -fx },
    robotFrame: !!(bits & B_ROBOT), autoFire: !!(bits & B_AUTOFIRE), turretLock: !!(bits & B_TLOCK), aimAssist: !!(bits & B_ASSIST), turretFast: !!(bits & B_TFAST) };
};
NET.hostDone = function () { if (NET.role === 'host') NET.sendSnapshot(true); };

// ------------------------------------------------------------------ guest: build from setup, send input, draw snapshots
function guestBuild(raw, gp) {
  const st = S();
  if (!validSetup(raw)) { NET.badGid = raw && raw.gid | 0; setStatus('Chủ phòng gửi trận không hợp lệ.', true); return; }
  const setup = cleanSetup(raw);
  let M, sim;
  try { M = st.matchFromSetup(setup, 'guest'); sim = st.createSimFrom(M); }
  catch (e) { NET.badGid = setup.gid; setStatus('Không dựng được trận của chủ phòng.', true); return; }
  if (!st.humans.length || st.humans[0].remote) { NET.badGid = setup.gid; return; }
  const rh = st.humans.find(h => h.remote); if (rh) rh.name = cleanName(setup.names && setup.names.h);
  R.build(sim);
  st.sim = sim; st.mode = 'guest'; st.paused = false; st.lastKind = 'online'; st.match = M;
  const mePeer = NET.room ? NET.room.peers().find(p => p.isMe && p.sameTab) : null;
  const spectator = !!(gp && mePeer && gp !== mePeer.peer);
  st.cam = spectator ? 'broadcast' : st.set.cam || 'driver'; st.showTag = false; st.hideUI = false; st.details = false;
  const view = RP.makeView(sim); view.bts = sim.balls.map(b => b.bt);
  NET.G = { spectator, gid: setup.gid, setup, sim, view, n0: sim.balls.length, myId: st.humans[0].id, buf: [], off: null, offT: 0, lastSq: 0, lastEv: 0, lastIn: 0, field: st.set.driveMode === 'field', autoFire: !!st.set.autoFire, tlock: false, intake: true, hpN: 0,
    rtt: 0, hz: 0, hzN: 0, hzT: performance.now(), lastCd: 0, st: '', resultsShown: false, panel: null };
  if (root.BBFX) root.BBFX.reset();
  $('menu').hidden = true; $('results').hidden = true; $('pause').hidden = true; $('hud').hidden = false;
  H().setup();
  $('panels').replaceChildren(); $('pips').replaceChildren(); $('flowerPanel').hidden = true;
  if (!spectator) $('panels').replaceChildren(guestPanel());
  $('btnReset').hidden = true;
  R.setAimMap(null);
  const me = view.robots[NET.G.myId];
  R.updateCamera(view, st.cam, me, me.alliance, 0, true);
  pres({ gid: setup.gid });
  H().banner(spectator ? 'ĐANG XEM' : 'ONLINE', 'phòng ' + NET.code.toUpperCase() + (spectator ? ' · trận đang diễn ra' : ' · chuẩn bị'));
}
function guestPanel() {
  const el = document.createElement('div'); el.className = 'rp olp';
  el.innerHTML = `<div class="rp-head"><span class="rp-name" id="olpName"></span><span class="badge ok">ONLINE</span></div>
    <div class="rp-sub"><span class="rp-slot" id="olpSlot"></span></div>
    <div class="rp-row"><span class="hopper" id="olpHop"><i></i><i></i><i></i><i></i></span><span class="chips" id="olpChips"></span></div>
    <div class="olp-sh" id="olpSh"></div>
    <div class="rp-stats"><div class="st"><span class="k">Vào/bắn</span><b id="olpShots">0/0</b></div><div class="st"><span class="k">Pin</span><b id="olpBat">12.6 V</b></div><div class="st"><span class="k">Ping</span><b id="olpPing">–</b></div><div class="st"><span class="k">Hình</span><b id="olpHz">–</b></div></div>`;
  NET.G.panel = el;
  return el;
}
function guestInput() {
  const st = S(), G = NET.G, set = st.set;
  const inp = IN.player('kbA+gp0+gp1', 'both');
  const HUD = H();
  if (inp.press.driveMode) { G.field = !G.field; HUD.toast(G.field ? 'Lái theo sân' : 'Lái theo đầu robot'); }
  if (inp.press.autoFire) { G.autoFire = !G.autoFire; HUD.toast('Tự bắn khi khóa: ' + (G.autoFire ? 'BẬT' : 'TẮT')); AU.sfxs.toggle(G.autoFire); }
  if (inp.press.turretLock) { G.tlock = !G.tlock; HUD.toast(G.tlock ? 'Turret khóa tay: dùng nút xoay turret' : 'Turret tự bám tag'); AU.sfxs.toggle(G.tlock); }
  if (inp.press.hp) G.hpN = (G.hpN + 1) % 1000;
  let intake = true;
  if (set.intakeMode === 'toggle') { if (inp.press.intake) { G.intake = !G.intake; AU.sfxs.toggle(G.intake); } intake = G.intake; }
  else if (set.intakeMode === 'hold') intake = !!inp.hold.intake;
  let bits = 0;
  HOLD_BITS.forEach((k, i) => { if (k === 'intake' ? intake : inp.hold[k]) bits |= 1 << i; });
  if (G.autoFire) bits |= B_AUTOFIRE; if (G.tlock) bits |= B_TLOCK; if (set.aimAssist === 'on') bits |= B_ASSIST; if (set.turretResp === 'fast') bits |= B_TFAST; if (!G.field) bits |= B_ROBOT;
  let mx = inp.mx, my = inp.my; const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
  const f = G.field ? R.driveFrame(st.cam, G.view.robots[G.myId]) : { fx: 0, fy: 0 };
  return [Math.round(mx * 100), Math.round(my * 100), Math.round(inp.turn * 100), Math.round(f.fx * 1000), Math.round(f.fy * 1000), bits, G.hpN, Math.round(Math.max(0, inp.shootV) * 100)];
}
function guestEvents(list) {
  const G = NET.G, HUD = H(), me = G.myId, myAl = G.view.robots[me].alliance;
  const AL = i => (i ? 'B' : 'R'), ALN = i => (i ? 'XANH' : 'ĐỎ');
  for (const e of list.slice(-12)) {
    if (!Array.isArray(e) || (e[0] | 0) <= G.lastEv) continue;
    G.lastEv = e[0] | 0;
    switch (e[1]) {
      case EV.phase: {
        const ph = PHASES[e[2] | 0];
        if (ph === 'auto') { HUD.banner('AUTO', 'robot chạy chương trình 30 giây'); AU.cue.start(); }
        if (ph === 'trans') { HUD.banner('HẾT AUTO', 'TELEOP sau 8 giây · đặt tay lên cần'); AU.cue.autoEnd(); }
        if (ph === 'tele') { HUD.banner('TELEOP', 'cầm lái!'); AU.cue.tele(); IN.rumble('gp0+gp1', 0.4, 0.4, 180); }
        if (ph === 'end') { HUD.banner('HẾT GIỜ', 'chờ bóng dừng để chấm điểm'); AU.cue.end(); }
        break;
      }
      case EV.pickup: AU.say('Drivers, pick up your controllers.'); HUD.toast('Drivers, pick up your controllers', 'g'); break;
      case EV.lastMinute: HUD.banner('1:00', 'FLOWER bắt đầu tính · human player đưa hết NECTAR'); AU.cue.endgame(); break;
      case EV.tip: HUD.toast(`HIVE ${ALN(e[2])} TIP! +20${e[3] ? ' (AUTO)' : ''}`, e[2] ? 'b' : 'r'); AU.sfxs.tip(AL(e[2]) === myAl); if (root.BBFX) root.BBFX.tip(AL(e[2])); break;
      case EV.foul: HUD.toast(`${String(e[4]).slice(0, 8)} · ${e[3] ? 'MAJOR' : 'MINOR'} ${ALN(e[2])}: ${String(e[5]).slice(0, 90)}`, 'f'); AU.cue.foul(); break;
      case EV.rule: HUD.toast(String(e[2]).slice(0, 90), 'f'); break;
      case EV.fire: if ((e[2] | 0) === me) { AU.sfxs.shot(1); IN.rumble('gp0+gp1', 0.15, 0.35, 60); } else AU.sfxs.shot(0.35); break;
      case EV.made: if ((e[2] | 0) === me) AU.sfxs.made(); if (root.BBFX && isFinite(e[3]) && isFinite(e[4]) && isFinite(e[5])) root.BBFX.made(Math.max(-80, Math.min(80, e[3] / 10)), Math.max(-80, Math.min(80, e[4] / 10)), Math.max(0, Math.min(90, e[5] / 10)), AL(e[6])); break;
      case EV.intake: AU.sfxs.intake(); break;
      case EV.dunkStart: AU.sfxs.arm(); break;
      case EV.dunk: if ((e[2] | 0) === me) AU.sfxs.dunk(); break;
      case EV.nectarIn: if (AL(e[2]) === myAl) { HUD.toast(`Human player đưa NECTAR vào LOADING ZONE (còn ${e[3]})`, e[2] ? 'b' : 'r'); AU.sfxs.nectar(); } break;
      case EV.out: HUD.toast(e[2] === 0 ? 'POLLEN văng khỏi sân: đặt lại sau 2 giây (10.8.2)' : 'NECTAR văng khỏi sân: trả về human player'); break;
      case EV.hpBlocked: if (AL(e[2]) === myAl) HUD.toast(e[3] ? 'LOADING ZONE không còn chỗ trống để đặt NECTAR' : 'Human player đã hết NECTAR', 'f'); break;
    }
  }
}
function cleanFinal(d) {
  d = d && typeof d === 'object' ? d : {};
  const o = {}; for (const k of ['leave', 'autoPark', 'autoTip', 'teleTip', 'cell', 'flower', 'bottom', 'garden', 'telePark', 'foul', 'total', 'tips', 'rpTotal']) o[k] = d[k] | 0;
  const rp = d.rp && typeof d.rp === 'object' ? d.rp : {};
  o.rp = { win: (rp.win | 0) === 3 ? 3 : (rp.win | 0) === 1 ? 1 : 0, swarm: rp.swarm ? 1 : 0, poll1: rp.poll1 ? 1 : 0, poll2: rp.poll2 ? 1 : 0 };
  return o;
}
function guestResults(fin) {
  const st = S(), G = NET.G, sim = G.sim;
  if (!fin || typeof fin !== 'object' || !fin.f || typeof fin.f !== 'object') return;
  sim.final = { R: cleanFinal(fin.f.R), B: cleanFinal(fin.f.B) };
  (Array.isArray(fin.rs) ? fin.rs : []).forEach((a, i) => { const r = sim.robots[i]; if (r && Array.isArray(a)) Object.assign(r.stats, { shots: a[0] | 0, made: a[1] | 0, pickups: a[2] | 0, dunks: a[3] | 0, fouls: a[4] | 0, dist: Math.max(0, +a[5] || 0) }); });
  sim.foulLog = (Array.isArray(fin.fl) ? fin.fl : []).slice(0, 12).map(f => ({ rule: String(f && f.rule || '').replace(/[^A-Za-z0-9.]/g, '').slice(0, 8), kind: f && f.kind === 'major' ? 'major' : 'minor', alliance: f && f.alliance === 'B' ? 'B' : 'R', text: String(f && f.text || '').slice(0, 90), t: +(f && f.t) || 0 }));
  st.mode = 'guestResults';
  H().results();
  const again = $('btnAgain'); again.disabled = true; again.textContent = 'Chờ chủ phòng…';
  $('btnMenu2').focus();
  if (root.BBFX) root.BBFX.celebrate(fin.f);
}
NET.guestMenu = function (open) {
  $('btnRestart').hidden = open; $('btnReplayPause').hidden = open; $('btnReset').hidden = true;
  if (open) { $('pause').querySelector('h2').textContent = 'Online · phòng ' + NET.code.toUpperCase(); $('btnResume').textContent = 'Chơi tiếp'; $('btnMenu').textContent = 'Về phòng chờ'; $('btnResume').focus(); }
  else { $('pause').querySelector('h2').textContent = 'Tạm dừng'; $('btnResume').textContent = 'Tiếp tục'; $('btnMenu').textContent = 'Về menu'; $('btnRestart').hidden = false; $('btnReplayPause').hidden = false; }
};
const CAMS = ['driver', 'follow', 'broadcast', 'top', 'pov', 'free'];
NET.guestFrame = function (dt) {
  const st = S(), G = NET.G;
  if (!G || !NET.room) { st.startAttract(); root.BBUI.show('online'); return; }   // the room is gone: back to the online screen
  const now = performance.now();
  readPeers();
  if (NET.role !== 'guest') return;                                   // left while reading
  const hp = NET.hostPeer, pr = hp && hp.presence;
  // a new match from the host
  if (pr && pr.setup && (pr.setup.gid | 0) > G.gid && (pr.setup.gid | 0) !== NET.badGid) { guestBuild(pr.setup, pr.gp); return; }
  // the host went back to its lobby: follow it there
  if (pr && pr.st === 'lobby') { NET.toLobby(); st.startAttract(); root.BBUI.show('online'); setStatus('Chủ phòng đã về phòng chờ.'); return; }
  // snapshots
  if (pr && pr.gid === G.gid && Array.isArray(pr.s) && pr.sq !== G.lastSq) {
    G.lastSq = pr.sq;
    const f = RP.unpack(pr.s, G.view.robots.length);
    if (f) {
      if (Array.isArray(pr.bx)) for (let i = 0; i < pr.bx.length && i < 64; i++) G.view.bts[G.n0 + i] = Math.max(0, Math.min(2, pr.bx[i] | 0));
      const off = now - (+pr.c || 0);
      G.off = G.off === null ? off : Math.min(off, G.off + 0.02 * dt * 1000);    // lowest delay seen, drifting up slowly
      G.buf.push({ c: +pr.c || 0, f }); if (G.buf.length > 40) G.buf.shift();
      if (pr.e) G.rtt = G.rtt ? G.rtt * 0.8 + (now - pr.e) * 0.2 : now - pr.e;
      G.hzN++;
    }
    if (Array.isArray(pr.ev)) guestEvents(pr.ev);
    if (pr.cd && pr.cd !== G.lastCd) { H().banner(String(pr.cd), 'chuẩn bị AUTO'); AU.cue.count(); }
    G.lastCd = pr.cd || 0;
  }
  if (now - G.hzT > 1000) { G.hz = G.hzN * 1000 / (now - G.hzT); G.hzN = 0; G.hzT = now; }
  if (pr && pr.st === 'done' && pr.fin && !G.resultsShown && pr.gid === G.gid) { G.resultsShown = true; guestResults(pr.fin); }
  G.st = pr ? pr.st : '';
  // controls: global keys work like a local match (not while the camera is being adjusted)
  if (st.mode === 'guest' && st.camEdit) { G.inp = null; }
  else if (st.mode === 'guest') {
    const g = IN.globals(st.activeKeySets());
    if (g.pause) { const p = $('pause'); p.hidden = !p.hidden; NET.guestMenu(!p.hidden); }
    if (g.camera) setCam(CAMS[(CAMS.indexOf(st.cam) + 1) % CAMS.length]);
    for (let k = 1; k <= 5; k++) if (g['cam' + k]) setCam(['driver', 'follow', 'broadcast', 'top', 'pov'][k - 1]);
    if (g.hideUI) st.hideUI = !st.hideUI;
    if (g.fps) st.fpsOn = !st.fpsOn;
    if (g.camReset) st.camResetView(false);
    if (!$('pause').hidden) root.BBUI.navigate(IN.menu(), $('pause'));
    else if (!G.spectator) {
      G.inp = guestInput();                                            // every frame: presses last a single frame
      if (now - G.lastIn >= IN_MS) { G.lastIn = now; pres({ i: G.inp, tg: Math.round(now), gid: G.gid }); }
    }
  } else if (st.mode === 'guestResults') {
    const nav = IN.menu(); root.BBUI.navigate(nav, $('results'));
  }
  // interpolate between snapshots, a little in the past so there is always a pair
  const buf = G.buf;
  if (buf.length) {
    const delay = Math.max(70, Math.min(220, SNAP_MS * 1.6 + 30));
    const tr = now - (G.off || 0) - delay;
    let i = buf.length - 1; while (i > 0 && buf[i - 1].c > tr) i--;
    const A = i > 0 ? buf[i - 1] : buf[0], B = buf[i];
    const span = Math.max(1, B.c - A.c), k = A === B ? 0 : Math.max(0, Math.min(1, (tr - A.c) / span));
    G.view.span = span / 1000;
    RP.applyFrame(G.view, A.f, B.f, k);
  }
  const v = G.view, me = v.robots[G.myId];
  R.update(v, dt);
  if (root.BBFX) root.BBFX.update(dt, R.cam, v);
  S().scrT = (S().scrT || 0) - dt;
  if (S().scrT <= 0) { S().scrT = 0.5; R.drawScreen(v, { R: { total: v.score.R }, B: { total: v.score.B } }, BB.matchClock(v)); }
  R.updateCamera(v, st.mode === 'guestResults' ? 'broadcast' : st.cam, me, me.alliance, dt, false);
  R.showTrajectory(null, null, false);
  R.render([]);
  if (st.mode === 'guest') guestHud(dt);
};
function setCam(c) {
  const st = S(); st.cam = c; st.set.cam = c; st.save();
  H().toast('Góc nhìn: ' + st.CAM_NAMES[c] + (R.camAdjusted(c) ? ' (góc bạn đã chỉnh)' : ''));
}
function guestHud(dt) {
  const st = S(), G = NET.G, v = G.view, HUD = H(), set = (el, t) => { const s = String(t); if (el && el.textContent !== s) el.textContent = s; };
  const clk = BB.matchClock(v);
  set($('period'), clk.label); set($('clock'), HUD.fmt(clk.secs));
  $('clock').classList.toggle('warn', (v.phase === 'tele' && clk.secs <= 15) || v.phase === 'trans');
  $('hud').classList.toggle('bare', st.hideUI);
  G.hudT = (G.hudT || 0) - dt;
  if (G.hudT <= 0) {
    G.hudT = 1 / 12;
    for (const al of ['R', 'B']) {
      set($('score' + al), v.score[al] | 0);
      const tq = $('tipsq' + al).children, n = v.tipsN[al] | 0;
      for (let k = 0; k < 7; k++) tq[k].classList.toggle('on', k < n);
      set(tq[7], n);
      const pct = Math.min(100, Math.round((v.pct[al] || 0) * 100)); $('bar' + al).style.width = pct + '%'; set($('pct' + al), pct + '%');
      const nd = $('nect' + al).children; for (let k = 0; k < 5; k++) nd[k].classList.toggle('on', k < v.hp[al].left);
      set($('hp' + al), `NECTAR ${al === 'R' ? 'ĐỎ' : 'XANH'} · còn ${v.hp[al].left}`);
      const fo = v.foulN[al] | 0, fe = $('foul' + al);
      if (fo) { fe.hidden = false; set(fe, `LỖI ${Math.floor(fo / 100)}M ${fo % 100}m`); } else fe.hidden = true;
    }
    const me = v.robots[G.myId], rb = G.sim.robots[G.myId];
    if (G.panel) {
    set($('olpName'), rb.name); set($('olpSlot'), `${me.alliance === 'R' ? 'ĐỎ' : 'XANH'} ${rb.slot + 1} · #${rb.team}`);
    $('olpSlot').className = 'rp-slot ' + me.alliance;
    const hop = $('olpHop').children;
    for (let k = 0; k < 4; k++) { const q = me.hopper[k]; hop[k].className = q ? (q.ball.bt === 1 ? 'nr' : q.ball.bt === 2 ? 'nb' : 'p') : ''; }
    const chips = [`<span class="chip ${G.field ? 'on' : ''}">${G.field ? 'LÁI THEO SÂN' : 'THEO ROBOT'}</span>`];
    if (G.autoFire) chips.push('<span class="chip on">TỰ BẮN</span>');
    if (G.tlock) chips.push('<span class="chip on">KHÓA TURRET</span>');
    const ch = chips.join(''); if ($('olpChips')._h !== ch) { $('olpChips').innerHTML = ch; $('olpChips')._h = ch; }
    const sh = me.shooters.map((s, k) => {
      const F = rb.shooters[k].fw, spd = F.eta * s.fw.w * F.rIn;
      const state = s.aim.locked ? '<b class="aim-state lock">KHÓA</b>' : s.aim.valid ? '<b class="aim-state track">ĐANG BÁM</b>' : '<b class="aim-state">CHƯA THẤY TAG</b>';
      return `<div class="olp-row">${state}<span class="mono">${Math.round(spd)} in/s</span></div>`;
    }).join('');
    if ($('olpSh')._h !== sh) { $('olpSh').innerHTML = sh; $('olpSh')._h = sh; }
    set($('olpShots'), `${me.stats.made | 0}/${me.stats.shots | 0}`); set($('olpBat'), me.bat.v.toFixed(1) + ' V');
    set($('olpPing'), G.rtt ? Math.round(G.rtt) + ' ms' : '–'); set($('olpHz'), G.hz ? Math.round(G.hz) + ' Hz' : '–');
    }
    const names = { driver: 'KHU LÁI', follow: 'THEO ROBOT', broadcast: 'KHÁN ĐÀI', top: 'NHÌN TỪ TRÊN', pov: 'CAMERA ROBOT', free: 'TỰ DO' };
    const wait = G.st === 'paused' ? ' · CHỦ PHÒNG TẠM DỪNG' : !G.buf.length ? ' · CHỜ HÌNH' : '';
    set($('camLine'), `ONLINE · PHÒNG ${NET.code.toUpperCase()} · ${names[st.cam] || ''}${wait}`);
    $('fps').hidden = !st.fpsOn;
    if (st.fpsOn) { const f = st.frameMs, avg = f.reduce((a, c) => a + c, 0) / f.length; set($('fps'), `${(1000 / avg).toFixed(0)} fps · ping ${Math.round(G.rtt)} ms · ${Math.round(G.hz)} Hz hình`); }
  }
  if (!$('banner').hidden) { HUD.bannerT -= dt; if (HUD.bannerT <= 0) $('banner').hidden = true; }
  HUD.labels(v);
  $('details').hidden = true; $('coach').hidden = true; $('aimKey').hidden = true;
}

// ------------------------------------------------------------------ menu screen
NET.bind = function () {
  $('olCreate').addEventListener('click', () => NET.create());
  $('olJoin').addEventListener('click', () => NET.join($('olCode').value));
  $('olCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); NET.join($('olCode').value); } });
  $('olCode').addEventListener('input', () => { const el = $('olCode'); el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('olStart').addEventListener('click', () => NET.startMatch());
  $('olLeave').addEventListener('click', () => NET.leave());
  $('olCopy').addEventListener('click', () => {
    const t = NET.code.toUpperCase(); let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(() => setStatus('Đã chép mã ' + t), () => setStatus('Mã phòng: ' + t)); ok = true; } } catch (e) { ok = false; }
    if (!ok) setStatus('Mã phòng: ' + t);
  });
  const name = $('olName'); name.value = S().set.olName || '';
  name.addEventListener('input', () => { S().set.olName = name.value.slice(0, 16); S().save(); });
  name.addEventListener('change', () => NET.cfgChanged());
};

root.BBNET = NET;
})(typeof globalThis !== 'undefined' ? globalThis : this);
