// shoot-on-the-move accuracy: a lead-compensating turret robot drives straight lines past its HIVE
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const key = process.argv[2] || 'turret';
for (const spd of [0, 0.25, 0.5, 0.75, 1.0]) {
  for (const dir of ['across', 'toward', 'away']) {
    let shots = 0, made = 0; const why = {};
    for (let k = 0; k < 6; k++) {
      const sim = BB.createSim({ seed: 7 + k * 31, robots: [{ alliance: 'R', slot: 0, spec: BB.presetSpec(key) }], mode: 'free' });
      for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
      const h = sim.hives[0]; h.K = 1e8;
      const rb = sim.robots[0];
      // plenty of balls
      for (let q = 0; q < 12; q++) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = rb.id; }
      const tp = BB.aimPointWorld(h, h.side);
      let x0, y0, ux, uy;
      if (dir === 'across') { x0 = -55; y0 = tp[1] + h.side * 36; ux = 1; uy = 0; }
      else if (dir === 'toward') { x0 = tp[0] + 25; y0 = tp[1] + h.side * 46; ux = 0; uy = -h.side; }
      else { x0 = tp[0] + 25; y0 = tp[1] + h.side * 18; ux = 0; uy = h.side; }
      rb.x = x0; rb.y = y0; rb.psi = Math.atan2(uy, ux); rb.px = rb.x; rb.py = rb.y; rb.ppsi = rb.psi; rb.est = { x: rb.x, y: rb.y, psi: rb.psi };
      BB.startMatch(sim);
      rb.fireHeld = true;
      let stopT = 1e9;
      for (let s = 0; s < 300 * 5; s++) {
        // keep the hopper topped up from the spare balls
        if (rb.hopper.length < 3) { const b = sim.balls.find(b => b.state === 'held' && b.holder === rb.id && !rb.hopper.some(q => q.ball === b) && !rb.shooters.some(sh => sh.feed.ball === b)); if (b) rb.hopper.push({ ball: b, t: 0 }); }
        const t = s * BB.DT;
        const v = t > stopT ? 0 : spd * Math.min(1, t / 0.8);            // accelerate for 0.8 s then cruise
        rb.cmd.vx = ux * v; rb.cmd.vy = uy * v; rb.cmd.w = 0;
        if (t > stopT) rb.fireHeld = false;
        if (t > stopT + 1.3) break;
        BB.advance(sim); sim.events.length = 0;
        for (const b of sim.balls) if (b.state === 'field' && b.launchT > 0 && b.madeFor === b.launchT) b.state = 'out';   // empty the CELL
        const A = rb.shooters[0].aim; why[A.reason] = (why[A.reason] || 0) + 1;
        if (stopT > 1e8 && (t > 3.2 || Math.abs(rb.x) > 58 || Math.abs(rb.y) > 62 || Math.abs(rb.y - tp[1]) < 16)) stopT = t;
      }
      shots += rb.stats.shots; made += rb.stats.made;
    }
    const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, b]) => a + ':' + b).join(' ');
    console.log(`${key} spd ${spd.toFixed(2)} ${dir.padEnd(6)} made ${made}/${shots} ${shots ? Math.round(100 * made / shots) : '--'}%   ${top}`);
  }
}
