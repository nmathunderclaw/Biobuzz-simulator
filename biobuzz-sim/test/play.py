import asyncio, sys
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
def log(*a): print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':960,'height':600})
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
        await pg.evaluate('() => { window.BBAPP.set.kbDrive = true; }')
        await pg.evaluate('() => { const s = window.BBAPP.set; s.quality = "low"; window.BBR.setQuality("low"); s.cam = "driver"; s.pRobot = "turret"; s.pSlot = "R0"; s.pDefender = "none"; window.BBAPP.start("practice"); }')
        await pg.wait_for_timeout(1500)
        pos = lambda: pg.evaluate('() => { const r = window.BBAPP.primary(); return [+r.x.toFixed(1), +r.y.toFixed(1), +(r.psi*57.3).toFixed(0), +window.BBAPP.sim.t.toFixed(2)]; }')
        a = await pos(); log('start', a)
        await pg.keyboard.down('KeyW'); await pg.wait_for_timeout(2500); await pg.keyboard.up('KeyW')
        b1 = await pos(); log('after W (driver view, red): expect +x', b1)
        await pg.keyboard.down('KeyD'); await pg.wait_for_timeout(2000); await pg.keyboard.up('KeyD')
        c = await pos(); log('after D: expect -y (right of the red driver)', c)
        await pg.keyboard.down('KeyE'); await pg.wait_for_timeout(1500); await pg.keyboard.up('KeyE')
        d = await pos(); log('after E: expect heading to decrease (turn right)', d)
        # put the robot at a known good spot with 4 POLLEN and shoot
        await pg.evaluate('''() => { const S = window.BBAPP, sim = S.sim, r = S.primary(), BB = window.BB;
          const h = BB.hiveOf(sim, r.alliance), tp = BB.aimPointWorld(h, h.side);
          r.x = tp[0] - 10; r.y = tp[1] + h.side * 48; r.psi = Math.atan2(tp[1] - r.y, tp[0] - r.x) + Math.PI; r.vx = r.vy = r.w = 0; r.px = r.x; r.py = r.y; r.ppsi = r.psi; r.est = {x: r.x, y: r.y, psi: r.psi};
          while (r.hopper.length < 4) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ball: b, t: 0}); }
          r.stats.shots = 0; r.stats.made = 0; }''')
        await pg.wait_for_timeout(1500)
        log('aim before shooting', await pg.evaluate('() => { const r = window.BBAPP.primary(); const A = r.shooters[0].aim; return {reason: A.reason, valid: A.valid, locked: A.locked, D: A.D}; }'))
        await pg.keyboard.down('Space'); await pg.wait_for_timeout(6000); await pg.keyboard.up('Space')
        await pg.wait_for_timeout(2500)
        log('shots', await pg.evaluate('() => { const r = window.BBAPP.primary(); return {shots: r.stats.shots, made: r.stats.made, hop: r.hopper.length, reason: r.shooters[0].aim.reason}; }'))
        # fixed shooter with aim assist
        await pg.evaluate('() => { window.BBAPP.toMenu(); const s = window.BBAPP.set; s.pRobot = "speed"; window.BBAPP.start("practice"); }')
        await pg.wait_for_timeout(1500)
        await pg.evaluate('''() => { const S = window.BBAPP, sim = S.sim, r = S.primary(), BB = window.BB;
          const h = BB.hiveOf(sim, r.alliance), tp = BB.aimPointWorld(h, h.side);
          r.x = tp[0] + 14; r.y = tp[1] + h.side * 50; r.psi = 0.3; r.vx = r.vy = r.w = 0; r.px = r.x; r.py = r.y; r.ppsi = r.psi; r.est = {x: r.x, y: r.y, psi: r.psi};
          while (r.hopper.length < 4) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ball: b, t: 0}); }
          r.stats.shots = 0; r.stats.made = 0; }''')
        await pg.wait_for_timeout(1000)
        await pg.keyboard.down('Space'); await pg.wait_for_timeout(7000); await pg.keyboard.up('Space')
        await pg.wait_for_timeout(2500)
        log('fixed shooter + aim assist', await pg.evaluate('() => { const r = window.BBAPP.primary(); return {shots: r.stats.shots, made: r.stats.made, psi: +(r.psi*57.3).toFixed(0), reason: r.shooters[0].aim.reason}; }'))
        # pause toggling with Escape
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(2500)
        p1 = await pg.evaluate('() => window.BBAPP.paused')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(2500)
        p2 = await pg.evaluate('() => window.BBAPP.paused')
        fr = await pg.evaluate('() => { const f = window.BBAPP.frameMs; return (f.reduce((a,c)=>a+c,0)/f.length).toFixed(0) + " ms/frame"; }')
        log('frame time in this headless browser', fr)
        log('pause toggle', p1, p2)
        log('\n'.join(errs[:20]) or 'no console errors')
        await b.close()
asyncio.run(main())
