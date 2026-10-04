import asyncio
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>'
async def main():
    open('dist/_test.html','w').write(SK + open('dist/biobuzz-sim.html').read() + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1280,'height':800})
        msgs = []
        pg.on('console', lambda m: msgs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: msgs.append('PAGEERROR: ' + str(e)))
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('file:///home/claude/biobuzz/dist/_test.html')
        for i in range(12):
            await pg.wait_for_timeout(2500)
            st = await pg.evaluate('() => ({loading: !document.getElementById("loading").hidden, fatal: !document.getElementById("fatal").hidden, msg: document.getElementById("fatalMsg").textContent, mode: window.BBAPP && window.BBAPP.mode})')
            print(i, st, flush=True)
            if not st['loading']: break
        print('\n'.join(msgs[:20]))
        await b.close()
asyncio.run(main())
