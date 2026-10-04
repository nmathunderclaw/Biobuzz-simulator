// team AUTO plans: run a few plans for every preset on both alliances, print what each step achieved
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BB = require('../src/engine.js');
const AI = require('../src/ai.js');
const PLANS = {
  garden: { name: 'Preload + GARDEN + PARK', start: { wall: 'a', s: -16, h: 0 }, steps: [
    { k: 'move', x: -40, y: -34, h: 'hive' }, { k: 'shoot', at: 'here', to: 5 },
    { k: 'collect', x: -60, y: -64, r: 14, n: 4, to: 9 }, { k: 'move', x: -40, y: -34, h: 'hive' }, { k: 'shoot', at: 'here', to: 5 }, { k: 'park' }] },
  spot: { name: 'Spot', start: { wall: 'l', s: -6, h: 0 }, steps: [{ k: 'shoot', at: 'spot', to: 7 }, { k: 'until', t: 20 }, { k: 'park' }] },
  wait: { name: 'Wait+turn', start: { wall: 'f', s: -47, h: 0 }, steps: [{ k: 'wait', s: 2 }, { k: 'turn', h: 90 }, { k: 'move', x: -30, y: 40, h: null, pass: true }, { k: 'move', x: -50, y: 10, h: 0 }, { k: 'shoot', at: 'here', to: 6 }] },
};
const keys = process.argv[2] ? [process.argv[2]] : Object.keys(BB.PRESETS);
let bad = 0;
for (const pk of Object.keys(PLANS)) {
  const plan = AI.PLAN.normalize(PLANS[pk]);
  // round trip through the share code
  const back = AI.PLAN.decode(AI.PLAN.encode(plan));
  if (JSON.stringify(back) !== JSON.stringify(plan)) { console.log('CODE MISMATCH', pk, JSON.stringify(back), JSON.stringify(plan)); bad++; }
  for (const key of keys) for (const al of ['R', 'B']) {
    const spec = BB.presetSpec(key), P = BB.deriveRobot(spec);
    const pose = AI.PLAN.start(plan, al, P);
    const sim = BB.createSim({ seed: 7, robots: [{ alliance: al, slot: 0, spec, pose, human: false }] });
    const rb = sim.robots[0];
    AI.brainFor(sim, rb, { routine: 'plan', plan, skill: 'normal' });
    BB.startMatch(sim);
    let steps = 0, g402 = 0;
    while (sim.phase === 'auto' && steps < 300 * 31) {
      if (steps % 5 === 0) AI.control(sim, rb, 5 * BB.DT);
      BB.advance(sim); steps++;
      for (const e of sim.events) if (e.type === 'foul') g402++;
      sim.events.length = 0;
    }
    const snap = sim.autoSnap || {}, ps = rb.brain.ps;
    const log = ps.log.map(q => `${q.i + 1}@${q.t.toFixed(1)}`).join(' ');
    const warn = AI.PLAN.check(plan, spec).length;
    console.log(`${pk.padEnd(7)} ${key.padEnd(8)} ${al} shots ${rb.stats.shots} made ${rb.stats.made} pick ${rb.stats.pickups} leave ${snap[al] && snap[al].leave} park ${snap[al] && snap[al].park} tips ${sim.tips[al].auto} fouls ${g402} step ${ps.i + 1}/${plan.steps.length} [${log}] warn ${warn}`);
    if (g402) bad++;
  }
}
console.log(bad ? 'FAIL ' + bad : 'ok');
