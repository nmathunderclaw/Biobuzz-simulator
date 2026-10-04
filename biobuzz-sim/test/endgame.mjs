import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const seed = +process.argv[2] || 2, skill = process.argv[3] || 'hard';
const keys = (process.argv[4] || 'swerve,wall,turret,twin').split(',');
const from = +(process.argv[5] || 145), to = +(process.argv[6] || 158.5);
const watch = (process.argv[7] || '0,1').split(',').map(Number);
const sim = BB.createSim({ seed, robots: keys.map((k, i) => ({ alliance: i < 2 ? 'R' : 'B', slot: i % 2, spec: BB.presetSpec(k) })) });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
BB.startMatch(sim);
let steps = 0;
while (sim.phase !== 'done' && steps < 300 * 170) {
  if (steps % 5 === 0) for (const r of sim.robots) AI.control(sim, r, 5 * BB.DT);
  BB.advance(sim); steps++;
  sim.events.length = 0;
  if (steps % 30 === 0 && sim.t > from && sim.t < to) for (const i of watch) {
    const r = sim.robots[i], br = r.brain, ps = AI.parkSpot(sim, r, sim.phase === 'auto');
    console.log(sim.t.toFixed(1), `${r.alliance}${r.slot}${r.spec.key} ${br.mode}${br.retreat ? '+RET' : ''}${br.detour && sim.t < br.detour.until ? '+DET' : ''} @(${r.x.toFixed(1)},${r.y.toFixed(1)}) psi${(r.psi / BB.D2R).toFixed(0)} v(${r.vx.toFixed(0)},${r.vy.toFixed(0)}) cmd(${r.cmd.vx.toFixed(2)},${r.cmd.vy.toFixed(2)},${r.cmd.w.toFixed(2)}) park(${ps.x.toFixed(0)},${ps.y.toFixed(0)}) inZone ${BB.inZone(r, BB.ZONES.loading[r.alliance])} hop${r.hopper.length} goalD${br.goalD.toFixed(1)} stat${r._static ? 1 : 0} slip${r.wheelSlip.toFixed(2)} V${r.bat.v.toFixed(1)} rr${sim._rr.filter(c => c.a === r || c.b === r).length} mods[${r.swerve.map(m => (m.ang / BB.D2R).toFixed(0)).join(',')}] feed${r.shooters.some(s => s.feed.ball) ? 1 : 0}`);
  }
}
console.log(JSON.stringify(sim.final.R.parkN), JSON.stringify(sim.final.B.parkN));
