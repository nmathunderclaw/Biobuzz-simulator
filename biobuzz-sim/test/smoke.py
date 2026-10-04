import asyncio, sys, time
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
ADV = '''(tt) => { const S = window.BBAPP; const sim = S.sim; let n = 0; if (sim.phase === 'pre') { S.countdown = 0; window.BB.startMatch(sim); }
  while (sim.t < tt && n < 300*200 && sim.phase !== 'done') { if (S.step % 5 === 0) { sim.robots.forEach(r => window.BBAI.control(sim, r, 5*window.BB.DT)); } window.BB.advance(sim, window.BB.DT); S.step++; n++; }
  return {phase: sim.phase, t: sim.t, n}; }'''
def log(*a):
    print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1280,'height':800})
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
        await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=60000)
        log('loaded'); await pg.wait_for_timeout(2000)
        await pg.screenshot(path='shots/1_menu.png'); log('shot menu')
        await pg.click('#btnStart'); log('clicked start')
        log(await pg.evaluate(ADV, 6)); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='shots/2_auto.png'); log('shot auto')
        log(await pg.evaluate(ADV, 41))
        await pg.keyboard.down('KeyW'); await pg.wait_for_timeout(1500); await pg.keyboard.up('KeyW')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/3_tele_driver.png'); log('shot tele')
        await pg.keyboard.press('KeyC'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='shots/4_follow.png'); log('shot follow')
        await pg.keyboard.press('KeyC'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='shots/5_broadcast.png'); log('shot broadcast')
        info = await pg.evaluate('''() => { const S = window.BBAPP; const me = S.sim.robots[0]; return {phase: S.sim.phase, t: S.sim.t.toFixed(1), me: [me.x.toFixed(1), me.y.toFixed(1), (me.psi*57.3).toFixed(0)], aim: me.aim.reason, hop: me.hopper.length, ctl: me.controller}; }''')
        log(info)
        log(await pg.evaluate(ADV, 999))
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path='shots/6_results.png'); log('shot results')
        calls = await pg.evaluate('() => { const r = window.BBR.renderer; return {calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures}; }')
        log('render info', calls)
        log('\n'.join(errs[:30]) or 'no console errors')
        await b.close()
asyncio.run(main())
