# drives frames by hand (60 Hz of page time) while real key events are held down
import asyncio
from playwright.async_api import async_playwright
SK = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
FR = '''async (secs) => { const S = window.BBAPP; let t = S.__t || performance.now(); for (let i = 0; i < Math.round(secs * 60); i++) { t += 1000 / 60; S._frame(t); } S.__t = t; }'''
def log(*a): print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':800,'height':500})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('file:///home/claude/biobuzz/dist/_test.html')
        await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=90000)
        await pg.evaluate('() => { window.BBAPP.set.kbDrive = true; }')
        await pg.evaluate('() => { window.BBR.render = () => {}; const s = window.BBAPP.set; s.cam = "driver"; s.pRobot = "turret"; s.pSlot = "R0"; s.pDefender = "none"; s.aimAssist = "on"; window.BBAPP.start("practice"); }')
        pos = lambda: pg.evaluate('() => { const r = window.BBAPP.primary(); return [+r.x.toFixed(1), +r.y.toFixed(1), +(r.psi*57.3).toFixed(0), +window.BBAPP.sim.t.toFixed(2)]; }')
        await pg.evaluate(FR, 0.5)
        log('start', await pos())
        await pg.keyboard.down('KeyW'); await pg.evaluate(FR, 1.0); await pg.keyboard.up('KeyW'); await pg.evaluate(FR, 0.5)
        log('W 1 s (driver view, red) -> +x', await pos())
        await pg.keyboard.down('KeyA'); await pg.evaluate(FR, 0.8); await pg.keyboard.up('KeyA'); await pg.evaluate(FR, 0.5)
        log('A 0.8 s -> +y (left of the red driver)', await pos())
        await pg.keyboard.down('KeyQ'); await pg.evaluate(FR, 0.5); await pg.keyboard.up('KeyQ'); await pg.evaluate(FR, 0.3)
        log('Q 0.5 s -> heading up (turn left)', await pos())
        # turret robot: aim behind it, hold Space
        await pg.evaluate('''() => { const S = window.BBAPP, sim = S.sim, r = S.primary(), BB = window.BB;
          const h = BB.hiveOf(sim, r.alliance), tp = BB.aimPointWorld(h, h.side);
          r.x = tp[0] - 10; r.y = tp[1] + h.side * 48; r.psi = Math.atan2(tp[1] - r.y, tp[0] - r.x) + Math.PI; r.vx = r.vy = r.w = 0; r.px = r.x; r.py = r.y; r.ppsi = r.psi; r.est = {x: r.x, y: r.y, psi: r.psi};
          while (r.hopper.length < 4) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ball: b, t: 0}); }
          r.stats.shots = 0; r.stats.made = 0; }''')
        await pg.keyboard.down('Space'); await pg.evaluate(FR, 4.0); await pg.keyboard.up('Space'); await pg.evaluate(FR, 2.0)
        log('turret: hold Space 4 s', await pg.evaluate('() => { const r = window.BBAPP.primary(); return {shots: r.stats.shots, made: r.stats.made, hop: r.hopper.length, reason: r.shooters[0].aim.reason}; }'))
        # turret at the end of its travel: hold Space and the chassis turns (aim assist)
        await pg.evaluate('''() => { const S = window.BBAPP, sim = S.sim, r = S.primary(), BB = window.BB;
          const h = BB.hiveOf(sim, r.alliance), tp = BB.aimPointWorld(h, h.side);
          r.x = tp[0] - 10; r.y = tp[1] + h.side * 48; r.psi = Math.atan2(tp[1] - r.y, tp[0] - r.x); r.vx = r.vy = r.w = 0; r.px = r.x; r.py = r.y; r.ppsi = r.psi; r.est = {x: r.x, y: r.y, psi: r.psi};
          while (r.hopper.length < 4) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ball: b, t: 0}); }
          r.stats.shots = 0; r.stats.made = 0; }''')
        await pg.evaluate(FR, 0.5)
        log('turret facing wrong way', await pg.evaluate('() => window.BBAPP.primary().shooters[0].aim.reason'))
        await pg.keyboard.down('Space'); await pg.evaluate(FR, 5.0); await pg.keyboard.up('Space'); await pg.evaluate(FR, 2.0)
        log('turret + assist: hold Space 5 s', await pg.evaluate('() => { const r = window.BBAPP.primary(); return {shots: r.stats.shots, made: r.stats.made, psi: +(r.psi*57.3).toFixed(0), reason: r.shooters[0].aim.reason}; }'))
        # fixed shooter
        await pg.evaluate('() => { window.BBAPP.toMenu(); window.BBR.render = () => {}; const s = window.BBAPP.set; s.pRobot = "speed"; window.BBAPP.start("practice"); }')
        await pg.evaluate(FR, 0.3)
        await pg.evaluate('''() => { const S = window.BBAPP, sim = S.sim, r = S.primary(), BB = window.BB;
          const h = BB.hiveOf(sim, r.alliance), tp = BB.aimPointWorld(h, h.side);
          r.x = tp[0] + 14; r.y = tp[1] + h.side * 50; r.psi = 0.3; r.vx = r.vy = r.w = 0; r.px = r.x; r.py = r.y; r.ppsi = r.psi; r.est = {x: r.x, y: r.y, psi: r.psi};
          while (r.hopper.length < 4) { const b = BB.addBall(sim, 0, 0, 0, 0); b.state = 'held'; b.holder = r.id; r.hopper.push({ball: b, t: 0}); }
          r.stats.shots = 0; r.stats.made = 0; }''')
        await pg.keyboard.down('Space'); await pg.evaluate(FR, 5.0); await pg.keyboard.up('Space'); await pg.evaluate(FR, 2.0)
        log('fixed + assist: hold Space 5 s', await pg.evaluate('() => { const r = window.BBAPP.primary(); return {shots: r.stats.shots, made: r.stats.made, psi: +(r.psi*57.3).toFixed(0), reason: r.shooters[0].aim.reason}; }'))
        # pause with Escape
        await pg.keyboard.press('Escape'); await pg.evaluate(FR, 0.1); p1 = await pg.evaluate('() => window.BBAPP.paused')
        await pg.keyboard.press('Escape'); await pg.evaluate(FR, 0.1); p2 = await pg.evaluate('() => window.BBAPP.paused')
        log('pause toggle', p1, p2)
        # manual human player: request NECTAR in the free phase
        await pg.evaluate('() => { const S = window.BBAPP; S.sim.hp.R.manual = true; }')
        before = await pg.evaluate('() => window.BBAPP.sim.hp.R.left')
        await pg.keyboard.press('KeyH'); await pg.evaluate(FR, 0.5)
        after = await pg.evaluate('() => window.BBAPP.sim.hp.R.left')
        log('manual HP NECTAR', before, '->', after)
        log(errs[:10] or 'no errors')
        await b.close()
asyncio.run(main())
