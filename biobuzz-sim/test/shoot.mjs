import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const archs = Object.keys(BB.ARCH);
for (const ak of archs) {
  const line = [];
  for (const D of [26, 34, 42, 52, 64, 80, 100, 120]) {
    let hits = 0, tries = 0, noaim = 0;
    for (let k = 0; k < 12; k++) {
      const sim = BB.createSim({ seed: 100 + k + D, robots: [{ alliance: 'R', slot: 0, arch: ak }] });
      sim.phase = 'free'; sim.t = 0;
      for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
      const h = sim.hives[0]; h.K = 1e7;
      const rb = sim.robots[0]; rb.enabled = true; rb.autoFire = false;
      const tp = BB.aimPointWorld(h, h.side);
      const lat = (k % 3 - 1) * 8;
      rb.x = tp[0] + lat; rb.y = tp[1] + h.side * D; rb.psi = Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
      if (!rb.arch.turret) rb.psi += 0; 
      // settle aim
      let ok = false;
      for (let s = 0; s < 240 * 2.5; s++) {
        BB.advance(sim, BB.DT);
        if (!rb.arch.turret && rb.aim.valid) rb.psi = rb.aim.az;
        if (rb.aim.locked) { ok = true; break; }
      }
      if (!ok) { noaim++; continue; }
      const ball = rb.hopper[0].ball;
      BB.fire(sim, rb); tries++;
      let inCell = false;
      for (let s = 0; s < 240 * 2; s++) { BB.advance(sim, BB.DT); if (BB.ballInCell(h, ball, h.side)) { inCell = true; } }
      if (inCell && BB.ballInCell(h, ball, h.side)) hits++;
    }
    line.push(`D${D}:${tries ? Math.round(100 * hits / tries) : '--'}%${noaim ? '(' + noaim + ' no-lock)' : ''}`);
  }
  console.log(ak.padEnd(8), line.join('  '));
}
