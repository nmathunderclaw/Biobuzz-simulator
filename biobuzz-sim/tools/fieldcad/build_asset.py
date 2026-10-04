# Official BIOBUZZ field CAD (STEP, via extract.py -> proto.pkl) -> compact web asset for the simulator.
# Output: ../biobuzz/src/fieldcad.b64 (raw-deflate + base64) and a JSON summary.
# Frames: CAD is Y-up inches with X toward BLUE and +Z toward the audience, which equals the renderer's
# three.js frame (three.x = sim.x, three.y = sim.z, three.z = -sim.y). HIVE parts are stored in their own
# level frame (pivot at origin, local x across the HIVE, y up, z along the arm) so the page can rotate them.
import pickle, re, zlib, base64, json, struct, time, sys
import numpy as np
import fast_simplification
import pymeshlab

t0 = time.time()
D = pickle.load(open('/home/claude/fieldcad/proto.pkl', 'rb'))
MESH, INSTS = D['mesh'], D['insts']
PIV_Y = 43.95

def world(it):
    P, I, C = MESH[it[1]]; M = it[2]
    return P @ M[:3, :3].T + M[:3, 3] / 25.4, I, C

def Rx(t):
    c, s = np.cos(t), np.sin(t); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

# ---------------------------------------------------------------- classification
RULES = [
    ('skip', r'am-2499|April Tag|Panel Sticker'),
    ('glass', r'Side Glass'),
    ('rail', r'am-2556a'),
    ('alu', r'Panel Link|Corner Hinge|A-Frame Leg|A-Frame Top Bar|Foot Bar|Churro|Basket Base Tube|Pivot Bracket'),
    ('black', r'Top Corner|Frame Foot|Axle Holder|Layer X|Layer B|Field Bracket'),
    ('orange', r'Layer C'),
    ('pipe', r'HIPS Pipe'),
    ('purple', r'Backstop'),
    ('gray', r'Peanut'),
    ('rib', r'Goal Rib'),
    ('skin', r'Skin'),
    ('acm', r'ACM Panel'),
    ('tapeR', r'Tape, Red'), ('tapeB', r'Tape, Blue'),
    ('tray', r'Artifact Tray'),
]
TARGET = [(r'Goal Rib', 6000), (r'Backstop', 900), (r'Top Corner', 2600), (r'Layer C', 2200), (r'Layer B', 2200),
          (r'Layer X', 1100), (r'Field Bracket', 650), (r'Axle Holder', 1200), (r'Frame Foot', 900), (r'Back Skin', 900),
          (r'Pivot Bracket', 500), (r'Side Glass', 260), (r'Corner Hinge', 700), (r'Peanut', 260), (r'Artifact Tray', 400),
          (r'Panel Link', 500), (r'am-2556a', 700), (r'Churro', 600), (r'Bottom Skin', 900), (r'Top Skin', 700)]
def material(name):
    for m, rx in RULES:
        if re.search(rx, name): return m
    return None
def target(name, n):
    for rx, t in TARGET:
        if re.search(rx, name): return min(n, t)
    return min(n, 1200)

# ---------------------------------------------------------------- per-prototype weld + simplify (cached)
def weld(P, I, tol=2e-4):
    key = np.round(P / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    I2 = inv[I]
    ok = (I2[:, 0] != I2[:, 1]) & (I2[:, 1] != I2[:, 2]) & (I2[:, 0] != I2[:, 2])
    return P[first], I2[ok]
SIMPLE = {}
def simple(key, name):
    if key in SIMPLE: return SIMPLE[key]
    P, I, C = MESH[key]
    P, I = weld(P, I)
    n = len(I); t = target(name, n)
    if t < n * 0.95:
        try:
            ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(P, I))
            ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(t), qualitythr=0.3, preserveboundary=True, preservenormal=True,
                                                        preservetopology=False, optimalplacement=True, planarquadric=True, autoclean=True)
            m = ms.current_mesh(); P, I = m.vertex_matrix().astype(np.float64), m.face_matrix().astype(np.int64)
        except Exception as e:
            print('meshlab failed', name, e)
            P2, I2 = fast_simplification.simplify(P.astype(np.float32), I.astype(np.int32), target_reduction=1 - t / n, agg=7)
            P, I = P2.astype(np.float64), I2.astype(np.int64)
    SIMPLE[key] = (P, I)
    return SIMPLE[key]

# ---------------------------------------------------------------- HIVE frames from the AprilTag stickers
HIVE = {}
for al, tag in (('R', 'Red Hive'), ('B', 'Blue Hive')):
    parts = [it for it in INSTS if any(tag in p for p in it[0]) and it[1] in MESH]
    allP = np.concatenate([world(it)[0] for it in parts])
    hx = float((allP[:, 0].min() + allP[:, 0].max()) / 2)
    ths = []
    for it in parts:
        if 'April Tag' not in it[0][-1]: continue
        Q, I, _ = world(it)
        A, B, C = Q[I[:, 0]], Q[I[:, 1]], Q[I[:, 2]]
        n = np.cross(B - A, C - A); a = np.linalg.norm(n, axis=1); big = a > a.max() * 0.2
        nn = n[big] / a[big][:, None]
        cell = [jt for jt in parts if jt[0][:-1] == it[0][:-1] and 'Skin' in jt[0][-1]]
        cc = np.concatenate([world(jt)[0] for jt in cell]).mean(0)
        cand = nn[np.argmax(nn @ (Q.mean(0) - cc))]
        ths.append(float(np.arctan2(-cand[2], -cand[1])))
    HIVE[al] = {'hx': hx, 'theta': float(np.mean(ths))}
print('hives', {k: (round(v['hx'], 4), round(np.degrees(v['theta']), 3)) for k, v in HIVE.items()})

# ---------------------------------------------------------------- bucket the instances
BUCKETS = {}
stats = {}
for it in INSTS:
    if it[1] not in MESH: continue
    name = it[0][-1].split(' <')[0]
    mat = material(name)
    if mat is None: print('unclassified', name); continue
    if mat == 'skip': continue
    path = ' / '.join(it[0])
    grp = 'hR' if 'Red Hive' in path else 'hB' if 'Blue Hive' in path else 'st'
    if mat == 'rib': mat = 'ribR' if grp == 'hR' else 'ribB'
    P, I = simple(it[1], name)
    M = it[2]
    Q = P @ M[:3, :3].T + M[:3, 3] / 25.4
    if grp != 'st':
        h = HIVE['R' if grp == 'hR' else 'B']
        Q = (Q - np.array([h['hx'], PIV_Y, 0.0])) @ Rx(-h['theta']).T
    b = BUCKETS.setdefault((grp, mat), {'P': [], 'I': [], 'n': 0})
    b['P'].append(Q); b['I'].append(I + b['n']); b['n'] += len(Q)
    stats[name] = stats.get(name, 0) + len(I)

# ---------------------------------------------------------------- crease-angle normals
def crease_normals(P, I, deg=33.0):
    V = P[I]
    fn = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0])
    ar = np.linalg.norm(fn, axis=1); keep = ar > 1e-12
    I = I[keep]; fn = fn[keep]; ar = ar[keep]
    fu = fn / ar[:, None]
    nC = len(I) * 3
    vid = I.reshape(-1)
    cf = np.repeat(np.arange(len(I)), 3)
    order = np.argsort(vid, kind='stable')
    vs = vid[order]
    starts = np.flatnonzero(np.r_[True, vs[1:] != vs[:-1]])
    counts = np.diff(np.r_[starts, len(vs)])
    cosT = np.cos(np.radians(deg))
    out = np.zeros((nC, 3))
    for lo_s, hi_s in ((1, 1), (2, 8), (9, 32), (33, 128), (129, 10 ** 9)):
        sel = np.flatnonzero((counts >= lo_s) & (counts <= hi_s))
        if not len(sel): continue
        g = int(counts[sel].max())
        idx = starts[sel][:, None] + np.arange(g)[None, :]
        valid = np.arange(g)[None, :] < counts[sel][:, None]
        idx = np.where(valid, idx, 0)
        corners = order[idx]                      # corner ids
        faces = cf[corners]
        N = fu[faces] * valid[..., None]
        W = (fn[faces]) * valid[..., None]        # area weighted
        for c0 in range(0, len(sel), max(1, 400000 // (g * g))):
            c1 = c0 + max(1, 400000 // (g * g))
            dots = np.einsum('ijk,ilk->ijl', N[c0:c1], N[c0:c1])
            mask = (dots > cosT) & valid[c0:c1, :, None] & valid[c0:c1, None, :]
            acc = np.einsum('ijl,ilk->ijk', mask.astype(np.float64), W[c0:c1])
            cc = corners[c0:c1][valid[c0:c1]]
            out[cc] = acc[valid[c0:c1]]
    l = np.linalg.norm(out, axis=1); bad = l < 1e-12
    out[~bad] /= l[~bad][:, None]
    out[bad] = fu[cf[bad]]
    # weld corners with the same vertex and (almost) the same normal
    qn = np.round(out * 127).astype(np.int64)
    key = np.c_[vid, qn]
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return P[vid[first]], out[first], inv.reshape(-1, 3)

def oct_encode(n):
    n = n / np.abs(n).sum(1, keepdims=True)
    x, y = n[:, 0].copy(), n[:, 1].copy()
    neg = n[:, 2] < 0
    ox = (1 - np.abs(y[neg])) * np.sign(x[neg] + 1e-30); oy = (1 - np.abs(x[neg])) * np.sign(y[neg] + 1e-30)
    x[neg], y[neg] = ox, oy
    return np.clip(np.round(np.c_[x, y] * 127), -127, 127).astype(np.int8)

# ---------------------------------------------------------------- tile seams (top-face outlines of the 36 soft tiles)
def seams():
    polys = []
    for it in INSTS:
        if 'am-2499' not in it[0][-1] or it[1] not in MESH: continue
        P, I, C = MESH[it[1]]; M = it[2]
        Pw, Iw = weld(P, I, 1e-4)
        Q = Pw @ M[:3, :3].T + M[:3, 3] / 25.4
        V = Q[Iw]; fn = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0]); l = np.linalg.norm(fn, axis=1)
        top = (fn[:, 1] > 0.99 * l) & (np.abs(V[:, :, 1]).max(1) < 0.02)
        T = Iw[top]
        E = np.sort(np.r_[T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]], axis=1)
        e, c = np.unique(E, axis=0, return_counts=True)
        bnd = e[c == 1]
        adj = {}
        for a, b in bnd: adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
        seen = set()
        for s in list(adj):
            if s in seen: continue
            loop = [s]; seen.add(s); prev, cur = None, s
            while True:
                nxt = [q for q in adj[cur] if q != prev and q not in seen]
                if not nxt: break
                prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
            pts = Q[loop][:, [0, 2]]
            polys.append(np.round(np.r_[pts, pts[:1]] * 100).astype(np.int16))
    return polys
SEAMS = seams()
print('seam loops', len(SEAMS), 'points', sum(len(p) for p in SEAMS))

# ---------------------------------------------------------------- logo panel quads (the sticker face that looks out)
def logo_quads():
    out = []
    for it in INSTS:
        if 'Panel Sticker' not in it[0][-1]: continue
        Q, I, _ = world(it)
        c = Q.mean(0)
        u, s, vt = np.linalg.svd(Q - c)
        ax0, ax1, nrm = vt[0], vt[1], vt[2]
        if nrm[2] * c[2] < 0: nrm = -nrm            # outward: away from the frame centre plane z = 0
        d = (Q - c) @ nrm
        face = Q[d > d.max() - 0.005]
        a = (face - c) @ ax0; b = (face - c) @ ax1
        if ax1[1] < 0: ax1 = -ax1; b = -b             # ax1 points up the panel
        if np.cross(ax0, ax1) @ nrm < 0: ax0 = -ax0; a = -a
        cf = c + nrm * d.max()
        corners = [cf + ax0 * a.min() + ax1 * b.min(), cf + ax0 * a.max() + ax1 * b.min(), cf + ax0 * a.max() + ax1 * b.max(), cf + ax0 * a.min() + ax1 * b.max()]
        out.append([[round(float(v), 4) for v in p] for p in corners])
    return out
LOGOS = logo_quads()
print('logo quads', LOGOS)

# ---------------------------------------------------------------- encode
order = sorted(BUCKETS, key=lambda k: (k[0], k[1]))
chunks, desc = [], []
off = 0
def put(arr):
    global off
    b = arr.tobytes(); pad = (-len(b)) % 4
    chunks.append(b + b'\0' * pad); o = off; off += len(b) + pad; return o
ntri = 0
for k in order:
    b = BUCKETS[k]
    P = np.concatenate(b['P']); I = np.concatenate(b['I'])
    Pv, Nv, Iv = crease_normals(P, I)
    lo, hi = Pv.min(0), Pv.max(0); span = np.maximum(hi - lo, 1e-6)
    q = np.round((Pv - lo) / span * 65535).astype(np.uint16)
    idx32 = len(Pv) > 65535
    Ia = Iv.astype(np.uint32 if idx32 else np.uint16).reshape(-1)
    d = {'g': k[0], 'm': k[1], 'nv': int(len(Pv)), 'ni': int(len(Ia)), 'lo': [float(v) for v in lo], 'hi': [float(v) for v in hi], 'i32': bool(idx32)}
    d['p'] = put(q.reshape(-1)); d['n'] = put(oct_encode(Nv).reshape(-1)); d['i'] = put(Ia)
    desc.append(d); ntri += len(Iv)
    print(f'{k[0]:3s} {k[1]:7s} verts {len(Pv):7d} tris {len(Iv):7d}')
seam_counts = np.array([len(p) for p in SEAMS], np.uint32)
so = put(seam_counts); sp = put(np.concatenate(SEAMS).reshape(-1))
meta = {'v': 1, 'src': 'FIRST Tech Challenge BIOBUZZ Field CAD (STEP) v26-27.2, 2026-09-15', 'buckets': desc,
        'seams': {'n': int(len(SEAMS)), 'counts': so, 'pts': sp, 'scale': 0.01},
        'hive': {k: {'hx': v['hx'], 'theta': v['theta'], 'pivotY': PIV_Y} for k, v in HIVE.items()}, 'logos': LOGOS}
js = json.dumps(meta, separators=(',', ':')).encode()
jpad = (-len(js)) % 4
blob = b'BBF1' + struct.pack('<I', len(js) + jpad) + js + b' ' * jpad + b''.join(chunks)
comp = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
z = comp.compress(blob) + comp.flush()
b64 = base64.b64encode(z).decode()
open('/home/claude/biobuzz/src/fieldcad.b64', 'w').write(b64)
print(f'triangles {ntri}  raw {len(blob) / 1e6:.2f} MB  deflate {len(z) / 1e6:.2f} MB  base64 {len(b64) / 1e6:.2f} MB  in {time.time() - t0:.1f}s')
top = sorted(stats.items(), key=lambda kv: -kv[1])[:12]
print('source tris by part (after simplify, instanced):', top)
