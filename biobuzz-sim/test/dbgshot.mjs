// print every shot of a stationary turret robot at a given pose, with the aim state and the outcome
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const key = process.argv[2] || 'turret';
const X = +(process.argv[3] ?? -55), Y = +(process.argv[4] ?? -50.3), PSI = +(process.argv[5] ?? 0) * BB.D2R;
const sim = BB.createSim({ seed: +(process.argv[6] ?? 7), robots: [{ alliance: 'R', slot: 0, spec: BB.presetSpec(key) }], mode: 'free' });
for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
const h = sim.hives[0]; h.K = 1e8;
const rb = sim.robots[0], sh = rb.shooters[0];
for (let q = 0; q < 8; q++) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = rb.id; }
rb.x = X; rb.y = Y; rb.psi = PSI; rb.px = rb.x; rb.py = rb.y; rb.ppsi = rb.psi; rb.est = { x: rb.x, y: rb.y, psi: rb.psi };
BB.startMatch(sim);
rb.fireHeld = true;
const shots = [];
for (let s = 0; s < 300 * 5; s++) {
  if (rb.hopper.length < 3) { const b = sim.balls.find(b => b.state === 'held' && b.holder === rb.id && !rb.hopper.some(q => q.ball === b) && !rb.shooters.some(sh => sh.feed.ball === b)); if (b) rb.hopper.push({ ball: b, t: 0 }); }
  BB.advance(sim);
  for (const e of sim.events) if (e.type === 'fire') {
    const b = sim.balls.filter(b => b.state === 'field' && b.launchedBy === rb.id).sort((p, q) => q.launchT - p.launchT)[0];
    const A = sh.aim;
    shots.push({ b, t: sim.t, D: A.D.toFixed(1), v: e.v.toFixed(0), vSol: A.v.toFixed(0), th: (sh.hood.cur / BB.D2R).toFixed(1), thSol: (A.th / BB.D2R).toFixed(1), yawErr: (A.yawErr / BB.D2R).toFixed(2), w: sh.fw.w.toFixed(0), wt: sh.fw.wt.toFixed(0), tur: (sh.tur.ang / BB.D2R).toFixed(1), minD: 1e9, maxZ: 0, apex: null });
  }
  sim.events.length = 0;
  const tp = BB.aimPointWorld(h, h.side);
  for (const q of shots) { const b = q.b; if (!b || b.state !== 'field') continue; const d = Math.hypot(b.x - tp[0], b.y - tp[1], b.z - tp[2]); if (d < q.minD) { q.minD = d; q.at = [b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1)]; } }
}
const tp = BB.aimPointWorld(h, h.side);
console.log('target', tp.map(v => v.toFixed(1)).join(','), 'robot', X, Y, 'hood kind', sh.hood.kind);
for (const q of shots) console.log(`t${q.t.toFixed(2)} D${q.D} v${q.v}/${q.vSol} th${q.th}/${q.thSol} yawErr${q.yawErr} w${q.w}/${q.wt} tur${q.tur} made:${q.b.madeFor === q.b.launchT} closest ${q.minD.toFixed(1)} at ${q.at}`);
