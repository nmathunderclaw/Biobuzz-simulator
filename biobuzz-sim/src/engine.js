/* BIOBUZZ Sim — physics + rules engine v2 (no DOM, no three.js).
   Units: inches, seconds, grams (SI only where marked). Frame: origin field centre on the tile top,
   +x toward the BLUE wall (right from the audience), +y away from the audience, +z up. */
(function (root) {
'use strict';

const G = 386.09;
const DT = 1 / 300;
const D2R = Math.PI / 180;
// field geometry follows the official FIELD CAD (STEP v26-27.2): tiles span +-70.585 in, the perimeter glass
// faces the field at 70.674 in and the top rail ends 11.64 in above the TILES
const HALF = 70.6;
const WALL_H = 11.64;
const N2G = 39370.08;          // 1 N      in g*in/s^2
const NM2G = 1.5500031e6;      // 1 N*m    in g*in^2/s^2

// ---------------------------------------------------------------- balls (AndyMark am-5851 / am-5852)
const BT_POLLEN = 0, BT_RED = 1, BT_BLUE = 2;
const BALL_R = [1.40, 1.81, 1.81];
const BALL_M = [24.9, 41.3, 41.3];
const RHO = 1.2e-3 * 16.387;              // air, g / in^3
const CD = 0.45;                          // 26-hole pickleball-style ball
const BALL_K = BALL_R.map((r, i) => 0.5 * RHO * CD * Math.PI * r * r / BALL_M[i]);   // drag: a = K |v| v
const BALL_KL = BALL_R.map((r, i) => 0.5 * RHO * Math.PI * r * r / BALL_M[i]);        // lift: a = KL C_L |v|^2
const KI = 0.635;                         // I = KI m r^2 for a thin perforated shell
const CL_K = 0.22;                        // Magnus lift C_L = 0.22 * min(spin ratio, 1)
const SPIN_TAU = 3.0;                     // spin decay time in flight (s)
// contact materials: restitution, Coulomb friction, rolling-resistance lever (x ball radius)
const MAT = {
  floor: [0.36, 0.60, 0.10], wall: [0.45, 0.25, 0.01], frame: [0.40, 0.20, 0.01], cell: [0.30, 0.25, 0.02],
  arm: [0.35, 0.20, 0.01], flower: [0.25, 0.20, 0.02], ring: [0.30, 0.20, 0.02], robot: [0.35, 0.35, 0.02], ball: [0.45, 0.30, 0.01],
};

// ---------------------------------------------------------------- match (Table 9-1, 10-2, 10-3)
const T_AUTO = 30, T_TRANS = 8, T_TELE = 120;
const T_TELE0 = T_AUTO + T_TRANS;         // 38
const T_END = T_TELE0 + T_TELE;           // 158
const T_FLOWER = T_END - 60;              // last minute of the MATCH
const PTS = { leave: 3, park: 5, tip: 20, cell: 2, bottom: 5, flower: 2, garden: 1, minor: 5, major: 20 };
const RPV = { win: 3, tie: 1, swarm: 16, poll1: 4, poll2: 7 };

// ---------------------------------------------------------------- field zones (inches, outer tape edges from the FIELD CAD)
const ZONES = {
  loading: { R: { x0: -HALF, x1: -59.101, y0: 23.907, y1: 46.599 }, B: { x0: 59.101, x1: HALF, y0: -46.599, y1: -23.907 } },
  garden: { R: { x0: -HALF, x1: -47.409, y0: -70.101, y1: -68.101 }, B: { x0: 47.409, x1: HALF, y0: 68.101, y1: 70.101 } },
  alliance: { R: { x0: -125.65, x1: -71.65, y0: -48.41, y1: 48.41 }, B: { x0: 71.65, x1: 125.65, y0: -48.41, y1: 48.41 } },
};

// ---------------------------------------------------------------- HIVE geometry (Manual §9.6, checked against the FIELD CAD)
// Body frame (w, a, b): w across the HIVE, a along the arm (+a = away from the audience at phi = 0), b up; pivot at the origin.
// CELL plates are 0.2 in half-thick slabs centred on PENT, so their inner faces land on the CAD skins:
// floor -1.43, side walls +-10.04, roof peak 12.63, closed back wall at |a| = 9.44, open mouth at |a| = 21.457.
const HV = {
  pz: 43.95, stop: 30 * D2R, xs: { R: -12.75, B: 12.75 },
  aIn: 9.24, aOut: 21.457, b0: -1.63, bTop: 12.87, pt: 0.2, bAim: 4.2,
  I: 450000, damp: 30000, rest: 0.12,
};
const PENT = [[-10.24, HV.b0], [10.24, HV.b0], [10.24, 6.43], [0, HV.bTop], [-10.24, 6.43]];
// resting torque (g*in^2/s^2) of n POLLEN settled in an empty upward CELL, measured with this engine
// (test/calibrate.mjs). Field Setup Guide 12.3: a CELL tips at 8 POLLEN or 3 NECTAR + 3 POLLEN.
let TORQUE_TABLE = [0, 90390, 180790, 271187, 380761, 471253, 561650, 650994, 760799, 861977, 972069, 1099771, 1210090, 1340511, 1468059];
function holdK(pollenToTip) {
  const t = TORQUE_TABLE;
  const n = Math.max(2, Math.min(t.length - 1, pollenToTip));
  const lo = t[n - 1], hi = t[n];
  const frac = pollenToTip - Math.floor(pollenToTip);
  const mid = frac > 0 ? lo + (hi - lo) * frac : (lo + hi) / 2;
  return mid / Math.sin(HV.stop);
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function plateRect(o, u, lu, v, lv) { return { o, u, v, n: cross(u, v), rect: true, lu, lv, poly: null }; }
function platePoly(o, u, v, poly) { return { o, u, v, n: cross(u, v), rect: false, poly }; }
// body coords are (w, a, b)
function buildCellPlates(sgn) {
  const a1 = sgn * HV.aIn, len = HV.aOut - HV.aIn;
  const plates = [];
  for (let i = 0; i < 5; i++) {
    const P = PENT[i], Q = PENT[(i + 1) % 5];
    const dw = Q[0] - P[0], db = Q[1] - P[1], L = Math.hypot(dw, db);
    plates.push(plateRect([P[0], a1, P[1]], [dw / L, 0, db / L], L, [0, sgn, 0], len));
  }
  plates.push(platePoly([0, a1, 0], [1, 0, 0], [0, 0, 1], PENT.map(p => [p[0], p[1]])));
  return plates;
}
const CELL_PLATES = { 1: buildCellPlates(1), [-1]: buildCellPlates(-1) };
// 1 x 1 in basket base tube under both CELLS, climbing over the pivot on the two goal pivot brackets
const ARM_SEGS = [[-21.457, -2.212, -4.707, -2.212], [-4.707, -2.212, -1.5, 0.3], [-1.5, 0.3, 1.5, 0.3], [1.5, 0.3, 4.707, -2.212], [4.707, -2.212, 21.457, -2.212]];
const ARM_R = 0.62;
// HIVE frame (am-5854): four 1.19 x 1.0 in legs, the top bar and the two top corners that carry the axles
const LEGS = [[-23.9, -18.553, 0.551, -12.64, -0.515, 41.065], [-23.9, 18.553, 0.551, -12.64, 0.515, 41.065],
  [23.9, -18.553, 0.551, 12.64, -0.515, 41.065], [23.9, 18.553, 0.551, 12.64, 0.515, 41.065]];
const FRAME_CAPS = LEGS.map(L => L.concat([0.6])).concat([
  [-12.0, 0, 41.45, 12.0, 0, 41.45, 0.55],
  [-12.13, 0, 41.05, -12.13, 0, 42.7, 1.55], [12.13, 0, 41.05, 12.13, 0, 42.7, 1.55],
]);
// sheet-metal foot bars joining each pair of feet: 2.15 in tall, nothing drives over them
const FOOT_BARS = [{ x0: -24.733, x1: -22.75, y0: -19.472, y1: 19.472, z0: 0, z1: 2.148 }, { x0: 22.75, x1: 24.733, y0: -19.472, y1: 19.472, z0: 0, z1: 2.148 }];
// ACM logo panels hanging under the top bar
const LOGO_PLATES = [
  platePoly([0.007, -1.666, 40.024], [1, 0, 0], norm3([0, -2.627, -5.9]), [[-15.078, 0], [15.078, 0], [15.078, 6.458], [-15.078, 6.458]]),
  platePoly([0.007, 1.666, 40.024], [1, 0, 0], norm3([0, 2.627, -5.9]), [[-15.078, 0], [15.078, 0], [15.078, 6.458], [-15.078, 6.458]]),
];

// ---------------------------------------------------------------- FLOWER geometry (Manual §9.7 and FIELD CAD am-5855)
// top ring (4 in opening, top face 21.4 in), four 1.05 in HIPS pipes on a 3.45 in square, a middle ring whose 3.38 in
// hole lets POLLEN through but seats NECTAR, the lower ring the bottom POLLEN sits in, and a backstop bar 1 in above
// the top ring on the wall side. u runs along the wall, v toward the wall.
const FL = {
  ri: 1.995, zTop: 21.404, zTopB: 20.254, rTopO: 2.7,
  zMid: 5.254, zMidB: 3.904, rMidI: 1.69, rMidO: 2.85,
  zLow: 0.354, rLowI: 1.395, rLowO: 2.85,
  pipeR: 0.524, pipeD: 1.725, pipeZ0: 4.254, pipeZ1: 21.254,
  back: 1.25, backZ: 22.529, backR: 0.19, backSegs: [[-2.62, 0.6, -1.05, 2.14], [-1.05, 2.14, 1.05, 2.14], [1.05, 2.14, 2.62, 0.6]],
  posts: [[-2.47, 0.62], [2.47, 0.62]], postR: 0.19,
  edge: 0.04,
};
const FLOWERS_DEF = [
  { x: -23.392, y: 68.042, nx: 0, ny: -1 },
  { x: 68.042, y: 23.392, nx: -1, ny: 0 },
  { x: 23.392, y: -68.042, nx: 0, ny: 1 },
  { x: -68.042, y: -23.392, nx: 1, ny: 0 },
];
function flowerBox(f) {
  const along = 2.98, depth = 5.05;
  if (f.nx !== 0) { const wx = f.nx > 0 ? -HALF : HALF; return { x0: Math.min(wx, wx + f.nx * depth), x1: Math.max(wx, wx + f.nx * depth), y0: f.y - along, y1: f.y + along }; }
  const wy = f.ny > 0 ? -HALF : HALF; return { x0: f.x - along, x1: f.x + along, y0: Math.min(wy, wy + f.ny * depth), y1: Math.max(wy, wy + f.ny * depth) };
}

// ---------------------------------------------------------------- AprilTags (36h11, Manual §9.9)
const TAG_CODES = { 30: 0xe2cfda160, 31: 0x2ff497c63, 32: 0x47240671b, 33: 0x5047a2e55, 34: 0x635ca87c7, 35: 0x691254166, 36: 0x68f43d94a, 37: 0x6ef24bdb6,
  38: 0x8cdd8f886, 39: 0x9de96b718, 40: 0xaff6e5a8a, 41: 0xbae46f029, 42: 0xd225b6d59, 43: 0xdf8ba8c01, 44: 0xe3744a22f, 45: 0xfbb59375d };
const TAG_BITX = [1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4, 1, 1, 1, 1, 1, 2, 2, 2, 3];
const TAG_BITY = [1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4];
function tagGrid(id) {
  const code = TAG_CODES[id]; const W = 10; const g = [];
  for (let i = 0; i < W; i++) g.push(new Array(W).fill(0));
  for (let i = 0; i < 9; i++) { g[0][i] = 1; g[i][9] = 1; g[9][i + 1] = 1; g[i + 1][0] = 1; }
  for (let i = 0; i < 36; i++) { if (Math.floor(code / Math.pow(2, 35 - i)) % 2) g[TAG_BITY[i] + 1][TAG_BITX[i] + 1] = 1; }
  return g;
}
const TAG_SIZE = 3.25;
// Figures 9-15 to 9-17: one sticker per CELL bottom, four tags in a row 2.75 in above the reference holes, which sit
// 9.938 in inside the CELL mouth; the strip with the holes faces the field centre. IDs 30-33 red far side, 34-37 red
// audience side, 38-41 blue audience side, 42-45 blue far side. sg = +1 is the CELL away from the audience.
const TAG_BASE = { R: { 1: 30, [-1]: 34 }, B: { 1: 42, [-1]: 38 } };
const TAG_A_MID = HV.aOut - 9.938 + 2.75;
const TAG_OFF = [[6.5, 0], [2.75, 0], [-2.75, 0], [-6.5, 0]];      // body w = sg * o[0]: ID base at w = +6.5 on the far CELL
const TAG_B = -1.50;                                              // printed face, just under the CELL floor skin
const TAG_STICKER = { hw: 8.5, a0: HV.aOut - 9.938, a1: HV.aOut - 4.938, b: TAG_B, hole: 7.0 };

// ---------------------------------------------------------------- parts catalogue (goBILDA 5203 Yellow Jacket, 12 V)
const MOTORS = {
  yj6000: { rpm: 6000, tau: 0.1442 }, yj1620: { rpm: 1620, tau: 0.5296 }, yj1150: { rpm: 1150, tau: 0.7747 },
  yj435: { rpm: 435, tau: 1.8338 }, yj312: { rpm: 312, tau: 2.383 }, yj223: { rpm: 223, tau: 3.7265 }, yj117: { rpm: 117, tau: 6.7077 },
};
const MOTOR_IS = 9.2, MOTOR_I0 = 0.25, FREE_FACTOR = 0.97;
// flywheel assemblies (goBILDA Gecko wheels + steel flywheels), inertia in kg*m^2
const FLYWHEELS = {
  96: { rMm: 48, J: { light: 1.3e-4, medium: 4.0e-4, heavy: 7.5e-4 } },
  72: { rMm: 36, J: { light: 0.45e-4, medium: 1.3e-4, heavy: 2.4e-4 } },
};
const BATTERY = { voc: 13.2, rInt: 0.10, ah: 3.0, sag: 0.45 };   // 12 V NiMH, R601; resistance incl. wiring and fuse

// ---------------------------------------------------------------- robot presets (all FTC legal: R102, R503)
const DEFAULT_SHOOTER = { type: 'turret', balls: 'both', faces: 180, x: -2, y: 0, z: 16.5, hood: 'adjustable', hoodDeg: 64,
  wheel: 96, dual: false, motors: 1, inertia: 'medium', ctrl: 'pidf', band: 0.03, feed: 1.0, range: 300 };
const PRESETS = {
  starter: { name: 'KHỞI ĐẦU', desc: 'Mecanum, 1 súng cố định bắn về sau, hood cố định 64°, SDK setVelocity. Như robot đầu mùa của đội mới.',
    body: { L: 18, W: 18, H: 13 }, mass: 12.0, color: 'graphite',
    drive: { type: 'mecanum', motor: 'yj312', wheel: 104 },
    intake: { sides: 'front', width: 14, reach: 0, picks: 'both' },
    shooters: [{ type: 'fixed', balls: 'both', faces: 180, x: -3, y: 0, z: 14.5, hood: 'fixed', hoodDeg: 64, wheel: 96, dual: false, motors: 1, inertia: 'medium', ctrl: 'sdk', band: 0.05, feed: 0.8, range: 0 }],
    camera: { mount: 'back', h: 12, pitch: 32 }, flower: { arm: 'none', flap: true }, odo: 'tag', lead: false, scatter: 1.2 },
  turret: { name: 'THÁP PHÁO', desc: 'Turret 300° mang camera, hood chỉnh được, PIDF + feedforward, bù vận tốc khi vừa chạy vừa bắn.',
    body: { L: 18, W: 18, H: 14.5 }, mass: 14.5, color: 'graphite',
    drive: { type: 'mecanum', motor: 'yj312', wheel: 104 },
    intake: { sides: 'front', width: 14, reach: 0, picks: 'both' },
    shooters: [{ type: 'turret', balls: 'both', faces: 180, x: -2, y: 0, z: 16.5, hood: 'adjustable', hoodDeg: 64, wheel: 96, dual: false, motors: 1, inertia: 'medium', ctrl: 'pidf', band: 0.03, feed: 1.0, range: 300 }],
    camera: { mount: 'turret0', h: 17, pitch: 28 }, flower: { arm: 'short', flap: true }, odo: 'fusion', lead: true, scatter: 1.0 },
  twin: { name: 'SONG PHÁO', desc: 'Hai turret: một cho POLLEN, một cho NECTAR. Mecanum 435 rpm, arm dài. Đúng 8 motor, 8 servo.',
    body: { L: 18, W: 18, H: 15 }, mass: 16.0, color: 'amber',
    drive: { type: 'mecanum', motor: 'yj435', wheel: 104 },
    intake: { sides: 'front', width: 16, reach: 1.5, picks: 'both' },
    shooters: [
      { type: 'turret', balls: 'pollen', faces: 180, x: -3, y: 4, z: 17, hood: 'adjustable', hoodDeg: 64, wheel: 96, dual: false, motors: 1, inertia: 'medium', ctrl: 'pidf', band: 0.03, feed: 1.0, range: 330 },
      { type: 'turret', balls: 'nectar', faces: 180, x: -3, y: -4, z: 17, hood: 'adjustable', hoodDeg: 64, wheel: 96, dual: false, motors: 1, inertia: 'heavy', ctrl: 'pidf', band: 0.03, feed: 1.0, range: 330 }],
    camera: { mount: 'turret0', h: 18, pitch: 28 }, flower: { arm: 'long', flap: true }, odo: 'fusion', lead: true, scatter: 1.0 },
  swerve: { name: 'SWERVE', desc: 'Swerve 4 module, chạy mọi hướng hết tốc. Một turret, hood chỉnh được, bang-bang cho phục hồi nhanh.',
    body: { L: 18, W: 18, H: 14 }, mass: 15.5, color: 'sky',
    drive: { type: 'swerve', motor: 'yj435', wheel: 96 },
    intake: { sides: 'front', width: 15, reach: 1, picks: 'both' },
    shooters: [{ type: 'turret', balls: 'both', faces: 180, x: -2, y: 0, z: 16, hood: 'adjustable', hoodDeg: 64, wheel: 96, dual: false, motors: 1, inertia: 'medium', ctrl: 'bang', band: 0.03, feed: 1.1, range: 300 }],
    camera: { mount: 'turret0', h: 16.5, pitch: 28 }, flower: { arm: 'none', flap: true }, odo: 'fusion', lead: true, scatter: 1.0 },
  speed: { name: 'TỐC ĐỘ', desc: 'Mecanum 435 rpm, súng cố định 2 bánh (ít xoáy), hood lật 60/72°, bắn 0,13 s/quả.',
    body: { L: 18, W: 18, H: 12.5 }, mass: 12.8, color: 'mint',
    drive: { type: 'mecanum', motor: 'yj435', wheel: 104 },
    intake: { sides: 'front', width: 15, reach: 1, picks: 'both' },
    shooters: [{ type: 'fixed', balls: 'both', faces: 180, x: -2, y: 0, z: 14, hood: 'flap', hoodDeg: 60, wheel: 96, dual: true, motors: 2, inertia: 'medium', ctrl: 'pidf', band: 0.03, feed: 1.5, range: 0 }],
    camera: { mount: 'back', h: 12, pitch: 32 }, flower: { arm: 'none', flap: true }, odo: 'fusion', lead: false, scatter: 1.1 },
  flower: { name: 'CÁNH TAY FLOWER', desc: 'Arm dài cắm FLOWER 0,4 s, flap rút POLLEN đáy. Súng lob bánh 72 mm.',
    body: { L: 18, W: 18, H: 15.5 }, mass: 15.2, color: 'violet',
    drive: { type: 'mecanum', motor: 'yj312', wheel: 104 },
    intake: { sides: 'front', width: 13, reach: 0, picks: 'both' },
    shooters: [{ type: 'fixed', balls: 'both', faces: 180, x: -2, y: 0, z: 17, hood: 'adjustable', hoodDeg: 70, wheel: 72, dual: false, motors: 1, inertia: 'light', ctrl: 'pidf', band: 0.04, feed: 0.8, range: 0 }],
    camera: { mount: 'back', h: 13, pitch: 34 }, flower: { arm: 'long', flap: true }, odo: 'fusion', lead: false, scatter: 1.2 },
  wall: { name: 'PHÒNG THỦ', desc: 'Tank drive bánh bám, 19 kg, đẩy mạnh nhất sân. Súng đơn giản, chơi chặn đường hợp lệ.',
    body: { L: 18, W: 18, H: 12 }, mass: 19.0, color: 'graphite',
    drive: { type: 'tank', motor: 'yj312', wheel: 104 },
    intake: { sides: 'front', width: 13, reach: 0, picks: 'both' },
    shooters: [{ type: 'fixed', balls: 'both', faces: 0, x: 0, y: 0, z: 14, hood: 'fixed', hoodDeg: 62, wheel: 96, dual: false, motors: 1, inertia: 'heavy', ctrl: 'sdk', band: 0.05, feed: 0.6, range: 0 }],
    camera: { mount: 'front', h: 11, pitch: 32 }, flower: { arm: 'none', flap: false }, odo: 'odometry', lead: false, scatter: 1.5 },
};
const COLORS = { graphite: 0x3a4149, amber: 0x6b4a14, sky: 0x1d4f73, mint: 0x1f5f4c, violet: 0x4a2f6b, sand: 0x6e6450 };

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(v, lo, hi, d) { v = Number(v); if (!isFinite(v)) v = d; return v < lo ? lo : v > hi ? hi : v; }
function pick(v, list, d) { return list.includes(v) ? v : d; }
// fill defaults and clamp everything a user (or a pasted share code) may have set
function normalizeSpec(spec) {
  const base = PRESETS.turret;
  const s = Object.assign(clone(base), clone(spec || {}));
  s.name = String(s.name || 'ROBOT').slice(0, 24);
  s.body = { L: num(s.body && s.body.L, 12, 18, 18), W: num(s.body && s.body.W, 12, 18, 18), H: num(s.body && s.body.H, 8, 18, 14) };
  s.mass = num(s.mass, 6, 25, 14);
  s.color = pick(s.color, Object.keys(COLORS), 'graphite');
  const d = s.drive || {};
  s.drive = { type: pick(d.type, ['mecanum', 'swerve', 'tank'], 'mecanum'), motor: pick(d.motor, Object.keys(MOTORS), 'yj312'), wheel: pick(Number(d.wheel), [72, 96, 104], 104) };
  const it = s.intake || {};
  s.intake = { sides: pick(it.sides, ['front', 'both'], 'front'), width: num(it.width, 8, s.body.W - 2, 14), reach: num(it.reach, 0, 3, 0), picks: pick(it.picks, ['both', 'pollen', 'nectar'], 'both') };
  const shs = Array.isArray(s.shooters) && s.shooters.length ? s.shooters.slice(0, 3) : [clone(DEFAULT_SHOOTER)];
  s.shooters = shs.map(q => {
    const o = Object.assign(clone(DEFAULT_SHOOTER), q || {});
    return { type: pick(o.type, ['turret', 'fixed'], 'turret'), balls: pick(o.balls, ['both', 'pollen', 'nectar'], 'both'), faces: pick(Number(o.faces), [0, 90, 180, 270], 180),
      x: num(o.x, -s.body.L / 2 + 2, s.body.L / 2 - 2, 0), y: num(o.y, -s.body.W / 2 + 2, s.body.W / 2 - 2, 0), z: num(o.z, s.body.H, 28, s.body.H + 2),
      hood: pick(o.hood, ['fixed', 'flap', 'adjustable'], 'adjustable'), hoodDeg: num(o.hoodDeg, 45, 80, 64),
      wheel: pick(Number(o.wheel), [72, 96], 96), dual: !!o.dual, motors: pick(Number(o.motors), [1, 2], 1), inertia: pick(o.inertia, ['light', 'medium', 'heavy'], 'medium'),
      ctrl: pick(o.ctrl, ['sdk', 'pidf', 'bang'], 'pidf'), band: num(o.band, 0.01, 0.1, 0.03), feed: num(o.feed, 0.5, 4, 1), range: num(o.range, 90, 360, 300) };
  });
  const cm = s.camera || {};
  s.camera = { mount: pick(cm.mount, ['turret0', 'front', 'back'], 'front'), h: num(cm.h, 6, 28, 13), pitch: num(cm.pitch, 10, 45, 30) };
  if (s.camera.mount === 'turret0' && s.shooters[0].type !== 'turret') s.camera.mount = s.shooters[0].faces === 180 ? 'back' : 'front';
  const fl = s.flower || {};
  s.flower = { arm: pick(fl.arm, ['none', 'short', 'long'], 'none'), flap: !!fl.flap };
  s.odo = pick(s.odo, ['fusion', 'odometry', 'tag'], 'fusion');
  s.lead = !!s.lead;
  s.scatter = num(s.scatter, 0.5, 3, 1);
  return s;
}
// motor / servo counts (R503: at most 8 motors and 8 servos)
function classCheck(specIn) {
  const s = normalizeSpec(specIn);
  let motors = 4 + (s.intake.sides === 'both' ? 2 : 1);
  let servos = s.drive.type === 'swerve' ? 4 : 0;
  for (const sh of s.shooters) {
    motors += sh.motors;
    servos += 1;                                        // feeder
    if (sh.type === 'turret') servos += 1;
    if (sh.hood !== 'fixed') servos += 1;
  }
  if (s.flower.arm !== 'none') servos += 1;
  if (s.flower.flap) servos += 1;
  const size = s.body.L <= 18 && s.body.W <= 18 && s.body.H <= 18;
  const legal = motors <= 8 && servos <= 8 && size;
  return { motors, servos, size, legal };
}
// what the spec means physically
function deriveRobot(specIn) {
  const s = normalizeSpec(specIn);
  const m = s.mass * 1000;
  const mot = MOTORS[s.drive.motor];
  const rw = s.drive.wheel / 25.4 / 2;
  const vf = mot.rpm / 60 * 2 * Math.PI * rw * FREE_FACTOR;
  const Fs = mot.tau / (rw * 0.0254) * N2G;
  const type = s.drive.type;
  const P = {
    spec: s, hx: s.body.L / 2, hy: s.body.W / 2, h: s.body.H, m, I: m * (s.body.L * s.body.L + s.body.W * s.body.W) / 12 * 0.9,
    drive: { type, vf, Fs, rw, mu: type === 'mecanum' ? 0.72 : type === 'swerve' ? 1.0 : 0.95, strafeEff: 0.84,
      lx: s.body.L / 2 - 2.8, ly: s.body.W / 2 - 2.2, steerRate: 14 },
    intake: { front: true, back: s.intake.sides === 'both', w: s.intake.width, reach: s.intake.reach, picks: s.intake.picks, xfer: 0.14 },
    arm: s.flower.arm, flap: s.flower.flap, armReach: s.flower.arm === 'long' ? 9 : 6, armTime: s.flower.arm === 'long' ? 0.42 : 0.85,
    camera: s.camera, odo: s.odo, lead: s.lead, scatter: s.scatter, color: s.color,
    cls: classCheck(s),
  };
  P.drive.wl = P.drive.lx + P.drive.ly;
  return P;
}
function presetSpec(key) { return clone(Object.assign({ key }, PRESETS[key] || PRESETS.turret)); }

// ---------------------------------------------------------------- helpers
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function allyOf(bt) { return bt === BT_RED ? 'R' : bt === BT_BLUE ? 'B' : null; }
function other(al) { return al === 'R' ? 'B' : 'R'; }

// ---------------------------------------------------------------- shot tables
// The same integrator as the ball physics, so the predicted arc is the arc the ball flies.
function flyTo(v, th, bt, D, H, S0) {
  const k = BALL_K[bt], kl = BALL_KL[bt], r = BALL_R[bt];
  let x = 0, z = 0, vx = v * Math.cos(th), vz = v * Math.sin(th), t = 0, w = (S0 || 0) * v / r;
  let px = 0, pz = 0;
  while (t < 3) {
    vz -= G * DT;
    const sp = Math.hypot(vx, vz);
    let ax = -k * sp * vx, az = -k * sp * vz;
    if (w > 1 && sp > 1) { const cl = CL_K * Math.min(r * w / sp, 1); ax += kl * cl * sp * -vz; az += kl * cl * sp * vx; }
    vx += ax * DT; vz += az * DT; w *= 1 - DT / SPIN_TAU;
    px = x; pz = z;
    x += vx * DT; z += vz * DT; t += DT;
    if (x >= D) { const f = (D - px) / (x - px); return { dz: pz + (z - pz) * f - H, t: t - DT + f * DT }; }
    if (z < -40 || vx < 1) break;
  }
  return { dz: -1e3, t: 3 };
}
function solveV(th, bt, D, H, S0) {
  let lo = 40, hi = 1000;
  if (flyTo(hi, th, bt, D, H, S0).dz < 0) return null;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (flyTo(mid, th, bt, D, H, S0).dz < 0) lo = mid; else hi = mid; }
  const v = (lo + hi) / 2; const r = flyTo(v, th, bt, D, H, S0);
  return { v, t: r.t };
}
// launch angle for a given exit speed near a guess (adjustable-hood trim)
function solveTheta(v, bt, D, H, S0, guess, lo, hi) {
  let th = guess;
  for (let it = 0; it < 4; it++) {
    const f0 = flyTo(v, th, bt, D, H, S0).dz, f1 = flyTo(v, th + 0.01, bt, D, H, S0).dz;
    const dfd = (f1 - f0) / 0.01;
    if (!isFinite(dfd) || Math.abs(dfd) < 1e-3 || f0 < -900) return null;
    th = clamp(th - f0 / dfd, lo, hi);
  }
  return Math.abs(flyTo(v, th, bt, D, H, S0).dz) < 1.2 ? th : null;
}
const AIM_Z = HV.pz + (HV.aOut - 2.5) * Math.sin(HV.stop) + HV.bAim * Math.cos(HV.stop);
const HOOD_MIN = 45 * D2R, HOOD_MAX = 82 * D2R;
function hoodSchedule(hood, D) {
  if (hood.kind === 'fixed') return hood.deg0;
  if (hood.kind === 'flap') return D < 56 ? hood.hi : hood.lo;
  return clamp(74 - (D - 26) * 0.28, 48, 74) * D2R;
}
const TABLES = new Map();
function tableFor(hood, H, S0, bt) {
  const key = hood.kind + ':' + (hood.kind === 'fixed' ? hood.deg0.toFixed(3) : hood.kind === 'flap' ? hood.lo.toFixed(3) : '') + ':' + H.toFixed(1) + ':' + S0.toFixed(2) + ':' + (bt ? 1 : 0);
  let t = TABLES.get(key);
  if (!t) { t = { hood, H, S0, bt, rows: new Array(108) }; TABLES.set(key, t); }
  return t;
}
function tableRow(t, i) {
  let r = t.rows[i];
  if (r === undefined) {
    const D = 8 + i * 2, th = hoodSchedule(t.hood, D), s = solveV(th, t.bt, D, t.H, t.S0);
    r = t.rows[i] = s ? { D, th, v: s.v, t: s.t } : null;
  }
  return r;
}
function shotLookup(sh, bt, D) {
  const t = tableFor(sh.hood, AIM_Z - sh.mz, sh.fw.S0, bt ? 1 : 0);
  const f = (D - 8) / 2, i = Math.floor(f);
  if (i < 0 || i + 1 >= t.rows.length) return null;
  // the flap switches angle at 56 in: never interpolate across it
  const a = tableRow(t, i), b = tableRow(t, i + 1); if (!a || !b) return null;
  if (Math.abs(a.th - b.th) > 0.05) return f - i < 0.5 ? a : b;
  const u = f - i;
  return { th: a.th + (b.th - a.th) * u, v: a.v + (b.v - a.v) * u, t: a.t + (b.t - a.t) * u };
}

// ---------------------------------------------------------------- sim construction
function createSim(opt) {
  opt = opt || {};
  const sim = {
    rng: mulberry32(opt.seed || (Math.random() * 1e9) | 0), seed: opt.seed,
    t: 0, phase: 'pre', mode: opt.mode || 'match', practice: !!opt.practice,
    noTimer: !!opt.noTimer, flowersOpen: !!opt.flowersOpen, foulsOn: opt.fouls !== false,
    balls: [], robots: [], hives: [], flowers: [], events: [], step: 0,
    hp: { R: { left: 5, credit: 0, cd: 0, manual: !!(opt.hpManual && opt.hpManual.R), req: 0 }, B: { left: 5, credit: 0, cd: 0, manual: !!(opt.hpManual && opt.hpManual.B), req: 0 } },
    tips: { R: { auto: 0, tele: 0 }, B: { auto: 0, tele: 0 } },
    autoSnap: null, final: null, outCount: 0, endT: 0, reintro: [],
    pollenToTip: opt.pollenToTip || 8,
    fouls: { R: { minor: 0, major: 0 }, B: { minor: 0, major: 0 } }, foulLog: [], pins: new Map(), g402: { R: false, B: false },
    _rr: [], opt,
  };
  const K = holdK(sim.pollenToTip);
  for (const al of ['R', 'B']) {
    const sigma = al === 'R' ? -1 : 1;
    sim.hives.push({ alliance: al, hx: HV.xs[al], phi: sigma * HV.stop, w: 0, w0: 0, side: sigma, K, tipT: -9 });
  }
  FLOWERS_DEF.forEach((f, i) => sim.flowers.push({ i, x: f.x, y: f.y, nx: f.nx, ny: f.ny, box: flowerBox(f) }));
  // §10.3.1: 4 POLLEN stacked in each FLOWER, 4 in each GARDEN in a line from the corner nearest the ALLIANCE AREA
  // against the wall, 3 NECTAR in each upward CELL against its back wall, in a line from the side nearest the ALLIANCE AREA
  sim.flowers.forEach(f => { for (let k = 0; k < 4; k++) { const b = addBall(sim, BT_POLLEN, f.x, f.y, BALL_R[0] + 0.01 + 2.81 * k); b.flower = f.i; } });
  for (const al of ['R', 'B']) {
    const s = al === 'R' ? -1 : 1, c = HALF - BALL_R[0] - 0.02;
    for (let k = 0; k < 4; k++) addBall(sim, BT_POLLEN, s * (c - k * 2.89), s * c, BALL_R[0]);
  }
  sim.hives.forEach(h => {
    const bt = h.alliance === 'R' ? BT_RED : BT_BLUE, sg = h.side, toAl = h.alliance === 'R' ? -1 : 1, r = BALL_R[1];
    [8.25, 4.63, 1.01].forEach(w => { const p = bodyToWorld(h, toAl * w, sg * (HV.aIn + HV.pt + r + 0.02), HV.b0 + HV.pt + r + 0.02); addBall(sim, bt, p[0], p[1], p[2]); });
  });
  const specs = opt.robots || [
    { alliance: 'R', slot: 0, spec: presetSpec('turret'), team: '2026' }, { alliance: 'R', slot: 1, spec: presetSpec('speed'), team: '1123' },
    { alliance: 'B', slot: 0, spec: presetSpec('twin'), team: '3141' }, { alliance: 'B', slot: 1, spec: presetSpec('flower'), team: '4567' },
  ];
  specs.forEach((s, i) => {
    const r = makeRobot(sim, i, s);
    sim.robots.push(r);
    for (let k = 0; k < 4; k++) { const b = addBall(sim, BT_POLLEN, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ ball: b, t: 0 }); }
  });
  return sim;
}
function addBall(sim, bt, x, y, z) {
  const b = { id: sim.balls.length, bt, r: BALL_R[bt], m: BALL_M[bt], invM: 1 / BALL_M[bt], k: BALL_K[bt],
    x, y, z, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, invI: 1 / (KI * BALL_M[bt] * BALL_R[bt] * BALL_R[bt]),
    state: 'field', holder: -1, flower: -1, onFloor: false, nCont: 0,
    launchedBy: -1, launchT: -9, madeFor: -1, placedBy: -1, fromTip: false, g410: false };
  sim.balls.push(b); return b;
}
// G304: own side, touching the wall, out of the LOADING ZONE and clear of FLOWERS
const START_SPOTS = {
  R: { audience: { x: -16, wall: 'y-' }, alliance: { y: -6, wall: 'x-' }, far: { x: -47, wall: 'y+' }, alliance2: { y: 8, wall: 'x-' } },
  B: { audience: { x: 47, wall: 'y-' }, alliance: { y: 6, wall: 'x+' }, far: { x: 16, wall: 'y+' }, alliance2: { y: -8, wall: 'x+' } },
};
function startPose(al, where, P) {
  const s = START_SPOTS[al][where] || START_SPOTS[al].audience;
  const hx = P.hx, hy = P.hy;
  // the robot's long side against the wall; heading points into the field
  if (s.wall === 'y-') return { x: s.x, y: -HALF + hx + 0.2, psi: 90 * D2R };
  if (s.wall === 'y+') return { x: s.x, y: HALF - hx - 0.2, psi: -90 * D2R };
  if (s.wall === 'x-') return { x: -HALF + hx + 0.2, y: s.y, psi: 0 };
  return { x: HALF - hx - 0.2, y: s.y, psi: Math.PI };
}
function makeShooter(ss, i) {
  const fwd = FLYWHEELS[ss.wheel];
  const eta = ss.dual ? 0.72 : 0.45, S0 = ss.dual ? 0.25 : 0.9;
  const hood = ss.hood === 'fixed' ? { kind: 'fixed', deg0: ss.hoodDeg * D2R }
    : ss.hood === 'flap' ? { kind: 'flap', lo: ss.hoodDeg * D2R, hi: (ss.hoodDeg + 12) * D2R }
      : { kind: 'adjustable' };
  const h0 = ss.hood === 'fixed' ? hood.deg0 : ss.hood === 'flap' ? hood.hi : 64 * D2R;
  return {
    i, type: ss.type, balls: ss.balls, faces: ss.faces * D2R, mx: ss.x, my: ss.y, mz: ss.z,
    hood: Object.assign(hood, { cur: h0, tgt: h0, rate: 5 }),
    fw: { rIn: fwd.rMm / 25.4, J: fwd.J[ss.inertia], eta, S0, n: ss.motors, wf: 6000 / 60 * 2 * Math.PI * FREE_FACTOR, ts: 0.1442,
      w: 0, wt: 0, u: 0, iA: 0, ctrl: ss.ctrl, integ: 0, meas: 0, band: ss.band, tick: 0, lastT: 0 },
    tur: { has: ss.type === 'turret', ang: 0, vel: 0, tgt: 0, half: Math.min(Math.PI * 0.999, ss.range / 2 * D2R), rate: 7, acc: 45, lock: false, lockAng: 0 },
    feed: { cd: 0, ball: null, t: 0, intP: 0.2 / ss.feed, intN: 0.3 / ss.feed },
    aim: { valid: false, locked: false, reason: 'CHỜ', D: 0, v: 0, th: 0, t: 0, az: 0, yawErr: 0, bt: BT_POLLEN, wt: 0 },
    shots: 0, made: 0,
  };
}
function makeRobot(sim, id, s) {
  const P = deriveRobot(s.spec || presetSpec(s.preset || 'turret'));
  // a team's own AUTO program brings its own start pose (checked against G304 in the editor)
  const pz = s.pose;
  const st = pz && Number.isFinite(pz.x) && Number.isFinite(pz.y) && Number.isFinite(pz.psi)
    ? { x: clamp(pz.x, -HALF + 1, HALF - 1), y: clamp(pz.y, -HALF + 1, HALF - 1), psi: wrap(pz.psi) }
    : startPose(s.alliance, s.start || (s.slot === 0 ? 'audience' : 'alliance'), P);
  const rb = {
    id, alliance: s.alliance, slot: s.slot, P, spec: P.spec, name: P.spec.name, team: String(s.team || 1000 + id).slice(0, 5),
    human: !!s.human, x: st.x, y: st.y, psi: st.psi, vx: 0, vy: 0, w: 0, m: P.m, I: P.I, hx: P.hx, hy: P.hy, h: P.h,
    px: st.x, py: st.y, ppsi: st.psi, pvx: 0, pvy: 0, acc: 0,
    cmd: { vx: 0, vy: 0, w: 0, slow: false }, enabled: false,
    intakeOn: true, outtake: false, fireHeld: false, fireReqT: 0, forceFire: false, autoFire: false, armHeld: false,
    turretLock: false, turretNudge: 0, shootAnywhere: false, shotPower: 1, turretFast: false, noiseMul: 1,
    hopper: [], shooters: P.spec.shooters.map((ss, i) => makeShooter(ss, i)),
    dunkT: 0, dunkFlower: -1, retrT: 0, retrFlower: -1, outCd: 0, flapT: 0,
    bat: { voc: BATTERY.voc - sim.rng() * 0.25, v: BATTERY.voc, i: 0, iF: 0, ah: 0 },
    swerve: [0, 0, 0, 0].map(() => ({ ang: 0, v: 0 })),
    est: { x: st.x, y: st.y, psi: st.psi }, odoK: 1 + gauss(sim.rng) * 0.003, odoH: 1 + gauss(sim.rng) * 0.001,
    loc: { lastFix: -9, tags: [], n: 0, err: 0, mode: P.odo },
    stats: { shots: 0, made: 0, pickups: 0, dunks: 0, dist: 0, fouls: 0 },
    _static: false, _bump: 0, wheelSlip: 0, startWall: true,
  };
  return rb;
}

// ---------------------------------------------------------------- HIVE transforms
function bodyToWorld(h, w, a, b) { const c = Math.cos(h.phi), s = Math.sin(h.phi); return [h.hx + w, a * c - b * s, HV.pz + a * s + b * c]; }
function worldToBody(h, x, y, z, out) {
  const c = Math.cos(h.phi), s = Math.sin(h.phi), zz = z - HV.pz;
  out[0] = x - h.hx; out[1] = y * c + zz * s; out[2] = -y * s + zz * c; return out;
}
function bodyDirToWorld(h, dw, da, db, out) { const c = Math.cos(h.phi), s = Math.sin(h.phi); out[0] = dw; out[1] = da * c - db * s; out[2] = da * s + db * c; return out; }
function aimPointWorld(h, side) {
  const sg = side, phi = sg * HV.stop, c = Math.cos(phi), s = Math.sin(phi);
  const a = sg * (HV.aOut - 2.5), b = HV.bAim;
  return [h.hx, a * c - b * s, HV.pz + a * s + b * c];
}
function insidePent(w, b, inset) {
  for (let i = 0; i < 5; i++) {
    const P = PENT[i], Q = PENT[(i + 1) % 5];
    const ex = Q[0] - P[0], eb = Q[1] - P[1], L = Math.hypot(ex, eb);
    if ((ex * (b - P[1]) - eb * (w - P[0])) / L < inset) return false;
  }
  return true;
}
const _bw = [0, 0, 0];
function ballInCell(h, b, sg) {
  worldToBody(h, b.x, b.y, b.z, _bw);
  const aa = _bw[1] * sg;
  return aa > HV.aIn && aa < HV.aOut && insidePent(_bw[0], _bw[2], 0);
}

// ---------------------------------------------------------------- closest point helpers
const _cp = [0, 0];
function closestOnPoly(poly, u, v, out) {
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    if ((Q[0] - P[0]) * (v - P[1]) - (Q[1] - P[1]) * (u - P[0]) < 0) { inside = false; break; }
  }
  if (inside) { out[0] = u; out[1] = v; return 0; }
  let best = 1e18;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const ex = Q[0] - P[0], ey = Q[1] - P[1];
    let t = ((u - P[0]) * ex + (v - P[1]) * ey) / (ex * ex + ey * ey); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = P[0] + ex * t, qy = P[1] + ey * t, d = (u - qx) * (u - qx) + (v - qy) * (v - qy);
    if (d < best) { best = d; out[0] = qx; out[1] = qy; }
  }
  return best;
}
function platePoint(pl, cx, cy, cz, res) {
  const dx = cx - pl.o[0], dy = cy - pl.o[1], dz = cz - pl.o[2];
  const u = dx * pl.u[0] + dy * pl.u[1] + dz * pl.u[2];
  const v = dx * pl.v[0] + dy * pl.v[1] + dz * pl.v[2];
  let qu, qv;
  if (pl.rect) { qu = u < 0 ? 0 : u > pl.lu ? pl.lu : u; qv = v < 0 ? 0 : v > pl.lv ? pl.lv : v; }
  else { closestOnPoly(pl.poly, u, v, _cp); qu = _cp[0]; qv = _cp[1]; }
  const qx = pl.o[0] + pl.u[0] * qu + pl.v[0] * qv, qy = pl.o[1] + pl.u[1] * qu + pl.v[1] * qv, qz = pl.o[2] + pl.u[2] * qu + pl.v[2] * qv;
  let nx = cx - qx, ny = cy - qy, nz = cz - qz; let d = Math.hypot(nx, ny, nz);
  if (d < 1e-7) { nx = pl.n[0]; ny = pl.n[1]; nz = pl.n[2]; d = 0; } else { nx /= d; ny /= d; nz /= d; }
  res[0] = d; res[1] = nx; res[2] = ny; res[3] = nz; res[4] = qx; res[5] = qy; res[6] = qz;
  return res;
}
function segPoint(ax, ay, az, bx, by, bz, px, py, pz, res) {
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  let t = ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / (ex * ex + ey * ey + ez * ez); t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + ex * t, qy = ay + ey * t, qz = az + ez * t;
  let nx = px - qx, ny = py - qy, nz = pz - qz; const d = Math.hypot(nx, ny, nz) || 1e-7;
  res[0] = d; res[1] = nx / d; res[2] = ny / d; res[3] = nz / d; res[4] = qx; res[5] = qy; res[6] = qz; return res;
}

// ---------------------------------------------------------------- contacts
const MAXC = 3000;
function Contact() {
  this.kind = 0; this.a = null; this.b = null; this.hv = null; this.key = 0;
  this.nx = 0; this.ny = 0; this.nz = 0; this.gap = 0; this.rx = 0; this.ry = 0; this.rz = 0;
  this.sx = 0; this.sy = 0; this.sz = 0; this.e = 0; this.mu = 0; this.roll = 0; this.jn = 0; this.j1 = 0; this.j2 = 0;
  this.qx = 0; this.qy = 0; this.qz = 0; this.mr = 0; this.imp = 0;
  this.t1x = 0; this.t1y = 0; this.t1z = 0; this.t2x = 0; this.t2y = 0; this.t2z = 0;
  this.mn = 0; this.m1 = 0; this.m2 = 0; this.cn = 0; this.c1 = 0; this.c2 = 0; this.bias = 0; this.vn0 = 0; this.mat = 0;
}
const POOL = []; for (let i = 0; i < MAXC; i++) POOL.push(new Contact());
let NC = 0;
let WARM = new Map();
const MAT_ID = { floor: 1, wall: 2, frame: 3, cell: 4, arm: 4, flower: 5, ring: 5, robot: 6, ball: 7 };
function addC(kind, a, nx, ny, nz, gap, mat, key, mid) {
  if (NC >= MAXC) return null;
  const c = POOL[NC++];
  c.kind = kind; c.a = a; c.b = null; c.hv = null; c.key = key; c.mat = mid || 0;
  c.nx = nx; c.ny = ny; c.nz = nz; c.gap = gap; c.e = mat[0]; c.mu = mat[1]; c.roll = mat[2];
  c.sx = 0; c.sy = 0; c.sz = 0; c.rx = 0; c.ry = 0; c.rz = 0; c.jn = 0; c.j1 = 0; c.j2 = 0; c.qx = 0; c.qy = 0; c.qz = 0;
  return c;
}
const _r = [0, 0, 0, 0, 0, 0, 0];
const _bb = [0, 0, 0];
const _n3 = [0, 0, 0];
function genContacts(sim) {
  NC = 0;
  const balls = sim.balls, nb = balls.length;
  for (let i = 0; i < nb; i++) {
    const b = balls[i]; if (b.state !== 'field') continue;
    b.nCont = 0;
    const r = b.r, spd = Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vz);
    const marg = spd * DT + 0.06;
    const K0 = b.id * 1000;
    if (b.z - r < marg) { addC(0, b, 0, 0, 1, b.z - r, MAT.floor, K0 + 1, 1); if (b.z - r < 0.02) b.fromTip = false; }
    if (b.z < WALL_H + 0.3) {
      if (b.x - r < -HALF + marg) addC(0, b, 1, 0, 0, b.x - r + HALF, MAT.wall, K0 + 2, 2);
      if (b.x + r > HALF - marg) addC(0, b, -1, 0, 0, HALF - b.x - r, MAT.wall, K0 + 3, 2);
      if (b.y - r < -HALF + marg) addC(0, b, 0, 1, 0, b.y - r + HALF, MAT.wall, K0 + 4, 2);
      if (b.y + r > HALF - marg) addC(0, b, 0, -1, 0, HALF - b.y - r, MAT.wall, K0 + 5, 2);
    }
    if (Math.abs(b.x) < 27 + r && Math.abs(b.y) < 22 + r && b.z < 47 + r) {
      for (let k = 0; k < FRAME_CAPS.length; k++) {
        const f = FRAME_CAPS[k];
        segPoint(f[0], f[1], f[2], f[3], f[4], f[5], b.x, b.y, b.z, _r);
        const gap = _r[0] - f[6] - r;
        if (gap < marg) addC(0, b, _r[1], _r[2], _r[3], gap, MAT.frame, K0 + 10 + k, 3);
      }
      for (let k = 0; k < 2; k++) {
        platePoint(LOGO_PLATES[k], b.x, b.y, b.z, _r);
        const gap = _r[0] - 0.15 - r;
        if (gap < marg) addC(0, b, _r[1], _r[2], _r[3], gap, MAT.frame, K0 + 20 + k, 3);
      }
      if (b.z < FOOT_BARS[0].z1 + r + marg) for (let k = 0; k < 2; k++) {
        const fb = FOOT_BARS[k];
        const qx = clamp(b.x, fb.x0, fb.x1), qy = clamp(b.y, fb.y0, fb.y1), qz = clamp(b.z, fb.z0, fb.z1);
        let nx = b.x - qx, ny = b.y - qy, nz = b.z - qz, d = Math.hypot(nx, ny, nz);
        if (d < 1e-7) { nx = 0; ny = 0; nz = 1; d = qz - fb.z1; } else { nx /= d; ny /= d; nz /= d; }
        const gap = d - r;
        if (gap < marg) addC(0, b, nx, ny, nz, gap, MAT.frame, K0 + 30 + k, 3);
      }
    }
    for (let hI = 0; hI < 2; hI++) {
      const h = sim.hives[hI];
      const dx = b.x - h.hx, dy = b.y, dz = b.z - HV.pz;
      if (dx * dx + dy * dy + dz * dz > (29 + r) * (29 + r)) continue;
      worldToBody(h, b.x, b.y, b.z, _bb);
      const w = _bb[0], a = _bb[1], bb = _bb[2];
      for (let sg = -1; sg <= 1; sg += 2) {
        const aa = a * sg;
        if (Math.abs(w) > 10.85 + r + marg || aa < HV.aIn - 0.4 - r - marg || aa > HV.aOut + 0.4 + r + marg || bb < HV.b0 - 0.4 - r - marg || bb > HV.bTop + 0.4 + r + marg) continue;
        const plates = CELL_PLATES[sg];
        for (let k = 0; k < plates.length; k++) {
          platePoint(plates[k], w, a, bb, _r);
          const gap = _r[0] - HV.pt - r;
          if (gap < marg) hiveContact(b, h, _r, gap, MAT.cell, K0 + 100 + hI * 50 + (sg > 0 ? 0 : 20) + k);
        }
      }
      if (Math.abs(w) < ARM_R + r + marg && bb < 1 + r + marg && bb > -3.2 - r - marg) {
        for (let k = 0; k < ARM_SEGS.length; k++) {
          const s = ARM_SEGS[k];
          segPoint(0, s[0], s[1], 0, s[2], s[3], w, a, bb, _r);
          const gap = _r[0] - ARM_R - r;
          if (gap < marg) hiveContact(b, h, _r, gap, MAT.arm, K0 + 140 + hI * 50 + k);
        }
      }
    }
    for (let k = 0; k < 4; k++) flowerContacts(sim, b, sim.flowers[k], marg);
    for (let k = 0; k < sim.robots.length; k++) robotBallContact(sim, sim.robots[k], b, marg);
    if (b.state !== 'field') continue;
    for (let j = i + 1; j < nb; j++) {
      const o = balls[j]; if (o.state !== 'field') continue;
      const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, rs = r + o.r;
      const m2 = marg + (Math.abs(o.vx) + Math.abs(o.vy) + Math.abs(o.vz)) * DT;
      if (Math.abs(dx) > rs + m2 || Math.abs(dy) > rs + m2 || Math.abs(dz) > rs + m2) continue;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d - rs >= m2) continue;
      const inv = d > 1e-7 ? 1 / d : 0;
      if (d - rs < 0.03) { b.fromTip = false; o.fromTip = false; }
      const c = addC(1, b, d > 1e-7 ? dx * inv : 0, d > 1e-7 ? dy * inv : 0, d > 1e-7 ? dz * inv : 1, d - rs, MAT.ball, 1e7 + b.id * 1000 + o.id, 7);
      if (c) c.b = o;
    }
  }
  return NC;
}
function hiveContact(b, h, res, gap, mat, key) {
  const n = bodyDirToWorld(h, res[1], res[2], res[3], _n3);
  const c = addC(2, b, n[0], n[1], n[2], gap, mat, key, 4); if (!c) return;
  c.hv = h;
  c.rx = b.x - n[0] * b.r - h.hx; c.ry = b.y - n[1] * b.r; c.rz = b.z - n[2] * b.r - HV.pz;
}
function flowerContacts(sim, b, f, marg) {
  const dx = b.x - f.x, dy = b.y - f.y, rho = Math.hypot(dx, dy), r = b.r;
  if (rho > 3.1 + r + marg || b.z > FL.backZ + FL.backR + r + marg) {
    if (b.flower === f.i && (rho > FL.rMidO + 0.5 || b.z > FL.zTop + r + 0.5)) b.flower = -1;
    return;
  }
  // a ball is in the FLOWER once its centre drops through the top ring opening; it leaves by popping back out the top
  if (b.flower !== f.i) { if (rho < FL.ri && b.z < FL.zTop + 0.5 && b.z > FL.zMid) { b.flower = f.i; enteredFlower(sim, b, f); } }
  else if (b.z > FL.zTop + r + 0.5 || rho > FL.rMidO + 0.5) b.flower = -1;
  const K = b.id * 1000 + 500 + f.i * 50;
  ringContacts(b, f, rho, dx, dy, FL.ri, FL.rTopO, FL.zTopB, FL.zTop, marg, K);
  ringContacts(b, f, rho, dx, dy, FL.rMidI, FL.rMidO, FL.zMidB, FL.zMid, marg, K + 10);
  ringContacts(b, f, rho, dx, dy, FL.rLowI, FL.rLowO, -0.2, FL.zLow, marg, K + 20);
  if (b.z > FL.pipeZ0 - r - marg && b.z < FL.pipeZ1 + r + marg) {
    for (let k = 0; k < 4; k++) {
      const px = f.x + (k & 1 ? FL.pipeD : -FL.pipeD), py = f.y + (k & 2 ? FL.pipeD : -FL.pipeD);
      segPoint(px, py, FL.pipeZ0, px, py, FL.pipeZ1, b.x, b.y, b.z, _r);
      const gap = _r[0] - FL.pipeR - r;
      if (gap < marg) addC(0, b, _r[1], _r[2], _r[3], gap, MAT.flower, K + 30 + k, 5);
    }
  }
  if (b.z > FL.zTop - r - marg) {
    const ux = f.ny, uy = -f.nx, vx = -f.nx, vy = -f.ny;          // u along the wall, v toward it
    for (let k = 0; k < 3; k++) {
      const q = FL.backSegs[k];
      segPoint(f.x + ux * q[0] + vx * q[1], f.y + uy * q[0] + vy * q[1], FL.backZ, f.x + ux * q[2] + vx * q[3], f.y + uy * q[2] + vy * q[3], FL.backZ, b.x, b.y, b.z, _r);
      const gap = _r[0] - FL.backR - r;
      if (gap < marg) addC(0, b, _r[1], _r[2], _r[3], gap, MAT.ring, K + 34 + k, 5);
    }
    for (let k = 0; k < 2; k++) {
      const q = FL.posts[k], px = f.x + ux * q[0] + vx * q[1], py = f.y + uy * q[0] + vy * q[1];
      segPoint(px, py, FL.zTop, px, py, FL.backZ, b.x, b.y, b.z, _r);
      const gap = _r[0] - FL.postR - r;
      if (gap < marg) addC(0, b, _r[1], _r[2], _r[3], gap, MAT.ring, K + 37 + k, 5);
    }
  }
}
// annular plate around a FLOWER axis: inner radius r1, outer r2, between z0 and z1
function ringContacts(b, f, rho, dx, dy, r1, r2, z0, z1, marg, K) {
  const r = b.r;
  if (b.z < z0 - r - marg || b.z > z1 + r + marg || rho > r2 + r + marg) return;
  const ux = rho > 1e-6 ? dx / rho : 1, uy = rho > 1e-6 ? dy / rho : 0;
  if (rho >= r1) {
    const qr = rho > r2 ? r2 : rho, qz = b.z < z0 ? z0 : b.z > z1 ? z1 : b.z;
    const er = rho - qr, ez = b.z - qz;
    let d = Math.hypot(er, ez), nr, nz;
    if (d < 1e-7) {
      const up = z1 - b.z, dn = b.z - z0, out = r2 - rho;
      if (up <= dn && up <= out) { nr = 0; nz = 1; d = -up; } else if (dn <= out) { nr = 0; nz = -1; d = -dn; } else { nr = 1; nz = 0; d = -out; }
    } else { nr = er / d; nz = ez / d; }
    if (d - r < marg) addC(0, b, ux * nr, uy * nr, nz, d - r, MAT.ring, K, 5);
    return;
  }
  // over the opening: its wall, and its top and bottom rims
  if (b.z > z0 && b.z < z1) { const gap = r1 - rho - r; if (gap < marg) addC(0, b, -ux, -uy, 0, gap, MAT.ring, K + 1, 5); }
  holeRim(b, f, ux, uy, r1, z1, marg, K + 2);
  holeRim(b, f, ux, uy, r1, z0, marg, K + 5);
}
// three points on a rim circle - the one nearest the ball and two more 120 degrees round - so a ball resting centred on
// an opening smaller than itself (NECTAR on the middle ring) sits on a tripod instead of sliding off a single point
function holeRim(b, f, ux, uy, R, z, marg, K) {
  for (let k = 0; k < 3; k++) {
    const c = k === 0 ? 1 : -0.5, s = k === 0 ? 0 : k === 1 ? 0.8660254 : -0.8660254;
    const qx = f.x + (ux * c - uy * s) * R, qy = f.y + (ux * s + uy * c) * R;
    const nx = b.x - qx, ny = b.y - qy, nz = b.z - z, d = Math.hypot(nx, ny, nz);
    const gap = d - FL.edge - b.r;
    if (gap < marg && d > 1e-7) addC(0, b, nx / d, ny / d, nz / d, gap, MAT.ring, K + k, 5);
  }
}
function torusContact(b, cx, cy, cz, R, rr, marg, mat, key) {
  const dx = b.x - cx, dy = b.y - cy, rho = Math.hypot(dx, dy);
  const ux = rho > 1e-6 ? dx / rho : 1, uy = rho > 1e-6 ? dy / rho : 0;
  const qx = cx + ux * R, qy = cy + uy * R, qz = cz;
  const nx = b.x - qx, ny = b.y - qy, nz = b.z - qz; const d = Math.hypot(nx, ny, nz);
  const gap = d - rr - b.r;
  if (gap >= marg || d < 1e-7) return;
  addC(0, b, nx / d, ny / d, nz / d, gap, mat, key, 5);
}
// G410: NECTAR may not enter a FLOWER before the last 60 seconds (MAJOR FOUL per NECTAR)
function enteredFlower(sim, b, f) {
  if (b.bt === BT_POLLEN || b.g410) return;
  const live = sim.phase === 'auto' || sim.phase === 'trans' || sim.phase === 'tele';
  if (!live || sim.flowersOpen || sim.t >= T_FLOWER) return;
  b.g410 = true;
  const by = b.placedBy >= 0 ? sim.robots[b.placedBy] : b.launchedBy >= 0 ? sim.robots[b.launchedBy] : null;
  const al = by ? by.alliance : allyOf(b.bt);
  foul(sim, al, 'major', 'G410', 'NECTAR vào FLOWER trước 1:00', by ? by.id : -1);
}
function robotBallContact(sim, rb, b, marg) {
  if (b.flower >= 0) return;            // inside a FLOWER the pipes are between the ball and any robot (G418)
  const r = b.r;
  const dx = b.x - rb.x, dy = b.y - rb.y;
  const reach = rb.enabled ? rb.P.intake.reach : 0;
  const ext = Math.max(rb.hx, rb.hy) + reach + 4.5;
  if (dx * dx + dy * dy > (ext + r + marg) * (ext + r + marg) || b.z > rb.h + r + marg) return;
  const c = Math.cos(rb.psi), s = Math.sin(rb.psi);
  const lx = c * dx + s * dy, ly = -s * dx + c * dy, lz = b.z;
  const IN = rb.P.intake;
  const xf = rb.hx + reach, xb = IN.back ? -(rb.hx + reach) : -rb.hx;
  // intake capture: ball meeting an intake face inside the window, not too fast relative to the rollers
  if (rb.enabled && rb.intakeOn && !rb.outtake && rb.hopper.length < 4 && lz < 6.5 && Math.abs(ly) < IN.w / 2 - 0.2 && legalFor(rb, b)) {
    const front = lx > xf - 2.5 && lx - r < xf + 0.8;
    const back = IN.back && lx < xb + 2.5 && lx + r > xb - 0.8;
    if (front || back) {
      const rvx = b.vx - rb.vx, rvy = b.vy - rb.vy;
      const into = -(c * rvx + s * rvy) * (front ? 1 : -1);
      if (into < 150) {
        b.state = 'held'; b.holder = rb.id; b.flower = -1; b.fromTip = false;
        b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
        rb.hopper.push({ ball: b, t: IN.xfer, cap: [lx, ly, lz], side: front ? 1 : -1 });
        rb.stats.pickups++;
        sim.events.push({ type: 'intake', robot: rb.id, bt: b.bt });
        return;
      }
    }
  }
  const x0 = xb, x1 = xf, zb = 0.3, zt = rb.h;
  const qx = lx < x0 ? x0 : lx > x1 ? x1 : lx;
  const qy = ly < -rb.hy ? -rb.hy : ly > rb.hy ? rb.hy : ly;
  const qz = lz < zb ? zb : lz > zt ? zt : lz;
  let nlx = lx - qx, nly = ly - qy, nlz = lz - qz; const d = Math.hypot(nlx, nly, nlz); let gap;
  if (d < 1e-6) {
    const px = Math.min(x1 - lx, lx - x0), py = rb.hy - Math.abs(ly), pz = zt - lz;
    if (pz < px && pz < py) { nlx = 0; nly = 0; nlz = 1; gap = -pz - r; }
    else if (px < py) { nlx = (x1 - lx) < (lx - x0) ? 1 : -1; nly = 0; nlz = 0; gap = -px - r; }
    else { nlx = 0; nly = ly > 0 ? 1 : -1; nlz = 0; gap = -py - r; }
  } else { nlx /= d; nly /= d; nlz /= d; gap = d - r; }
  if (gap >= marg + 0.5 * Math.hypot(rb.vx, rb.vy) * DT) return;
  const nx = c * nlx - s * nly, ny = s * nlx + c * nly;
  const cc = addC(0, b, nx, ny, nlz, gap, MAT.robot, b.id * 1000 + 400 + rb.id, 6); if (!cc) return;
  const px = b.x - nx * r, py = b.y - ny * r;
  cc.sx = rb.vx - rb.w * (py - rb.y); cc.sy = rb.vy + rb.w * (px - rb.x); cc.sz = 0;
  if (b.fromTip) {
    b.fromTip = false;
    if (rb._g409 !== b.tipT) { rb._g409 = b.tipT; sim.events.push({ type: 'rule', rule: 'G409', level: 'warn', robot: rb.id, text: 'G409: chạm bóng rơi từ HIVE vừa TIP (cảnh cáo)' }); }
  }
}
function legalFor(rb, b) {
  const pk = rb.P.intake.picks;
  if (b.bt === BT_POLLEN) return pk !== 'nectar';
  return pk !== 'pollen' && allyOf(b.bt) === rb.alliance;      // G408
}

// ---------------------------------------------------------------- solver
const SLOP = 0.004, BETA = 0.25, VREST = 12;
const _v = [0, 0, 0];
function relVel(c, out) {
  const a = c.a, ra = a.r;
  const rx = -c.nx * ra, ry = -c.ny * ra, rz = -c.nz * ra;
  let vx = a.vx + a.wy * rz - a.wz * ry, vy = a.vy + a.wz * rx - a.wx * rz, vz = a.vz + a.wx * ry - a.wy * rx;
  if (c.kind === 1) {
    const o = c.b, rb = o.r, qx = c.nx * rb, qy = c.ny * rb, qz = c.nz * rb;
    vx -= o.vx + o.wy * qz - o.wz * qy; vy -= o.vy + o.wz * qx - o.wx * qz; vz -= o.vz + o.wx * qy - o.wy * qx;
  } else if (c.kind === 2) { const w = c.hv.w; vy += w * c.rz; vz -= w * c.ry; }
  else { vx -= c.sx; vy -= c.sy; vz -= c.sz; }
  out[0] = vx; out[1] = vy; out[2] = vz; return out;
}
function applyN(c, lam) {
  const a = c.a, px = lam * c.nx, py = lam * c.ny, pz = lam * c.nz;
  a.vx += px * a.invM; a.vy += py * a.invM; a.vz += pz * a.invM;
  if (c.kind === 1) { const o = c.b; o.vx -= px * o.invM; o.vy -= py * o.invM; o.vz -= pz * o.invM; }
  else if (c.kind === 2) c.hv.w -= lam * c.cn / HV.I;
}
function applyT(c, jx, jy, jz, cr) {
  const a = c.a, ra = a.r;
  const rx = -c.nx * ra, ry = -c.ny * ra, rz = -c.nz * ra;
  a.vx += jx * a.invM; a.vy += jy * a.invM; a.vz += jz * a.invM;
  a.wx += (ry * jz - rz * jy) * a.invI; a.wy += (rz * jx - rx * jz) * a.invI; a.wz += (rx * jy - ry * jx) * a.invI;
  if (c.kind === 1) {
    const o = c.b, rb = o.r, qx = c.nx * rb, qy = c.ny * rb, qz = c.nz * rb;
    o.vx -= jx * o.invM; o.vy -= jy * o.invM; o.vz -= jz * o.invM;
    o.wx -= (qy * jz - qz * jy) * o.invI; o.wy -= (qz * jx - qx * jz) * o.invI; o.wz -= (qx * jy - qy * jx) * o.invI;
  } else if (c.kind === 2) c.hv.w -= cr / HV.I;
}
function preSolve(c) {
  const a = c.a; relVel(c, _v);
  const vn = _v[0] * c.nx + _v[1] * c.ny + _v[2] * c.nz;
  c.vn0 = vn;
  let invSum = a.invM;
  if (c.kind === 1) invSum += c.b.invM;
  if (c.kind === 2) { c.cn = c.ry * c.nz - c.rz * c.ny; invSum += c.cn * c.cn / HV.I; }
  c.mn = 1 / invSum;
  if (c.gap > SLOP) c.bias = -c.gap / DT;
  else {
    let bb = vn < -VREST ? -c.e * vn : 0;
    const push = BETA * (-c.gap - SLOP) / DT;
    if (push > bb) bb = Math.min(push, 30);
    c.bias = bb;
  }
  let tx = _v[0] - vn * c.nx, ty = _v[1] - vn * c.ny, tz = _v[2] - vn * c.nz;
  let tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-6) { if (Math.abs(c.nz) < 0.9) { tx = -c.ny; ty = c.nx; tz = 0; } else { tx = 1; ty = 0; tz = 0; } tl = Math.hypot(tx, ty, tz); }
  c.t1x = tx / tl; c.t1y = ty / tl; c.t1z = tz / tl;
  c.t2x = c.ny * c.t1z - c.nz * c.t1y; c.t2y = c.nz * c.t1x - c.nx * c.t1z; c.t2z = c.nx * c.t1y - c.ny * c.t1x;
  const it = a.invM * (1 + 1 / KI); let i1 = it, i2 = it;
  if (c.kind === 1) { const ib = c.b.invM * (1 + 1 / KI); i1 += ib; i2 += ib; }
  if (c.kind === 2) { c.c1 = c.ry * c.t1z - c.rz * c.t1y; c.c2 = c.ry * c.t2z - c.rz * c.t2y; i1 += c.c1 * c.c1 / HV.I; i2 += c.c2 * c.c2 / HV.I; }
  c.m1 = 1 / i1; c.m2 = 1 / i2;
  c.mr = 1 / (a.invI + (c.kind === 1 ? c.b.invI : 0));
  a.nCont++;
  if (c.gap <= SLOP) { const pj = WARM.get(c.key); if (pj) { c.jn = pj * 0.85; applyN(c, c.jn); } }
}
function solveContact(c) {
  const a = c.a;
  if (a.state !== 'field' || (c.kind === 1 && c.b.state !== 'field')) return;
  relVel(c, _v);
  const vn = _v[0] * c.nx + _v[1] * c.ny + _v[2] * c.nz;
  let lam = c.mn * (c.bias - vn);
  const nj = c.jn + lam > 0 ? c.jn + lam : 0; lam = nj - c.jn; c.jn = nj;
  if (lam !== 0) applyN(c, lam);
  if (c.jn <= 0) return;
  const lim = c.mu * c.jn;
  relVel(c, _v);
  let l1 = -c.m1 * (_v[0] * c.t1x + _v[1] * c.t1y + _v[2] * c.t1z);
  let n1 = c.j1 + l1; n1 = n1 < -lim ? -lim : n1 > lim ? lim : n1; l1 = n1 - c.j1; c.j1 = n1;
  if (l1 !== 0) applyT(c, l1 * c.t1x, l1 * c.t1y, l1 * c.t1z, l1 * c.c1);
  relVel(c, _v);
  let l2 = -c.m2 * (_v[0] * c.t2x + _v[1] * c.t2y + _v[2] * c.t2z);
  let n2 = c.j2 + l2; n2 = n2 < -lim ? -lim : n2 > lim ? lim : n2; l2 = n2 - c.j2; c.j2 = n2;
  if (l2 !== 0) applyT(c, l2 * c.t2x, l2 * c.t2y, l2 * c.t2z, l2 * c.c2);
  let wx = a.wx, wy = a.wy, wz = a.wz;
  if (c.kind === 1) { wx -= c.b.wx; wy -= c.b.wy; wz -= c.b.wz; }
  const rl = c.roll * a.r * c.jn;
  let ax = c.qx - wx * c.mr, ay = c.qy - wy * c.mr, az = c.qz - wz * c.mr;
  const am = Math.hypot(ax, ay, az);
  if (am > rl) { const f = rl / am; ax *= f; ay *= f; az *= f; }
  const dx = ax - c.qx, dy = ay - c.qy, dz = az - c.qz; c.qx = ax; c.qy = ay; c.qz = az;
  a.wx += dx * a.invI; a.wy += dy * a.invI; a.wz += dz * a.invI;
  if (c.kind === 1) { const o = c.b; o.wx -= dx * o.invI; o.wy -= dy * o.invI; o.wz -= dz * o.invI; }
}
function hivePre(h) {
  const near = 1.2 * D2R;
  h.sp = 0; h.sL = 0;
  if (h.phi > HV.stop - near) h.sp = 1; else if (h.phi < -HV.stop + near) h.sp = -1;
  if (h.sp) {
    const gap = HV.stop - h.sp * h.phi, into0 = h.sp * h.w0;
    h.sAllow = gap > 1e-4 ? gap / DT : (into0 > 0.35 ? -HV.rest * into0 : 0);
  }
}
function hiveSolve(h) {
  if (!h.sp) return;
  const into = h.sp * h.w;
  let lam = (into - h.sAllow) * HV.I;
  const nL = h.sL + lam > 0 ? h.sL + lam : 0; lam = nL - h.sL; h.sL = nL;
  h.w -= h.sp * lam / HV.I;
}

// ---------------------------------------------------------------- drivetrains (motor curves, battery sag, traction)
function battery(rb) { return rb.bat.v; }
function driveRobot(sim, rb) {
  const P = rb.P, D = P.drive, Vb = rb.bat.v;
  let f = 0, st = 0, tw = 0;
  const c = Math.cos(rb.psi), s = Math.sin(rb.psi);
  if (rb.enabled) {
    f = rb.cmd.vx * c + rb.cmd.vy * s; st = -rb.cmd.vx * s + rb.cmd.vy * c; tw = rb.cmd.w;
    if (rb.cmd.slow) { f *= 0.35; st *= 0.35; tw *= 0.4; }
  }
  const vxb = rb.vx * c + rb.vy * s, vyb = -rb.vx * s + rb.vy * c;
  const Fs = D.Fs, vf = D.vf, Vr = Vb / 12;
  let Fx = 0, Fy = 0, T = 0, Ibat = 0, slip = 0;
  if (D.type === 'mecanum') {
    const u0 = f - st - tw, u1 = f + st + tw, u2 = f + st - tw, u3 = f - st + tw;
    const um = Math.max(1, Math.abs(u0), Math.abs(u1), Math.abs(u2), Math.abs(u3));
    const vy2 = vyb / D.strafeEff, wl = rb.w * D.wl;
    const us = [u0 / um, u1 / um, u2 / um, u3 / um], vs = [vxb - vy2 - wl, vxb + vy2 + wl, vxb + vy2 - wl, vxb - vy2 + wl];
    const Fmax = D.mu * rb.m * G / 4 / Math.SQRT2;
    const F = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const raw = Fs * (us[k] * Vr - vs[k] / vf);
      F[k] = clamp(raw, -Fmax, Fmax);
      if (Math.abs(raw) > Fmax) slip += (Math.abs(raw) - Fmax) / Fs;
      Ibat += Math.max(0, us[k] * MOTOR_IS * F[k] / Fs);
    }
    Fx = F[0] + F[1] + F[2] + F[3]; Fy = (-F[0] + F[1] + F[2] - F[3]) * D.strafeEff; T = D.wl * (-F[0] + F[1] - F[2] + F[3]);
    Fx -= rb.m * 0.8 * vxb; Fy -= rb.m * 1.6 * vyb; T -= rb.I * 0.8 * rb.w;
    rb.wheelV = vs;
  } else if (D.type === 'tank') {
    let uL = f - tw, uR = f + tw;
    const um = Math.max(1, Math.abs(uL), Math.abs(uR)); uL /= um; uR /= um;
    const vL = vxb - rb.w * D.ly, vR = vxb + rb.w * D.ly;
    const Fmax = D.mu * rb.m * G / 2;
    const rawL = 2 * Fs * (uL * Vr - vL / vf), rawR = 2 * Fs * (uR * Vr - vR / vf);
    const FL_ = clamp(rawL, -Fmax, Fmax), FR = clamp(rawR, -Fmax, Fmax);
    slip += (Math.max(0, Math.abs(rawL) - Fmax) + Math.max(0, Math.abs(rawR) - Fmax)) / (2 * Fs);
    Ibat += 2 * Math.max(0, uL * MOTOR_IS * FL_ / (2 * Fs)) + 2 * Math.max(0, uR * MOTOR_IS * FR / (2 * Fs));
    Fx = FL_ + FR - rb.m * 0.5 * vxb; T = (FR - FL_) * D.ly;
    // traction wheels do not slide sideways; skid-steer scrub resists turning
    Fy = -clamp(vyb * rb.m * 40, -D.mu * rb.m * G, D.mu * rb.m * G);
    T -= clamp(rb.w * rb.I * 9, -0.35 * D.mu * rb.m * G * D.lx, 0.35 * D.mu * rb.m * G * D.lx);
    rb.wheelV = [vL, vR, vL, vR];
  } else {
    // swerve: each module steers toward its wheel velocity vector, then drives along it
    const R0 = Math.hypot(D.lx, D.ly), wcmd = tw * vf / R0;
    const mods = [[D.lx, D.ly], [D.lx, -D.ly], [-D.lx, D.ly], [-D.lx, -D.ly]];
    let vmax = 0; const want = [];
    for (let k = 0; k < 4; k++) {
      const mx = mods[k][0], my = mods[k][1];
      const wx = f * vf - wcmd * my, wy = st * vf + wcmd * mx;
      want.push([wx, wy]); vmax = Math.max(vmax, Math.hypot(wx, wy));
    }
    const sc = vmax > vf ? vf / vmax : 1;
    const Fmax = D.mu * rb.m * G / 4;
    for (let k = 0; k < 4; k++) {
      const m = rb.swerve[k], mx = mods[k][0], my = mods[k][1];
      const wx = want[k][0] * sc, wy = want[k][1] * sc, sp = Math.hypot(wx, wy);
      let spd = sp / vf;
      if (sp > vf * 0.02) {
        let ta = Math.atan2(wy, wx);
        if (Math.abs(wrap(ta - m.ang)) > Math.PI / 2) { ta = wrap(ta + Math.PI); spd = -spd; }
        const e = wrap(ta - m.ang), stp = D.steerRate * DT;
        m.ang = wrap(m.ang + clamp(e, -stp, stp));
        spd *= Math.max(0, Math.cos(wrap(ta - m.ang)));
      } else spd = 0;
      const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
      const pvx = vxb - rb.w * my, pvy = vyb + rb.w * mx;
      const vpar = pvx * ca + pvy * sa, vperp = -pvx * sa + pvy * ca;
      const raw = Fs * (spd * Vr - vpar / vf);
      const Fp = clamp(raw, -Fmax, Fmax);
      if (Math.abs(raw) > Fmax) slip += (Math.abs(raw) - Fmax) / Fs;
      const Fl = -clamp(vperp * rb.m / 4 * 40, -Fmax, Fmax);
      Ibat += Math.max(0, spd * MOTOR_IS * Fp / Fs);
      const fx = Fp * ca - Fl * sa, fy = Fp * sa + Fl * ca;
      Fx += fx; Fy += fy; T += mx * fy - my * fx;
      m.v = vpar;
    }
    Fx -= rb.m * 0.4 * vxb; Fy -= rb.m * 0.4 * vyb; T -= rb.I * 0.5 * rb.w;
    Ibat += rb.enabled ? 1.2 : 0;                        // steering servos
  }
  rb.vx += (Fx * c - Fy * s) / rb.m * DT; rb.vy += (Fx * s + Fy * c) / rb.m * DT; rb.w += T / rb.I * DT;
  rb.wheelSlip = slip;
  rb.bat.iDrive = Ibat;
}
function updateBattery(rb) {
  const B = rb.bat;
  let I = 0.8 + (B.iDrive || 0);                       // Control Hub, sensors, drive
  for (const sh of rb.shooters) I += sh.fw.iA;
  if (rb.enabled && rb.intakeOn) I += 1.4 * (rb.P.intake.back ? 2 : 1);
  if (rb.enabled) I += 0.4 * rb.shooters.length;       // servos holding
  B.i = I; B.iF += (I - B.iF) * 0.2;
  B.ah += I * DT / 3600;
  B.v = Math.max(6, (B.voc - BATTERY.sag * B.ah) - B.iF * BATTERY.rInt);
}

// ---------------------------------------------------------------- robot-robot and static collisions (2D)
function obbAxes(b) { const c = Math.cos(b.psi || 0), s = Math.sin(b.psi || 0); return [c, s, -s, c]; }
const _ca = new Array(8), _cb = new Array(8);
function boxCorners(b, out) {
  const c = Math.cos(b.psi || 0), s = Math.sin(b.psi || 0), hx = b.hx, hy = b.hy; let k = 0;
  out[k++] = b.x + c * hx - s * hy; out[k++] = b.y + s * hx + c * hy;
  out[k++] = b.x + c * hx + s * hy; out[k++] = b.y + s * hx - c * hy;
  out[k++] = b.x - c * hx + s * hy; out[k++] = b.y - s * hx - c * hy;
  out[k++] = b.x - c * hx - s * hy; out[k++] = b.y - s * hx + c * hy;
  return out;
}
function sat(A, Bb) {
  const ax = obbAxes(A), bx = obbAxes(Bb);
  const axes = [ax[0], ax[1], ax[2], ax[3], bx[0], bx[1], bx[2], bx[3]];
  const dx = Bb.x - A.x, dy = Bb.y - A.y;
  let best = 1e9, bnx = 0, bny = 0, bi = -1;
  for (let i = 0; i < 4; i++) {
    const nx = axes[2 * i], ny = axes[2 * i + 1];
    const ra = A.hx * Math.abs(ax[0] * nx + ax[1] * ny) + A.hy * Math.abs(ax[2] * nx + ax[3] * ny);
    const rb = Bb.hx * Math.abs(bx[0] * nx + bx[1] * ny) + Bb.hy * Math.abs(bx[2] * nx + bx[3] * ny);
    const d = dx * nx + dy * ny, o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; bnx = d < 0 ? -nx : nx; bny = d < 0 ? -ny : ny; bi = i; }
  }
  let px = 0, py = 0;
  if (bi < 2) { const cs = boxCorners(Bb, _cb); let m = 1e9; for (let k = 0; k < 4; k++) { const p = cs[2 * k] * bnx + cs[2 * k + 1] * bny; if (p < m) { m = p; px = cs[2 * k]; py = cs[2 * k + 1]; } } }
  else { const cs = boxCorners(A, _ca); let m = -1e9; for (let k = 0; k < 4; k++) { const p = cs[2 * k] * bnx + cs[2 * k + 1] * bny; if (p > m) { m = p; px = cs[2 * k]; py = cs[2 * k + 1]; } } }
  return { nx: bnx, ny: bny, depth: best, px, py };
}
// true clearance between two robot frames (0 when touching)
function pointBoxDist(px, py, b) {
  const c = Math.cos(b.psi), s = Math.sin(b.psi), dx = px - b.x, dy = py - b.y;
  const ex = Math.max(0, Math.abs(c * dx + s * dy) - b.hx), ey = Math.max(0, Math.abs(-s * dx + c * dy) - b.hy);
  return Math.hypot(ex, ey);
}
const _g1 = new Array(8), _g2 = new Array(8);
function boxGap(A, B) {
  if (sat(A, B)) return 0;
  const ca = boxCorners(A, _g1), cb = boxCorners(B, _g2);
  let best = 1e9;
  for (let k = 0; k < 4; k++) best = Math.min(best, pointBoxDist(cb[2 * k], cb[2 * k + 1], A), pointBoxDist(ca[2 * k], ca[2 * k + 1], B));
  return best;
}
function impulseRR(A, B, nx, ny, depth, px, py) {
  const iA = 1 / A.m, iB = B ? 1 / B.m : 0;
  const corr = Math.max(depth - 0.01, 0) * 0.85 / (iA + iB);
  A.x -= nx * corr * iA; A.y -= ny * corr * iA;
  if (B) { B.x += nx * corr * iB; B.y += ny * corr * iB; }
  const rax = px - A.x, ray = py - A.y;
  const vax = A.vx - A.w * ray, vay = A.vy + A.w * rax;
  let vbx = 0, vby = 0, rbx = 0, rby = 0;
  if (B) { rbx = px - B.x; rby = py - B.y; vbx = B.vx - B.w * rby; vby = B.vy + B.w * rbx; }
  const rvx = vbx - vax, rvy = vby - vay;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const ca = rax * ny - ray * nx, cb = rbx * ny - rby * nx;
  const k = iA + iB + ca * ca / A.I + (B ? cb * cb / B.I : 0);
  const j = -1.05 * vn / k;
  A.vx -= j * nx * iA; A.vy -= j * ny * iA; A.w -= j * ca / A.I;
  if (B) { B.vx += j * nx * iB; B.vy += j * ny * iB; B.w += j * cb / B.I; }
  const tx = -ny, ty = nx; const vt = rvx * tx + rvy * ty;
  const ta = rax * ty - ray * tx, tb = rbx * ty - rby * tx;
  const kt = iA + iB + ta * ta / A.I + (B ? tb * tb / B.I : 0);
  let jt = -vt / kt; const lim = 0.35 * j; jt = clamp(jt, -lim, lim);
  A.vx -= jt * tx * iA; A.vy -= jt * ty * iA; A.w -= jt * ta / A.I;
  if (B) { B.vx += jt * tx * iB; B.vy += jt * ty * iB; B.w += jt * tb / B.I; }
  A._bump += j * iA; if (B) B._bump += j * iB;
  return j;
}
// floor footprint of each HIVE leg up to height h: segment from the foot to where the leg is at height h
function legObstacles(h) {
  const out = [];
  for (const L of LEGS) {
    const f = clamp((h - L[2]) / (L[5] - L[2]), 0, 1);
    out.push([L[0], L[1], L[0] + (L[3] - L[0]) * f, L[1] + (L[4] - L[1]) * f]);
  }
  return out;
}
function robotStatic(sim, rb) {
  const cs = boxCorners(rb, _ca);
  for (let k = 0; k < 4; k++) {
    const x = cs[2 * k], y = cs[2 * k + 1];
    if (x < -HALF) { impulseRR(rb, null, -1, 0, -HALF - x, x, y); rb._static = true; }
    if (x > HALF) { impulseRR(rb, null, 1, 0, x - HALF, x, y); rb._static = true; }
    if (y < -HALF) { impulseRR(rb, null, 0, -1, -HALF - y, x, y); rb._static = true; }
    if (y > HALF) { impulseRR(rb, null, 0, 1, y - HALF, x, y); rb._static = true; }
  }
  for (const f of sim.flowers) {
    const bx = f.box; const box = { x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2, psi: 0, hx: (bx.x1 - bx.x0) / 2, hy: (bx.y1 - bx.y0) / 2 };
    if (Math.abs(box.x - rb.x) > 22 || Math.abs(box.y - rb.y) > 22) continue;
    const res = sat(rb, box); if (res) { impulseRR(rb, null, res.nx, res.ny, res.depth, res.px, res.py); rb._static = true; }
  }
  for (const fb of FOOT_BARS) {
    const box = { x: (fb.x0 + fb.x1) / 2, y: (fb.y0 + fb.y1) / 2, psi: 0, hx: (fb.x1 - fb.x0) / 2, hy: (fb.y1 - fb.y0) / 2 };
    if (Math.abs(box.x - rb.x) > 20 || Math.abs(box.y - rb.y) > 34) continue;
    const res = sat(rb, box); if (res) { impulseRR(rb, null, res.nx, res.ny, res.depth, res.px, res.py); rb._static = true; }
  }
  if (Math.abs(rb.x) < 42 && Math.abs(rb.y) < 36) {
    const legs = rb.legs || (rb.legs = legObstacles(rb.h));
    const c = Math.cos(rb.psi), s = Math.sin(rb.psi);
    for (const L of legs) {
      for (let q = 0; q <= 4; q++) {
        const ox = L[0] + (L[2] - L[0]) * q / 4, oy = L[1] + (L[3] - L[1]) * q / 4, rad = 0.7;
        const dx = ox - rb.x, dy = oy - rb.y;
        const lx = c * dx + s * dy, ly = -s * dx + c * dy;
        const qx = clamp(lx, -rb.hx, rb.hx), qy = clamp(ly, -rb.hy, rb.hy);
        const ex = lx - qx, ey = ly - qy; const d = Math.hypot(ex, ey);
        if (d >= rad) continue;
        let nlx, nly, depth;
        if (d < 1e-6) { const px = rb.hx - Math.abs(lx), py = rb.hy - Math.abs(ly); if (px < py) { nlx = Math.sign(lx) || 1; nly = 0; depth = px + rad; } else { nlx = 0; nly = Math.sign(ly) || 1; depth = py + rad; } }
        else { nlx = ex / d; nly = ey / d; depth = rad - d; }
        impulseRR(rb, null, c * nlx - s * nly, s * nlx + c * nly, depth, rb.x + c * qx - s * qy, rb.y + s * qx + c * qy);
        rb._static = true;
      }
    }
  }
}

// ---------------------------------------------------------------- vision (AprilTag clusters on the CELL bottoms)
function tagPoses(sim) {
  const out = sim._tags || (sim._tags = []);
  out.length = 0;
  for (const h of sim.hives) {
    for (const sg of [1, -1]) {
      const base = TAG_BASE[h.alliance][sg];
      for (let k = 0; k < 4; k++) {
        const o = TAG_OFF[k];
        const p = bodyToWorld(h, sg * o[0], sg * (TAG_A_MID + o[1]), TAG_B);
        const n = bodyDirToWorld(h, 0, 0, -1, [0, 0, 0]);
        const up = bodyDirToWorld(h, 0, sg, 0, [0, 0, 0]);
        const rt = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
        out.push({ id: base + k, hive: h, alliance: h.alliance, sg, x: p[0], y: p[1], z: p[2], n, up, rt });
      }
    }
  }
  return out;
}
function cameraPose(rb) {
  const cam = rb.P.camera;
  let yaw, cx, cy, cz = cam.h;
  const c = Math.cos(rb.psi), s = Math.sin(rb.psi);
  if (cam.mount === 'turret0' && rb.shooters[0] && rb.shooters[0].tur.has) {
    const sh = rb.shooters[0];
    yaw = rb.psi + sh.faces + sh.tur.ang;
    const bx = rb.x + c * sh.mx - s * sh.my, by = rb.y + s * sh.mx + c * sh.my;
    cx = bx + Math.cos(yaw) * 3.2; cy = by + Math.sin(yaw) * 3.2; cz = sh.mz + 1.4;
  } else {
    const back = cam.mount === 'back';
    yaw = rb.psi + (back ? Math.PI : 0);
    const lx = back ? -rb.hx + 0.6 : rb.hx - 0.6;
    cx = rb.x + c * lx; cy = rb.y + s * lx;
  }
  const pitch = cam.pitch * D2R, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.cos(yaw) * cp, Math.sin(yaw) * cp, sp];
  const r = [Math.sin(yaw), -Math.cos(yaw), 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { x: cx, y: cy, z: cz, f, r, u, yaw, pitch, fovH: 63 * D2R, fovV: 49 * D2R };
}
function segBlockedByRobot(sim, rbSelf, ax, ay, az, bx, by, bz) {
  for (const o of sim.robots) {
    if (o === rbSelf) continue;
    const c = Math.cos(o.psi), s = Math.sin(o.psi);
    const lax = c * (ax - o.x) + s * (ay - o.y), lay = -s * (ax - o.x) + c * (ay - o.y);
    const lbx = c * (bx - o.x) + s * (by - o.y), lby = -s * (bx - o.x) + c * (by - o.y);
    let t0 = 0, t1 = 1, hit = true;
    const Pp = [lax, lay, az], Dd = [lbx - lax, lby - lay, bz - az], mn = [-o.hx, -o.hy, 0], mx = [o.hx, o.hy, o.h + 4];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(Dd[i]) < 1e-9) { if (Pp[i] < mn[i] || Pp[i] > mx[i]) { hit = false; break; } }
      else { let ta = (mn[i] - Pp[i]) / Dd[i], tb = (mx[i] - Pp[i]) / Dd[i]; if (ta > tb) { const q = ta; ta = tb; tb = q; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { hit = false; break; } }
    }
    if (hit) return true;
  }
  return false;
}
const _sA = [0, 0, 0], _sB = [0, 0, 0];
function segBlockedByCells(sim, tag, ax, ay, az, bx, by, bz) {
  for (const h of sim.hives) {
    worldToBody(h, ax, ay, az, _sA); worldToBody(h, bx, by, bz, _sB);
    for (const sg of [1, -1]) {
      if (h === tag.hive && sg === tag.sg) continue;
      const mn0 = -10.5, mx0 = 10.5, mn1 = sg > 0 ? HV.aIn : -HV.aOut, mx1 = sg > 0 ? HV.aOut : -HV.aIn, mn2 = HV.b0 - 0.3, mx2 = HV.bTop + 0.3;
      let t0 = 0, t1 = 1, hit = true;
      const mn = [mn0, mn1, mn2], mx = [mx0, mx1, mx2];
      for (let i = 0; i < 3; i++) {
        const d = _sB[i] - _sA[i];
        if (Math.abs(d) < 1e-9) { if (_sA[i] < mn[i] || _sA[i] > mx[i]) { hit = false; break; } }
        else { let ta = (mn[i] - _sA[i]) / d, tb = (mx[i] - _sA[i]) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { hit = false; break; } }
      }
      if (hit) return true;
    }
  }
  return false;
}
const PIX_W = 640;
function detectTags(sim, rb, tags) {
  const cam = cameraPose(rb);
  const res = [];
  const fpx = (PIX_W / 2) / Math.tan(cam.fovH / 2);
  for (const tg of tags) {
    const dx = tg.x - cam.x, dy = tg.y - cam.y, dz = tg.z - cam.z;
    const depth = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (depth < 6) continue;
    const xr = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2];
    const yu = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
    const ax = Math.atan2(xr, depth), ay = Math.atan2(yu, depth);
    if (Math.abs(ax) > cam.fovH / 2 - 0.03 || Math.abs(ay) > cam.fovV / 2 - 0.03) continue;
    const dist = Math.hypot(dx, dy, dz);
    const facing = -(dx * tg.n[0] + dy * tg.n[1] + dz * tg.n[2]) / dist;
    if (facing < 0.26) continue;
    const px = fpx * TAG_SIZE * Math.sqrt(facing) / depth;
    if (px < 14) continue;
    if (segBlockedByRobot(sim, rb, cam.x, cam.y, cam.z, tg.x, tg.y, tg.z)) continue;
    if (segBlockedByCells(sim, tg, cam.x, cam.y, cam.z, tg.x, tg.y, tg.z)) continue;
    res.push({ id: tg.id, tag: tg, dist, tx: ax / D2R, ty: ay / D2R, px, facing });
  }
  return res;
}

// ---------------------------------------------------------------- localization: odometry pods + IMU, fused with AprilTag fixes
function odometryStep(sim, rb) {
  const dx = rb.x - rb.px, dy = rb.y - rb.py, dpsi = wrap(rb.psi - rb.ppsi);
  const c0 = Math.cos(rb.ppsi), s0 = Math.sin(rb.ppsi);
  const fx = c0 * dx + s0 * dy, fy = -s0 * dx + c0 * dy, ds = Math.hypot(fx, fy);
  rb.stats.dist += ds;
  const pods = rb.loc.mode !== 'tag';
  // dead-wheel pods: ~0.3 % scale error + random walk; heading from the IMU
  const nk = pods ? 0.02 : 0.06;
  const mfx = fx * rb.odoK + gauss(sim.rng) * nk * Math.sqrt(ds), mfy = fy * rb.odoK + gauss(sim.rng) * nk * Math.sqrt(ds);
  const mdp = dpsi * rb.odoH;
  const e = rb.est, ce = Math.cos(e.psi), se = Math.sin(e.psi);
  e.x += ce * mfx - se * mfy; e.y += se * mfx + ce * mfy; e.psi = wrap(e.psi + mdp);
  if (rb._bump > 25) { const k = 0.004 * rb._bump; e.x += gauss(sim.rng) * k; e.y += gauss(sim.rng) * k; e.psi = wrap(e.psi + gauss(sim.rng) * k * 0.002); }
  rb._bump = 0;
  rb.px = rb.x; rb.py = rb.y; rb.ppsi = rb.psi;
}
function visionStep(sim, rb, tags) {
  const det = detectTags(sim, rb, tags);
  rb.loc.tags = det; rb.loc.n = det.length;
  const e = rb.est;
  if (det.length && rb.loc.mode !== 'odometry' && Math.abs(rb.w) < 3 && Math.hypot(rb.vx, rb.vy) < 75) {
    let dmin = 1e9; for (const d of det) if (d.dist < dmin) dmin = d.dist;
    const sig = (0.08 + 0.00012 * dmin * dmin) / Math.sqrt(det.length);
    const mx = rb.x + gauss(sim.rng) * sig, my = rb.y + gauss(sim.rng) * sig;
    const k = rb.loc.mode === 'tag' ? 1 : 0.35;
    e.x += (mx - e.x) * k; e.y += (my - e.y) * k;
    rb.loc.lastFix = sim.t;
  }
  rb.loc.err = Math.hypot(e.x - rb.x, e.y - rb.y);
}

// ---------------------------------------------------------------- shooters: aim solve, turret, hood, flywheel control, feed and launch
function shooterBase(rb, sh, est) {
  const px = est ? rb.est.x : rb.x, py = est ? rb.est.y : rb.y, psi = est ? rb.est.psi : rb.psi;
  const c = Math.cos(psi), s = Math.sin(psi);
  return [px + c * sh.mx - s * sh.my, py + s * sh.mx + c * sh.my, psi];
}
function shooterYaw(rb, sh, psi) { return psi + sh.faces + (sh.tur.has ? sh.tur.ang : 0); }
function muzzle(rb, sh, est) {
  const b = shooterBase(rb, sh, est), yaw = shooterYaw(rb, sh, b[2]);
  return [b[0] + Math.cos(yaw) * 1.5, b[1] + Math.sin(yaw) * 1.5, sh.mz, yaw];
}
function accepts(sh, bt) { return sh.balls === 'both' || (sh.balls === 'pollen' ? bt === BT_POLLEN : bt !== BT_POLLEN); }
function nextBallFor(rb, sh) {
  for (const q of rb.hopper) if (q.t <= 0 && accepts(sh, q.ball.bt)) return q.ball.bt;
  for (const q of rb.hopper) if (accepts(sh, q.ball.bt)) return q.ball.bt;
  return -1;
}
function hiveOf(sim, al) { return sim.hives[al === 'R' ? 0 : 1]; }
function aimShooters(sim, rb) {
  const h = hiveOf(sim, rb.alliance);
  const moving = Math.abs(h.w) > 0.15;
  const tgt = aimPointWorld(h, h.side);
  const tagMode = rb.loc.mode === 'tag';
  const seesTarget = rb.loc.tags.some(d => d.tag.hive === h && d.tag.sg === h.side);
  if (tagMode && seesTarget) rb.loc.lastTarget = sim.t;
  const tagOk = !tagMode || sim.t - (rb.loc.lastTarget || -9) < 0.35;
  for (const sh of rb.shooters) {
    const A = sh.aim;
    const bt0 = nextBallFor(rb, sh);
    const bt = bt0 < 0 ? (sh.balls === 'nectar' ? (rb.alliance === 'R' ? BT_RED : BT_BLUE) : BT_POLLEN) : bt0;
    A.bt = bt; A.empty = bt0 < 0;
    if (moving) { A.valid = false; A.reason = 'HIVE ĐANG LẬT'; continue; }
    if (!tagOk) { A.valid = false; A.reason = 'KHÔNG THẤY TAG'; continue; }
    const base = shooterBase(rb, sh, true);
    let tx = tgt[0], ty = tgt[1], sol = null, Dd = 0;
    const lead = rb.P.lead;
    for (let it = 0; it < (lead ? 3 : 1); it++) {
      Dd = Math.hypot(tx - base[0], ty - base[1]) - 1.5;
      sol = shotLookup(sh, bt, Dd);
      if (!sol) break;
      if (lead) { tx = tgt[0] - rb.vx * sol.t; ty = tgt[1] - rb.vy * sol.t; }
    }
    const wmax = sh.fw.wf * 1.02 * (rb.bat.v / 12);
    if (!sol) { A.valid = false; A.reason = Dd < 24 ? 'QUÁ GẦN' : 'NGOÀI TẦM'; continue; }
    const wt = sol.v / (sh.fw.eta * sh.fw.rIn);
    if (wt > wmax * 0.95) { A.valid = false; A.reason = 'QUÁ XA'; continue; }
    // the team's code knows the field: no shot through the HIVE frame or from behind the CELL
    const az0 = Math.atan2(ty - base[1], tx - base[0]);
    const key = Math.round(base[0] * 0.5) + ',' + Math.round(base[1] * 0.5) + ',' + h.side + ',' + (bt ? 1 : 0) + ',' + Math.round(rb.vx * 0.2) + ',' + Math.round(rb.vy * 0.2);
    if (A.clearKey !== key) { A.clearKey = key; A.clear = shotClear(sim, rb.alliance, sh, base[0], base[1], bt, sol, az0, rb.vx, rb.vy); }
    if (!A.clear) { A.valid = false; A.reason = 'KHÔNG CÓ ĐƯỜNG BẮN'; continue; }
    A.valid = true; A.reason = 'TRACKING';
    A.D = Dd; A.v = sol.v; A.th = sol.th; A.t = sol.t; A.wt = wt;
    A.az = Math.atan2(ty - base[1], tx - base[0]);
    A.tx = tx; A.ty = ty; A.rvx = rb.vx; A.rvy = rb.vy;
  }
}
// run every step: turret servo, hood servo, flywheel motor + controller, lock state, feed
function shooterStep(sim, rb, dt) {
  const V = rb.bat.v;
  for (const sh of rb.shooters) {
    const A = sh.aim, T = sh.tur, H = sh.hood, F = sh.fw;
    // turret: relative to its centre (faces); limited range means it unwinds the long way round
    if (T.has) {
      let tgt = T.ang;
      if (rb.turretLock) { T.lockAng = clamp(T.lockAng + rb.turretNudge * 1.6 * dt, -T.half, T.half); tgt = T.lockAng; }
      else if (A.valid) tgt = wrap(A.az - rb.est.psi - sh.faces);
      else if (rb.enabled) tgt = T.ang;
      A.limit = Math.abs(tgt) > T.half;
      tgt = clamp(tgt, -T.half, T.half);
      T.tgt = tgt;
      const rate = T.rate * (rb.turretFast ? 4 : 1), acc = T.acc * (rb.turretFast ? 4 : 1);
      const vDes = clamp((tgt - T.ang) * 22, -rate, rate);
      T.vel += clamp(vDes - T.vel, -acc * dt, acc * dt);
      T.ang = clamp(T.ang + T.vel * dt, -T.half, T.half);
      if (!rb.turretLock) T.lockAng = T.ang;
    }
    // hood servo
    if (H.kind !== 'fixed') {
      H.tgt = A.valid ? A.th : H.tgt;
      const e = H.tgt - H.cur, stp = H.rate * dt;
      H.cur += clamp(e, -stp, stp);
    }
    // flywheel set-point: the solved speed; hold a ready speed while there is something to shoot
    if (!rb.enabled) F.wt = 0;
    else if (A.valid) F.wt = A.wt;
    else if (!A.empty) F.wt = Math.max(F.wt * 0.999, 150);
    else F.wt = Math.max(F.wt - 60 * dt, 90);
    flywheelStep(sim, rb, sh, V, dt);
    // lock
    if (A.valid && rb.enabled) {
      const yaw = shooterYaw(rb, sh, rb.est.psi);
      A.yawErr = wrap(A.az - yaw);
      const tol = clamp(Math.atan(3.2 / Math.max(A.D, 10)), 0.9 * D2R, 2.4 * D2R) * (T.has ? 1 : 1.25);
      const atSpeed = Math.abs(F.meas - F.wt) < F.band * F.wt;
      const hoodOk = H.kind === 'fixed' || Math.abs(H.cur - H.tgt) < 0.6 * D2R;
      // without lead the ball keeps the robot's velocity: only a (nearly) stopped robot can lock;
      // with lead the solution is only good while the velocity it assumed still holds
      const spd = Math.hypot(rb.vx, rb.vy), dv = Math.hypot(rb.vx - (A.rvx || 0), rb.vy - (A.rvy || 0));
      const still = (spd < 10 && rb.acc < 120) || (rb.P.lead && dv < 6 && spd < 75 && rb.acc < 90);
      A.atSpeed = atSpeed; A.still = still;
      A.locked = !A.limit && Math.abs(A.yawErr) < tol && atSpeed && hoodOk && still && Math.abs(rb.w) < (T.has ? 1.6 : 0.6);
      A.reason = A.locked ? 'KHÓA' : A.limit ? 'GIỚI HẠN TURRET' : !atSpeed ? 'QUAY FLYWHEEL' : Math.abs(A.yawErr) >= tol ? 'ĐANG NGẮM' : 'CHỜ ỔN ĐỊNH';
    } else A.locked = false;
    if (A.empty && A.valid) A.reason = 'HẾT BÓNG';
    // feed and launch
    sh.feed.cd -= dt;
    if (sh.feed.ball) {
      sh.feed.t -= dt;
      if (sh.feed.t <= 0) launch(sim, rb, sh);
    } else if (rb.enabled && sh.feed.cd <= 0 && rb.dunkT <= 0) {
      const req = rb.fireHeld || rb.fireReqT > 0 || rb.autoFire;
      const want = rb.forceFire || (req && (A.locked || (rb.shootAnywhere && rb.fireHeld)));
      if (want) {
        const q = takeBallFor(rb, sh);
        if (q) {
          sh.feed.ball = q; sh.feed.t = 0.1; sh.feed.cd = q.bt === BT_POLLEN ? sh.feed.intP : sh.feed.intN;
          if (!rb.fireHeld && !rb.forceFire) rb.fireReqT = 0;
        }
      }
    }
  }
  if (rb.fireReqT > 0) rb.fireReqT -= dt;
}
function flywheelStep(sim, rb, sh, V, dt) {
  const F = sh.fw;
  F.tick++;
  const period = F.ctrl === 'sdk' ? 15 : 3;            // hub velocity loop ~20 Hz vs a 100 Hz OpMode loop
  if (F.tick % period === 0) {
    const cdt = period * DT;
    F.meas = F.w * (1 + gauss(sim.rng) * 0.002);
    const e = (F.wt - F.meas) / F.wf;
    const ff = F.wt > 0 ? (F.wt / (F.wf / FREE_FACTOR) + 0.02) * 12 / Math.max(V, 7) : 0;
    let u;
    if (!rb.enabled || F.wt <= 0) { u = 0; F.integ = 0; }
    else if (F.ctrl === 'sdk') {
      // REV hub setVelocity(): PI on encoder ticks, no feedforward, no voltage compensation
      const pre = e * 4 + F.integ;
      if (Math.abs(pre) < 1 || pre * e < 0) F.integ = clamp(F.integ + e * cdt * 9, -1, 1);
      u = clamp(e * 4 + F.integ, -1, 1);
    } else if (F.ctrl === 'bang') {
      u = F.meas < F.wt * (1 - 0.015) ? 1 : clamp(ff, 0, 1);
    } else {
      F.integ = clamp(F.integ + e * cdt * 3, -0.2, 0.2);
      u = clamp(ff + e * 14 + F.integ, -1, 1);
    }
    F.u = u;
  }
  const u = rb.enabled ? F.u : 0;
  const wm = F.w;                                       // direct drive, 1:1
  const tauM = F.ts * (u * V / 12 - wm / F.wf);
  const iM = MOTOR_IS * (u * V / 12 - wm / F.wf);
  const tauW = F.n * tauM - 2.2e-5 * F.w - (F.w > 1 ? 0.004 : 0);
  F.w = Math.max(0, F.w + tauW / F.J * dt);
  F.iA = F.n * Math.max(0, u * iM) + (Math.abs(u) > 0.01 ? F.n * MOTOR_I0 : 0);
}
function takeBallFor(rb, sh) {
  let idx = -1;
  for (let i = 0; i < rb.hopper.length; i++) { const q = rb.hopper[i]; if (q.t <= 0 && accepts(sh, q.ball.bt)) { idx = i; break; } }
  if (idx < 0) return null;
  return rb.hopper.splice(idx, 1)[0].ball;
}
function launch(sim, rb, sh) {
  const ball = sh.feed.ball; sh.feed.ball = null;
  const F = sh.fw, A = sh.aim, H = sh.hood;
  const sc = rb.P.scatter * (rb.noiseMul || 1);
  // ball-to-ball variation (size, compression, feed contact) - "Typical" robot precision
  const v = F.eta * F.w * F.rIn * (1 + gauss(sim.rng) * 0.011 * sc) * (rb.shotPower || 1);
  let th = H.cur;
  // an adjustable hood trims to the wheel speed at the moment the ball reaches it
  if (H.kind === 'adjustable' && A.valid) {
    const t2 = solveTheta(v, ball.bt, A.D, AIM_Z - sh.mz, F.S0, H.cur, HOOD_MIN, HOOD_MAX);
    if (t2 !== null) th = t2;
  }
  const mz = muzzle(rb, sh, false);
  const yaw = mz[3] + gauss(sim.rng) * 0.8 * D2R * sc;
  th += gauss(sim.rng) * 0.7 * D2R * sc;
  const cp = Math.cos(th), dx = Math.cos(yaw) * cp, dy = Math.sin(yaw) * cp, dz = Math.sin(th);
  const rmx = mz[0] - rb.x, rmy = mz[1] - rb.y;
  ball.state = 'field'; ball.holder = -1; ball.flower = -1; ball.fromTip = false;
  ball.x = mz[0] + dx * 1.2; ball.y = mz[1] + dy * 1.2; ball.z = mz[2] + dz * 1.2;
  ball.vx = dx * v + rb.vx - rb.w * rmy; ball.vy = dy * v + rb.vy + rb.w * rmx; ball.vz = dz * v;
  const wsp = F.S0 * v / ball.r * (1 + gauss(sim.rng) * 0.08);
  ball.wx = Math.sin(yaw) * wsp; ball.wy = -Math.cos(yaw) * wsp; ball.wz = 0;
  ball.launchedBy = rb.id; ball.launchT = sim.t; ball.madeFor = -1; ball.placedBy = -1;
  // each ball takes its launch energy out of the wheel (x2 for slip and compression losses)
  const vs = v * 0.0254, E = (ball.m / 1000) * vs * vs * (1 + KI * F.S0 * F.S0);
  F.w = Math.sqrt(Math.max(0, F.w * F.w - 2 * E / F.J));
  sh.shots++; rb.stats.shots++;
  sim.events.push({ type: 'fire', robot: rb.id, shooter: sh.i, bt: ball.bt, v, ball: ball.id, x: rb.x, y: rb.y, mx: mz[0], my: mz[1], mz: mz[2], vx: ball.vx, vy: ball.vy, vz: ball.vz });
}

// ---------------------------------------------------------------- robot mechanisms
function robotLogic(sim, rb, dt) {
  for (const hq of rb.hopper) if (hq.t > 0) hq.t -= dt;
  rb.outCd -= dt;
  shooterStep(sim, rb, dt);
  if (!rb.enabled) return;
  if (rb.outtake && rb.outCd <= 0 && rb.hopper.length) { eject(sim, rb); rb.outCd = 0.3; }
  // FLOWER arm: places an element on top of the FLOWER in front
  if (rb.dunkT > 0) {
    rb.dunkT -= dt;
    if (rb.dunkT <= 0) finishDunk(sim, rb);
  } else if (rb.armHeld && rb.P.arm !== 'none' && rb.hopper.length) {
    const f = flowerInReach(sim, rb, false);
    if (f) { rb.dunkT = rb.P.armTime; rb.dunkFlower = f.i; sim.events.push({ type: 'dunkStart', robot: rb.id }); }
  }
  // extraction flap: the intake pulls the bottom POLLEN out of a FLOWER's retrieval opening
  if (rb.retrT > 0) {
    rb.retrT -= dt; rb.flapT = 0.3;
    if (rb.retrT <= 0) finishRetrieve(sim, rb);
  } else if (rb.P.flap && rb.intakeOn && rb.hopper.length < 4 && rb.dunkT <= 0) {
    const f = flowerInReach(sim, rb, true);
    if (f) { const bot = flowerBottom(sim, f); if (bot && bot.bt === BT_POLLEN) { rb.retrT = 0.35; rb.retrFlower = f.i; } }
  }
  if (rb.flapT > 0) rb.flapT -= dt;
}
function flowerInReach(sim, rb, low) {
  const c = Math.cos(rb.psi), s = Math.sin(rb.psi);
  const face = rb.hx + (low ? rb.P.intake.reach : 0);
  for (const f of sim.flowers) {
    const dx = f.x - rb.x, dy = f.y - rb.y;
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;
    const reach = low ? 5.5 : rb.P.armReach + 1.5;
    if (lx > face - 0.5 && lx < face + reach && Math.abs(ly) < (low ? 3.5 : 5)) {
      const facing = -(c * f.nx + s * f.ny);
      if (facing > 0.8) return f;
    }
  }
  return null;
}
function flowerBottom(sim, f) {
  let best = null;
  for (const b of sim.balls) if (b.state === 'field' && b.flower === f.i && (!best || b.z < best.z)) best = b;
  return best && best.z < 4.2 ? best : null;
}
function takeFromHopper(rb, preferNectar) {
  let idx = rb.hopper.findIndex(q => q.t <= 0);
  if (preferNectar) { const k = rb.hopper.findIndex(q => q.ball.bt !== BT_POLLEN && q.t <= 0); if (k >= 0) idx = k; }
  if (idx < 0) return null;
  return rb.hopper.splice(idx, 1)[0].ball;
}
function eject(sim, rb) {
  const q = rb.hopper.pop(); if (!q) return;
  const ball = q.ball, c = Math.cos(rb.psi), s = Math.sin(rb.psi), side = q.side || 1;
  const off = (rb.hx + rb.P.intake.reach + ball.r + 0.6) * side;
  ball.state = 'field'; ball.holder = -1; ball.flower = -1;
  ball.x = rb.x + c * off; ball.y = rb.y + s * off; ball.z = ball.r + 0.3;
  ball.vx = rb.vx + c * 40 * side; ball.vy = rb.vy + s * 40 * side; ball.vz = 0; ball.wx = ball.wy = ball.wz = 0;
  ball.placedBy = rb.id;
  sim.events.push({ type: 'eject', robot: rb.id });
}
function finishDunk(sim, rb) {
  const f = sim.flowers[rb.dunkFlower]; rb.dunkFlower = -1;
  if (!f || !flowerInReach(sim, rb, false)) return;
  const ball = takeFromHopper(rb, true); if (!ball) return;
  const e = rb.P.arm === 'long' ? 0.18 : 0.3;
  ball.state = 'field'; ball.holder = -1; ball.flower = -1;
  ball.x = f.x + gauss(sim.rng) * e; ball.y = f.y + gauss(sim.rng) * e; ball.z = FL.zTop + ball.r + 1.2;
  ball.vx = 0; ball.vy = 0; ball.vz = -12; ball.wx = ball.wy = ball.wz = 0;
  ball.placedBy = rb.id; ball.launchedBy = -1;
  rb.stats.dunks++;
  sim.events.push({ type: 'dunk', robot: rb.id, flower: f.i, bt: ball.bt });
}
function finishRetrieve(sim, rb) {
  const f = sim.flowers[rb.retrFlower]; rb.retrFlower = -1; if (!f) return;
  if (rb.hopper.length >= 4 || !flowerInReach(sim, rb, true)) return;
  const b = flowerBottom(sim, f); if (!b || b.bt !== BT_POLLEN) return;
  b.state = 'held'; b.holder = rb.id; b.flower = -1; b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
  rb.hopper.push({ ball: b, t: 0.12, side: 1 });
  rb.stats.pickups++;
  sim.events.push({ type: 'intake', robot: rb.id, bt: 0, flower: f.i });
}

// ---------------------------------------------------------------- human players (G426, G427, TU02) and 10.8.2 logistics
function hpSpot(sim, al) {
  const z = ZONES.loading[al];
  for (let k = 0; k < 14; k++) {
    const x = al === 'R' ? z.x0 + 3.0 + sim.rng() * 5 : z.x1 - 3.0 - sim.rng() * 5;
    const y = z.y0 + 3 + sim.rng() * (z.y1 - z.y0 - 6);
    let ok = true;
    for (const b of sim.balls) if (b.state === 'field' && Math.hypot(b.x - x, b.y - y) < b.r + 2.2 && b.z < 8) { ok = false; break; }
    if (ok) for (const r of sim.robots) {
      const c = Math.cos(r.psi), s = Math.sin(r.psi), dx = x - r.x, dy = y - r.y;
      if (Math.abs(c * dx + s * dy) < r.hx + 2.5 && Math.abs(-s * dx + c * dy) < r.hy + 2.5) { ok = false; break; }
    }
    if (ok) return [x, y];
  }
  return null;
}
function hpAllowed(sim, al) { return sim.phase === 'free' || sim.t >= T_FLOWER || sim.hp[al].credit > 0; }
function enterNectar(sim, al, manual) {
  const hp = sim.hp[al];
  if (hp.left <= 0) return false;
  const spot = hpSpot(sim, al); if (!spot) return false;
  const legal = hpAllowed(sim, al) && sim.phase !== 'trans';
  const b = addBall(sim, al === 'R' ? BT_RED : BT_BLUE, spot[0], spot[1], 4.2);
  b.vx = al === 'R' ? 8 : -8; b.vz = -5;
  hp.left--;
  if (hp.credit > 0 && sim.t < T_FLOWER && sim.phase !== 'free') hp.credit--;
  if (!legal && manual) foul(sim, al, 'minor', 'G426', 'Human player đưa NECTAR vào sớm', -1);
  sim.events.push({ type: 'nectarIn', alliance: al, left: hp.left });
  return true;
}
function humanPlayers(sim, dt) {
  const live = sim.phase === 'tele' || sim.phase === 'auto' || sim.phase === 'free' || sim.phase === 'trans';
  if (!live) return;
  for (const al of ['R', 'B']) {
    const hp = sim.hp[al]; hp.cd -= dt;
    if (hp.manual) {
      if (hp.req > 0 && hp.cd <= 0) {
        if (enterNectar(sim, al, true)) hp.cd = 0.8;
        else sim.events.push({ type: 'hpBlocked', alliance: al, why: hp.left <= 0 ? 'empty' : 'full' });
        hp.req = 0;
      }
      continue;
    }
    if (hp.left <= 0 || hp.cd > 0 || sim.phase === 'trans' || !hpAllowed(sim, al)) continue;
    if (enterNectar(sim, al, false)) hp.cd = 1.1; else hp.cd = 0.4;
  }
}
function reintroduce(sim, dt) {
  for (let i = sim.reintro.length - 1; i >= 0; i--) {
    const q = sim.reintro[i]; q.t -= dt;
    if (q.t > 0) continue;
    const b = q.ball;
    let x = clamp(q.x, -HALF + 3, HALF - 3), y = clamp(q.y, -HALF + 3, HALF - 3);
    for (let k = 0; k < 12; k++) {
      let clear = true;
      for (const r of sim.robots) if (Math.abs(r.x - x) < r.hx + 4 && Math.abs(r.y - y) < r.hy + 4) { clear = false; break; }
      for (const f of sim.flowers) if (Math.hypot(f.x - x, f.y - y) < 8) clear = false;
      if (clear) break;
      x = clamp(x * 0.9 + (sim.rng() - 0.5) * 10, -HALF + 3, HALF - 3); y = clamp(y * 0.9 + (sim.rng() - 0.5) * 10, -HALF + 3, HALF - 3);
    }
    b.state = 'field'; b.x = x; b.y = y; b.z = b.r + 0.2; b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.flower = -1;
    sim.reintro.splice(i, 1);
    sim.events.push({ type: 'reintro', bt: b.bt });
  }
}
function ballLeftField(sim, b) {
  b.state = 'out'; sim.outCount++;
  if (b.bt === BT_POLLEN) sim.reintro.push({ ball: b, t: 2.0, x: b.x, y: b.y });
  else { const al = allyOf(b.bt); sim.hp[al].left++; }
  sim.events.push({ type: 'out', bt: b.bt, alliance: allyOf(b.bt) });
}

// ---------------------------------------------------------------- automated referee (G402, G410, G421, G426)
function foul(sim, al, kind, rule, text, robot) {
  if (!sim.foulsOn || sim.practice) return;
  sim.fouls[al][kind]++;
  sim.foulLog.push({ t: sim.t, alliance: al, kind, rule, text, robot });
  if (robot >= 0 && sim.robots[robot]) sim.robots[robot].stats.fouls++;
  sim.events.push({ type: 'foul', alliance: al, kind, rule, text, robot });
}
function referee(sim, dt) {
  const live = sim.phase === 'auto' || sim.phase === 'tele';
  // G402: during AUTO a ROBOT may not disrupt the opposing ALLIANCE on its side (columns A-C red, D-F blue)
  if (sim.phase === 'auto') {
    for (const c of sim._rr) {
      if (c.a.alliance === c.b.alliance) continue;
      for (const [off, vic] of [[c.a, c.b], [c.b, c.a]]) {
        const vicSide = vic.alliance === 'R' ? c.px < 0 : c.px > 0;
        const offIn = vic.alliance === 'R' ? off.x < 0 : off.x > 0;
        if (vicSide && offIn && !sim.g402[off.alliance]) { sim.g402[off.alliance] = true; foul(sim, off.alliance, 'major', 'G402', 'Cản trở AUTO của đối thủ bên phần sân của họ', off.id); }
      }
    }
  }
  // G421: 3-count on PINS
  const touching = new Map();
  for (const c of sim._rr) {
    if (!touching.has(c.a.id)) touching.set(c.a.id, []); if (!touching.has(c.b.id)) touching.set(c.b.id, []);
    touching.get(c.a.id).push({ o: c.b, nx: c.nx, ny: c.ny }); touching.get(c.b.id).push({ o: c.a, nx: -c.nx, ny: -c.ny });
  }
  if (live) {
    for (const A of sim.robots) {
      const list = touching.get(A.id) || [];
      for (const t of list) {
        const B = t.o; if (B.alliance === A.alliance) continue;
        // A pushes toward B (n points from A to B); B is held against something or cannot move
        const push = (A.cmd.vx * t.nx + A.cmd.vy * t.ny) > 0.15 || (A.vx * t.nx + A.vy * t.ny) > 3;
        const blocked = B._static || (touching.get(B.id) || []).some(q => q.o !== A) || (Math.hypot(B.vx, B.vy) < 6 && Math.hypot(B.cmd.vx, B.cmd.vy) > 0.25);
        const key = A.id + '>' + B.id;
        if (push && blocked && Math.hypot(B.vx, B.vy) < 10 && !sim.pins.has(key)) {
          sim.pins.set(key, { a: A, b: B, count: 0, fouls: 0, pause: 0, ax: A.x, ay: A.y, bx: B.x, by: B.y });
          for (const [k2, p2] of sim.pins) if (p2.b === A) sim.pins.delete(k2);     // G421.C: the pinner got pinned
        }
      }
    }
  }
  for (const [key, p] of sim.pins) {
    const A = p.a, B = p.b;
    const gap = boxGap(A, B);
    const moved = Math.max(Math.hypot(A.x - p.ax, A.y - p.ay), Math.hypot(B.x - p.bx, B.y - p.by));
    p.gap = gap;
    if (!live) { sim.pins.delete(key); continue; }
    // the count pauses at 2 ft (G421.A/B) and ends after 3 s apart; it only runs while the frames are in contact
    if (gap >= 24 || moved >= 24) { p.pause += dt; if (p.pause > 3) { sim.pins.delete(key); continue; } }
    else if (gap > 2.5) p.pause = 0;
    else {
      p.pause = 0; p.count += dt;
      const due = Math.floor(p.count / 3);
      while (p.fouls < due) { p.fouls++; foul(sim, A.alliance, 'major', 'G421', p.fouls === 1 ? 'Giữ chặn (PIN) quá 3 giây' : 'Tiếp tục PIN thêm 3 giây', A.id); }
    }
    A.pinCount = p.count;
  }
  for (const A of sim.robots) { let pc = 0; for (const p of sim.pins.values()) if (p.a === A) pc = Math.max(pc, p.count); A.pinCount = pc; }
}

// ---------------------------------------------------------------- stepping
function physicsStep(sim) {
  const balls = sim.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]; if (b.state !== 'field') continue;
    b.onFloor = b.z < b.r + 0.05 && Math.abs(b.vz) < 3;
    b.vz -= G * DT;
    const s = Math.hypot(b.vx, b.vy, b.vz);
    if (s > 1) {
      let ax = -b.k * s * b.vx, ay = -b.k * s * b.vy, az = -b.k * s * b.vz;
      const wm = Math.hypot(b.wx, b.wy, b.wz);
      if (wm > 1 && !b.onFloor) {
        const cl = CL_K * Math.min(b.r * wm / s, 1), k = BALL_KL[b.bt] * cl * s / wm;
        ax += k * (b.wy * b.vz - b.wz * b.vy); ay += k * (b.wz * b.vx - b.wx * b.vz); az += k * (b.wx * b.vy - b.wy * b.vx);
      }
      b.vx += ax * DT; b.vy += ay * DT; b.vz += az * DT;
    }
    if (!b.onFloor) { const d = 1 - DT / SPIN_TAU; b.wx *= d; b.wy *= d; b.wz *= d; }
  }
  for (const h of sim.hives) { h.w0 = h.w; h.w += (h.K * Math.sin(h.phi) - HV.damp * h.w) / HV.I * DT; }
  for (const rb of sim.robots) { rb._static = false; driveRobot(sim, rb); }
  sim._rr.length = 0;
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < sim.robots.length; i++) for (let j = i + 1; j < sim.robots.length; j++) {
      const A = sim.robots[i], B = sim.robots[j];
      if (Math.abs(A.x - B.x) > 30 || Math.abs(A.y - B.y) > 30) continue;
      const res = sat(A, B);
      if (res) { impulseRR(A, B, res.nx, res.ny, res.depth, res.px, res.py); if (it === 0) sim._rr.push({ a: A, b: B, px: res.px, py: res.py, nx: res.nx, ny: res.ny }); }
    }
    for (const rb of sim.robots) robotStatic(sim, rb);
  }
  for (const rb of sim.robots) {
    rb.x += rb.vx * DT; rb.y += rb.vy * DT; rb.psi = wrap(rb.psi + rb.w * DT);
    const ax = (rb.vx - rb.pvx) / DT, ay = (rb.vy - rb.pvy) / DT; rb.pvx = rb.vx; rb.pvy = rb.vy;
    rb.acc += (Math.min(Math.hypot(ax, ay), 2000) - rb.acc) * 0.08;
    updateBattery(rb); odometryStep(sim, rb);
  }
  const n = genContacts(sim);
  WARM = sim._warm || WARM;
  for (let i = 0; i < n; i++) preSolve(POOL[i]);
  for (const h of sim.hives) hivePre(h);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < n; i++) solveContact(POOL[i]);
    for (const h of sim.hives) hiveSolve(h);
  }
  const nw = sim._warm2 || new Map(); nw.clear();
  let loud = null, loudV = 0;
  for (let i = 0; i < n; i++) {
    const c = POOL[i];
    if (c.jn > 0 && c.gap <= SLOP) nw.set(c.key, c.jn);
    if (c.jn > 0 && -c.vn0 > loudV && -c.vn0 > 55) { loudV = -c.vn0; loud = c; }
  }
  sim._warm2 = sim._warm || new Map(); sim._warm = nw;
  if (loud && sim.step % 2 === 0) sim.events.push({ type: 'impact', v: loudV, mat: loud.mat, x: loud.a.x, y: loud.a.y, z: loud.a.z });
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]; if (b.state !== 'field') continue;
    b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    if (b.z < b.r - 0.25) { b.z = b.r - 0.25; if (b.vz < 0) b.vz = 0; }
    if (Math.abs(b.x) > HALF + 4 || Math.abs(b.y) > HALF + 4 || b.z < -10) ballLeftField(sim, b);
  }
  for (const h of sim.hives) {
    h.phi += h.w * DT;
    if (h.phi > HV.stop) { h.phi = HV.stop; if (h.w > 0) h.w = 0; }
    if (h.phi < -HV.stop) { h.phi = -HV.stop; if (h.w < 0) h.w = 0; }
    const tol = 0.35 * D2R;
    if (h.side === -1 && h.phi >= HV.stop - tol) tipped(sim, h, 1);
    else if (h.side === 1 && h.phi <= -HV.stop + tol) tipped(sim, h, -1);
  }
  sim.step++;
}
function tipped(sim, h, newSide) {
  const old = h.side;
  h.side = newSide; h.tipT = sim.t;
  // what was in the old up CELL is now falling (G409)
  for (const b of sim.balls) if (b.state === 'field' && ballInCell(h, b, old)) { b.fromTip = true; b.tipT = sim.t; }
  const inMatch = sim.phase === 'auto' || sim.phase === 'trans' || sim.phase === 'tele' || sim.phase === 'free';
  if (!inMatch) { sim.events.push({ type: 'tip', alliance: h.alliance, counted: false }); return; }
  const auto = sim.phase === 'auto' || sim.phase === 'trans';
  sim.tips[h.alliance][auto ? 'auto' : 'tele']++;
  if (sim.t < T_FLOWER || sim.phase === 'free') sim.hp[h.alliance].credit++;
  sim.events.push({ type: 'tip', alliance: h.alliance, counted: true, auto });
}
// credit a launched ball that drops into its own alliance's upward CELL
function trackMade(sim) {
  for (const b of sim.balls) {
    if (b.state !== 'field' || b.launchedBy < 0 || b.madeFor === b.launchT) continue;
    if (sim.t - b.launchT > 3) continue;
    const rb = sim.robots[b.launchedBy]; if (!rb) continue;
    const h = hiveOf(sim, rb.alliance);
    if (Math.abs(b.x - h.hx) < 12 && b.z > 44 && ballInCell(h, b, h.side)) { b.madeFor = b.launchT; rb.stats.made++; sim.events.push({ type: 'made', robot: rb.id, ball: b.id, x: b.x, y: b.y, z: b.z, alliance: rb.alliance }); }
  }
}

// ---------------------------------------------------------------- match flow
function setPhase(sim, ph) {
  if (sim.phase === ph) return;
  sim.phase = ph;
  const enabled = ph === 'auto' || ph === 'tele' || ph === 'free';
  sim.robots.forEach(r => { r.enabled = enabled; if (!enabled) { r.fireHeld = false; r.forceFire = false; } });
  sim.events.push({ type: 'phase', phase: ph });
}
function startMatch(sim) { sim.t = 0; setPhase(sim, sim.mode === 'free' ? 'free' : 'auto'); }
function advance(sim) {
  const ph = sim.phase;
  if (ph === 'auto' || ph === 'trans' || ph === 'tele' || ph === 'free') sim.t += DT;
  if (ph === 'auto' && sim.t >= T_AUTO) { sim.autoSnap = autoSnapshot(sim); setPhase(sim, 'trans'); }
  else if (ph === 'trans' && sim.t >= T_TELE0) setPhase(sim, 'tele');
  else if (ph === 'tele' && !sim.noTimer && sim.t >= T_END) { setPhase(sim, 'end'); sim.endT = 0; }
  if (ph === 'tele' && sim.t >= T_FLOWER && !sim._flowerMsg) { sim._flowerMsg = true; sim.events.push({ type: 'lastMinute' }); }
  if (ph === 'trans' && sim.t >= T_TELE0 - 5 && !sim._callout) { sim._callout = true; sim.events.push({ type: 'pickup' }); }
  if (sim.phase === 'end') {
    sim.endT += DT;
    let moving = false;
    for (const b of sim.balls) if (b.state === 'field' && Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vz) > 4) { moving = true; break; }
    for (const h of sim.hives) if (Math.abs(h.w) > 0.05) moving = true;
    if ((!moving && sim.endT > 1.2) || sim.endT > 5) { sim.final = finalScore(sim); setPhase(sim, 'done'); }
  }
  physicsStep(sim);
  if (sim.step % 8 === 0) {
    const tags = tagPoses(sim);
    for (const rb of sim.robots) { visionStep(sim, rb, tags); aimShooters(sim, rb); }
  }
  for (const rb of sim.robots) robotLogic(sim, rb, DT);
  humanPlayers(sim, DT);
  reintroduce(sim, DT);
  referee(sim, DT);
  trackMade(sim);
  // stamp this step's events with the match time (a frame can run several steps)
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t === undefined; i--) sim.events[i].t = sim.t;
}

// ---------------------------------------------------------------- scoring
function touchingWall(rb) {
  const cs = boxCorners(rb, _ca);
  for (let k = 0; k < 4; k++) if (Math.abs(cs[2 * k]) > HALF - 0.35 || Math.abs(cs[2 * k + 1]) > HALF - 0.35) return true;
  return false;
}
function inZone(rb, z) {
  const box = { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2, psi: 0, hx: (z.x1 - z.x0) / 2, hy: (z.y1 - z.y0) / 2 };
  return !!sat(rb, box);
}
function autoSnapshot(sim) {
  const s = { R: { leave: 0, park: 0 }, B: { leave: 0, park: 0 }, robots: {} };
  for (const rb of sim.robots) {
    const lv = !touchingWall(rb), pk = inZone(rb, ZONES.loading[rb.alliance]);
    s.robots[rb.id] = { leave: lv, park: pk };
    if (lv) s[rb.alliance].leave++;
    if (pk) s[rb.alliance].park++;
  }
  return s;
}
function cellCounts(sim) {
  const out = { R: 0, B: 0 };
  for (const h of sim.hives) for (const b of sim.balls) if (b.state === 'field' && ballInCell(h, b, h.side)) out[h.alliance]++;
  return out;
}
function flowerState(sim, f) {
  const all = [];
  for (const b of sim.balls) if (b.state === 'field' && b.flower === f.i) all.push(b);
  all.sort((p, q) => p.z - q.z);
  const els = all.filter(b => b.z + b.r > FL.zMid && b.z - b.r < FL.zTop);
  let owner = null, bottom = null;
  for (const b of els) if (b.bt !== BT_POLLEN) { if (!bottom) bottom = allyOf(b.bt); owner = allyOf(b.bt); }
  return { owner, bottom, count: els.length, stack: all.map(b => b.bt), height: all.reduce((s, b) => s + 2 * b.r, 0) };
}
function gardenCounts(sim) {
  const out = { R: 0, B: 0 };
  for (const al of ['R', 'B']) {
    const z = ZONES.garden[al];
    for (const b of sim.balls) {
      if (b.state !== 'field' || b.flower >= 0) continue;
      if (b.x + b.r > z.x0 && b.x - b.r < z.x1 && b.y + b.r > z.y0 && b.y - b.r < z.y1) out[al]++;
    }
  }
  return out;
}
function breakdown(sim) {
  const snap = sim.autoSnap || (sim.phase === 'auto' || sim.phase === 'pre' ? autoSnapshot(sim) : { R: { leave: 0, park: 0 }, B: { leave: 0, park: 0 } });
  const cells = cellCounts(sim), gardens = gardenCounts(sim);
  const fl = sim.flowers.map(f => flowerState(sim, f));
  const tele = sim.phase === 'tele' || sim.phase === 'end' || sim.phase === 'done' || sim.phase === 'free';
  const out = {};
  for (const al of ['R', 'B']) {
    const o = other(al);
    const parks = sim.robots.filter(r => r.alliance === al && inZone(r, ZONES.loading[al])).length;
    const d = {
      leave: snap[al].leave * PTS.leave, autoPark: snap[al].park * PTS.park, autoTip: sim.tips[al].auto * PTS.tip,
      teleTip: sim.tips[al].tele * PTS.tip,
      cell: cells[al] * PTS.cell, cellN: cells[al],
      flower: fl.reduce((s, f) => s + (f.owner === al ? f.count * PTS.flower : 0), 0),
      bottom: fl.reduce((s, f) => s + (f.bottom === al ? PTS.bottom : 0), 0),
      garden: gardens[al] * PTS.garden, gardenN: gardens[al],
      telePark: tele ? parks * PTS.park : 0, parkN: parks,
      foul: sim.fouls[o].minor * PTS.minor + sim.fouls[o].major * PTS.major,
      foulsAgainst: sim.fouls[al].minor + sim.fouls[al].major,
      tips: sim.tips[al].auto + sim.tips[al].tele,
    };
    if (!tele) { d.cell = 0; d.flower = 0; d.bottom = 0; d.garden = 0; d.telePark = 0; }
    d.auto = d.leave + d.autoPark + d.autoTip;
    d.teleop = d.teleTip + d.cell + d.flower + d.bottom + d.garden + d.telePark;
    d.total = d.auto + d.teleop + d.foul;
    d.swarmPts = d.leave + d.autoPark + d.telePark;
    out[al] = d;
  }
  out.flowers = fl;
  return out;
}
function finalScore(sim) {
  const b = breakdown(sim);
  for (const al of ['R', 'B']) {
    const o = other(al), d = b[al];
    d.rp = { win: d.total > b[o].total ? RPV.win : d.total === b[o].total ? RPV.tie : 0,
      swarm: d.swarmPts >= RPV.swarm ? 1 : 0, poll1: d.tips >= RPV.poll1 ? 1 : 0, poll2: d.tips >= RPV.poll2 ? 1 : 0 };
    d.rpTotal = d.rp.win + d.rp.swarm + d.rp.poll1 + d.rp.poll2;
  }
  return b;
}
function tipProgress(sim, h) {
  let t = 0;
  for (const b of sim.balls) {
    if (b.state !== 'field' || Math.abs(b.x - h.hx) > 12 || Math.abs(b.y) > 26 || b.z < 44) continue;
    if (ballInCell(h, b, h.side)) t += b.m * G * Math.abs(b.y);
  }
  return t / (h.K * Math.sin(HV.stop));
}
function matchClock(sim) {
  if (sim.phase === 'auto') return { label: 'AUTO', secs: Math.max(0, T_AUTO - sim.t), key: 'auto' };
  if (sim.phase === 'trans') return { label: 'CHUYỂN TIẾP', secs: Math.max(0, T_TELE0 - sim.t), key: 'trans' };
  if (sim.phase === 'tele') return { label: sim.t >= T_FLOWER ? 'ENDGAME' : 'TELEOP', secs: sim.noTimer ? 0 : Math.max(0, T_END - sim.t), key: 'tele' };
  if (sim.phase === 'free') return { label: 'LUYỆN TẬP', secs: sim.t, key: 'free', up: true };
  if (sim.phase === 'end' || sim.phase === 'done') return { label: 'KẾT THÚC', secs: 0, key: 'end' };
  return { label: 'CHỜ', secs: T_AUTO, key: 'pre' };
}

// ---------------------------------------------------------------- predicted arc (HUD) — same integrator as the physics
function predictArc(rb, sh, out, maxPts) {
  const A = sh.aim, mz = muzzle(rb, sh, false), F = sh.fw;
  const bt = A.bt || 0, r = BALL_R[bt];
  const yaw = mz[3], th = sh.hood.cur, v = F.eta * F.w * F.rIn;
  const cp = Math.cos(th), dx = Math.cos(yaw) * cp, dy = Math.sin(yaw) * cp, dz = Math.sin(th);
  const rmx = mz[0] - rb.x, rmy = mz[1] - rb.y;
  let x = mz[0] + dx * 1.2, y = mz[1] + dy * 1.2, z = mz[2] + dz * 1.2;
  let vx = dx * v + rb.vx - rb.w * rmy, vy = dy * v + rb.vy + rb.w * rmx, vz = dz * v;
  const w0 = F.S0 * v / r; let wx = Math.sin(yaw) * w0, wy = -Math.cos(yaw) * w0, wz = 0;
  let n = 0;
  for (let st = 0; st < 1200 && n < maxPts; st++) {
    if (st % 6 === 0) { out[n * 3] = x; out[n * 3 + 1] = y; out[n * 3 + 2] = z; n++; }
    vz -= G * DT;
    const s = Math.hypot(vx, vy, vz);
    let ax = -BALL_K[bt] * s * vx, ay = -BALL_K[bt] * s * vy, az = -BALL_K[bt] * s * vz;
    const wm = Math.hypot(wx, wy, wz);
    if (wm > 1 && s > 1) { const cl = CL_K * Math.min(r * wm / s, 1), k = BALL_KL[bt] * cl * s / wm; ax += k * (wy * vz - wz * vy); ay += k * (wz * vx - wx * vz); az += k * (wx * vy - wy * vx); }
    vx += ax * DT; vy += ay * DT; vz += az * DT; const d = 1 - DT / SPIN_TAU; wx *= d; wy *= d; wz *= d;
    x += vx * DT; y += vy * DT; z += vz * DT;
    if (z < r) break;
  }
  return n;
}

// ---------------------------------------------------------------- aim map: where a standing shot clears the mouth of the upward CELL
// Pure geometry probe (no bounce-ins, no robots): the ball flies with drag + Magnus and must pass the mouth
// of the target CELL fully inside the opening before touching any CELL, arm bar, frame member or panel.
function dPoly(w, b) {
  if (insidePent(w, b, 0)) return 0;
  return Math.sqrt(closestOnPoly(PENT, w, b, _cp));
}
function dEdge(w, b) {
  let best = 1e18;
  for (let i = 0; i < 5; i++) {
    const P = PENT[i], Q = PENT[(i + 1) % 5];
    const ex = Q[0] - P[0], ey = Q[1] - P[1];
    let t = ((w - P[0]) * ex + (b - P[1]) * ey) / (ex * ex + ey * ey); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = P[0] + ex * t, qy = P[1] + ey * t, d = (w - qx) * (w - qx) + (b - qy) * (b - qy);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
function probeShot(p) {
  // p: {x,y,z, vx,vy,vz, wx,wy,wz, bt, hives:[{hx,phi,side}], ti (target hive index)}
  const r = BALL_R[p.bt], k = BALL_K[p.bt], kl = BALL_KL[p.bt];
  let x = p.x, y = p.y, z = p.z, vx = p.vx, vy = p.vy, vz = p.vz, wx = p.wx, wy = p.wy, wz = p.wz;
  const hs = p.hives;
  const cs = hs.map(h => [Math.cos(h.phi), Math.sin(h.phi)]);
  for (let st = 0; st < 900; st++) {
    vz -= G * DT;
    const s = Math.hypot(vx, vy, vz);
    let ax = -k * s * vx, ay = -k * s * vy, az = -k * s * vz;
    const wm = Math.hypot(wx, wy, wz);
    if (wm > 1 && s > 1) { const cl = CL_K * Math.min(r * wm / s, 1), q = kl * cl * s / wm; ax += q * (wy * vz - wz * vy); ay += q * (wz * vx - wx * vz); az += q * (wx * vy - wy * vx); }
    vx += ax * DT; vy += ay * DT; vz += az * DT; const dd = 1 - DT / SPIN_TAU; wx *= dd; wy *= dd; wz *= dd;
    x += vx * DT; y += vy * DT; z += vz * DT;
    if (z < r || (vz < 0 && z < 50)) return 0;
    if (Math.abs(x) > HALF - r || Math.abs(y) > HALF - r) { if (z < WALL_H + r) return 0; if (Math.abs(x) > HALF + 6 || Math.abs(y) > HALF + 6) return 0; }
    if (Math.abs(x) > 30 || Math.abs(y) > 30 || z < 24 || z > 72) { if (vz < 0 && z < 40 && Math.abs(x) < 30 && Math.abs(y) < 30) return 0; continue; }
    for (let hi = 0; hi < 2; hi++) {
      const h = hs[hi], c = cs[hi][0], sn = cs[hi][1], zz = z - HV.pz;
      const w = x - h.hx, a = y * c + zz * sn, b = -y * sn + zz * c;
      if (Math.abs(w) > 10.5 + r + 1 || Math.abs(a) > HV.aOut + r + 1 || b < -4 - r || b > HV.bTop + r) continue;
      for (let sg = -1; sg <= 1; sg += 2) {
        const aa = a * sg;
        const isTarget = hi === p.ti && sg === h.side;
        if (isTarget) {
          const f = aa - HV.aOut;                   // >0 outside the mouth plane
          if (f > r) { /* approaching the mouth */ }
          else if (f > -r) { if (dPoly(w, b) < r && !insidePent(w, b, r)) return 0; }       // straddling the mouth: must clear the rim
          else if (aa >= HV.aIn) { if (insidePent(w, b, 0)) return 1; if (dPoly(w, b) < r) return 0; }
          else if (Math.hypot(dPoly(w, b), HV.aIn - aa) < r) return 0;
        } else {
          const dInt = aa < HV.aIn ? HV.aIn - aa : aa > HV.aOut ? aa - HV.aOut : 0;
          if (Math.hypot(dPoly(w, b), dInt) < r) return 0;
        }
      }
      if (Math.abs(w) < ARM_R + r) {
        for (let q = 0; q < ARM_SEGS.length; q++) {
          const sgm = ARM_SEGS[q];
          segPoint(0, sgm[0], sgm[1], 0, sgm[2], sgm[3], w, a, b, _r);
          if (_r[0] < ARM_R + r) return 0;
        }
      }
    }
    if (Math.abs(x) < 27 + r && Math.abs(y) < 22 + r && z < 47 + r) {
      for (let q = 0; q < FRAME_CAPS.length; q++) { const f = FRAME_CAPS[q]; segPoint(f[0], f[1], f[2], f[3], f[4], f[5], x, y, z, _r); if (_r[0] < f[6] + r) return 0; }
      for (let q = 0; q < 2; q++) { platePoint(LOGO_PLATES[q], x, y, z, _r); if (_r[0] < 0.15 + r) return 0; }
    }
  }
  return 0;
}
// nominal shot (no scatter) from a shooter pivot at (bx, by) into the alliance's upward CELL, with the HIVEs as they stand now
const _ph = [{ hx: 0, phi: 0, side: 1 }, { hx: 0, phi: 0, side: 1 }];
function shotClear(sim, al, sh, bx, by, bt, sol, az, rvx, rvy) {
  for (let i = 0; i < 2; i++) { const h = sim.hives[i]; _ph[i].hx = h.hx; _ph[i].phi = h.side * HV.stop; _ph[i].side = h.side; }
  const th = sol.th, v = sol.v, cp = Math.cos(th), w0 = sh.fw.S0 * v / BALL_R[bt];
  return probeShot({ x: bx + Math.cos(az) * 2.7, y: by + Math.sin(az) * 2.7, z: sh.mz + Math.sin(th) * 1.2,
    vx: Math.cos(az) * cp * v + (rvx || 0), vy: Math.sin(az) * cp * v + (rvy || 0), vz: Math.sin(th) * v,
    wx: Math.sin(az) * w0, wy: -Math.cos(az) * w0, wz: 0, bt, hives: _ph, ti: al === 'R' ? 0 : 1 }) > 0;
}
// can this shooter score standing at (x, y)? (used by planners and the aim map)
function shotFeasible(sim, al, sh, x, y, bt) {
  const h = hiveOf(sim, al), tgt = aimPointWorld(h, h.side);
  const D = Math.hypot(tgt[0] - x, tgt[1] - y) - 1.5;
  const sol = shotLookup(sh, bt, D); if (!sol) return false;
  if (sol.v / (sh.fw.eta * sh.fw.rIn) > sh.fw.wf * 0.93) return false;
  return shotClear(sim, al, sh, x, y, bt, sol, Math.atan2(tgt[1] - y, tgt[0] - x), 0, 0);
}
// q: {shooter: shooter spec (normalized), alliance, bt, hives:[{hx,phi,side}], step, lead:false}
function aimMap(q) {
  const sh = makeShooter(q.shooter, 0);
  const ti = q.alliance === 'R' ? 0 : 1, h = q.hives[ti];
  const step = q.step || 4, n = Math.floor(2 * (HALF - 9) / step) + 1;
  const out = new Float32Array(n * n);
  const tgt = aimPointWorld({ hx: h.hx }, h.side);
  const bt = q.bt || 0, S0 = sh.fw.S0;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const x = -HALF + 9 + ix * step, y = -HALF + 9 + iy * step;
    if (Math.abs(x) < 26 && Math.abs(y) < 21) { out[iy * n + ix] = -1; continue; }
    const D = Math.hypot(tgt[0] - x, tgt[1] - y) - 1.5;
    const sol = shotLookup(sh, bt, D);
    if (!sol) { out[iy * n + ix] = -1; continue; }
    const az = Math.atan2(tgt[1] - y, tgt[0] - x);
    let ok = 0, tot = 0;
    for (const [dv, dyaw] of [[0, 0], [0.012, 0], [-0.012, 0], [0, 0.7 * D2R], [0, -0.7 * D2R]]) {
      const v = sol.v * (1 + dv), yaw = az + dyaw, th = sol.th;
      const cp = Math.cos(th);
      const r = BALL_R[bt], w0 = S0 * v / r;
      tot++;
      ok += probeShot({ x: x + Math.cos(yaw) * 2.7, y: y + Math.sin(yaw) * 2.7, z: sh.mz + Math.sin(th) * 1.2, vx: Math.cos(yaw) * cp * v, vy: Math.sin(yaw) * cp * v, vz: Math.sin(th) * v,
        wx: Math.sin(yaw) * w0, wy: -Math.cos(yaw) * w0, wz: 0, bt, hives: q.hives, ti });
    }
    out[iy * n + ix] = ok / tot;
  }
  return { n, step, x0: -HALF + 9, data: out };
}

const API = {
  G, DT, D2R, HALF, WALL_H, BT_POLLEN, BT_RED, BT_BLUE, BALL_R, BALL_M, T_AUTO, T_TRANS, T_TELE, T_TELE0, T_END, T_FLOWER,
  PTS, RPV, ZONES, HV, PENT, FL, FLOWERS_DEF, TAG_BASE, TAG_SIZE, TAG_OFF, TAG_A_MID, TAG_B, TAG_STICKER, FRAME_CAPS, LEGS, FOOT_BARS, ARM_SEGS, ARM_R, CELL_PLATES, AIM_Z,
  MOTORS, FLYWHEELS, BATTERY, PRESETS, COLORS, KI, MAT, HOOD_MIN, HOOD_MAX,
  createSim, startMatch, setPhase, advance, physicsStep, breakdown, finalScore, provisional: breakdown, matchClock, tipProgress,
  bodyToWorld, worldToBody, bodyDirToWorld, aimPointWorld, ballInCell, flowerState, flowerBottom, flowerInReach, cellCounts, gardenCounts,
  tagGrid, tagPoses, detectTags, cameraPose, muzzle, shooterBase, shooterYaw, shotLookup, legalFor, inZone, touchingWall, allyOf, other, addBall,
  predictArc, aimMap, probeShot, shotClear, shotFeasible, makeShooter, normalizeSpec, deriveRobot, classCheck, presetSpec, startPose, enterNectar, hpAllowed, hiveOf, nextBallFor,
  boxGap, legObstacles, flowerBox, clamp, wrap, gauss, mulberry32, holdK, flyTo, solveV, setTorqueTable: t => { TORQUE_TABLE = t; }, get torqueTable() { return TORQUE_TABLE; },
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.BB = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
