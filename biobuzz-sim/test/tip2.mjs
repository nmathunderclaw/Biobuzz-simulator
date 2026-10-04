import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const sim = BB.createSim({ seed: 11, robots: [] });
sim.phase = 'free';
const h = sim.hives[0];
const rng = BB.mulberry32(5);
const added = [];
for (let n = 1; n <= 5; n++) {
  const p = BB.bodyToWorld(h, (rng() - 0.5) * 12, h.side * (BB.HV.aOut - 2.2), BB.HV.b0 + 6 + rng() * 2);
  added.push(BB.addBall(sim, 0, p[0], p[1], p[2]));
  for (let s = 0; s < 1.0 / BB.DT; s++) { BB.physicsStep(sim); sim.t += BB.DT; }
}
const track = sim.balls.filter(b => b.bt === 1 || added.includes(b));
const bw = [0, 0, 0];
for (let s = 0; s <= 4 / BB.DT; s++) {
  if (s % 48 === 0) {
    console.log('t', (s * BB.DT).toFixed(2), 'phi', (h.phi / BB.D2R).toFixed(1), 'w', h.w.toFixed(2), 'side', h.side);
    console.log('   ' + track.map(b => { BB.worldToBody(h, b.x, b.y, b.z, bw); return `${b.bt}@(${b.x.toFixed(0)},${b.y.toFixed(0)},${b.z.toFixed(0)}) v${Math.hypot(b.vx, b.vy, b.vz).toFixed(0)}`; }).join(' '));
  }
  BB.physicsStep(sim); sim.t += BB.DT;
}
