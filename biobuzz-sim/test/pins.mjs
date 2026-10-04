import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const seed = +process.argv[2] || 2, skill = process.argv[3] || 'hard';
const keys = (process.argv[4] || 'swerve,wall,turret,twin').split(',');
const sim = BB.createSim({ seed, robots: keys.map((k, i) => ({ alliance: i < 2 ? 'R' : 'B', slot: i % 2, spec: BB.presetSpec(k) })) });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
BB.startMatch(sim);
let steps = 0; const seen = new Map();
const desc = r => `${r.alliance}${r.slot}${r.spec.key}[${r.brain.mode}${r.brain.retreat ? ' RETREAT' : ''}] @(${r.x.toFixed(0)},${r.y.toFixed(0)}) v(${r.vx.toFixed(0)},${r.vy.toFixed(0)}) cmd(${r.cmd.vx.toFixed(2)},${r.cmd.vy.toFixed(2)},${r.cmd.w.toFixed(2)}) stat${r._static ? 1 : 0}`;
while (sim.phase !== 'done' && steps < 300 * 170) {
  if (steps % 5 === 0) for (const r of sim.robots) AI.control(sim, r, 5 * BB.DT);
  BB.advance(sim); steps++;
  for (const e of sim.events) if (e.type === 'foul') console.log('  FOUL', sim.t.toFixed(2), e.rule, e.text);
  sim.events.length = 0;
  if (steps % 60 === 0) for (const [k, p] of sim.pins) {
    console.log(sim.t.toFixed(1), 'pin', k, 'count', p.count.toFixed(1), 'pause', p.pause.toFixed(1), '\n      A', desc(p.a), '\n      B', desc(p.b));
  }
}
