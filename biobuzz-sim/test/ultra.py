import asyncio, sys
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
ADV = open('test/replay.py').read().split("ADV = '''")[1].split("'''")[0]
def log(*a): print(*a, flush=True)
async def main():
    q = sys.argv[1] if len(sys.argv) > 1 else 'ultra'
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1100,'height':680})
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
        await pg.evaluate(f'() => {{ const s = window.BBAPP.set; s.quality = "{q}"; window.BBR.setQuality("{q}"); window.BBFX.setOptions(s); s.robot = "turret"; s.played = 9; s.cam = "broadcast"; window.BBAPP.start("match"); }}')
        await pg.wait_for_timeout(500)
        log(await pg.evaluate(ADV, 12.2))
        # a few real frames so sparks and trails show
        t = 50000
        for i in range(6):
            t += 16; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        log('post', await pg.evaluate('() => ({ok: window.BBR.post.ok, w: window.BBR.post.w, h: window.BBR.post.h, pr: window.BBR.renderer.getPixelRatio(), n: window.BBFX.sp.n, calls: window.BBR.renderer.info.render.calls})'))
        await pg.evaluate('() => { window.BBFX.tip("R"); window.BBFX.made(-12.75, 17, 50, "R"); }')
        for i in range(3):
            t += 16; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.evaluate('() => { document.getElementById("hud").hidden = true; }')
        await pg.screenshot(path=f'shots/v3_{q}_a.png', timeout=150000)
        await pg.evaluate('() => { window.BBAPP.setCam("follow"); }')
        for i in range(20):
            t += 16; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path=f'shots/v3_{q}_b.png', timeout=150000)
        log(await pg.evaluate(ADV, 999))
        for i in range(4):
            t += 16; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.evaluate('() => { window.BBAPP.mode = "results"; window.BBFX.celebrate(window.BBAPP.sim.final); document.getElementById("results").hidden = true; window.BBAPP.cam = "broadcast"; }')
        for i in range(40):
            t += 33; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path=f'shots/v3_{q}_confetti.png', timeout=150000)
        log('\n'.join(errs[:30]) or 'no console errors')
        await b.close()
asyncio.run(main())
