// many bot matches: parking, fouls, accuracy, stuck time, score spread
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const N = +process.argv[2] || 8, seed0 = +process.argv[3] || 100;
const keys = Object.keys(BB.PRESETS), skills = ['easy', 'normal', 'hard'];
const agg = { autoPark: 0, telePark: 0, leave: 0, robots: 0, fouls: {}, shots: 0, made: 0, stuck: 0, scores: [], g409: 0, out: 0 };
for (let m = 0; m < N; m++) {
  const rng = BB.mulberry32(seed0 + m * 7919);
  const pick = () => keys[Math.floor(rng() * keys.length)];
  const ks = [pick(), pick(), pick(), pick()], skill = skills[m % 3];
  const sim = BB.createSim({ seed: seed0 + m, robots: ks.map((k, i) => ({ alliance: i < 2 ? 'R' : 'B', slot: i % 2, spec: BB.presetSpec(k) })) });
  sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
  BB.startMatch(sim);
  let steps = 0;
  while (sim.phase !== 'done' && steps < 300 * 170) {
    if (steps % 5 === 0) for (const r of sim.robots) { AI.control(sim, r, 5 * BB.DT); if (r.enabled && r.brain.goalD > 6 && Math.hypot(r.vx, r.vy) < 6 && r.brain.mode !== 'defend') r.stuckT = (r.stuckT || 0) + 5 * BB.DT; }
    BB.advance(sim); steps++;
    for (const e of sim.events) { if (e.type === 'foul') agg.fouls[e.rule] = (agg.fouls[e.rule] || 0) + 1; if (e.type === 'rule') agg.g409++; }
    sim.events.length = 0;
  }
  const f = sim.final;
  for (const al of ['R', 'B']) { agg.autoPark += f[al].autoPark / 5; agg.telePark += f[al].telePark / 5; agg.leave += f[al].leave / 3; agg.scores.push(f[al].total); (agg[skill] = agg[skill] || []).push(f[al].total - f[al].foul); }
  for (const r of sim.robots) { agg.robots++; agg.shots += r.stats.shots; agg.made += r.stats.made; agg.stuck += r.stuckT || 0; }
  agg.out += sim.outCount;
  console.log(`#${m} ${skill.padEnd(6)} ${ks.join(',').padEnd(30)} R ${f.R.total} B ${f.B.total}  park A${f.R.autoPark / 5 + f.B.autoPark / 5}/4 T${f.R.telePark / 5 + f.B.telePark / 5}/4 leave ${f.R.leave / 3 + f.B.leave / 3}/4 fouls ${JSON.stringify(sim.fouls)} tips ${f.R.tips}/${f.B.tips} stuck ${sim.robots.map(r => (r.stuckT || 0).toFixed(0)).join(',')}`);
}
for (const k of skills) if (agg[k]) console.log(k, 'avg score (no fouls)', (agg[k].reduce((a, b) => a + b, 0) / agg[k].length).toFixed(0));
console.log(`\nauto park ${(100 * agg.autoPark / agg.robots).toFixed(0)}%  tele park ${(100 * agg.telePark / agg.robots).toFixed(0)}%  leave ${(100 * agg.leave / agg.robots).toFixed(0)}%  accuracy ${(100 * agg.made / agg.shots).toFixed(0)}% (${agg.shots} shots)  fouls ${JSON.stringify(agg.fouls)}  G409 warns ${agg.g409}  stuck avg ${(agg.stuck / agg.robots).toFixed(1)}s  score avg ${(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length).toFixed(0)} min ${Math.min(...agg.scores)} max ${Math.max(...agg.scores)}  balls out ${agg.out}`);
