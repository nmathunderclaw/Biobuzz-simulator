import asyncio, sys
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
# fast-forward like the app does: AI every 5 steps, recorder every 10 steps, events into the recorder
ADV = '''(tt) => { const S = window.BBAPP; const sim = S.sim; let n = 0; if (sim.phase === 'pre') { S.countdown = 0; window.BB.startMatch(sim); }
  const humans = new Set(S.humans.map(h => h.id));
  while (sim.t < tt && n < 300*200 && sim.phase !== 'done') {
    if (S.step % 5 === 0) { sim.robots.forEach(r => { if (!humans.has(r.id) || sim.phase === 'auto' || true) window.BBAI.control(sim, r, 5*window.BB.DT); }); }
    window.BB.advance(sim); S.step++; n++;
    if (S.step % 10 === 0) window.BBREC.tick(sim);
    for (const e of sim.events) window.BBREC.event(sim, e); sim.events.length = 0;
  }
  return {phase: sim.phase, t: +sim.t.toFixed(2), n, frames: window.BBREC.frames.length, shots: window.BBREC.shots.length, made: window.BBREC.shots.filter(s => s.made).length, marks: window.BBREC.marks.length}; }'''
def log(*a): print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1100,'height':720})
        errs = []
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('file:///home/claude/biobuzz/dist/_test.html')
        await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=90000)
        await pg.evaluate('() => { const s = window.BBAPP.set; s.quality = "low"; window.BBR.setQuality("low"); s.robot = "turret"; s.played = 9; window.BBAPP.start("match"); }')
        await pg.wait_for_timeout(800)
        log(await pg.evaluate(ADV, 60))
        # pause -> instant replay of the last 10 s
        await pg.evaluate('() => window.BBAPP.togglePause()')
        await pg.click('#btnReplayPause'); await pg.wait_for_timeout(300)
        st = await pg.evaluate('() => ({mode: window.BBAPP.mode, pos: window.BBRP.pos, n: window.BBREC.frames.length, cam: window.BBRP.cam, hidden: document.getElementById("replay").hidden})')
        log('instant replay', st)
        t = 100000
        for i in range(40):
            t += 33; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path='shots/v3_replay_pause.png', timeout=150000)
        log('after 40 frames', await pg.evaluate('() => ({pos: +window.BBRP.pos.toFixed(1), clock: document.getElementById("rpClock").textContent, time: document.getElementById("rpTime").textContent, cam: window.BBRP.camMode, score: [document.getElementById("rpR").textContent, document.getElementById("rpB").textContent]})'))
        await pg.keyboard.press('Space'); await pg.keyboard.press('ArrowLeft')
        t += 33; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        log('after space+left', await pg.evaluate('() => ({playing: window.BBRP.playing, pos: +window.BBRP.pos.toFixed(1)})'))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        log('after esc', await pg.evaluate('() => ({mode: window.BBAPP.mode, paused: window.BBAPP.paused, pauseHidden: document.getElementById("pause").hidden, hud: document.getElementById("hud").hidden})'))
        await pg.evaluate('() => window.BBAPP.togglePause()')
        log(await pg.evaluate(ADV, 999))
        await pg.wait_for_function('document.getElementById("results").hidden === false', timeout=60000)
        await pg.wait_for_timeout(600)
        log('timeline', await pg.evaluate('() => ({tl: window.BBREC.timeline.length, last: window.BBREC.timeline[window.BBREC.timeline.length-1], final: window.BBREC.final, marks: window.BBREC.marks.slice(0,6)})'))
        await pg.click('#resTabs button[data-v="flow"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='shots/v3_results_flow.png', timeout=150000)
        await pg.click('#resTabs button[data-v="map"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='shots/v3_results_map.png', timeout=150000)
        await pg.click('#resMapLayers button[data-v="path"]'); await pg.click('#resMapRobot button:nth-child(3)'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/v3_results_map2.png', timeout=150000)
        await pg.click('#btnReplay'); await pg.wait_for_timeout(300)
        for i in range(90):
            t += 33; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path='shots/v3_replay_full.png', timeout=150000)
        log('full replay', await pg.evaluate('() => ({mode: window.BBAPP.mode, pos: +window.BBRP.pos.toFixed(1), cam: window.BBRP.camMode, clock: document.getElementById("rpClock").textContent})'))
        await pg.click('#rpCam button[data-v="follow"]'); await pg.click('#rpSpeed button[data-v="0.25"]')
        await pg.evaluate('() => { const n = window.BBREC.frames.length; window.BBRP.pos = Math.floor(n * 0.5); }')
        for i in range(30):
            t += 33; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path='shots/v3_replay_follow.png', timeout=150000)
        await pg.click('#rpExit'); await pg.wait_for_timeout(200)
        log('exit', await pg.evaluate('() => ({mode: window.BBAPP.mode, results: document.getElementById("results").hidden})'))
        # narrow check of the results overlay
        await pg.set_viewport_size({'width': 420, 'height': 860}); await pg.wait_for_timeout(300)
        await pg.click('#resTabs button[data-v="map"]'); await pg.wait_for_timeout(300)
        log('narrow', await pg.evaluate('() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, card: document.querySelector("#results .ov-card").scrollWidth, cardW: document.querySelector("#results .ov-card").clientWidth})'))
        await pg.screenshot(path='shots/v3_results_narrow.png', timeout=150000)
        log('\n'.join(errs[:30]) or 'no console errors')
        await b.close()
asyncio.run(main())
