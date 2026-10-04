import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const seed = +process.argv[2] || 7, skill = process.argv[3] || 'hard';
const keys = (process.argv[4] || 'speed,swerve,flower,twin').split(',');
const sim = BB.createSim({ seed, robots: keys.map((k, i) => ({ alliance: i < 2 ? 'R' : 'B', slot: i % 2, spec: BB.presetSpec(k) })) });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
BB.startMatch(sim);
let steps = 0; const hist = {}; const eps = [];
const cur = sim.robots.map(() => null);
while (sim.phase !== 'done' && steps < 300 * 170) {
  if (steps % 5 === 0) for (const r of sim.robots) {
    AI.control(sim, r, 5 * BB.DT);
    const br = r.brain, stuck = r.enabled && br.goalD > 6 && Math.hypot(r.vx, r.vy) < 6 && br.mode !== 'defend';
    if (stuck) {
      const T = br.target ? (br.target.ball ? 'ball' : br.target.flower ? 'flower' : '?') : '-';
      const why = `${br.mode}/${T}${br.retreat ? '/RET' : ''}${br.detour && sim.t < br.detour.until ? '/DET' : ''}${r.shooters.some(s => s.feed.ball) ? '/FEED' : ''}${Math.abs(r.cmd.w) > 0.5 ? '/TURN' : ''}${Math.hypot(r.cmd.vx, r.cmd.vy) < 0.1 ? '/CMD0' : ''}${r._static ? '/STATIC' : ''}${sim._rr.some(c => c.a === r || c.b === r) ? '/ROBOT' : ''}`;
      hist[why] = (hist[why] || 0) + 5 * BB.DT;
      if (!cur[r.id]) cur[r.id] = { r: r.id, t0: sim.t, why, x: r.x, y: r.y };
      cur[r.id].t1 = sim.t;
    } else if (cur[r.id]) { if (cur[r.id].t1 - cur[r.id].t0 > 1.5) eps.push(cur[r.id]); cur[r.id] = null; }
  }
  BB.advance(sim); steps++; sim.events.length = 0;
}
console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v.toFixed(1)}s ${k}`).join('\n'));
console.log('episodes > 1.5 s:');
for (const e of eps) console.log(`  robot ${e.r} ${e.t0.toFixed(1)}-${e.t1.toFixed(1)} (${(e.t1 - e.t0).toFixed(1)}s) ${e.why} @(${e.x.toFixed(0)},${e.y.toFixed(0)})`);
