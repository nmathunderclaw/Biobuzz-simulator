import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const sim = BB.createSim({ seed: 1, robots: [
  { alliance: 'R', slot: 0, arch: 'turret' }, { alliance: 'R', slot: 1, arch: 'speed' },
  { alliance: 'B', slot: 0, arch: 'turret' }, { alliance: 'B', slot: 1, arch: 'flower' }] });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill: 'normal' }));
BB.startMatch(sim);
let steps = 0;
const watch = [+process.argv[2] || 3];
const from = +process.argv[3] || 95, to = +process.argv[4] || 158;
while (sim.phase !== 'done' && steps < 240 * 200) {
  if (steps % 4 === 0) for (const r of sim.robots) AI.control(sim, r, 4 * BB.DT);
  BB.advance(sim, BB.DT); steps++;
  for (const e of sim.events) if (e.robot !== undefined && watch.includes(e.robot) && sim.t > from) console.log('   ev', sim.t.toFixed(2), e.type, e.text || '');
  sim.events.length = 0;
  if (steps % 120 === 0 && sim.t > from && sim.t < to) for (const i of watch) {
    const r = sim.robots[i], br = r.brain;
    const T = br.target ? (br.target.ball ? 'ball' + br.target.ball.id : br.target.flower ? 'fl' + br.target.flower.i + `(${br.target.x.toFixed(0)},${br.target.y.toFixed(0)})` : '?') : '-';
    console.log(sim.t.toFixed(1), `${r.alliance}${r.slot} ${br.mode} T=${T} hop=${r.hopper.map(q => q.ball.bt).join('')} pos(${r.x.toFixed(1)},${r.y.toFixed(1)}) psi${(r.psi / BB.D2R).toFixed(0)} cmd(${r.cmd.vx.toFixed(2)},${r.cmd.vy.toFixed(2)},${r.cmd.w.toFixed(2)}) dunk${r.dunk} dT${r.dunkT.toFixed(2)} v(${r.vx.toFixed(0)},${r.vy.toFixed(0)}) reach${!!BB.flowerInReach(sim, r)}`);
  }
}
