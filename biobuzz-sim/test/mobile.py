import asyncio
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
ADV = '''(tt) => { const S = window.BBAPP; const sim = S.sim; let n = 0; if (sim.phase === 'pre') { S.countdown = 0; window.BB.startMatch(sim); }
  while (sim.t < tt && n < 240*200 && sim.phase !== 'done') { if (S.step % 4 === 0) { sim.robots.forEach(r => window.BBAI.control(sim, r, 4*window.BB.DT)); } window.BB.advance(sim, window.BB.DT); S.step++; n++; }
  return {phase: sim.phase, t: sim.t}; }'''
async def main():
    open('dist/_test.html','w').write(SK + open('dist/biobuzz-sim.html').read() + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pm = await b.new_page(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True, device_scale_factor=1)
        errs = []
        pm.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pm.route('**/*', route)
        await pm.goto('file:///home/claude/biobuzz/dist/_test.html')
        await pm.wait_for_function('document.getElementById("loading").hidden === true', timeout=60000)
        await pm.wait_for_timeout(1500)
        await pm.screenshot(path='shots/7_mobile_menu.png')
        await pm.evaluate('() => document.getElementById("btnStart").click()')
        print(await pm.evaluate(ADV, 44))
        await pm.wait_for_timeout(2500)
        await pm.screenshot(path='shots/8_mobile_play.png')
        ov = await pm.evaluate('() => document.documentElement.scrollWidth > window.innerWidth')
        print('horizontal overflow:', ov, errs or 'no errors')
        await b.close()
asyncio.run(main())
