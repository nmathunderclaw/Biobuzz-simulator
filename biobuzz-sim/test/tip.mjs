import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
function trial(withNectar, label) {
  const sim = BB.createSim({ seed: 11, robots: [] });
  sim.phase = 'free';
  if (!withNectar) for (const b of sim.balls) if (b.bt !== 0) b.state = 'out';
  const h = sim.hives[0];
  console.log(label, 'K', h.K.toFixed(0), 'progress start', BB.tipProgress(sim, h).toFixed(3));
  const rng = BB.mulberry32(5);
  let n = 0, tipAt = -1, t0 = 0;
  for (n = 1; n <= 12 && tipAt < 0; n++) {
    const p = BB.bodyToWorld(h, (rng() - 0.5) * 12, h.side * (BB.HV.aOut - 2.2), BB.HV.b0 + 6 + rng() * 2);
    BB.addBall(sim, 0, p[0], p[1], p[2]);
    for (let s = 0; s < 1.5 / BB.DT; s++) {
      const before = h.side; BB.physicsStep(sim); sim.t += BB.DT;
      if (h.side !== before) { tipAt = n; t0 = sim.t; break; }
    }
    if (tipAt < 0) console.log('  n', n, 'progress', BB.tipProgress(sim, h).toFixed(3), 'phi', (h.phi / BB.D2R).toFixed(2));
  }
  // measure when the HIVE left the stop: find dump positions
  for (let s = 0; s < 2.5 / BB.DT; s++) { BB.physicsStep(sim); sim.t += BB.DT; }
  const floor = sim.balls.filter(b => b.state === 'field' && b.z < 3 && Math.abs(b.x - h.hx) < 30 && Math.abs(b.y) < 45);
  console.log('  TIP after', tipAt, 'pollen; tips', sim.tips.R, 'side now', h.side, 'balls dumped to floor near hive:', floor.length,
    floor.map(b => `(${b.x.toFixed(0)},${b.y.toFixed(0)})`).join(' '));
  console.log('  still in cells:', BB.cellCounts(sim), 'phi', (h.phi / BB.D2R).toFixed(2), 'w', h.w.toFixed(3));
}
trial(false, 'EMPTY CELL');
trial(true, 'WITH 3 NECTAR');
