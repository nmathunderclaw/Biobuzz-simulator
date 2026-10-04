// per-shot log from a bot match: robot motion at launch and the outcome
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const seed = +process.argv[2] || 2, skill = process.argv[3] || 'hard';
const keys = (process.argv[4] || 'swerve,wall,turret,twin').split(',');
const watch = +(process.argv[5] ?? 0);
const sim = BB.createSim({ seed, robots: keys.map((k, i) => ({ alliance: i < 2 ? 'R' : 'B', slot: i % 2, spec: BB.presetSpec(k) })) });
sim.robots.forEach(r => AI.brainFor(sim, r, { skill }));
BB.startMatch(sim);
const shots = []; let steps = 0; const pv = sim.robots.map(r => [r.vx, r.vy]);
while (sim.phase !== 'done' && steps < 300 * 170) {
  if (steps % 5 === 0) for (const r of sim.robots) AI.control(sim, r, 5 * BB.DT);
  const rb = sim.robots[watch];
  const ax = (rb.vx - pv[watch][0]) / BB.DT, ay = (rb.vy - pv[watch][1]) / BB.DT; pv[watch] = [rb.vx, rb.vy];
  BB.advance(sim); steps++;
  for (const e of sim.events) {
    if (e.type === 'fire' && e.robot === watch) {
      const b = sim.balls.filter(b => b.state === 'field' && b.launchedBy === watch).sort((p, q) => q.launchT - p.launchT)[0];
      const h = BB.hiveOf(sim, rb.alliance);
      const sh = rb.shooters[e.shooter];
      shots.push({ b, t: sim.t, pos: `(${rb.x.toFixed(0)},${rb.y.toFixed(0)})`, lv: [b.vx, b.vy, b.vz], hit: null, mode: rb.brain.mode, v: Math.hypot(rb.vx, rb.vy).toFixed(0), acc: Math.hypot(ax, ay).toFixed(0), w: rb.w.toFixed(2), D: sh.aim.D.toFixed(0), side: h.side, err: rb.loc.err.toFixed(1), tipT: h.tipT, reason: sh.aim.reason });
    }
    if (e.type === 'tip') for (const s of shots) if (s.b && s.b.state === 'field' && sim.t - s.t < 1.2 && s.b.madeFor !== s.b.launchT) s.tipDuring = true;
  }
  sim.events.length = 0;
  for (const s of shots) {
    if (s.hit || !s.b || s.b.state !== 'field' || sim.t - s.t > 2) continue;
    const b = s.b, dv = Math.hypot(b.vx - s.lv[0], b.vy - s.lv[1], b.vz - s.lv[2] + BB.G * BB.DT);
    if (dv > 25) {
      let what = 'other';
      const near = sim.balls.find(o => o !== b && o.state === 'field' && Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) < b.r + o.r + 0.3);
      if (near) what = 'ball';
      else if (b.z < b.r + 0.5) what = 'floor';
      else if (sim.robots.some(r => Math.hypot(r.x - b.x, r.y - b.y) < 16 && b.z < r.h + 3)) what = 'robot';
      else if (Math.abs(b.x) < 30 && Math.abs(b.y) < 30 && b.z > 20) { const hs = sim.hives.map(h => BB.ballInCell(h, b, h.side) ? h.alliance + 'cell' : null).filter(Boolean); what = hs.length ? 'in ' + hs[0] : 'hive@z' + b.z.toFixed(0); }
      s.hit = what + `@(${b.x.toFixed(0)},${b.y.toFixed(0)},${b.z.toFixed(0)})`;
    }
    s.lv = [b.vx, b.vy, b.vz];
  }
}
let made = 0;
for (const s of shots) {
  const ok = s.b.madeFor === s.b.launchT; if (ok) made++;
  console.log(`t${s.t.toFixed(1)} ${s.mode.padEnd(7)} v${s.v} acc${s.acc} w${s.w} D${s.D} at${s.pos} side${s.side} first:${s.hit} ${ok ? 'MADE' : 'miss'}${s.tipDuring ? ' (tip in flight)' : ''} now@(${s.b.x.toFixed(0)},${s.b.y.toFixed(0)},${s.b.z.toFixed(0)}) ${s.b.state}`);
}
console.log('made', made, '/', shots.length);
