import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const seed = +process.argv[2] || 1;
const skill = process.argv[3] || 'normal';
const keys = (process.argv[4] || 'turret,speed,twin,flower').split(',');
const quiet = process.argv.includes('-q');
const sim = BB.createSim({ seed, robots: [
  { alliance: 'R', slot: 0, spec: BB.presetSpec(keys[0]), team: '1001' }, { alliance: 'R', slot: 1, spec: BB.presetSpec(keys[1]), team: '1002' },
  { alliance: 'B', slot: 0, spec: BB.presetSpec(keys[2]), team: '2001' }, { alliance: 'B', slot: 1, spec: BB.presetSpec(keys[3]), team: '2002' }] });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
BB.startMatch(sim);
const t0 = Date.now(); let steps = 0; const log = [];
const counts = {};
while (sim.phase !== 'done' && steps < 300 * 200) {
  if (steps % 5 === 0) for (const r of sim.robots) { AI.control(sim, r, 5 * BB.DT); if (r.enabled && r.brain.goalD > 6 && Math.hypot(r.vx, r.vy) < 6 && r.brain.mode !== 'defend') r.stuckT = (r.stuckT || 0) + 5 * BB.DT; }
  BB.advance(sim); steps++;
  for (const e of sim.events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'tip' || e.type === 'phase' || e.type === 'dunk' || e.type === 'foul' || e.type === 'rule') log.push(`${sim.t.toFixed(1)} ${e.type} ${e.alliance || e.phase || ''} ${e.rule || ''} ${e.text || ''} ${e.robot ?? ''} ${e.flower ?? ''}`);
  }
  sim.events.length = 0;
  if (!quiet && steps % (300 * 15) === 0) {
    console.log(`t=${sim.t.toFixed(0)} ` + sim.robots.map(r => `${r.alliance}${r.slot}${r.spec.key}:${r.brain.mode}/${r.hopper.length}@(${r.x.toFixed(0)},${r.y.toFixed(0)}) s${r.stats.shots}m${r.stats.made} ${r.shooters[0].aim.reason} V${r.bat.v.toFixed(1)}`).join(' | '));
  }
}
const ms = Date.now() - t0;
console.log('sim time', sim.t.toFixed(1), 'wall ms', ms, 'x realtime', (sim.t * 1000 / ms).toFixed(1));
if (!quiet) console.log(log.join('\n'));
console.log('events', JSON.stringify(counts));
const f = sim.final;
for (const al of ['R', 'B']) { const d = f[al]; console.log(al, 'TOTAL', d.total, 'auto', d.auto, `(leave ${d.leave} park ${d.autoPark} tip ${d.autoTip})`, 'tele', d.teleop, `(tips ${d.teleTip} cell ${d.cell} flower ${d.flower} bottom ${d.bottom} garden ${d.garden} park ${d.telePark})`, 'foul+', d.foul, 'tips', d.tips, 'RP', JSON.stringify(d.rp)); }
console.log('flowers', JSON.stringify(f.flowers.map(x => ({ o: x.owner, b: x.bottom, n: x.count, s: x.stack.join('') }))));
console.log('robots', sim.robots.map(r => `${r.alliance}${r.slot} ${r.spec.key} shots ${r.stats.shots} made ${r.stats.made} pick ${r.stats.pickups} dunk ${r.stats.dunks} fouls ${r.stats.fouls} dist ${(r.stats.dist / 12).toFixed(0)}ft V${r.bat.v.toFixed(2)} ah${r.bat.ah.toFixed(3)} locErr${r.loc.err.toFixed(1)} stuck${(r.stuckT || 0).toFixed(1)}s`).join('\n       '));
console.log('out of field', sim.outCount, 'hp left', sim.hp.R.left, sim.hp.B.left, 'fouls', JSON.stringify(sim.fouls));
