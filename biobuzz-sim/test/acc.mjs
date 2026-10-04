import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const presets = process.argv[2] ? process.argv[2].split(',') : Object.keys(BB.PRESETS);
const AL = process.argv[3] || 'R';
for (const key of presets) {
  const line = [];
  for (const D of [30, 40, 50, 60, 72, 86, 100]) {
    let shots = 0, made = 0, nolock = {};
    for (let k = 0; k < 6; k++) {
      const spec = BB.presetSpec(key);
      const sim = BB.createSim({ seed: 100 + k * 13 + D, robots: [{ alliance: AL, slot: 0, spec }], mode: 'free' });
      for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
      const h = sim.hives[AL === 'R' ? 0 : 1]; h.K = 1e8;
      const rb = sim.robots[0], sh = rb.shooters[0];
      const tp = BB.aimPointWorld(h, h.side);
      const ang = (-50 + sim.rng() * 100) * BB.D2R;
      rb.x = BB.clamp(tp[0] + Math.sin(ang) * (D + 2), -60, 60); rb.y = BB.clamp(tp[1] + h.side * Math.cos(ang) * (D + 2), -60, 60);
      const az = Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
      rb.psi = BB.wrap(az - sh.faces); rb.px = rb.x; rb.py = rb.y; rb.ppsi = rb.psi; rb.est = { x: rb.x, y: rb.y, psi: rb.psi };
      BB.startMatch(sim);
      rb.fireHeld = true;
      let locked = false;
      for (let s = 0; s < 300 * 5; s++) {
        // fixed shooters: keep the robot pointed (like the AI / aim assist does)
        if (sh.type === 'fixed' && sh.aim.valid) rb.cmd.w = BB.clamp(BB.wrap(sh.aim.az - (rb.est.psi + sh.faces)) * 3, -1, 1);
        BB.advance(sim); sim.events.length = 0;
        if (sh.aim.locked) locked = true;
      }
      if (!locked) nolock[sh.aim.reason] = (nolock[sh.aim.reason] || 0) + 1;
      shots += rb.stats.shots; made += rb.stats.made;
    }
    line.push(`D${D}:${shots ? Math.round(100 * made / shots) + '%' : '--'}/${shots}${Object.keys(nolock).length ? '(' + Object.entries(nolock).map(([a, b]) => a + ' ' + b).join(',') + ')' : ''}`);
  }
  console.log(key.padEnd(8), line.join('  '));
}
