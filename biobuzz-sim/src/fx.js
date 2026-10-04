/* BIOBUZZ Sim — effects: scoring sparks, HIVE TIP bursts, ball flight trails, end-of-match confetti, camera flashes in the stands. */
(function (root) {
'use strict';
const T = root.THREE, BB = root.BB, R = root.BBR;
if (!T || !R) { root.BBFX = null; return; }

const MAXS = 1600, MAXC = 520;
const FX = { on: true, flashes: false, world: null };
const COLS = { honey: [1, 0.78, 0.2], white: [1, 0.97, 0.9], R: [1, 0.3, 0.32], B: [0.35, 0.6, 1], ballP: [1, 0.82, 0.25], ballR: [1, 0.36, 0.36], ballB: [0.45, 0.66, 1] };

// ------------------------------------------------------------------ additive sparks (also used for trails and flashes)
const VS = `attribute float size; attribute float alpha; attribute vec3 pcolor; uniform float uPx; varying vec3 vC; varying float vA;
void main(){ vC = pcolor; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uPx / max(1.0, -mv.z), 1.0, 64.0); gl_Position = projectionMatrix * mv; }`;
const FS = `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; float a = 1.0 - r; float core = a * a * a * a;
  gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.55) * (a * a * vA * 1.6), 1.0); }`;
const VC = `attribute float size; attribute float alpha; attribute float rot; attribute vec3 pcolor; uniform float uPx; varying vec3 vC; varying float vA; varying float vR;
void main(){ vC = pcolor; vA = alpha; vR = rot; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uPx / max(1.0, -mv.z), 1.0, 48.0); gl_Position = projectionMatrix * mv; }`;
const FC = `varying vec3 vC; varying float vA; varying float vR; void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float h = 0.12 + 0.12 * abs(cos(vR * 1.7)); if (abs(p.x) > 0.42 || abs(p.y) > h) discard; gl_FragColor = vec4(vC * (0.8 + 0.2 * sign(p.y)), vA); }`;

function pool(n, confetti) {
  const geo = new T.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), rot = new Float32Array(n);
  geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
  geo.setAttribute('pcolor', new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
  geo.setAttribute('size', new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
  geo.setAttribute('alpha', new T.BufferAttribute(alpha, 1).setUsage(T.DynamicDrawUsage));
  if (confetti) geo.setAttribute('rot', new T.BufferAttribute(rot, 1).setUsage(T.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new T.ShaderMaterial({ uniforms: { uPx: { value: 600 } }, vertexShader: confetti ? VC : VS, fragmentShader: confetti ? FC : FS,
    transparent: true, depthWrite: false, blending: confetti ? T.NormalBlending : T.AdditiveBlending });
  const pts = new T.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  // simulation state (three.js coordinates, inches)
  return { geo, mat, pts, n: 0, max: n, p: new Float32Array(n * 3), v: new Float32Array(n * 3), c: new Float32Array(n * 3), life: new Float32Array(n), max0: new Float32Array(n), sz: new Float32Array(n), g: new Float32Array(n), drag: new Float32Array(n), r: new Float32Array(n), wr: new Float32Array(n), a0: new Float32Array(n) };
}
function emit(P, x, y, z, vx, vy, vz, c, life, size, grav, drag, a0) {
  if (P.n >= P.max) return;
  const i = P.n++, k = i * 3;
  P.p[k] = x; P.p[k + 1] = y; P.p[k + 2] = z; P.v[k] = vx; P.v[k + 1] = vy; P.v[k + 2] = vz;
  P.c[k] = c[0]; P.c[k + 1] = c[1]; P.c[k + 2] = c[2];
  P.life[i] = life; P.max0[i] = life; P.sz[i] = size; P.g[i] = grav; P.drag[i] = drag; P.a0[i] = a0 === undefined ? 1 : a0;
  P.r[i] = Math.random() * 6.28; P.wr[i] = (Math.random() - 0.5) * 14;
}
function step(P, dt, confetti) {
  const pos = P.geo.attributes.position.array, col = P.geo.attributes.pcolor.array, size = P.geo.attributes.size.array, alpha = P.geo.attributes.alpha.array;
  const rot = confetti ? P.geo.attributes.rot.array : null;
  let j = 0;
  for (let i = 0; i < P.n; i++) {
    P.life[i] -= dt;
    if (P.life[i] <= 0) continue;
    const k = i * 3, d = Math.max(0, 1 - P.drag[i] * dt);
    P.v[k] *= d; P.v[k + 1] = P.v[k + 1] * d + P.g[i] * dt; P.v[k + 2] *= d;
    if (confetti) { const t = P.life[i]; P.v[k] += Math.sin(t * 2.3 + i) * 18 * dt; P.v[k + 2] += Math.cos(t * 1.9 + i * 0.7) * 18 * dt; P.r[i] += P.wr[i] * dt; }
    P.p[k] += P.v[k] * dt; P.p[k + 1] += P.v[k + 1] * dt; P.p[k + 2] += P.v[k + 2] * dt;
    if (P.p[k + 1] < 0.3) { P.p[k + 1] = 0.3; P.v[k + 1] *= confetti ? 0 : -0.3; P.v[k] *= 0.5; P.v[k + 2] *= 0.5; }
    // compact alive particles to the front
    const m = j * 3;
    if (j !== i) {
      P.p[m] = P.p[k]; P.p[m + 1] = P.p[k + 1]; P.p[m + 2] = P.p[k + 2]; P.v[m] = P.v[k]; P.v[m + 1] = P.v[k + 1]; P.v[m + 2] = P.v[k + 2];
      P.c[m] = P.c[k]; P.c[m + 1] = P.c[k + 1]; P.c[m + 2] = P.c[k + 2];
      P.life[j] = P.life[i]; P.max0[j] = P.max0[i]; P.sz[j] = P.sz[i]; P.g[j] = P.g[i]; P.drag[j] = P.drag[i]; P.r[j] = P.r[i]; P.wr[j] = P.wr[i]; P.a0[j] = P.a0[i];
    }
    const f = P.life[j] / P.max0[j];
    pos[m] = P.p[m]; pos[m + 1] = P.p[m + 1]; pos[m + 2] = P.p[m + 2];
    col[m] = P.c[m]; col[m + 1] = P.c[m + 1]; col[m + 2] = P.c[m + 2];
    size[j] = P.sz[j] * (confetti ? 1 : 0.55 + 0.45 * f);
    alpha[j] = P.a0[j] * (confetti ? Math.min(1, f * 4) : f * f);
    if (rot) rot[j] = P.r[j];
    j++;
  }
  P.n = j;
  P.geo.setDrawRange(0, j);
  if (j) { for (const a of ['position', 'pcolor', 'size', 'alpha']) P.geo.attributes[a].needsUpdate = true; if (rot) P.geo.attributes.rot.needsUpdate = true; }
}

// ------------------------------------------------------------------ setup / reset
function ensure() {
  if (!R.scene) return false;
  if (!FX.group) {
    FX.sp = pool(MAXS, false); FX.cf = pool(MAXC, true);
    FX.group = new T.Group(); FX.group.add(FX.sp.pts, FX.cf.pts);
    R.scene.add(FX.group); R.fxGroup = FX.group;
    FX.last = new Float32Array(0); FX.lastOk = new Uint8Array(0);
  }
  if (FX.world !== R.world) { FX.world = R.world; FX.sp.n = 0; FX.cf.n = 0; FX.lastOk.fill(0); FX.flashT = 0; }
  return true;
}
FX.reset = function () { if (FX.sp) { FX.sp.n = 0; FX.cf.n = 0; FX.lastOk.fill(0); } };
FX.setOptions = function (set) { FX.on = set.fx !== 'off'; FX.flashes = set.quality === 'ultra'; if (!FX.on) FX.reset(); };

// ------------------------------------------------------------------ bursts (sim coordinates in, three.js coordinates inside)
FX.burst = function (x, y, z, cols, n, speed, life, size, grav, up) {
  if (!FX.on || !ensure()) return;
  const X = x, Y = z, Z = -y;
  for (let i = 0; i < n; i++) {
    const c = cols[i % cols.length];
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const s = speed * (0.35 + 0.65 * Math.random());
    const vx = Math.sin(ph) * Math.cos(th) * s, vy = Math.abs(Math.cos(ph)) * s * (up || 1), vz = Math.sin(ph) * Math.sin(th) * s;
    emit(FX.sp, X, Y, Z, vx, vy, vz, c, life * (0.6 + 0.4 * Math.random()), size * (0.7 + 0.6 * Math.random()), grav, 1.6, 1);
  }
};
FX.event = function (sim, e) {
  if (!FX.on) return;
  switch (e.type) {
    case 'made': FX.made(e.x, e.y, e.z, e.alliance); break;
    case 'tip': if (e.counted) FX.tip(e.alliance); break;
    case 'dunk': { const f = sim.flowers[e.flower]; if (f) FX.burst(f.x, f.y, 23, [e.bt === 1 ? COLS.R : e.bt === 2 ? COLS.B : COLS.honey, COLS.white], 22, 34, 0.6, 1.0, -90, 1.2); break; }
  }
};
FX.made = function (x, y, z, al) { FX.burst(x, y, z + 1, [COLS.honey, COLS.white, COLS[al] || COLS.honey], 22, 52, 0.6, 2.3, -140, 1.4); };
FX.tip = function (al) {
  const hx = BB.HV.xs[al], c = COLS[al] || COLS.honey;
  FX.burst(hx, 0, BB.HV.pz + 10, [c, c, COLS.honey, COLS.white], 130, 125, 1.2, 3.2, -150, 1.6);
  FX.burst(hx, 0, BB.HV.pz + 4, [COLS.white, c], 36, 55, 0.4, 6.5, 0, 0.6);
};
FX.celebrate = function (fin) {
  if (!FX.on || !fin || !ensure()) return;
  const win = fin.R.total > fin.B.total ? 'R' : fin.B.total > fin.R.total ? 'B' : null;
  const cols = win ? [COLS[win], COLS[win], COLS.honey, COLS.white] : [COLS.R, COLS.B, COLS.honey, COLS.white];
  for (let i = 0; i < MAXC - 20; i++) {
    const c = cols[i % cols.length];
    emit(FX.cf, (Math.random() - 0.5) * 170, 70 + Math.random() * 90, (Math.random() - 0.5) * 170, (Math.random() - 0.5) * 10, -18 - Math.random() * 22, (Math.random() - 0.5) * 10, c, 6 + Math.random() * 4, 1.6 + Math.random() * 1.2, -4, 0.35, 1);
  }
};

// ------------------------------------------------------------------ per frame: trails behind flying balls, flashes in the stands
FX.update = function (dt, cam, src) {
  if (!ensure()) return;
  const S = root.BBAPP; src = src || (S && S.sim);
  if (FX.on && src && dt > 0) {
    const balls = src.balls, n = balls.length;
    if (FX.last.length < n * 3) { const a = new Float32Array(n * 3 + 60), o = new Uint8Array(n + 20); a.set(FX.last); o.set(FX.lastOk); FX.last = a; FX.lastOk = o; }
    for (let i = 0; i < n; i++) {
      const b = balls[i], k = i * 3;
      if (b.state !== 'field' || b.z < b.r + 1.5) { FX.lastOk[i] = 0; continue; }
      if (FX.lastOk[i]) {
        const lx = FX.last[k], ly = FX.last[k + 1], lz = FX.last[k + 2], d = Math.hypot(b.x - lx, b.y - ly, b.z - lz), sp = d / dt;
        if (sp > 70 && d < 30) {
          const c = b.bt === 1 ? COLS.ballR : b.bt === 2 ? COLS.ballB : COLS.ballP, m = Math.min(7, Math.ceil(d / 1.3));
          for (let q = 0; q < m; q++) { const f = q / m; emit(FX.sp, lx + (b.x - lx) * f, lz + (b.z - lz) * f, -(ly + (b.y - ly) * f), 0, 0, 0, c, 0.22, b.r * 1.5, 0, 0, 0.55); }
        }
      }
      FX.last[k] = b.x; FX.last[k + 1] = b.y; FX.last[k + 2] = b.z; FX.lastOk[i] = 1;
    }
    if (FX.flashes) {
      FX.flashT = (FX.flashT || 0) - dt;
      while (FX.flashT < 0) {
        FX.flashT += 0.08 + Math.random() * 0.22;
        const side = Math.random() < 0.5 ? -1 : 1, k = Math.floor(Math.random() * 5);
        emit(FX.sp, (Math.random() - 0.5) * 440, 20 + k * 18 + Math.random() * 6, side * (222 + k * 34), 0, 0, 0, COLS.white, 0.07, 5.5, 0, 0, 1);
      }
    }
  }
  const px = cam ? R.renderer.getDrawingBufferSize(_v2).y / (2 * Math.tan(cam.fov * Math.PI / 360)) : 600;
  FX.sp.mat.uniforms.uPx.value = px; FX.cf.mat.uniforms.uPx.value = px;
  step(FX.sp, Math.max(0, dt), false); step(FX.cf, Math.max(0, dt), true);
};
const _v2 = new T.Vector2();
root.BBFX = FX;
})(typeof globalThis !== 'undefined' ? globalThis : this);
