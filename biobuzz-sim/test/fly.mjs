import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
function setup(spec, D = 50) {
  const sim = BB.createSim({ seed: 5, robots: [{ alliance: 'R', slot: 0, spec }], mode: 'free' });
  for (const b of sim.balls) if (b.state === 'field') b.state = 'out';
  const h = sim.hives[0]; h.K = 1e8;
  const rb = sim.robots[0];
  const tp = BB.aimPointWorld(h, h.side);
  rb.x = tp[0]; rb.y = tp[1] + h.side * (D + 2); rb.px = rb.x; rb.py = rb.y;
  const sh = rb.shooters[0];
  const az = Math.atan2(tp[1] - rb.y, tp[0] - rb.x);
  rb.psi = BB.wrap(az - sh.faces); rb.ppsi = rb.psi; rb.est = { x: rb.x, y: rb.y, psi: rb.psi };
  BB.startMatch(sim);
  return { sim, rb, sh, h };
}
for (const ctrl of ['sdk', 'pidf', 'bang']) for (const inertia of ['light', 'medium', 'heavy']) {
  const spec = BB.presetSpec('turret'); spec.shooters[0].ctrl = ctrl; spec.shooters[0].inertia = inertia;
  const { sim, rb, sh, h } = setup(spec);
  let tReach = -1, peak = 0, wt = 0;
  // spin up (no firing)
  for (let s = 0; s < 300 * 3; s++) {
    BB.advance(sim); sim.events.length = 0;
    const F = sh.fw; if (sh.aim.valid) wt = sh.aim.wt;
    if (wt && tReach < 0 && Math.abs(F.w - wt) < 0.03 * wt) tReach = sim.t;
    if (wt) peak = Math.max(peak, F.w / wt);
  }
  // fire 4 as fast as allowed
  rb.fireHeld = true;
  const dips = []; let last = 0, made0 = rb.stats.made; const shotT = [];
  let minW = 1e9, shots0 = rb.stats.shots;
  for (let s = 0; s < 300 * 3; s++) {
    BB.advance(sim);
    for (const e of sim.events) if (e.type === 'fire') shotT.push(sim.t.toFixed(2));
    sim.events.length = 0;
  }
  console.log(`${ctrl.padEnd(4)} ${inertia.padEnd(6)} wt=${wt.toFixed(0)} rad/s  spin-up ${tReach.toFixed(2)}s  overshoot ${((peak - 1) * 100).toFixed(1)}%  shots ${rb.stats.shots - shots0} made ${rb.stats.made - made0} at ${shotT.join(' ')}  V=${rb.bat.v.toFixed(2)} reason=${sh.aim.reason}`);
}
