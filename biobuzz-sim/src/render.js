/* BIOBUZZ Sim — three.js r128 renderer v2. Physics (x,y,z) maps to three (x, z, -y); 1 unit = 1 inch.
   Robots are built from their spec (drivetrain, intake, shooters, camera, FLOWER arm). */
(function (root) {
'use strict';
const BB = root.BB;
const T = root.THREE;
if (!T) { root.BBR = { ready: false, missing: true }; return; }

const COL = {
  red: 0xd8343a, blue: 0x2f6fe0, redNectar: 0xc8262b, blueNectar: 0x2459d2, pollen: 0xf4c01a,
  carpet: 0x0d1115, alu: 0xc3cad1, steel: 0x6d757e, frame: 0x3d434a, dark: 0x262b31, black: 0x131619,
  flower: 0x2f9d4f, flowerRing: 0xf2c230, bg: 0x080b0f,
};
function P(x, y, z) { return new T.Vector3(x, z, -y); }

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, srgb = true, wrap) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new T.CanvasTexture(c);
  if (srgb) t.encoding = T.sRGBEncoding;
  t.anisotropy = 8;
  if (wrap) { t.wrapS = t.wrapT = T.RepeatWrapping; }
  return t;
}
function tileTextures() {
  // colour + bump for 6x6 soft foam tiles
  const rnd = BB.mulberry32(42);
  const draw = (g, W, bump) => {
    const n = 6, s = W / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = bump ? 128 : 100 + Math.floor(rnd() * 9);
      g.fillStyle = bump ? '#808080' : `rgb(${v},${v + 4},${v + 9})`; g.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 2600; k++) {
        const a = rnd() * (bump ? 0.35 : 0.07);
        g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.8})`;
        const r = 1 + rnd() * 2.2; g.fillRect(i * s + rnd() * s, j * s + rnd() * s, r, r);
      }
    }
    g.strokeStyle = bump ? 'rgba(0,0,0,0.9)' : 'rgba(22,26,31,0.7)'; g.lineWidth = bump ? 6 : 3.5;
    for (let k = 1; k < n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, W); g.moveTo(0, k * s); g.lineTo(W, k * s); g.stroke(); }
  };
  const map = canvasTex(2048, 2048, (g, W) => draw(g, W, false));
  const bump = canvasTex(2048, 2048, (g, W) => draw(g, W, true), false);
  return { map, bump };
}
function holesAlpha() {
  // white = solid, black = hole (26 holes, indoor pickleball pattern)
  return canvasTex(512, 256, (g, W, H) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const rows = [[-64, 4, 0], [-26, 9, 0.5], [26, 9, 0], [64, 4, 0.5]];
    g.fillStyle = '#000';
    for (const [lat, cnt, off] of rows) {
      for (let k = 0; k < cnt; k++) {
        const lon = (k + off) / cnt * 360, u = lon / 360 * W, v = (90 - lat) / 180 * H, rr = 13;
        const sx = rr / Math.cos(lat * Math.PI / 180);
        for (const du of [0, -W, W]) { g.beginPath(); g.ellipse(u + du, v, sx, rr, 0, 0, Math.PI * 2); g.fill(); }
      }
    }
  }, false);
}
function signTexture(team, alliance) {
  return canvasTex(512, 160, (g, W, H) => {
    g.fillStyle = alliance === 'R' ? '#c9272e' : '#2663d1'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
    g.fillStyle = '#ffffff'; g.font = '800 124px "Saira Condensed", "Arial Narrow", Impact, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(team, W / 2, H / 2 + 6);
  });
}
function logoTexture(h = 256) {
  return canvasTex(1024, h, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#f6cb3c'); grd.addColorStop(1, '#e5b21d');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,80,0,0.2)'; g.lineWidth = 3;
    const r = 22;
    for (let y = -r, row = 0; y < H + r; y += r * 1.5, row++) for (let x = -r; x < W + r; x += r * Math.sqrt(3)) {
      const ox = (row % 2) * r * Math.sqrt(3) / 2;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g[k ? 'lineTo' : 'moveTo'](x + ox + r * Math.cos(a), y + r * Math.sin(a)); }
      g.closePath(); g.stroke();
    }
    g.fillStyle = '#1d1a12'; g.font = '900 150px "Saira Condensed", "Arial Narrow", Impact, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BIOBUZZ', W / 2, H / 2 + 8);
  });
}
function channelTexture() {
  // goBILDA-style channel: brushed aluminium with a hole pattern
  return canvasTex(512, 128, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#d5dbe0'); grd.addColorStop(1, '#aeb6be');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.fillRect(0, Math.random() * H, W, 1); }
    g.fillStyle = '#2a2f35';
    for (let x = 16; x < W; x += 32) { g.beginPath(); g.arc(x, H / 2, 9, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x + 16, H / 2 - 30, 4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x + 16, H / 2 + 30, 4, 0, Math.PI * 2); g.fill(); }
  }, true, true);
}
function rollerTexture() {
  return canvasTex(256, 64, (g, W, H) => {
    g.fillStyle = '#1b1e22'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#3a3f46'; g.lineWidth = 9;
    for (let x = -H; x < W + H; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); }
  }, true, true);
}
function crowdTexture() {
  return canvasTex(1024, 256, (g, W, H) => {
    g.fillStyle = '#0f141a'; g.fillRect(0, 0, W, H);
    const rnd = BB.mulberry32(9);
    const cols = ['#2b3440', '#3a4453', '#4a2a2e', '#23324d', '#5a4a1c', '#2e3a2f'];
    for (let y = 8; y < H; y += 26) for (let x = 4; x < W; x += 14 + rnd() * 6) {
      if (rnd() < 0.2) continue;
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.beginPath(); g.arc(x, y + 6, 5, 0, Math.PI * 2); g.fill(); g.fillRect(x - 6, y + 10, 12, 12);
    }
  }, true, true);
}

// ------------------------------------------------------------------ geometry helpers
function boxBetween(a, b, w, h, mat) {
  const d = new T.Vector3().subVectors(b, a), L = d.length();
  const m = new T.Mesh(new T.BoxGeometry(w, L, h), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  return m;
}
function cylBetween(a, b, r, mat, seg = 12) {
  const d = new T.Vector3().subVectors(b, a), L = d.length();
  const m = new T.Mesh(new T.CylinderGeometry(r, r, L, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  return m;
}
function mergeGeos(geos) {
  const hasUv = geos.every(g => g.attributes.uv);
  let n = 0; geos.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = hasUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
function mergeInto(group, skip) {
  skip = skip || new Set();
  group.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), victims = [];
  group.traverse(o => {
    if (o === group || !o.isMesh) return;
    for (let p = o; p && p !== group; p = p.parent) if (skip.has(p)) return;
    const m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(m);
    const key = o.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: o.castShadow, recv: o.receiveShadow, ro: o.renderOrder });
    buckets.get(key).geos.push(g); victims.push(o);
  });
  victims.forEach(o => o.parent && o.parent.remove(o));
  for (const b of buckets.values()) {
    const mesh = new T.Mesh(mergeGeos(b.geos), b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.ro;
    group.add(mesh);
  }
  return group;
}
function shadow(o, cast = true, recv = true) { o.traverse(c => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = recv; } }); return o; }
function blobShadowTex() {
  return canvasTex(128, 128, (g, W) => {
    const grd = g.createRadialGradient(W / 2, W / 2, 4, W / 2, W / 2, W / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
  }, false);
}

// ------------------------------------------------------------------ the official FIELD CAD
// fieldcad/build_asset.py turns FIRST's STEP model (Playing Field Resources, v26-27.2) into quantized meshes: the
// static field in world inches (CAD Y-up frame = this renderer's frame) and each HIVE in its own level frame around
// the pivot, plus the 36 tile outlines. The page carries it as raw-deflate + base64 text in #field-cad.
const CAD = { ready: false, data: null, err: '' };
function parseCad(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x31464242) throw new Error('bad field CAD header');
  const jl = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
  const base = 8 + jl, out = { meta, buckets: [] };
  for (const d of meta.buckets) {
    const q = new Uint16Array(buf, base + d.p, d.nv * 3), n8 = new Int8Array(buf, base + d.n, d.nv * 2);
    const idx = d.i32 ? new Uint32Array(buf, base + d.i, d.ni) : new Uint16Array(buf, base + d.i, d.ni);
    const pos = new Float32Array(d.nv * 3), nor = new Float32Array(d.nv * 3);
    const lo = d.lo, sx = (d.hi[0] - lo[0]) / 65535, sy = (d.hi[1] - lo[1]) / 65535, sz = (d.hi[2] - lo[2]) / 65535;
    for (let i = 0; i < d.nv; i++) {
      pos[3 * i] = lo[0] + q[3 * i] * sx; pos[3 * i + 1] = lo[1] + q[3 * i + 1] * sy; pos[3 * i + 2] = lo[2] + q[3 * i + 2] * sz;
      let x = n8[2 * i] / 127, y = n8[2 * i + 1] / 127; const z = 1 - Math.abs(x) - Math.abs(y);
      if (z < 0) { const ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1), oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1); x = ox; y = oy; }
      const l = Math.hypot(x, y, z) || 1;
      nor[3 * i] = x / l; nor[3 * i + 1] = y / l; nor[3 * i + 2] = z / l;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setIndex(new T.BufferAttribute(d.i32 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeBoundingSphere();
    geo.userData.keep = true;                    // shared by every R.build, never disposed
    out.buckets.push({ g: d.g, m: d.m, geo });
  }
  const counts = Array.from(new Uint32Array(buf, base + meta.seams.counts, meta.seams.n));
  const total = counts.reduce((s, c) => s + c, 0);
  out.seams = { counts, pts: new Int16Array(buf, base + meta.seams.pts, total * 2).slice(), scale: meta.seams.scale };
  return out;
}
function cadMaterials(M) {
  const std = o => new T.MeshStandardMaterial(o);
  const m = R.cadMats || (R.cadMats = {
    glass: std({ color: 0xe8f0f6, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.8 }),
    rail: std({ color: 0x1c1f23, metalness: 0.6, roughness: 0.42 }),
    alu: std({ color: 0xc9cfd5, metalness: 0.55, roughness: 0.38, envMapIntensity: 1.2 }),
    black: std({ color: 0x17191c, metalness: 0.05, roughness: 0.6 }),
    orange: std({ color: 0xf0982c, metalness: 0.1, roughness: 0.42 }),
    pipe: std({ color: 0x2f9a3d, metalness: 0.05, roughness: 0.3 }),
    purple: std({ color: 0x6c40a2, metalness: 0.1, roughness: 0.45 }),
    gray: std({ color: 0xa3aab1, metalness: 0.4, roughness: 0.45 }),
    ribR: std({ color: 0xd02a30, metalness: 0.05, roughness: 0.42 }),
    ribB: std({ color: 0x2a5fd6, metalness: 0.05, roughness: 0.42 }),
    skin: std({ color: 0xf3f6f9, metalness: 0, roughness: 0.16, transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.3 }),
    acm: std({ color: 0xd2d7dc, metalness: 0.45, roughness: 0.38 }),
    tray: std({ color: 0x2a2d31, metalness: 0.1, roughness: 0.75 }),
  });
  m.tapeR = M.tapeR; m.tapeB = M.tapeB;
  return m;
}
function cadMesh(b, mats) {
  const mat = mats[b.m] || mats.gray;
  const mesh = new T.Mesh(b.geo, mat);
  const tape = b.m === 'tapeR' || b.m === 'tapeB';
  mesh.castShadow = !mat.transparent && !tape; mesh.receiveShadow = true;
  if (mat.transparent) mesh.renderOrder = 3;
  return mesh;
}
// foam tiles: per-tile shade, speckle, and the real interlocking outlines of the 36 tiles from the CAD
function tileTexturesCad(seams) {
  const rnd = BB.mulberry32(42), TS = 141.17;
  const draw = (g, W, bump) => {
    const px = W / TS, pitch = TS / 6;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const v = bump ? 128 : 100 + Math.floor(rnd() * 9);
      g.fillStyle = bump ? '#808080' : `rgb(${v},${v + 4},${v + 9})`;
      g.fillRect(Math.floor(i * pitch * px) - 3, Math.floor(j * pitch * px) - 3, Math.ceil(pitch * px) + 6, Math.ceil(pitch * px) + 6);
    }
    for (let k = 0; k < 36 * 2600; k++) {
      const a = rnd() * (bump ? 0.35 : 0.07);
      g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.8})`;
      const r = 1 + rnd() * 2.2; g.fillRect(rnd() * W, rnd() * W, r, r);
    }
    g.strokeStyle = bump ? 'rgba(0,0,0,0.85)' : 'rgba(28,32,38,0.5)'; g.lineWidth = bump ? 3 : 1.6; g.lineJoin = 'round';
    const P = seams.pts, s = seams.scale;
    let o = 0;
    for (const c of seams.counts) {
      g.beginPath();
      for (let k = 0; k < c; k++) { const x = (P[2 * (o + k)] * s + TS / 2) * px, y = (P[2 * (o + k) + 1] * s + TS / 2) * px; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke(); o += c;
    }
  };
  const map = canvasTex(2048, 2048, (g, W) => draw(g, W, false));
  const bump = canvasTex(2048, 2048, (g, W) => draw(g, W, true), false);
  return { map, bump, size: TS };
}
// AprilTag cluster sticker (Figure 9-15): 17 x 5 in, four 3.25 in tags 2.75 in above the reference holes, ID labels on
// the coloured strip that faces the field centre
function tagStickerTexture(base, alliance, sg) {
  return canvasTex(1024, 302, (g, W, H) => {
    const k = W / 17;
    g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, W, H);
    g.fillStyle = alliance === 'R' ? '#c7262d' : '#1f5dcc'; g.fillRect(0, H - 0.62 * k, W, 0.62 * k);
    const cx0 = [2.0, 5.75, 11.25, 15.0];
    for (let i = 0; i < 4; i++) {
      const s = 3.25 * k, px = s / 10, x0 = cx0[i] * k - s / 2, y0 = H - 2.75 * k - s / 2;
      const grid = BB.tagGrid(base + i);
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        g.fillStyle = grid[r][c] ? '#f6f6f2' : '#101010';
        g.fillRect(Math.floor(x0 + c * px), Math.floor(y0 + r * px), Math.ceil(px) + 1, Math.ceil(px) + 1);
      }
      g.fillStyle = '#ffffff'; g.font = `700 ${Math.round(0.26 * k)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ID ' + (base + i), cx0[i] * k, H - 0.31 * k);
    }
    g.fillStyle = '#ffffff'; g.font = `700 ${Math.round(0.2 * k)}px Arial, sans-serif`; g.textAlign = 'center';
    g.fillText(`${alliance === 'R' ? 'RED' : 'BLUE'} ${sg > 0 ? 'SCORING' : 'AUDIENCE'} · Tag family: 36h11`, 8.5 * k, H - 0.31 * k);
    g.fillStyle = '#2d3238';
    for (const hx of [8.5 - 7.0, 8.5 + 7.0]) { g.beginPath(); g.arc(hx * k, H, 0.25 * k, 0, Math.PI * 2); g.fill(); }
  });
}

// ------------------------------------------------------------------ renderer
const R = { ready: false, cad: CAD };
// decode #field-cad once, before the first R.build; any failure leaves the hand-built field in place
R.loadFieldCad = async function () {
  if (CAD.ready) return true;
  try {
    const el = document.getElementById('field-cad');
    if (!el || typeof DecompressionStream === 'undefined' || typeof TextDecoder === 'undefined') { CAD.err = 'unsupported'; return false; }
    const txt = el.textContent.replace(/\s+/g, ''); if (!txt) { CAD.err = 'empty'; return false; }
    const bin = atob(txt), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    CAD.data = parseCad(buf); CAD.ready = true;
    el.textContent = '';
    return true;
  } catch (e) { CAD.err = String(e && e.message || e); CAD.ready = false; return false; }
};
R.init = function (canvas, opt) {
  opt = opt || {};
  // low-latency context: no alpha, desynchronized hint, high-performance GPU
  let context = null;
  const attrs = { antialias: true, alpha: false, depth: true, stencil: false, desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
  try { context = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs); } catch (e) { context = null; }
  const renderer = new T.WebGLRenderer(context ? { canvas, context, antialias: true } : { canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.physicallyCorrectLights = false;
  R.renderer = renderer;
  const scene = new T.Scene();
  scene.background = canvasTex(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#05080d'); grd.addColorStop(0.45, '#0d1622'); grd.addColorStop(0.62, '#141f2c'); grd.addColorStop(1, '#070a0e');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new T.Fog(COL.bg, 520, 1100);
  R.scene = scene;
  R.cam = new T.PerspectiveCamera(50, 1, 2, 2400);
  R.pipCam = new T.PerspectiveCamera(49, 4 / 3, 1, 900);
  // image-based lighting from a procedural arena (ceiling light panels, dark stands, alliance banners)
  scene.environment = buildEnvironment(renderer);
  // sky light from the ceiling panels; the ground term is the grey floor bouncing light onto undersides (CELL tags)
  scene.add(new T.HemisphereLight(0xd8e6ff, 0x3c4147, 0.32));
  const sun = new T.DirectionalLight(0xfff3e2, 1.25);
  sun.position.set(-60, 230, 95); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -84; sc.right = 84; sc.top = 84; sc.bottom = -84; sc.near = 90; sc.far = 420;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.3; sun.shadow.radius = 3;
  scene.add(sun, sun.target); R.sun = sun;
  const fill = new T.DirectionalLight(0xb9ccff, 0.35); fill.position.set(110, 140, -150); scene.add(fill);
  const rim = new T.DirectionalLight(0xffe0b8, 0.25); rim.position.set(0, 90, -220); scene.add(rim);
  R.setQuality(opt.quality || 'high');
  R.ready = true;
};
function buildEnvironment(renderer) {
  const pm = new T.PMREMGenerator(renderer);
  const env = new T.Scene();
  env.add(new T.Mesh(new T.BoxGeometry(1200, 420, 1200), new T.MeshBasicMaterial({ color: 0x10151b, side: T.BackSide })));
  const lamp = new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).multiplyScalar(6) });
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
    const m = new T.Mesh(new T.PlaneGeometry(110, 26), lamp); m.position.set(i * 170, 200, j * 190); m.rotation.x = Math.PI / 2; env.add(m);
  }
  const red = new T.MeshBasicMaterial({ color: new T.Color(0xd8343a).multiplyScalar(0.9) }), blue = new T.MeshBasicMaterial({ color: new T.Color(0x2f6fe0).multiplyScalar(0.9) });
  const r = new T.Mesh(new T.PlaneGeometry(420, 90), red); r.position.set(-590, 60, 0); r.rotation.y = Math.PI / 2; env.add(r);
  const b = new T.Mesh(new T.PlaneGeometry(420, 90), blue); b.position.set(590, 60, 0); b.rotation.y = -Math.PI / 2; env.add(b);
  const floor = new T.Mesh(new T.PlaneGeometry(1200, 1200), new T.MeshBasicMaterial({ color: 0x2a2f36 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -200; env.add(floor);
  const tex = pm.fromScene(env, 0.035).texture;
  pm.dispose();
  return tex;
}
R.setQuality = function (q) {
  R.quality = q;
  R.renderer.toneMappingExposure = q === 'ultra' ? 1.06 : 1.0;
  R.renderer.shadowMap.enabled = q !== 'low';
  // soft shadows only on "Đẹp nhất"; plain PCF with a wider kernel costs about a third as much per pixel
  R.renderer.shadowMap.type = q === 'ultra' ? T.PCFSoftShadowMap : T.PCFShadowMap;
  if (R.sun) {
    R.sun.castShadow = q !== 'low'; R.sun.shadow.radius = q === 'ultra' ? 3 : 1.6;
    R.sun.shadow.mapSize.set(q === 'ultra' ? 4096 : 2048, q === 'ultra' ? 4096 : 2048); if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; }
  }
  R.scene && R.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  R.dyn.scale = 1; R.dyn.hist.length = 0; R.dyn.hold = 2; R.dyn.wait = 8000;
  if (R.size) R.resize(R.size.w, R.size.h);
};
// ------------------------------------------------------------------ resolution: per-quality pixel ratio, lowered on the fly when the GPU falls behind
R.dyn = { on: true, scale: 1, hist: [], t: 0, hold: 2, lastDrop: -1e9, wait: 8000, cpu: 0 };
function basePR(w, h) {
  const dpr = window.devicePixelRatio || 1;
  if (R.quality === 'low') return 1;
  // keep the ultra render targets inside ~4.2 million pixels (a 4K screen at 2x would be 33 million)
  if (R.quality === 'ultra') return Math.max(1, Math.min(dpr, 2, Math.sqrt(4.2e6 / Math.max(1, w * h))));
  return Math.min(dpr, 1.5);
}
R.pixelRatio = function () { return R.size ? Math.max(0.5, basePR(R.size.w, R.size.h) * R.dyn.scale) : 1; };
R.dynTick = function (dt, cpuMs) {
  const D = R.dyn;
  if (!D.on) { if (D.scale !== 1) { D.scale = 1; if (R.size) R.resize(R.size.w, R.size.h); } return; }
  if (!(dt > 0) || dt > 0.25 || document.hidden) return;           // tab switches and one-off hitches say nothing
  if (D.hold > 0) { D.hold -= dt; return; }                         // settle after a rebuild or a change
  D.hist.push(dt); if (D.hist.length > 90) D.hist.shift();
  D.cpu = D.cpu ? D.cpu * 0.94 + cpuMs * 0.06 : cpuMs;
  D.t += dt; if (D.t < 1) return; D.t = 0;
  if (D.hist.length < 50) return;
  const s = D.hist.slice().sort((a, b) => a - b), base = s[Math.floor(s.length * 0.1)], med = s[s.length >> 1];
  const late = D.hist.filter(x => x > base * 1.5 + 0.002).length / D.hist.length;
  const now = performance.now();
  // below ~55 fps, or stuttering, while the page's own work is small: the GPU is the bottleneck, draw fewer pixels
  if ((med > 1 / 55 || (late > 0.2 && med > 1 / 90)) && D.cpu < med * 1000 * 0.6 && D.scale > 0.56) {
    D.scale = Math.max(0.55, D.scale * 0.85);
    if (now - D.lastUp < 12000) D.wait = Math.min(120000, D.wait * 2);   // the last step up was too much: wait longer next time
    D.lastDrop = now; D.hold = 1.2; D.hist.length = 0; if (R.size) R.resize(R.size.w, R.size.h);
  } else if (late < 0.03 && med <= base * 1.12 && D.scale < 1 && now - D.lastDrop > D.wait) {
    D.scale = Math.min(1, D.scale / 0.88); D.lastUp = now; D.hold = 1.2; D.hist.length = 0; if (R.size) R.resize(R.size.w, R.size.h);
  }
};

R.build = function (sim) {
  const scene = R.scene;
  R.dyn.hold = Math.max(R.dyn.hold, 2); R.dyn.hist.length = 0;       // shader compiles right after a build are not a slow GPU
  if (R.world) { scene.remove(R.world); R.world.traverse(o => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); }); }
  const W = new T.Group(); R.world = W; scene.add(W);
  const chan = channelTexture();
  const M = R.mats = {
    alu: new T.MeshStandardMaterial({ color: COL.alu, metalness: 0.85, roughness: 0.32 }),
    chan: new T.MeshStandardMaterial({ map: chan, metalness: 0.8, roughness: 0.34 }),
    steel: new T.MeshStandardMaterial({ color: COL.steel, metalness: 0.7, roughness: 0.42 }),
    frame: new T.MeshStandardMaterial({ color: COL.frame, metalness: 0.55, roughness: 0.5 }),
    dark: new T.MeshStandardMaterial({ color: COL.dark, metalness: 0.4, roughness: 0.55 }),
    black: new T.MeshStandardMaterial({ color: COL.black, metalness: 0.05, roughness: 0.8 }),
    rubber: new T.MeshStandardMaterial({ color: 0x0e1012, roughness: 0.95 }),
    panel: new T.MeshStandardMaterial({ color: 0xe6f0f8, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.4 }),
    red: new T.MeshStandardMaterial({ color: COL.red, roughness: 0.45 }),
    blue: new T.MeshStandardMaterial({ color: COL.blue, roughness: 0.45 }),
    // floor decals sit a hair above the tiles: polygon offset keeps them from z-fighting on 16-bit depth buffers
    tapeR: new T.MeshStandardMaterial({ color: COL.red, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    tapeB: new T.MeshStandardMaterial({ color: COL.blue, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    flower: new T.MeshStandardMaterial({ color: COL.flower, roughness: 0.32, metalness: 0.05 }),
    ring: new T.MeshStandardMaterial({ color: COL.flowerRing, roughness: 0.35 }),
    cellFace: new T.MeshStandardMaterial({ color: 0xeaf2f8, metalness: 0.05, roughness: 0.06, transparent: true, opacity: 0.16, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.6 }),
    orange: new T.MeshStandardMaterial({ color: 0xea7a2c, roughness: 0.65 }),
    roller: new T.MeshStandardMaterial({ map: rollerTexture(), roughness: 0.85 }),
  };
  // --- arena
  const ARENA = new T.Group(); W.add(ARENA);
  const carpet = new T.Mesh(new T.PlaneGeometry(1400, 1400), new T.MeshStandardMaterial({ color: COL.carpet, roughness: 1, envMapIntensity: 0.2 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.y = -0.6; carpet.receiveShadow = true; ARENA.add(carpet);
  for (const al of ['R', 'B']) {
    const a = BB.ZONES.alliance[al];
    const m = new T.Mesh(new T.PlaneGeometry(a.x1 - a.x0, a.y1 - a.y0), new T.MeshStandardMaterial({ color: al === 'R' ? 0x3a1216 : 0x122140, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    m.rotation.x = -Math.PI / 2; m.position.set((a.x0 + a.x1) / 2, -0.58, -(a.y0 + a.y1) / 2); m.receiveShadow = true; ARENA.add(m);
  }
  buildStands(ARENA, M);
  // field floor: the tiles with their real interlocking seams when the FIELD CAD is loaded
  const cad = CAD.ready ? CAD.data : null;
  const tt = R.tileTex = R.tileTex && (!!R.tileTex.size === !!cad) ? R.tileTex : (cad ? tileTexturesCad(cad.seams) : tileTextures());
  const TS = tt.size || 141;
  const tiles = new T.Mesh(new T.PlaneGeometry(TS, TS), new T.MeshStandardMaterial({ map: tt.map, bumpMap: tt.bump, bumpScale: 0.12, roughness: 0.93, envMapIntensity: 0.35 }));
  tiles.rotation.x = -Math.PI / 2; tiles.receiveShadow = true; W.add(tiles);
  // the tile edge seen at the boundary; its top stays well under the tiles so the two never z-fight
  const edge = new T.Mesh(new T.BoxGeometry(TS, 0.5, TS), new T.MeshStandardMaterial({ color: 0x4d535b, roughness: 1 }));
  edge.position.y = -0.5; W.add(edge);
  const ST = new T.Group(); W.add(ST);
  if (cad) buildCadField(W, ST, M, sim, cad);
  else buildHandField(W, ST, M, sim);
  // balls: perforated shells (real see-through holes; the shadow keeps the holes too)
  const holes = holesAlpha();
  R.ballGeo = [new T.SphereGeometry(BB.BALL_R[0], 28, 18), new T.SphereGeometry(BB.BALL_R[1], 32, 20)];
  const ballMat = hex => {
    const m = new T.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0, alphaMap: holes, alphaTest: 0.5, side: T.DoubleSide, envMapIntensity: 0.9 });
    m.userData.depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, alphaMap: holes, alphaTest: 0.5 });
    return m;
  };
  R.ballMat = [ballMat(COL.pollen), ballMat(COL.redNectar), ballMat(COL.blueNectar)];
  R.balls = [];
  R.ballGroup = new T.Group(); W.add(R.ballGroup);
  syncBallMeshes(sim);
  R.blob = R.blob || blobShadowTex();
  R.robots = sim.robots.map(rb => {
    const o = buildRobot(M, rb); W.add(o.g);
    if (rb.human) {
      const rr = Math.hypot(rb.hx, rb.hy) + 2.2;
      const ring = new T.Mesh(new T.RingGeometry(rr, rr + 0.9, 48), new T.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; ring.renderOrder = 2; o.g.add(ring); o.ring = ring;
    }
    return o;
  });
  // predicted arcs, one per shooter of the focused robot
  R.trajs = [0, 1, 2].map(() => {
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(3 * 90), 3));
    const line = new T.Line(geo, new T.LineDashedMaterial({ color: 0xf2c230, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.95 }));
    line.frustumCulled = false; line.visible = false; W.add(line);
    return { line, buf: new Float32Array(3 * 90) };
  });
  const mk = new T.Mesh(new T.TorusGeometry(2.2, 0.28, 8, 24), new T.MeshBasicMaterial({ color: 0xf2c230 }));
  R.aimMark = mk; mk.visible = false; W.add(mk);
  R.aimOverlay = null;
  R.sim = sim;
};

// hand-built field (used when the FIELD CAD cannot be decoded)
function buildHandField(W, ST, M, sim) {
  const tape = (x0, x1, y0, y1, mat) => { const m = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.03, -(y0 + y1) / 2); m.receiveShadow = true; ST.add(m); };
  const outline = (z, mat, t = 2) => { tape(z.x0, z.x1, z.y0, z.y0 + t, mat); tape(z.x0, z.x1, z.y1 - t, z.y1, mat); tape(z.x0, z.x0 + t, z.y0 + t, z.y1 - t, mat); tape(z.x1 - t, z.x1, z.y0 + t, z.y1 - t, mat); };
  for (const al of ['R', 'B']) {
    const mat = al === 'R' ? M.tapeR : M.tapeB;
    outline(BB.ZONES.loading[al], mat, 1.0);
    const gz = BB.ZONES.garden[al]; tape(gz.x0, gz.x1, gz.y0, gz.y1, mat);
    const a = BB.ZONES.alliance[al];
    const t2 = (x0, x1, y0, y1) => { const m = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, -0.55, -(y0 + y1) / 2); ST.add(m); };
    t2(a.x0, a.x1, a.y0, a.y0 + 1); t2(a.x0, a.x1, a.y1 - 1, a.y1);
    t2(al === 'R' ? a.x0 : a.x1 - 1, al === 'R' ? a.x0 + 1 : a.x1, a.y0, a.y1);
  }
  buildPerimeter(ST, M);
  buildFrame(ST, M);
  R.flowers = sim.flowers.map(f => buildFlower(ST, M, f));
  buildAllianceStations(ST, M, sim);
  mergeInto(ST, new Set(R.hpGroups));
  R.hives = sim.hives.map(h => buildHive(W, M, h));
}
// the official FIELD CAD: perimeter, FLOWERS, HIVE frame, tape and trays as merged meshes; each HIVE in its own group
function buildCadField(W, ST, M, sim, cad) {
  const mats = cadMaterials(M);
  for (const b of cad.buckets) if (b.g === 'st') ST.add(cadMesh(b, mats));
  // BIOBUZZ logo stickers on the two ACM panels
  const lm = new T.MeshStandardMaterial({ map: R.logoTex || (R.logoTex = logoTexture(220)), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  for (const q of cad.meta.logos) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([].concat(...q), 3));
    g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    const m = new T.Mesh(g, lm); m.receiveShadow = true; ST.add(m);
  }
  R.flowers = [];
  // drive team carts; the five NECTAR wait in the CAD tray on the floor of each ALLIANCE AREA (Figure 10-2)
  R.hpNectar = {}; R.hpGroups = [];
  for (const al of ['R', 'B']) {
    const sgn = al === 'R' ? -1 : 1;
    const g = new T.Group();
    for (const dy of [-22, 22]) {
      const cart = new T.Mesh(new T.BoxGeometry(12, 1.2, 18), M.dark); cart.position.set(sgn * 100, 32, dy); g.add(cart);
      const post = new T.Mesh(new T.BoxGeometry(1.2, 32, 1.2), M.steel); post.position.set(sgn * 100, 16, dy); g.add(post);
      const lap = new T.Mesh(new T.BoxGeometry(8, 0.5, 11), M.black); lap.position.set(sgn * 100, 32.9, dy); g.add(lap);
      const scr = new T.Mesh(new T.BoxGeometry(0.4, 7, 11), M.black); scr.position.set(sgn * 103.6, 36.3, dy); scr.rotation.z = sgn * 0.25; g.add(scr);
    }
    shadow(g); ST.add(g);
    const balls = new T.Group(); W.add(balls); R.hpGroups.push(balls);
    const mat = new T.MeshStandardMaterial({ color: al === 'R' ? COL.redNectar : COL.blueNectar, roughness: 0.45 });
    const geo = new T.SphereGeometry(BB.BALL_R[1], 24, 16);
    R.hpNectar[al] = [[73.575, -3.62], [73.575, 0], [73.575, 3.62], [76.71, -1.81], [76.71, 1.81]].map(([x, z]) => {
      const b = new T.Mesh(geo, mat); b.position.set(sgn * x, 1.34, z); b.castShadow = true; b.receiveShadow = true; balls.add(b); return b;
    });
  }
  R.hives = sim.hives.map(h => buildHiveCad(W, M, h, cad, mats));
}
function buildHiveCad(W, M, h, cad, mats) {
  const grp = new T.Group(); grp.position.set(h.hx, BB.HV.pz, 0);
  const key = h.alliance === 'R' ? 'hR' : 'hB';
  for (const b of cad.buckets) if (b.g === key) grp.add(cadMesh(b, mats));
  // AprilTag cluster stickers under both CELLS: u runs across the printed image, v away from its coloured strip
  const S = BB.TAG_STICKER;
  for (const sg of [1, -1]) {
    const pts = [], uvs = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const w = sg * S.hw * (1 - 2 * u), a = sg * (S.a0 + (S.a1 - S.a0) * v);
      pts.push(w, S.b - 0.004, -a); uvs.push(u, v);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    const tex = tagStickerTexture(BB.TAG_BASE[h.alliance][sg], h.alliance, sg);
    const m = new T.Mesh(g, new T.MeshStandardMaterial({ map: tex, roughness: 0.62, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; grp.add(m);
  }
  W.add(grp);
  return grp;
}

function buildStands(G, M) {
  // tiered stands behind the far wall and the audience side, a live screen and light trusses
  const crowd = crowdTexture();
  const standMat = new T.MeshStandardMaterial({ map: crowd, roughness: 1, envMapIntensity: 0.1 });
  crowd.repeat.set(3, 1);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const step = new T.Mesh(new T.BoxGeometry(460, 18, 34), standMat);
      step.position.set(0, 9 + k * 18, side * (230 + k * 34)); step.receiveShadow = false; G.add(step);
    }
  }
  const screenTex = canvasTex(1024, 320, () => {});
  R.screenTex = screenTex;
  const screen = new T.Mesh(new T.PlaneGeometry(210, 66), new T.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 150, -300); G.add(screen);
  const bezel = new T.Mesh(new T.BoxGeometry(218, 74, 4), M.black); bezel.position.set(0, 150, -303); G.add(bezel);
  const lampMat = new T.MeshBasicMaterial({ color: new T.Color(1, 0.96, 0.88).multiplyScalar(2.2), toneMapped: true });
  for (const z of [-150, 0, 150]) {
    const truss = new T.Mesh(new T.BoxGeometry(420, 6, 6), M.dark); truss.position.set(0, 300, z); G.add(truss);
    for (let x = -180; x <= 180; x += 60) { const l = new T.Mesh(new T.BoxGeometry(14, 4, 14), lampMat); l.position.set(x, 295, z); G.add(l); }
  }
}
R.drawScreen = function (sim, prov, clk) {
  const t = R.screenTex; if (!t) return;
  // redraw (and re-upload the texture) only when something on it changes
  const key = prov.R.total + '|' + prov.B.total + '|' + clk.label + '|' + Math.max(0, Math.ceil(clk.secs));
  if (t._bbKey === key) return; t._bbKey = key;
  const c = t.image, g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#05080b'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#a8232a'; g.fillRect(0, 0, W * 0.4, H);
  g.fillStyle = '#1d56c4'; g.fillRect(W * 0.6, 0, W * 0.4, H);
  g.fillStyle = '#0c1116'; g.fillRect(W * 0.4, 0, W * 0.2, H);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 180px "Saira Condensed", "Arial Narrow", Impact, sans-serif';
  g.fillText(String(prov.R.total), W * 0.2, H * 0.52); g.fillText(String(prov.B.total), W * 0.8, H * 0.52);
  g.fillStyle = '#f2c230'; g.font = '700 44px "Saira Condensed", "Arial Narrow", sans-serif'; g.fillText(clk.label, W * 0.5, H * 0.3);
  g.fillStyle = '#fff'; g.font = '800 96px "Saira Condensed", "Arial Narrow", sans-serif';
  const s = Math.max(0, Math.ceil(clk.secs)); g.fillText(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), W * 0.5, H * 0.64);
  t.needsUpdate = true;
};

function buildPerimeter(W, M) {
  const H = BB.WALL_H + 0.1, half = BB.HALF;
  for (const side of [0, 1, 2, 3]) {
    const g = new T.Group();
    const panel = new T.Mesh(new T.PlaneGeometry(141, H - 1.4), M.panel); panel.position.set(0, (H - 1.4) / 2 + 0.7, 0.1); panel.renderOrder = 3; g.add(panel);
    const top = new T.Mesh(new T.BoxGeometry(142, 1.0, 1.0), M.alu); top.position.set(0, H - 0.5, 0.5); g.add(top);
    const bot = new T.Mesh(new T.BoxGeometry(142, 1.4, 1.0), M.alu); bot.position.set(0, 0.7, 0.5); g.add(bot);
    for (let k = 0; k <= 6; k++) { const p = new T.Mesh(new T.BoxGeometry(1.0, H, 1.0), M.alu); p.position.set(-70.5 + k * 23.5, H / 2, 0.5); g.add(p); }
    const ang = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
    g.rotation.y = ang;
    g.position.set([0, half, 0, -half][side], 0, [-half, 0, half, 0][side]);
    shadow(g, true, true);
    W.add(g);
  }
}
function buildFrame(W, M) {
  const g = new T.Group();
  for (const c of BB.FRAME_CAPS) {
    const a = P(c[0], c[1], c[2]), b = P(c[3], c[4], c[5]);
    if (c[6] > 0.9) g.add(boxBetween(a, b, 2.2, 2.2, M.dark));
    else g.add(boxBetween(a, b, 1.2, 1.2, M.frame));
  }
  for (const fb of BB.FOOT_BARS) { const m = new T.Mesh(new T.BoxGeometry(fb.x1 - fb.x0, fb.z1 - fb.z0, fb.y1 - fb.y0), M.frame); m.position.set((fb.x0 + fb.x1) / 2, (fb.z0 + fb.z1) / 2, -(fb.y0 + fb.y1) / 2); g.add(m); }
  // rubber dampers on the crossbar where the HIVE arms land
  for (const sx of [-12.75, 12.75]) for (const sz of [-1, 1]) { const d = new T.Mesh(new T.BoxGeometry(2.4, 1.6, 1.6), M.rubber); d.position.set(sx, 40.6, sz * 2.4); g.add(d); }
  const logo = new T.MeshStandardMaterial({ map: logoTexture(), roughness: 0.5, side: T.DoubleSide });
  for (const sy of [-1, 1]) {
    const a = P(0, sy * 1.666, 40.024), b = P(0, sy * 4.293, 34.125);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const m = new T.Mesh(new T.PlaneGeometry(30.16, a.distanceTo(b)), logo);
    m.position.copy(mid);
    const n = new T.Vector3(0, 0.407, -sy * 0.913).normalize();
    m.lookAt(mid.clone().add(n.multiplyScalar(10)));
    g.add(m);
  }
  shadow(g); W.add(g);
}
function buildHive(W, M, h) {
  const grp = new T.Group(); grp.position.copy(P(h.hx, 0, BB.HV.pz));
  const col = h.alliance === 'R' ? COL.red : COL.blue;
  const edgeMat = new T.MeshStandardMaterial({ color: col, roughness: 0.38, metalness: 0.25 });
  const L = (w, a, b) => new T.Vector3(w, b, -a);
  for (const sg of [1, -1]) {
    const a1 = sg * BB.HV.aIn, a2 = sg * BB.HV.aOut;
    const pts = BB.PENT;
    const pos = [];
    for (let i = 1; i < 5; i++) {        // side + roof panels (the base is a solid plate below)
      const p = pts[i], q = pts[(i + 1) % 5];
      const A = L(p[0], a1, p[1]), B = L(q[0], a1, q[1]), C = L(q[0], a2, q[1]), D = L(p[0], a2, p[1]);
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, A.x, A.y, A.z, C.x, C.y, C.z, D.x, D.y, D.z);
    }
    const c0 = L(0, a1, (pts[0][1] + pts[3][1]) / 2);
    for (let i = 0; i < 5; i++) { const p = pts[i], q = pts[(i + 1) % 5]; const A = L(p[0], a1, p[1]), B = L(q[0], a1, q[1]); pos.push(c0.x, c0.y, c0.z, A.x, A.y, A.z, B.x, B.y, B.z); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const faces = new T.Mesh(geo, M.cellFace); faces.renderOrder = 2; grp.add(faces);
    for (let i = 0; i < 5; i++) {
      const p = pts[i], q = pts[(i + 1) % 5];
      grp.add(boxBetween(L(p[0], a1, p[1]), L(p[0], a2, p[1]), 0.9, 0.9, edgeMat));
      grp.add(boxBetween(L(p[0], a2, p[1]), L(q[0], a2, q[1]), 1.1, 1.1, edgeMat));
      grp.add(boxBetween(L(p[0], a1, p[1]), L(q[0], a1, q[1]), 0.8, 0.8, edgeMat));
    }
    const base = new T.Mesh(new T.BoxGeometry(20.4, 0.1, Math.abs(a2 - a1)), new T.MeshStandardMaterial({ color: 0xd9dfe4, roughness: 0.45, metalness: 0.2 }));
    base.position.copy(L(0, (a1 + a2) / 2, BB.TAG_B + 0.06)); grp.add(base);
    const S = BB.TAG_STICKER, sp = [], uvs = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const w = sg * S.hw * (1 - 2 * u), a = sg * (S.a0 + (S.a1 - S.a0) * v); sp.push(w, S.b - 0.004, -a); uvs.push(u, v); }
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); tg.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    tg.setIndex([0, 1, 2, 0, 2, 3]); tg.computeVertexNormals();
    grp.add(new T.Mesh(tg, new T.MeshStandardMaterial({ map: tagStickerTexture(BB.TAG_BASE[h.alliance][sg], h.alliance, sg), roughness: 0.62, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
  }
  for (const s of BB.ARM_SEGS) grp.add(boxBetween(L(0, s[0], s[1]), L(0, s[2], s[3]), 1.0, 1.0, M.frame));
  const hub = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 4, 20), M.steel); hub.rotation.z = Math.PI / 2; grp.add(hub);
  shadow(grp, true, true);
  W.add(grp);
  mergeInto(grp);
  return grp;
}
function buildFlower(W, M, f) {
  const g = new T.Group(); g.position.copy(P(f.x, f.y, 0));
  g.rotation.y = Math.atan2(f.ny, f.nx);
  const R0 = 2.25;
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2;
    const x = Math.cos(a) * R0, z = -Math.sin(a) * R0;
    const front = Math.cos(a) > 0.8;
    const y0 = front ? 4.0 : 0;
    const rod = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 21.5 - y0, 10), M.flower);
    rod.position.set(x, y0 + (21.5 - y0) / 2, z); g.add(rod);
  }
  const top = new T.Mesh(new T.TorusGeometry(2.3, 0.3, 12, 32), M.ring); top.rotation.x = Math.PI / 2; top.position.y = 21.5; g.add(top);
  const cup = new T.Mesh(new T.CylinderGeometry(2.75, 2.35, 0.9, 32, 1, true), M.ring); cup.position.y = 21.9; g.add(cup);
  const mid = new T.Mesh(new T.TorusGeometry(2.3, 0.22, 10, 32), M.flower); mid.rotation.x = Math.PI / 2; mid.position.y = 4.5; g.add(mid);
  const low = new T.Mesh(new T.TorusGeometry(1.55, 0.16, 8, 28), M.flower); low.rotation.x = Math.PI / 2; low.position.y = 0.4; g.add(low);
  const back = new T.Mesh(new T.BoxGeometry(0.3, 1.25, 5.9), M.ring); back.position.set(-2.45, 22.1, 0); g.add(back);
  const brk = new T.Mesh(new T.BoxGeometry(2.4, 1.2, 5.9), M.steel); brk.position.set(-3.1, 20.8, 0); g.add(brk);
  const brk2 = new T.Mesh(new T.BoxGeometry(2.4, 1.2, 4.0), M.steel); brk2.position.set(-3.1, 4.4, 0); g.add(brk2);
  shadow(g); W.add(g);
  return g;
}
function buildAllianceStations(W, M, sim) {
  R.hpNectar = {}; R.hpGroups = [];
  for (const al of ['R', 'B']) {
    const sgn = al === 'R' ? -1 : 1;
    const z = BB.ZONES.loading[al], cy = (z.y0 + z.y1) / 2;
    const g = new T.Group();
    const rx = sgn * 80, rz = -cy;
    const top = new T.Mesh(new T.BoxGeometry(7, 1, 24), M.dark); top.position.set(rx, 24, rz); g.add(top);
    for (const dz of [-10, 10]) { const leg = new T.Mesh(new T.BoxGeometry(1, 24, 1), M.steel); leg.position.set(rx, 12, rz + dz); g.add(leg); }
    const lip = new T.Mesh(new T.BoxGeometry(7.4, 1.4, 0.6), al === 'R' ? M.red : M.blue); lip.position.set(rx, 25, rz + 12); g.add(lip);
    // driver station carts with a laptop and a gamepad
    for (const dy of [-20, 20]) {
      const cart = new T.Mesh(new T.BoxGeometry(12, 1.2, 18), M.dark); cart.position.set(sgn * 98, 32, dy); g.add(cart);
      const post = new T.Mesh(new T.BoxGeometry(1.2, 32, 1.2), M.steel); post.position.set(sgn * 98, 16, dy); g.add(post);
      const lap = new T.Mesh(new T.BoxGeometry(8, 0.5, 11), M.black); lap.position.set(sgn * 98, 32.9, dy); g.add(lap);
      const scr = new T.Mesh(new T.BoxGeometry(0.4, 7, 11), M.black); scr.position.set(sgn * 101.6, 36.3, dy); scr.rotation.z = sgn * 0.25; g.add(scr);
    }
    shadow(g); W.add(g);
    const balls = new T.Group(); W.add(balls); R.hpGroups.push(balls);
    const arr = [];
    for (let k = 0; k < 5; k++) {
      const b = new T.Mesh(new T.SphereGeometry(BB.BALL_R[1], 24, 16), new T.MeshStandardMaterial({ color: al === 'R' ? COL.redNectar : COL.blueNectar, roughness: 0.45 }));
      b.position.set(rx, 26.4, rz - 8 + k * 4); b.castShadow = true; balls.add(b); arr.push(b);
    }
    R.hpNectar[al] = arr;
  }
}

// ------------------------------------------------------------------ robots (built from the spec)
const WHEEL_R = { 72: 1.42, 96: 1.89, 104: 2.05 };
function robotMats(M, spec, alliance) {
  const col = alliance === 'R' ? COL.red : COL.blue;
  return {
    plate: new T.MeshStandardMaterial({ color: 0x2c3238, metalness: 0.6, roughness: 0.45 }),
    body: new T.MeshStandardMaterial({ color: BB.COLORS[spec.color] || 0x3a4149, metalness: 0.35, roughness: 0.5 }),
    alliance: new T.MeshStandardMaterial({ color: col, roughness: 0.45 }),
    led: new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3, roughness: 0.4 }),
    hood: new T.MeshStandardMaterial({ color: 0xdfe8f0, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.38, side: T.DoubleSide, depthWrite: false }),
    lens: new T.MeshStandardMaterial({ color: 0x1f6fff, emissive: 0x1c58d8, emissiveIntensity: 1.4, roughness: 0.2 }),
    tread: new T.MeshStandardMaterial({ color: 0x15181b, roughness: 0.9 }),
  };
}
function wheelMesh(M, r, w, kind) {
  const g = new T.Group();
  if (kind === 'mecanum') {
    const tire = new T.Mesh(new T.CylinderGeometry(r, r, w, 22), M.roller); g.add(tire);
    for (const s of [-1, 1]) { const hub = new T.Mesh(new T.CylinderGeometry(r * 0.84, r * 0.84, 0.18, 18), M.alu); hub.position.y = s * (w / 2 + 0.05); g.add(hub); }
  } else {
    const tire = new T.Mesh(new T.CylinderGeometry(r, r, w, 24), M.rubber); g.add(tire);
    const hub = new T.Mesh(new T.CylinderGeometry(r * 0.62, r * 0.62, w + 0.12, 16), kind === 'swerve' ? M.alu : M.steel); g.add(hub);
    for (let k = 0; k < 5; k++) { const sp = new T.Mesh(new T.BoxGeometry(0.28, w + 0.16, r * 1.1), M.dark); sp.rotation.y = k * Math.PI / 5; g.add(sp); }
  }
  const axle = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, w + 0.6, 8), M.steel); g.add(axle);
  return g;
}
// rb: { spec, P, alliance, team } (a live robot, or a stand-in for the preview)
function buildRobot(M, rb) {
  const s = rb.spec || rb.P.spec, P = rb.P || BB.deriveRobot(s);
  const RM = robotMats(M, s, rb.alliance);
  const g = new T.Group();
  const L = (lx, ly, lz) => new T.Vector3(lx, lz, -ly);
  const hx = s.body.L / 2, hy = s.body.W / 2, H = s.body.H;
  const wr = WHEEL_R[s.drive.wheel] || 2.05, wz = wr;
  const dyn = [];                         // animated parts stay out of the merge
  // ---- chassis: channel rails, cross members, base plate
  const base = new T.Mesh(new T.BoxGeometry(s.body.L - 1.6, 0.4, s.body.W - 4.2), RM.plate); base.position.copy(L(0, 0, wz - 0.4)); g.add(base);
  for (const sy of [-1, 1]) {
    const rail = new T.Mesh(new T.BoxGeometry(s.body.L, 1.9, 1.05), M.chan); rail.position.copy(L(0, sy * (hy - 0.55), wz + 0.4)); g.add(rail);
    const inner = new T.Mesh(new T.BoxGeometry(s.body.L - 1.2, 1.9, 1.05), M.chan); inner.position.copy(L(0, sy * (hy - 2.6), wz + 0.4)); g.add(inner);
  }
  for (const sx of [-1, 1]) { const x = new T.Mesh(new T.BoxGeometry(1.05, 1.9, s.body.W - 1.1), M.chan); x.position.copy(L(sx * (hx - 0.55), 0, wz + 0.4)); g.add(x); }
  // ---- drivetrain
  const wheels = [], mods = [];
  const D = P.drive;
  if (s.drive.type === 'swerve') {
    [[D.lx, D.ly], [D.lx, -D.ly], [-D.lx, D.ly], [-D.lx, -D.ly]].forEach(([mx, my]) => {
      const mod = new T.Group(); mod.position.copy(L(mx, my, 0));
      const house = new T.Mesh(new T.CylinderGeometry(2.0, 2.0, 1.2, 20), M.dark); house.position.y = wz * 2 + 0.9; mod.add(house);
      const gear = new T.Mesh(new T.TorusGeometry(1.9, 0.18, 6, 28), M.alu); gear.rotation.x = Math.PI / 2; gear.position.y = wz * 2 + 1.5; mod.add(gear);
      for (const sz of [-1, 1]) { const fork = new T.Mesh(new T.BoxGeometry(wr * 1.4, wz * 2 + 0.6, 0.3), M.alu); fork.position.set(0, wz + 0.3, sz * 0.75); mod.add(fork); }
      const wh = wheelMesh(M, wr, 1.0, 'swerve'); wh.rotation.x = Math.PI / 2; wh.position.y = wz; mod.add(wh);
      g.add(mod); dyn.push(mod); mods.push({ mod, wh, spin: 0 });
    });
  } else if (s.drive.type === 'tank') {
    const n = 3;
    for (const sy of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const x = -D.lx + 2 * D.lx * k / (n - 1);
        const wh = wheelMesh(M, wr, 1.3, 'tank'); wh.rotation.x = Math.PI / 2; wh.position.copy(L(x, sy * (hy - 1.6), wz)); g.add(wh); dyn.push(wh);
        wheels.push({ m: wh, side: sy, spin: 0 });
      }
      const skirt = new T.Mesh(new T.BoxGeometry(s.body.L - 0.6, 3.2, 0.25), RM.body); skirt.position.copy(L(0, sy * (hy - 0.12), wz + 1.2)); g.add(skirt);
    }
  } else {
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy]) => {
      const wh = wheelMesh(M, wr, 1.5, 'mecanum'); wh.rotation.x = Math.PI / 2; wh.position.copy(L(sx * D.lx, sy * (hy - 1.6), wz)); g.add(wh); dyn.push(wh);
      wheels.push({ m: wh, spin: 0, sx, sy });
    });
  }
  // ---- electronics
  const hubB = new T.Mesh(new T.BoxGeometry(4.2, 1.0, 3.6), M.black); hubB.position.copy(L(-hx + 4.2, hy - 4.2, wz + 1.6)); g.add(hubB);
  const hubS = new T.Mesh(new T.BoxGeometry(4.25, 0.25, 0.6), M.orange); hubS.position.copy(L(-hx + 4.2, hy - 5.9, wz + 2.15)); g.add(hubS);
  const bat = new T.Mesh(new T.BoxGeometry(4.6, 2.2, 1.9), new T.MeshStandardMaterial({ color: 0xe8c02a, roughness: 0.6 })); bat.position.copy(L(-hx + 4.4, -hy + 4.2, wz + 1.5)); g.add(bat);
  // ---- uprights, deck, body panels
  const topZ = H;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const p = new T.Mesh(new T.BoxGeometry(1, topZ - wz - 1.4, 1), M.chan); p.position.copy(L(sx * (hx - 1.6), sy * (hy - 1.2), wz + 1.4 + (topZ - wz - 1.4) / 2)); g.add(p);
  }
  for (const sy of [-1, 1]) {
    const rail = new T.Mesh(new T.BoxGeometry(s.body.L - 2.4, 0.9, 0.9), M.chan); rail.position.copy(L(0, sy * (hy - 1.2), topZ - 0.45)); g.add(rail);
    const panel = new T.Mesh(new T.BoxGeometry(s.body.L - 5.5, Math.max(1.2, topZ - wz - 4.2), 0.25), RM.body); panel.position.copy(L(-1.2, sy * (hy - 0.4), wz + 2.6 + Math.max(1.2, topZ - wz - 4.2) / 2)); g.add(panel);
  }
  const deck = new T.Mesh(new T.BoxGeometry(s.body.L * 0.42, 0.4, s.body.W - 3.2), RM.plate); deck.position.copy(L(-hx + s.body.L * 0.21 + 0.8, 0, topZ - 0.2)); g.add(deck);
  // hopper ramp (visual)
  const ramp = new T.Mesh(new T.BoxGeometry(s.body.L * 0.55, 0.3, 6.4), M.panel); ramp.position.copy(L(hx - s.body.L * 0.34, 0, wz + 3.2)); ramp.rotation.z = 0.12; g.add(ramp);
  // ---- team signs (both sides) and LED strips
  const sign = new T.MeshStandardMaterial({ map: signTexture(rb.team || '0000', rb.alliance), roughness: 0.5 });
  const sh_ = Math.min(4.1, Math.max(2.6, topZ - wz - 3));
  for (const sy of [-1, 1]) {
    const sg = new T.Mesh(new T.PlaneGeometry(Math.min(13, s.body.L - 4), sh_), sign);
    sg.position.copy(L(-0.8, sy * (hy + 0.06), wz + 2.8 + sh_ / 2)); sg.rotation.y = sy > 0 ? 0 : Math.PI; g.add(sg);
  }
  const leds = [];
  for (const sy of [-1, 1]) { const l = new T.Mesh(new T.BoxGeometry(s.body.L - 3, 0.4, 0.4), RM.led); l.position.copy(L(0, sy * (hy - 0.9), topZ + 0.25)); g.add(l); leds.push(l); dyn.push(l); }
  // ---- intakes (front, and back for 'both')
  const rollers = [];
  const buildIntake = (side) => {
    const it = new T.Group(); const w = s.intake.width, reach = s.intake.reach;
    it.position.copy(L(side * (hx + reach - 0.7), 0, 2.3));
    if (side < 0) it.rotation.y = Math.PI;
    const roller = new T.Group(); it.add(roller);
    const core = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, w, 10), M.steel); core.rotation.x = Math.PI / 2; roller.add(core);
    const n = Math.max(3, Math.round(w / 3));
    for (let k = 0; k < n; k++) { const cw = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 0.9, 12), M.orange); cw.rotation.x = Math.PI / 2; cw.position.z = -w / 2 + 0.8 + k * (w - 1.6) / (n - 1); roller.add(cw); }
    for (const sy of [-1, 1]) { const pl = new T.Mesh(new T.BoxGeometry(3.6 + reach, 4.2, 0.3), M.chan); pl.position.set(-0.8 - reach / 2, 1.0, -sy * (w / 2 + 0.35)); it.add(pl); }
    const upper = new T.Group(); upper.position.set(-2.4, 3.6, 0); it.add(upper);
    const core2 = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, w - 1, 8), M.steel); core2.rotation.x = Math.PI / 2; upper.add(core2);
    g.add(it); dyn.push(it); rollers.push(roller, upper);
    return it;
  };
  buildIntake(1); if (s.intake.sides === 'both') buildIntake(-1);
  // extraction flap below the front intake
  let flap = null;
  if (s.flower.flap) {
    flap = new T.Group(); flap.position.copy(L(hx + s.intake.reach + 0.2, 0, 0.8));
    const fp = new T.Mesh(new T.BoxGeometry(2.6, 0.25, Math.min(6, s.intake.width - 2)), RM.alliance); fp.position.set(1.2, 0, 0); flap.add(fp);
    g.add(flap); dyn.push(flap);
  }
  // ---- hopper balls (up to 4, G407)
  const hop = [];
  for (let k = 0; k < 4; k++) { const b = new T.Mesh(R.ballGeo[0], R.ballMat[0]); b.visible = false; b.castShadow = true; g.add(b); hop.push(b); dyn.push(b); }
  const slot = k => L(hx - 5 - k * 2.7, (k % 2 ? 1 : -1) * 1.5, wz + 4.4 + k * 0.9);
  // ---- shooters
  const shooters = [];
  s.shooters.forEach((ss, i) => {
    const fwR = ss.wheel === 72 ? 1.42 : 1.89;
    const pivot = new T.Group(); pivot.position.copy(L(ss.x, ss.y, Math.min(topZ, ss.z - 3)));
    const base0 = Math.min(topZ, ss.z - 3);
    const riser = Math.max(0, base0 - topZ + 0.01);
    pivot.rotation.y = ss.faces * BB.D2R;
    const top = new T.Group(); pivot.add(top);                  // yaw part (turret) or fixed body
    if (ss.type === 'turret') {
      const ring = new T.Mesh(new T.CylinderGeometry(4.4, 4.4, 0.8, 32), M.dark); ring.position.y = 0.4; pivot.add(ring);
      const gear = new T.Mesh(new T.TorusGeometry(4.25, 0.22, 6, 44), M.alu); gear.rotation.x = Math.PI / 2; gear.position.y = 0.8; pivot.add(gear);
      if (riser > 0.1) { const col = new T.Mesh(new T.CylinderGeometry(1.2, 1.4, riser, 12), M.steel); col.position.y = -riser / 2; pivot.add(col); }
    }
    const bodyH = ss.z - base0 + 1.8;
    for (const sz of [-1, 1]) {
      const side = new T.Mesh(new T.BoxGeometry(7.2, bodyH, 0.3), ss.type === 'turret' ? RM.plate : M.chan);
      side.position.set(-0.6, 0.8 + bodyH / 2, sz * (fwR + 1.35)); top.add(side);
    }
    const back = new T.Mesh(new T.BoxGeometry(0.3, bodyH, 2 * fwR + 2.6), RM.plate); back.position.set(-4.2, 0.8 + bodyH / 2, 0); top.add(back);
    const mzY = ss.z - base0;                                   // muzzle height inside the pivot
    const flyG = new T.Group(); flyG.position.set(0.4, mzY - fwR * 0.6, 0); top.add(flyG);
    const fly = new T.Mesh(new T.CylinderGeometry(fwR, fwR, 2.6, 24), M.rubber); fly.rotation.x = Math.PI / 2; flyG.add(fly);
    const flyHub = new T.Mesh(new T.CylinderGeometry(fwR * 0.55, fwR * 0.55, 2.7, 6), M.alu); flyHub.rotation.x = Math.PI / 2; flyG.add(flyHub);
    let fly2 = null;
    if (ss.dual) { fly2 = new T.Group(); fly2.position.set(0.4, mzY + fwR * 1.5, 0); const m2 = new T.Mesh(new T.CylinderGeometry(fwR * 0.8, fwR * 0.8, 2.6, 20), M.rubber); m2.rotation.x = Math.PI / 2; fly2.add(m2); top.add(fly2); }
    // hood: a curved polycarb shell that sets the exit angle
    const hood = new T.Group(); hood.position.set(0.4, mzY - fwR * 0.6, 0); top.add(hood);
    const shell = new T.Mesh(new T.CylinderGeometry(fwR + 1.5, fwR + 1.5, 2.9, 20, 1, true, Math.PI * 0.5, Math.PI * 0.62), RM.hood);
    shell.rotation.x = Math.PI / 2; hood.add(shell);
    const lip = new T.Mesh(new T.BoxGeometry(2.4, 0.25, 2.9), RM.body); lip.position.set(1.2, fwR + 1.5, 0); hood.add(lip);
    // feeder wheel behind the flywheel
    const feed = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 2.4, 12), M.orange); feed.rotation.x = Math.PI / 2; feed.position.set(-2.4, mzY - fwR - 0.6, 0); top.add(feed);
    // turret camera
    if (i === 0 && s.camera.mount === 'turret0' && ss.type === 'turret') {
      const cb = new T.Mesh(new T.BoxGeometry(1.8, 1.4, 3.0), M.black); cb.position.set(3.2, mzY + 1.4 - 0.2, 0); cb.rotation.z = s.camera.pitch * BB.D2R; top.add(cb);
      const ln = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 0.4, 14), RM.lens); ln.rotation.z = Math.PI / 2 + s.camera.pitch * BB.D2R; ln.position.set(4.1, mzY + 1.45, 0); top.add(ln);
    }
    g.add(pivot); dyn.push(pivot);
    shooters.push({ pivot, top, hood, fly: flyG, fly2, feed, spin: 0, type: ss.type, faces: ss.faces * BB.D2R });
  });
  // ---- chassis camera
  if (s.camera.mount !== 'turret0') {
    const back = s.camera.mount === 'back', sx = back ? -1 : 1;
    const cam = new T.Group(); cam.position.copy(L(sx * (hx - 0.6), 0, s.camera.h)); cam.rotation.y = back ? Math.PI : 0; g.add(cam);
    const cb = new T.Mesh(new T.BoxGeometry(1.6, 1.4, 2.8), M.black); cb.rotation.z = s.camera.pitch * BB.D2R; cam.add(cb);
    const ln = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.4, 14), RM.lens); ln.rotation.z = Math.PI / 2 + s.camera.pitch * BB.D2R; ln.position.set(0.9, 0.3, 0); cam.add(ln);
    const mast = new T.Mesh(new T.BoxGeometry(0.8, Math.max(0.5, s.camera.h - topZ), 0.8), M.chan); mast.position.set(-0.6, -Math.max(0.5, s.camera.h - topZ) / 2 - 0.5, 0); if (s.camera.h > topZ + 1) cam.add(mast);
  }
  // ---- FLOWER arm
  let arm = null;
  if (s.flower.arm !== 'none') {
    const len = P.armReach + 4;
    arm = new T.Group(); arm.position.copy(L(hx - 3.5, -hy + 2.2, topZ + 0.4));
    const beam = new T.Mesh(new T.BoxGeometry(len, 1.1, 1.1), s.flower.arm === 'long' ? RM.body : M.chan); beam.position.x = len / 2; arm.add(beam);
    const claw = new T.Mesh(new T.BoxGeometry(2.4, 2.4, 2.8), M.dark); claw.position.set(len, -1, 0); arm.add(claw);
    const cup = new T.Mesh(new T.CylinderGeometry(2.1, 1.6, 1.6, 16, 1, true), M.panel); cup.position.set(len, -2.6, 0); arm.add(cup);
    arm.rotation.z = 2.95;
    g.add(arm); dyn.push(arm);
    const mount = new T.Mesh(new T.BoxGeometry(1.4, 2.2, 1.4), M.chan); mount.position.copy(L(hx - 3.5, -hy + 2.2, topZ - 0.6)); g.add(mount);
  }
  // soft contact shadow
  const blob = new T.Mesh(new T.PlaneGeometry(s.body.L * 1.45, s.body.W * 1.45), new T.MeshBasicMaterial({ map: R.blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.06; g.add(blob); dyn.push(blob);
  shadow(g, true, false); blob.castShadow = false;
  mergeInto(g, new Set(dyn));
  return { g, wheels, mods, rollers, shooters, hop, slot, arm, flap, leds, ledMat: RM.led, spec: s, wr, kind: s.drive.type };
}

// ------------------------------------------------------------------ robot preview (robot creator)
R.initPreview = function (canvas) {
  const pv = R.pv = R.pv || {};
  if (!pv.renderer) {
    pv.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    pv.renderer.outputEncoding = T.sRGBEncoding; pv.renderer.toneMapping = T.ACESFilmicToneMapping;
    pv.renderer.shadowMap.enabled = true; pv.renderer.shadowMap.type = T.PCFSoftShadowMap;
    pv.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const sc = pv.scene = new T.Scene(); sc.background = new T.Color(0x0e1419);
    sc.environment = R.scene ? R.scene.environment : null;
    sc.add(new T.HemisphereLight(0xd8e6ff, 0x0b0e12, 0.4));
    const sun = new T.DirectionalLight(0xfff3e2, 1.3); sun.position.set(-40, 90, 50); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera; c.left = -24; c.right = 24; c.top = 24; c.bottom = -24; c.near = 20; c.far = 200; sun.shadow.bias = -0.0005;
    sc.add(sun);
    const fill = new T.DirectionalLight(0xb9ccff, 0.45); fill.position.set(50, 40, -60); sc.add(fill);
    const tiles = new T.Mesh(new T.PlaneGeometry(72, 72), new T.MeshStandardMaterial({ map: R.tileTex ? R.tileTex.map : null, color: R.tileTex ? 0xffffff : 0x5a6068, roughness: 0.95 }));
    if (R.tileTex) { const m = R.tileTex.map.clone(); m.needsUpdate = true; m.repeat.set(0.5, 0.5); tiles.material.map = m; }
    tiles.rotation.x = -Math.PI / 2; tiles.receiveShadow = true; sc.add(tiles);
    // the 18 in starting-size box (R102): the robot must fit inside
    const box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(18, 18, 18)), new T.LineBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.55 }));
    box.position.y = 9; sc.add(box); pv.box = box;
    pv.cam = new T.PerspectiveCamera(38, 1, 1, 400);
    pv.orbit = { th: 0.75, ph: 0.42, r: 58 };
    const drag = { on: false };
    canvas.addEventListener('pointerdown', e => { drag.on = true; drag.x = e.clientX; drag.y = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (!drag.on) return; pv.orbit.th -= (e.clientX - drag.x) * 0.008; pv.orbit.ph = Math.max(0.05, Math.min(1.4, pv.orbit.ph + (e.clientY - drag.y) * 0.006)); drag.x = e.clientX; drag.y = e.clientY; pv.idle = 0; });
    canvas.addEventListener('pointerup', () => { drag.on = false; });
    canvas.addEventListener('wheel', e => { pv.orbit.r = Math.max(30, Math.min(110, pv.orbit.r * (1 + e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });
    pv.idle = 99;
  }
  pv.canvas = canvas;
  return pv;
};
R.previewSpec = function (spec, alliance, team) {
  const pv = R.pv; if (!pv) return;
  if (pv.robot) { pv.scene.remove(pv.robot.g); pv.robot.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  if (!R.mats) return;
  const s = BB.normalizeSpec(spec);
  const P = BB.deriveRobot(s);
  const o = buildRobot(R.mats, { spec: s, P, alliance: alliance || 'R', team: team || '2026' });
  pv.scene.add(o.g); pv.robot = o;
  o.g.traverse(c => { if (c.isMesh && c !== o.g) c.castShadow = true; });
  const fits = s.body.L <= 18 && s.body.W <= 18 && s.body.H <= 18;
  pv.box.material.color.setHex(fits ? 0xf2c230 : 0xe5484d);
};
R.renderPreview = function (dt) {
  const pv = R.pv; if (!pv || !pv.renderer || !pv.canvas) return;
  const c = pv.canvas, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (pv.w !== w || pv.h !== h) { pv.renderer.setSize(w, h, false); pv.cam.aspect = w / h; pv.cam.updateProjectionMatrix(); pv.w = w; pv.h = h; }
  pv.idle += dt; if (pv.idle > 3) pv.orbit.th += dt * 0.25;
  const o = pv.orbit;
  pv.cam.position.set(Math.sin(o.th) * Math.cos(o.ph) * o.r, 6 + Math.sin(o.ph) * o.r, Math.cos(o.th) * Math.cos(o.ph) * o.r);
  pv.cam.lookAt(0, 7, 0);
  if (pv.robot) { pv.robot.shooters.forEach(sh => { sh.fly.rotation.z -= dt * 30; }); pv.robot.rollers.forEach(r => { r.rotation.z -= dt * 8; }); }
  pv.renderer.render(pv.scene, pv.cam);
};

// ------------------------------------------------------------------ per-frame sync
function syncBallMeshes(sim) {
  while (R.balls.length < sim.balls.length) {
    const b = sim.balls[R.balls.length];
    const mat = R.ballMat[b.bt];
    const m = new T.Mesh(R.ballGeo[b.bt === 0 ? 0 : 1], mat);
    m.customDepthMaterial = mat.userData.depth;
    m.castShadow = true; m.receiveShadow = true;
    m.quaternion.setFromEuler(new T.Euler(Math.random() * 6, Math.random() * 6, 0));
    R.ballGroup.add(m); R.balls.push(m);
  }
}
const _q = new T.Quaternion(), _ax = new T.Vector3(), _v1 = new T.Vector3();
const LED_TRACK = new T.Color(0xf2c230), LED_LOCK = new T.Color(0x45e07a), LED_BASE = { R: new T.Color(COL.red), B: new T.Color(COL.blue) };
R.update = function (sim, dt, alpha) {
  syncBallMeshes(sim);
  // alpha: how far the screen time is between the previous physics step (0) and the latest one (1)
  const lerp = alpha !== undefined && PREV.ok && PREV.sim === sim, u = lerp ? Math.max(0, Math.min(1, alpha)) : 1;
  for (let i = 0; i < sim.balls.length; i++) {
    const b = sim.balls[i], m = R.balls[i];
    if (b.state !== 'field') { m.visible = false; continue; }
    m.visible = true;
    if (lerp && i < PREV.n && PREV.bs[i]) {
      const p = PREV.b, j = 3 * i;
      m.position.set(p[j] + (b.x - p[j]) * u, p[j + 2] + (b.z - p[j + 2]) * u, -(p[j + 1] + (b.y - p[j + 1]) * u));
    } else m.position.set(b.x, b.z, -b.y);
    const wm = Math.hypot(b.wx, b.wy, b.wz);
    if (wm > 0.05 && dt > 0) { _ax.set(b.wx / wm, b.wz / wm, -b.wy / wm); _q.setFromAxisAngle(_ax, wm * dt); m.quaternion.premultiply(_q); }
  }
  // a replay or an online view can hold fewer balls than meshes built so far
  for (let i = sim.balls.length; i < R.balls.length; i++) R.balls[i].visible = false;
  sim.hives.forEach((h, i) => { R.hives[i].rotation.x = lerp && PREV.h[i] !== undefined ? PREV.h[i] + (h.phi - PREV.h[i]) * u : h.phi; });
  sim.robots.forEach((rb, i) => {
    const o = R.robots[i]; if (!o) return;
    const pp = lerp ? PREV.r[i] : null, ps = R.pose[rb.id] || (R.pose[rb.id] = { x: 0, y: 0, psi: 0, rb: null });
    if (pp) { ps.x = pp.x + (rb.x - pp.x) * u; ps.y = pp.y + (rb.y - pp.y) * u; ps.psi = pp.psi + BB.wrap(rb.psi - pp.psi) * u; }
    else { ps.x = rb.x; ps.y = rb.y; ps.psi = rb.psi; }
    ps.rb = rb;
    o.g.position.set(ps.x, 0, -ps.y); o.g.rotation.y = ps.psi;
    // wheels: surface speed from the drivetrain model
    const wv = rb.wheelV || [0, 0, 0, 0];
    if (o.kind === 'swerve') {
      o.mods.forEach((m, k) => { const md = rb.swerve[k]; m.mod.rotation.y = md.ang; m.spin += md.v * dt / o.wr; m.wh.rotation.y = -m.spin; });
    } else if (o.kind === 'tank') {
      o.wheels.forEach(w => { w.spin += (w.side > 0 ? wv[0] : wv[1]) * dt / o.wr; w.m.rotation.y = -w.spin * (w.side > 0 ? 1 : 1); });
    } else {
      // mecanum order in the engine: 0 FL, 1 FR, 2 BL, 3 BR (u0 = f - st - tw ...)
      o.wheels.forEach((w, k) => { const idx = w.sx > 0 ? (w.sy > 0 ? 0 : 1) : (w.sy > 0 ? 2 : 3); w.spin += (wv[idx] || 0) * dt / o.wr; w.m.rotation.y = -w.spin; });
    }
    if (rb.intakeOn && rb.enabled && rb.hopper.length < 4 && !rb.outtake) o.rollers.forEach(r => { r.rotation.z -= dt * 22; });
    else if (rb.outtake && rb.enabled) o.rollers.forEach(r => { r.rotation.z += dt * 22; });
    // shooters: turret yaw, hood angle, flywheel spin
    rb.shooters.forEach((sh, k) => {
      const v = o.shooters[k]; if (!v) return;
      v.pivot.rotation.y = sh.faces + (sh.tur.has ? sh.tur.ang : 0);
      v.hood.rotation.z = sh.hood.cur - 1.1;
      v.spin += sh.fw.w * dt; v.fly.rotation.z = -v.spin;
      if (v.fly2) v.fly2.rotation.z = v.spin * 0.8;
      if (sh.feed.ball) v.feed.rotation.z -= dt * 40;
    });
    // hopper: balls ride from where the intake caught them into their slot
    for (let k = 0; k < 4; k++) {
      const q = rb.hopper[k], m = o.hop[k];
      m.visible = !!q;
      if (!q) continue;
      const bt = q.ball.bt; m.geometry = R.ballGeo[bt === 0 ? 0 : 1]; m.material = R.ballMat[bt];
      const dst = o.slot(k);
      if (q.cap && q.t > 0) { const f = 1 - q.t / 0.14; _v1.set(q.cap[0], q.cap[2], -q.cap[1]); m.position.lerpVectors(_v1, dst, Math.max(0, Math.min(1, f))); }
      else m.position.copy(dst);
    }
    if (o.arm) { const target = rb.dunkT > 0 ? -0.35 : 2.95; o.arm.rotation.z += (target - o.arm.rotation.z) * Math.min(1, dt * 7); }
    if (o.flap) { const target = rb.flapT > 0 ? -0.9 : 0.25; o.flap.rotation.z += (target - o.flap.rotation.z) * Math.min(1, dt * 12); }
    // LEDs: alliance colour, yellow while tracking, green when a shooter is locked
    const any = rb.shooters.some(sh => sh.aim.locked), trk = rb.shooters.some(sh => sh.aim.valid);
    const c = any ? LED_LOCK : trk ? LED_TRACK : LED_BASE[rb.alliance];
    o.ledMat.color.copy(c); o.ledMat.emissive.copy(c);
  });
  for (const al of ['R', 'B']) R.hpNectar[al].forEach((m, k) => { m.visible = k < sim.hp[al].left; });
};
R.showTrajectory = function (sim, rb, on) {
  const tr = R.trajs || [];
  if (!rb || !on) { tr.forEach(t => { t.line.visible = false; }); R.aimMark.visible = false; return; }
  let mark = false;
  tr.forEach((t, k) => {
    const sh = rb.shooters[k];
    if (!sh || !sh.aim.valid || sh.aim.empty) { t.line.visible = false; return; }
    const n = BB.predictArc(rb, sh, t.buf, 90);
    const pos = t.line.geometry.attributes.position;
    for (let i = 0; i < 90; i++) { const j = Math.min(i, n - 1) * 3; pos.setXYZ(i, t.buf[j], t.buf[j + 2], -t.buf[j + 1]); }
    pos.needsUpdate = true; t.line.geometry.computeBoundingSphere(); t.line.computeLineDistances();
    t.line.material.color.setHex(sh.aim.locked ? 0x5fe08a : 0xf2c230);
    t.line.visible = true; mark = true;
  });
  if (mark) {
    const h = BB.hiveOf(sim, rb.alliance), p = BB.aimPointWorld(h, h.side);
    R.aimMark.visible = true; R.aimMark.position.set(p[0], p[2], -p[1]); R.aimMark.lookAt(R.cam.position);
    R.aimMark.material.color.setHex(rb.shooters.some(s => s.aim.locked) ? 0x5fe08a : 0xf2c230);
  } else R.aimMark.visible = false;
};

// ------------------------------------------------------------------ aim map overlay (floor heat map)
R.setAimMap = function (map) {
  if (R.aimOverlay) { R.world.remove(R.aimOverlay); R.aimOverlay.geometry.dispose(); R.aimOverlay.material.map.dispose(); R.aimOverlay.material.dispose(); R.aimOverlay = null; }
  if (!map) return;
  const n = map.n, data = new Uint8Array(n * n * 4);
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const v = map.data[iy * n + ix], o = (iy * n + ix) * 4;
    if (v < 0) { data[o + 3] = 0; continue; }
    // red (no) -> amber -> green (every probe scores)
    const r = v < 0.5 ? 229 : Math.round(229 - (v - 0.5) * 2 * 160), gC = v < 0.5 ? Math.round(72 + v * 2 * 122) : Math.round(194 + (v - 0.5) * 2 * 30);
    data[o] = r; data[o + 1] = gC; data[o + 2] = v > 0.9 ? 111 : 60; data[o + 3] = v <= 0 ? 70 : Math.round(110 + v * 90);
  }
  const tex = new T.DataTexture(data, n, n, T.RGBAFormat);
  tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
  const span = (n - 1) * map.step + map.step;
  const m = new T.Mesh(new T.PlaneGeometry(span, span), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }));
  m.rotation.x = -Math.PI / 2;
  const c = map.x0 + (n - 1) * map.step / 2;
  m.position.set(c, 0.08, -c);
  // DataTexture row 0 sits at v = 0, which the rotated plane puts at the audience side (y = x0)
  tex.flipY = false;
  m.renderOrder = 1;
  R.world.add(m); R.aimOverlay = m;
};

// ------------------------------------------------------------------ render interpolation
// Physics runs at 300 Hz and the screen at 60-240 Hz, so a frame holds 4, 5 or 6 steps in turn. Drawing the raw last
// step makes that jitter visible as judder; instead the scene is drawn between the last two steps (at most 3.3 ms old).
const PREV = { sim: null, ok: false, n: 0, b: new Float32Array(0), bs: new Uint8Array(0), r: [], h: [] };
R.snap = function (sim) {
  if (PREV.sim !== sim) { PREV.sim = sim; PREV.ok = false; }
  const n = sim.balls.length;
  if (PREV.bs.length < n) { PREV.b = new Float32Array(n * 3 + 48); PREV.bs = new Uint8Array(n + 16); }
  for (let i = 0; i < n; i++) { const b = sim.balls[i]; PREV.b[3 * i] = b.x; PREV.b[3 * i + 1] = b.y; PREV.b[3 * i + 2] = b.z; PREV.bs[i] = b.state === 'field' ? 1 : 0; }
  PREV.n = n;
  for (let i = 0; i < sim.robots.length; i++) { const rb = sim.robots[i], q = PREV.r[i] || (PREV.r[i] = { x: 0, y: 0, psi: 0 }); q.x = rb.x; q.y = rb.y; q.psi = rb.psi; }
  for (let i = 0; i < sim.hives.length; i++) PREV.h[i] = sim.hives[i].phi;
  PREV.ok = true;
};
R.unsnap = function () { PREV.ok = false; PREV.sim = null; };
// the robot pose the screen shows this frame (interpolated when a snapshot exists)
R.pose = [];
R.poseOf = function (rb) { const p = R.pose[rb.id]; return p && p.rb === rb ? p : rb; };

// ------------------------------------------------------------------ cameras
// Every view can be adjusted by the viewer (drag to orbit, shift/right-drag to slide, wheel to zoom); the offsets are
// kept per view mode in R.view.adj and applied on top of the mode's own framing.
R.view = { mode: 'broadcast', t: 0, orbit: { th: -0.55, ph: 0.62, r: 215 }, pos: new T.Vector3(0, 120, 180), look: new T.Vector3(0, 8, 0), adj: {}, fov: 50 };
const ADJ0 = { yaw: 0, pitch: 0, zoom: 1, px: 0, pz: 0 };
R.camAdj = function (mode) { const a = R.view.adj[mode]; return a || ADJ0; };
R.camAdjEdit = function (mode) { return R.view.adj[mode] || (R.view.adj[mode] = Object.assign({}, ADJ0)); };
R.camAdjusted = function (mode) { const a = R.view.adj[mode]; return !!a && (Math.abs(a.yaw) > 0.01 || Math.abs(a.pitch) > 0.01 || Math.abs(a.zoom - 1) > 0.02 || Math.abs(a.px) > 0.5 || Math.abs(a.pz) > 0.5); };
R.camReset = function (mode) { if (mode) delete R.view.adj[mode]; else R.view.adj = {}; };
R.cameraTarget = function (sim, mode, rb, alliance) {
  const pos = new T.Vector3(), look = new T.Vector3();
  const q = rb ? R.poseOf(rb) : null;
  if (mode === 'driver') {
    // standing behind your alliance wall, eye height ~5 ft
    const s = alliance === 'B' ? 1 : -1;
    pos.set(s * 126, 66, 0); look.set(-s * 4, 10, 0);
  } else if (mode === 'follow' && rb) {
    const c = Math.cos(q.psi), sn = Math.sin(q.psi);
    pos.copy(P(q.x - c * 46, q.y - sn * 46, 38)); look.copy(P(q.x + c * 24, q.y + sn * 24, 12));
  } else if (mode === 'pov' && rb) {
    // the camera pose at the interpolated chassis pose
    const x0 = rb.x, y0 = rb.y, p0 = rb.psi; rb.x = q.x; rb.y = q.y; rb.psi = q.psi;
    let cp; try { cp = BB.cameraPose(rb); } finally { rb.x = x0; rb.y = y0; rb.psi = p0; }
    pos.set(cp.x, cp.z + 2, -cp.y); look.set(cp.x + cp.f[0] * 30, cp.z + 2 + cp.f[2] * 30, -(cp.y + cp.f[1] * 30));
  } else if (mode === 'top') {
    // straight down, your alliance at the bottom of the screen (a hair off vertical so it can tilt smoothly)
    const s = alliance === 'B' ? 1 : -1, el = 1.54;
    pos.set(s * Math.cos(el) * 250, Math.sin(el) * 250, 0); look.set(0, 0, 0);
  } else if (mode === 'free') {
    const o = R.view.orbit;
    pos.set(Math.sin(o.th) * Math.cos(o.ph) * o.r, Math.sin(o.ph) * o.r, Math.cos(o.th) * Math.cos(o.ph) * o.r); look.set(0, 10, 0);
  } else if (mode === 'attract') {
    const t = R.view.t * 0.045;
    pos.set(Math.sin(t) * 185, 92 + Math.sin(t * 0.7) * 14, Math.cos(t) * 185); look.set(0, 16, 0);
  } else {
    pos.set(-70, 112, 172); look.set(0, 8, -6);
  }
  return { pos, look };
};
const _cv = new T.Vector3(), _cr = new T.Vector3();
// the viewer's offsets: orbit (yaw about the look point, pitch = elevation), zoom (distance), slide (px, pz)
function applyAdj(mode, tgt) {
  const a = R.view.adj[mode]; if (!a || mode === 'attract') return;
  if (mode === 'pov') {
    // look around from the robot camera: turn the view direction, keep the lens where it is
    _cv.copy(tgt.look).sub(tgt.pos);
    const r = _cv.length() || 1, el = Math.asin(Math.max(-1, Math.min(1, _cv.y / r))) + a.pitch, az = Math.atan2(_cv.x, _cv.z) + a.yaw;
    const e2 = Math.max(-1.2, Math.min(1.2, el));
    tgt.look.set(tgt.pos.x + Math.sin(az) * Math.cos(e2) * r, tgt.pos.y + Math.sin(e2) * r, tgt.pos.z + Math.cos(az) * Math.cos(e2) * r);
    return;
  }
  tgt.pos.x += a.px; tgt.pos.z += a.pz; tgt.look.x += a.px; tgt.look.z += a.pz;
  _cv.copy(tgt.pos).sub(tgt.look);
  const r = _cv.length() || 1;
  let el = Math.asin(Math.max(-1, Math.min(1, _cv.y / r))), az = Math.atan2(_cv.x, _cv.z);
  el = Math.max(0.03, Math.min(1.54, el + a.pitch)); az += a.yaw;
  const rr = r * a.zoom;
  tgt.pos.set(tgt.look.x + Math.sin(az) * Math.cos(el) * rr, tgt.look.y + Math.sin(el) * rr, tgt.look.z + Math.cos(az) * Math.cos(el) * rr);
  // never under the floor
  if (tgt.pos.y < 3) tgt.pos.y = 3;
}
R.updateCamera = function (sim, mode, rb, alliance, dt, snap) {
  R.view.t += dt;
  const tgt = R.cameraTarget(sim, mode, rb, alliance);
  applyAdj(mode, tgt);
  // frame-rate independent easing toward the target framing
  const rate = mode === 'follow' ? 14 : mode === 'pov' ? 30 : mode === 'attract' ? 2.5 : 8;
  const k = snap || R.view.drag ? 1 : 1 - Math.exp(-dt * rate);
  R.view.pos.lerp(tgt.pos, k); R.view.look.lerp(tgt.look, k);
  R.cam.position.copy(R.view.pos);
  R.cam.up.set(0, 1, 0);
  const a = R.view.adj[mode], base = mode === 'pov' ? 63 : (R.view.fov || 50);
  const fov = mode === 'pov' ? Math.max(30, Math.min(100, base * (a ? a.zoom : 1))) : base;
  if (R.cam.fov !== fov) { R.cam.fov = fov; R.cam.updateProjectionMatrix(); }
  R.cam.lookAt(R.view.look);
  if (R.robots && rb && R.robots[rb.id]) R.robots[rb.id].g.visible = mode !== 'pov';
};
// drag / slide / zoom from the pointer (pixels); returns true when something changed
R.camInput = function (mode, kind, dx, dy) {
  if (mode === 'attract') return false;
  const a = R.camAdjEdit(mode);
  if (kind === 'orbit') {
    a.yaw -= dx * 0.0055; a.pitch += dy * 0.0045;
    // keep the numbers bounded; the elevation clamp in applyAdj does the rest
    a.yaw = Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw));
    a.pitch = Math.max(mode === 'pov' ? -1.2 : -1.6, Math.min(mode === 'pov' ? 1.2 : 1.6, a.pitch));
  } else if (kind === 'pan' && mode !== 'pov') {
    // slide along the ground in screen directions (for a view from straight above, "up" on screen is the camera's up)
    R.cam.getWorldDirection(_cv); _cv.y = 0;
    if (_cv.lengthSq() < 1e-4) { const e = R.cam.matrixWorld.elements; _cv.set(e[4], 0, e[6]); }
    _cv.normalize(); _cr.set(-_cv.z, 0, _cv.x);
    const k = R.view.pos.distanceTo(R.view.look) * 0.0016;
    a.px += (-_cr.x * dx + _cv.x * dy) * k; a.pz += (-_cr.z * dx + _cv.z * dy) * k;
    const lim = 110; a.px = Math.max(-lim, Math.min(lim, a.px)); a.pz = Math.max(-lim, Math.min(lim, a.pz));
  } else if (kind === 'zoom') {
    a.zoom = Math.max(mode === 'pov' ? 0.5 : 0.3, Math.min(mode === 'pov' ? 1.5 : 2.6, a.zoom * Math.exp(dy * 0.0011)));
  } else return false;
  return true;
};
// field-centric driving follows what the screen shows: the robot's own heading for the chase and robot cameras,
// the camera's forward direction for the fixed views
R.driveFrame = function (mode, rb) {
  let fx, fy;
  if (rb && (mode === 'follow' || mode === 'pov')) {
    const q = R.poseOf(rb), off = mode === 'follow' ? R.camAdj(mode).yaw : 0;
    fx = Math.cos(q.psi + off); fy = Math.sin(q.psi + off);
    if (mode === 'pov') { const d = new T.Vector3(); R.cam.getWorldDirection(d); if (Math.hypot(d.x, d.z) > 0.2) { fx = d.x; fy = -d.z; } }
  } else {
    const d = new T.Vector3(); R.cam.getWorldDirection(d);
    fx = d.x; fy = -d.z;
    if (Math.hypot(fx, fy) < 0.2) { const e = R.cam.matrixWorld.elements; fx = e[4]; fy = -e[6]; }
  }
  const L = Math.hypot(fx, fy) || 1; fx /= L; fy /= L;
  return { fx, fy, rx: fy, ry: -fx };
};

// ------------------------------------------------------------------ render
R.resize = function (w, h) {
  R.size = { w, h };
  R.renderer.setPixelRatio(R.pixelRatio());
  R.renderer.setSize(w, h, false);
  R.cam.aspect = w / h; R.cam.updateProjectionMatrix();
};
R.render = function (pips) {
  const r = R.renderer, s = R.size;
  r.setScissorTest(false);
  r.setViewport(0, 0, s.w, s.h);
  let done = false;
  if (R.quality === 'ultra' && POST.ok !== false) {
    try { if (!POST.ok) postSetup(); postRender(); done = true; }
    catch (e) { POST.ok = false; r.setRenderTarget(null); if (window.console) console.warn('ultra post-processing off:', e && e.message); }
  }
  if (!done) r.render(R.scene, R.cam);
  const fxv = R.fxGroup ? R.fxGroup.visible : false; if (R.fxGroup) R.fxGroup.visible = false;
  for (const pip of pips || []) {
    const rb = pip.rb, cp = BB.cameraPose(rb);
    const cam = R.pipCam;
    cam.fov = cp.fovV / BB.D2R; cam.aspect = pip.rect.w / pip.rect.h; cam.updateProjectionMatrix();
    cam.position.set(cp.x, cp.z, -cp.y);
    cam.up.set(cp.u[0], cp.u[2], -cp.u[1]);
    cam.lookAt(cp.x + cp.f[0], cp.z + cp.f[2], -(cp.y + cp.f[1]));
    const { x, y, w, h } = pip.rect;
    r.setScissorTest(true); r.setScissor(x, y, w, h); r.setViewport(x, y, w, h);
    const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    const hide = R.robots[rb.id].g; const vis = hide.visible; hide.visible = false;
    const tv = (R.trajs || []).map(t => t.line.visible), av = R.aimMark.visible, ov = R.aimOverlay ? R.aimOverlay.visible : false;
    (R.trajs || []).forEach(t => { t.line.visible = false; }); R.aimMark.visible = false; if (R.aimOverlay) R.aimOverlay.visible = false;
    r.render(R.scene, cam);
    hide.visible = vis; (R.trajs || []).forEach((t, k) => { t.line.visible = tv[k]; }); R.aimMark.visible = av; if (R.aimOverlay) R.aimOverlay.visible = ov;
    r.shadowMap.autoUpdate = sh;
    r.setScissorTest(false);
    const keep = R.pipKeep || (R.pipKeep = []);
    pip.cam = keep[pip.k || 0] || (keep[pip.k || 0] = new T.PerspectiveCamera());
    pip.cam.copy(cam); pip.cam.updateMatrixWorld(true);
  }
  if (R.fxGroup) R.fxGroup.visible = fxv;
};

// ------------------------------------------------------------------ post-processing (ultra): MSAA scene target, bloom, vignette, dithering
// The scene target stores sRGB like the screen does, so every material keeps the program it uses on screen.
const POST = { ok: null, w: 0, h: 0 };
R.post = POST;
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const SRGB_GLSL = 'vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }\n' +
  'vec3 toSrgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }\n';
function postMat(frag, uniforms, defines) {
  return new T.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, toneMapped: false });
}
function postSetup() {
  const r = R.renderer;
  if (!r.capabilities.isWebGL2 || !T.WebGLMultisampleRenderTarget) { POST.ok = false; throw new Error('WebGL2 required'); }
  const opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat };
  const half = r.extensions.has('EXT_color_buffer_float') ? T.HalfFloatType : T.UnsignedByteType;
  POST.rt = new T.WebGLMultisampleRenderTarget(4, 4, Object.assign({ type: T.UnsignedByteType }, opt));
  POST.rt.samples = 4; POST.rt.texture.encoding = T.sRGBEncoding;
  // a 24-bit depth buffer: three r128 gives render targets 16 bits by default, and the tape lines and
  // tiles sit a few hundredths of an inch apart, which then z-fight at broadcast distance
  POST.rt.depthTexture = new T.DepthTexture(4, 4); POST.rt.depthTexture.type = T.UnsignedIntType;
  const mk = () => new T.WebGLRenderTarget(4, 4, Object.assign({ type: half, depthBuffer: false, stencilBuffer: false }, opt));
  POST.bright = mk(); POST.hs = [0, 1, 2, 3, 4].map(mk); POST.vs = [0, 1, 2, 3, 4].map(mk);
  POST.quad = new T.Mesh(new T.PlaneGeometry(2, 2)); POST.quad.frustumCulled = false;
  POST.scene = new T.Scene(); POST.scene.add(POST.quad);
  POST.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  POST.brightMat = postMat(SRGB_GLSL + `uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold, knee; varying vec2 vUv;
    void main(){ vec3 c = toLin(texture2D(tDiffuse, vUv + texel * vec2(-0.5, -0.5)).rgb) + toLin(texture2D(tDiffuse, vUv + texel * vec2(0.5, -0.5)).rgb)
        + toLin(texture2D(tDiffuse, vUv + texel * vec2(-0.5, 0.5)).rgb) + toLin(texture2D(tDiffuse, vUv + texel * vec2(0.5, 0.5)).rgb);
      c *= 0.25; float l = max(c.r, max(c.g, c.b));
      float sft = clamp(l - threshold + knee, 0.0, 2.0 * knee); sft = sft * sft / (4.0 * knee + 1e-4);
      gl_FragColor = vec4(c * (max(sft, l - threshold) / max(l, 1e-4)), 1.0); }`,
  { tDiffuse: { value: null }, texel: { value: new T.Vector2() }, threshold: { value: 0.74 }, knee: { value: 0.2 } });
  POST.blur = [3, 5, 7, 9, 11].map(kr => postMat(`uniform sampler2D tDiffuse; uniform vec2 texel, dir; varying vec2 vUv;
    float gs(float x, float s){ return exp(-0.5 * x * x / (s * s)); }
    void main(){ float s = float(KR); vec3 sum = texture2D(tDiffuse, vUv).rgb; float ws = 1.0;
      for (int i = 1; i < KR; i++){ float x = float(i); float w = gs(x, s); vec2 o = dir * texel * x;
        sum += (texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o).rgb) * w; ws += 2.0 * w; }
      gl_FragColor = vec4(sum / ws, 1.0); }`, { tDiffuse: { value: null }, texel: { value: new T.Vector2() }, dir: { value: new T.Vector2() } }, { KR: kr }));
  POST.final = postMat(SRGB_GLSL + `uniform sampler2D tScene, b0, b1, b2, b3, b4; uniform float strength, vig, seed; uniform vec2 res; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main(){ vec3 c = toLin(texture2D(tScene, vUv).rgb);
      vec3 b = texture2D(b0, vUv).rgb + texture2D(b1, vUv).rgb * 0.85 + texture2D(b2, vUv).rgb * 0.7 + texture2D(b3, vUv).rgb * 0.5 + texture2D(b4, vUv).rgb * 0.35;
      c += b * strength;
      c = c / (1.0 + max(c - 0.92, 0.0));
      vec2 q = vUv - 0.5; q.x *= res.x / res.y; c *= mix(0.74, 1.0, smoothstep(0.95, 0.3, length(q) * vig));
      vec3 o = toSrgb(c) + (rnd(vUv * res) - 0.5) / 255.0;
      gl_FragColor = vec4(o, 1.0); }`,
  { tScene: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, b3: { value: null }, b4: { value: null }, strength: { value: 0.42 }, vig: { value: 1.0 }, seed: { value: 0 }, res: { value: new T.Vector2() } });
  POST.w = 0; POST.h = 0; POST.ok = true;
}
const _dbs = new T.Vector2();
function postResize(w, h) {
  POST.w = w; POST.h = h;
  POST.rt.setSize(w, h);
  let bw = Math.max(1, Math.round(w / 2)), bh = Math.max(1, Math.round(h / 2));
  POST.bright.setSize(bw, bh);
  for (let k = 0; k < 5; k++) { POST.hs[k].setSize(bw, bh); POST.vs[k].setSize(bw, bh); bw = Math.max(1, Math.round(bw / 2)); bh = Math.max(1, Math.round(bh / 2)); }
}
function postRender() {
  const r = R.renderer; r.getDrawingBufferSize(_dbs);
  if (_dbs.x !== POST.w || _dbs.y !== POST.h) postResize(_dbs.x, _dbs.y);
  r.setRenderTarget(POST.rt); r.render(R.scene, R.cam);
  const q = POST.quad, pass = (mat, target) => { q.material = mat; r.setRenderTarget(target); r.render(POST.scene, POST.cam); };
  const bm = POST.brightMat.uniforms; bm.tDiffuse.value = POST.rt.texture; bm.texel.value.set(1 / POST.w, 1 / POST.h);
  pass(POST.brightMat, POST.bright);
  let src = POST.bright;
  for (let k = 0; k < 5; k++) {
    const m = POST.blur[k], u = m.uniforms, h = POST.hs[k], v = POST.vs[k];
    u.tDiffuse.value = src.texture; u.texel.value.set(1 / h.width, 1 / h.height); u.dir.value.set(1, 0); pass(m, h);
    u.tDiffuse.value = h.texture; u.dir.value.set(0, 1); pass(m, v);
    src = v;
  }
  const f = POST.final.uniforms;
  f.tScene.value = POST.rt.texture; f.b0.value = POST.vs[0].texture; f.b1.value = POST.vs[1].texture; f.b2.value = POST.vs[2].texture; f.b3.value = POST.vs[3].texture; f.b4.value = POST.vs[4].texture;
  f.seed.value = (f.seed.value + 0.618) % 17; f.res.value.set(POST.w, POST.h);
  pass(POST.final, null);
}
const _v3 = new T.Vector3();
R.projectTags = function (cam, rb, dets) {
  const out = [];
  for (const d of dets) {
    const tg = d.tag, s = BB.TAG_SIZE / 2, pts = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _v3.set(tg.x + tg.rt[0] * a * s + tg.up[0] * b * s, tg.z + tg.rt[2] * a * s + tg.up[2] * b * s, -(tg.y + tg.rt[1] * a * s + tg.up[1] * b * s));
      _v3.project(cam); pts.push([(_v3.x + 1) / 2, (1 - _v3.y) / 2]);
    }
    out.push({ id: d.id, pts, mine: d.tag.alliance === rb.alliance, dist: d.dist, tag: d.tag });
  }
  return out;
};
// screen position of a world point (for HUD labels over robots)
R.toScreen = function (x, y, z) {
  _v3.set(x, z, -y).project(R.cam);
  return { x: (_v3.x + 1) / 2 * R.size.w, y: (1 - _v3.y) / 2 * R.size.h, vis: _v3.z < 1 && _v3.z > -1 };
};

root.BBR = R;
})(typeof globalThis !== 'undefined' ? globalThis : this);
