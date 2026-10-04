import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
for (const ak of Object.keys(BB.ARCH)) {
  const line = [];
  for (const D of [36, 50, 64, 78, 92, 106]) {
    let hits = 0, tries = 0, noaim = 0, reasons = {};
    for (let k = 0; k < 16; k++) {
      const sim = BB.createSim({ seed: 300 + k * 7 + D, robots: [{ alliance: 'R', slot: 0, arch: ak }] });
      sim.phase = 'free';
      for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
      const h = sim.hives[0]; h.K = 1e7;
      const rb = sim.robots[0]; rb.enabled = true; rb.autoFire = false;
      const tp = BB.aimPointWorld(h, h.side);
      // pick a direction on the up side that keeps the robot inside the field
      let placed = false;
      for (let tries2 = 0; tries2 < 40 && !placed; tries2++) {
        const ang = (-60 + sim.rng() * 120) * BB.D2R; // around the outward direction
        const dx = Math.sin(ang), dy = h.side * Math.cos(ang);
        const x = tp[0] + dx * D, y = tp[1] + dy * D;
        if (Math.abs(x) < 60 && Math.abs(y) < 60) { rb.x = x; rb.y = y; placed = true; }
      }
      if (!placed) continue;
      rb.psi = Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
      let ok = false;
      for (let s = 0; s < 240 * 2.5; s++) {
        BB.advance(sim, BB.DT);
        if (!rb.arch.turret && rb.aim.valid) rb.psi = rb.aim.az;
        if (rb.aim.locked) { ok = true; break; }
      }
      if (!ok) { noaim++; reasons[rb.aim.reason] = (reasons[rb.aim.reason] || 0) + 1; continue; }
      const ball = rb.hopper[0].ball;
      BB.fire(sim, rb); tries++;
      for (let s = 0; s < 240 * 2; s++) BB.advance(sim, BB.DT);
      if (BB.ballInCell(h, ball, h.side)) hits++;
    }
    line.push(`D${D}:${tries ? Math.round(100 * hits / tries) + '%' : '--'}${noaim ? '(' + Object.entries(reasons).map(([a, b]) => a + ' ' + b).join(',') + ')' : ''}`);
  }
  console.log(ak.padEnd(8), line.join('  '));
}
