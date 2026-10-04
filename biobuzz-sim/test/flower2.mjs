// FLOWER geometry from the FIELD CAD: NECTAR seats on the middle ring, POLLEN drops to the lower ring
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const sim = BB.createSim({ seed: 4, robots: [] });
sim.phase = 'free'; sim.flowersOpen = true;
const f = sim.flowers[2];
for (const b of sim.balls) if (b.flower === f.i) { b.state = 'out'; b.flower = -1; }
const run = s => { for (let k = 0; k < s / BB.DT; k++) BB.physicsStep(sim); };
const drop = (bt, dx = 0, dy = 0) => BB.addBall(sim, bt, f.x + dx, f.y + dy, BB.FL.zTop + BB.BALL_R[bt] + 2);
const n1 = drop(1, 0.1, -0.05); run(2.0);
console.log('NECTAR alone:', n1.z.toFixed(2), 'rho', Math.hypot(n1.x - f.x, n1.y - f.y).toFixed(2), 'flower', n1.flower, 'v', Math.hypot(n1.vx, n1.vy, n1.vz).toFixed(3));
const p1 = drop(0, -0.2, 0.3); run(2.0);
console.log('POLLEN on top of it:', p1.z.toFixed(2), 'flower', p1.flower, '| NECTAR', n1.z.toFixed(2));
n1.state = 'out'; n1.flower = -1; run(2.0);
console.log('NECTAR removed -> POLLEN falls to', p1.z.toFixed(2), 'flower', p1.flower);
const p2 = drop(0); run(2.0);
console.log('second POLLEN', p2.z.toFixed(2), 'first', p1.z.toFixed(2));
const n2 = drop(2); run(2.0);
console.log('NECTAR over two POLLEN', n2.z.toFixed(2), 'bottom ball for retrieval:', BB.flowerBottom(sim, f) && BB.flowerBottom(sim, f).bt);
console.log('state', JSON.stringify(BB.flowerState(sim, f)));
// shots at a FLOWER from the field side: how many end up inside, none may be left intersecting the pipes
const g = BB.createSim({ seed: 9, robots: [] }); g.phase = 'free'; g.flowersOpen = true;
const F = g.flowers[2]; let inside = 0, stuck = 0, N = 40; const rng = BB.mulberry32(7);
for (let i = 0; i < N; i++) {
  const b = BB.addBall(g, i % 3 === 0 ? 1 : 0, F.x + (rng() - 0.5) * 30, F.y + 40 + rng() * 10, 20);
  const tx = F.x + (rng() - 0.5) * 1.2, ty = F.y + (rng() - 0.5) * 1.2, tz = 23 + rng() * 2;
  const T = 0.55; b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (tz - b.z) / T + 0.5 * BB.G * T;
  for (let k = 0; k < 2.5 / BB.DT; k++) BB.physicsStep(g);
  if (b.flower === F.i) inside++;
  for (const q of g.balls) if (q.state === 'field') for (let p = 0; p < 4; p++) {
    const px = F.x + (p & 1 ? 1.725 : -1.725), py = F.y + (p & 2 ? 1.725 : -1.725);
    if (q.z > 4.3 && q.z < 21.2 && Math.hypot(q.x - px, q.y - py) < 0.524 + q.r - 0.08) stuck++;
  }
}
console.log('shots', N, 'ended inside', inside, 'balls overlapping pipes', stuck, 'balls in flower', g.balls.filter(b => b.flower === F.i).length);
