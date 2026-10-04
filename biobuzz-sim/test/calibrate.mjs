// Calibrate HIVE holding torque: resting torque of n POLLEN in an empty upward CELL.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');

function run(settle = 1.6) {
  const sim = BB.createSim({ seed: 7, robots: [] });
  sim.phase = 'pre';
  for (const b of sim.balls) if (b.bt !== 0) b.state = 'out'; // empty the CELLs
  const h = sim.hives[0]; // red, up CELL on -y side (side -1)
  h.K = 1e7;
  const torques = [0];
  const rng = BB.mulberry32(3);
  for (let n = 1; n <= 14; n++) {
    const sg = h.side;
    const p = BB.bodyToWorld(h, (rng() - 0.5) * 12, sg * (BB.HV.aOut - 2.2), BB.HV.b0 + 6 + rng() * 2);
    const b = BB.addBall(sim, 0, p[0], p[1], p[2]);
    for (let s = 0; s < settle / BB.DT; s++) BB.physicsStep(sim);
    let t = 0, cnt = 0;
    for (const q of sim.balls) if (q.state === 'field' && BB.ballInCell(h, q, h.side)) { t += q.m * BB.G * Math.abs(q.y); cnt++; }
    torques.push(t);
    console.log(n, 'in cell', cnt, 'torque', t.toFixed(0), 'per-ball lever', (t / (cnt * 24.9 * BB.G)).toFixed(2));
  }
  return torques;
}
const T = run();
console.log(JSON.stringify(T.map(x => Math.round(x))));
