import asyncio, sys, time
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
def log(*a): print(*a, flush=True)
VIEWS = {
  'hive':   ((-44, 52, 62), (-6, 42, 0)),
  'flower': ((42, 30, 44), (23.4, 12, 66)),
  'tags':   ((-6, 12, 2), (-12.75, 35.5, -11.6)),
  'tiles':  ((-30, 34, 30), (-52, 0, 52)),
  'wall':   ((0, 20, 20), (-60, 6, 71)),
  'frame':  ((52, 18, 40), (18, 12, 6)),
}
async def main():
    q = sys.argv[1] if len(sys.argv) > 1 else 'high'
    tag = sys.argv[2] if len(sys.argv) > 2 else 'cad'
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html', 'w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 720})
        errs = []
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pg.route('**/*', route)
        t0 = time.time()
        await pg.goto('file:///home/claude/biobuzz/dist/_test.html')
        await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=120000)
        log('boot', round(time.time() - t0, 1), 's')
        log(await pg.evaluate('''() => { const c = window.BBR.cad; if (!c.ready) return {ready: false, err: c.err};
          let tris = 0; for (const b of c.data.buckets) tris += b.geo.index.count / 3;
          return {ready: true, buckets: c.data.buckets.length, tris, seams: c.data.seams.counts.length, src: c.data.meta.src}; }'''))
        await pg.evaluate(f'() => {{ const s = window.BBAPP.set; s.quality = "{q}"; window.BBR.setQuality("{q}"); s.robot = "turret"; s.played = 9; s.cam = "broadcast"; window.BBAPP.start("match"); document.getElementById("hud").hidden = true; }}')
        await pg.evaluate('() => { window.requestAnimationFrame = () => 0; }')
        await pg.wait_for_timeout(100)
        t = 50000
        for i in range(8):
            t += 16; await pg.evaluate(f'() => window.BBAPP._frame({t})')
        await pg.screenshot(path=f'shots/{tag}_{q}_broadcast.png', timeout=150000)
        for name, (pos, look) in VIEWS.items():
            await pg.evaluate(f'''() => {{ const R = window.BBR; R.cam.position.set({pos[0]}, {pos[1]}, {pos[2]}); R.cam.lookAt({look[0]}, {look[1]}, {look[2]}); R.cam.updateMatrixWorld(); R.render([]); }}''')
            await pg.screenshot(path=f'shots/{tag}_{q}_{name}.png', timeout=150000)
        log(await pg.evaluate('() => ({calls: window.BBR.renderer.info.render.calls, tris: window.BBR.renderer.info.render.triangles})'))
        log('\n'.join(errs[:30]) or 'no console errors')
        await b.close()
asyncio.run(main())
