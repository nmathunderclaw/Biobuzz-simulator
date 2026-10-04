import asyncio, sys, subprocess, time
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
ADV = open('test/replay.py').read().split("ADV = '''")[1].split("'''")[0]
def log(*a): print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html','w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    mock = open('test/mockroom.js').read()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
            ctx = await b.new_context(viewport={'width':800,'height':500})
            await ctx.add_init_script(mock)
            errs = []
            async def route(r):
                u = r.request.url
                if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
                elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
                else: await r.continue_()
            await ctx.route('**/*', route)
            pages = []
            for who in ('host', 'guest'):
                pg = await ctx.new_page()
                pg.on('console', lambda m, w=who: errs.append(f'{w} {m.type}: {m.text}') if m.type in ('error','warning') else None)
                pg.on('pageerror', lambda e, w=who: errs.append(f'{w} PAGEERROR: ' + str(e)))
                await pg.goto('http://localhost:8765/_test.html')
                try:
                    await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=120000)
                except Exception as ex:
                    log('load failed', who, await pg.evaluate('() => ({three: !!window.THREE, app: !!window.BBAPP, fatal: !document.getElementById("fatal").hidden, msg: document.getElementById("fatalMsg").textContent, net: !!window.BBNET})'))
                    log('\n'.join(errs[:20])); raise
                await pg.evaluate('() => { const s = window.BBAPP.set; s.quality = "low"; window.BBR.setQuality("low"); s.played = 9; window.requestAnimationFrame = () => 0; }')
                pages.append(pg)
            host, guest = pages
            T = {'t': 200000}
            async def pump(n, step=100):
                for i in range(n):
                    T['t'] += step
                    await host.evaluate(f'() => window.BBAPP._frame({T["t"]})')
                    await guest.evaluate(f'() => window.BBAPP._frame({T["t"]})')
            # host creates a room
            await host.evaluate('() => { window.BBAPP.set.olName = "Chủ"; window.BBAPP.set.olMode = "versus"; window.BBAPP.set.olBots = "normal"; window.BBUI.show("online"); }')
            await host.wait_for_timeout(300)
            log('host avail', await host.evaluate('() => document.getElementById("olAvail").textContent'))
            await host.click('#olCreate'); await host.wait_for_timeout(400)
            code = await host.evaluate('() => window.BBNET.code')
            log('room code', code)
            await guest.evaluate('() => { window.BBAPP.set.olName = "Khách"; window.BBAPP.set.olRobot = "swerve"; window.BBUI.show("online"); }')
            await guest.fill('#olCode', code.upper()); await guest.click('#olJoin')
            await pump(6)
            log('host lobby', await host.evaluate('() => ({peers: document.getElementById("olPeers").innerText, start: !document.getElementById("olStart").disabled, wait: document.getElementById("olWait").textContent})'))
            log('guest lobby', await guest.evaluate('() => ({peers: document.getElementById("olPeers").innerText, wait: document.getElementById("olWait").textContent})'))
            await host.click('#olStart')
            await pump(8)
            log('guest after start', await guest.evaluate('() => ({mode: window.BBAPP.mode, gid: window.BBNET.G && window.BBNET.G.gid, buf: window.BBNET.G && window.BBNET.G.buf.length, me: window.BBNET.G && window.BBNET.G.myId, spect: window.BBNET.G && window.BBNET.G.spectator})'))
            log('host humans', await host.evaluate('() => window.BBAPP.humans.map(h => ({id: h.id, remote: h.remote, name: h.name}))'))
            await pump(40)   # countdown + some AUTO
            # fast-forward the host into TELEOP
            log('host adv', await host.evaluate(ADV, 41))
            await pump(4)
            gid = await host.evaluate('() => window.BBAPP.humans.find(h => h.remote).id')
            before = await host.evaluate(f'() => {{ const r = window.BBAPP.sim.robots[{gid}]; return [+r.x.toFixed(1), +r.y.toFixed(1)]; }}')
            await guest.keyboard.down('KeyW')
            await pump(16)
            await guest.keyboard.up('KeyW')
            after = await host.evaluate(f'() => {{ const r = window.BBAPP.sim.robots[{gid}]; return [+r.x.toFixed(1), +r.y.toFixed(1)]; }}')
            gv = await guest.evaluate('() => { const G = window.BBNET.G, r = G.view.robots[G.myId]; return {x: +r.x.toFixed(1), y: +r.y.toFixed(1), rtt: Math.round(G.rtt), hz: Math.round(G.hz), buf: G.buf.length}; }')
            log('guest robot on host before/after W', before, after, 'guest view', gv)
            # guest opens its menu for a while: the bot drives, then the guest takes back over
            await guest.keyboard.press('Escape'); await pump(2)
            for k in range(5):
                await host.wait_for_timeout(1500); await pump(1)
            log('guest menu open', await guest.evaluate('() => !document.getElementById("pause").hidden'), 'host gone', await host.evaluate('() => window.BBAPP.humans.find(h => h.remote).gone'))
            await guest.keyboard.press('Escape'); await pump(4)
            log('guest menu closed', await guest.evaluate('() => document.getElementById("pause").hidden'), 'host gone', await host.evaluate('() => window.BBAPP.humans.find(h => h.remote).gone'))
            await guest.screenshot(path='shots/v3_online_guest.png', timeout=150000)
            log('presence max bytes', await host.evaluate('() => ({max: window.__maxPres, tooBig: window.__tooBig || 0, n: window.__presN})'), await guest.evaluate('() => ({max: window.__maxPres, tooBig: window.__tooBig || 0})'))
            # finish the match
            log('host adv end', await host.evaluate(ADV, 999))
            await pump(12)
            log('guest results', await guest.evaluate('() => ({mode: window.BBAPP.mode, res: document.getElementById("results").hidden, R: document.getElementById("resR").textContent, B: document.getElementById("resB").textContent, again: document.getElementById("btnAgain").textContent})'))
            log('host results', await host.evaluate('() => ({mode: window.BBAPP.mode, R: document.getElementById("resR").textContent, B: document.getElementById("resB").textContent})'))
            # rematch
            await host.click('#btnAgain')
            await pump(8)
            log('after rematch', await guest.evaluate('() => ({mode: window.BBAPP.mode, gid: window.BBNET.G && window.BBNET.G.gid})'), await host.evaluate('() => ({gid: window.BBNET.gid, mode: window.BBAPP.mode})'))
            # guest goes back to the lobby from its menu, then leaves the room
            await guest.keyboard.press('Escape'); await pump(1)
            log('guest menu labels', await guest.evaluate('() => ({h2: document.querySelector("#pause h2").textContent, menu: document.getElementById("btnMenu").textContent, restartHidden: document.getElementById("btnRestart").hidden})'))
            await guest.click('#btnMenu'); await pump(2)
            log('guest in lobby', await guest.evaluate('() => ({mode: window.BBAPP.mode, role: window.BBNET.role, leftGid: window.BBNET.leftGid, screen: window.BBUI.current, lobby: !document.getElementById("olLobby").hidden})'))
            await guest.click('#olLeave'); await pump(1)
            for k in range(4):
                await host.wait_for_timeout(1500); await pump(1)
            log('host after guest left', await host.evaluate('() => ({gone: window.BBAPP.humans.find(h => h.remote).gone, guestPeer: !!window.BBNET.guestPeer})'))
            log('guest after leaving', await guest.evaluate('() => ({mode: window.BBAPP.mode, role: window.BBNET.role})'))
            # the same person comes back with the code: re-adopted into the running match
            await guest.fill('#olCode', code.upper()); await guest.click('#olJoin')
            await pump(6)
            log('guest rejoined', await guest.evaluate('() => ({mode: window.BBAPP.mode, gid: window.BBNET.G && window.BBNET.G.gid, spect: window.BBNET.G && window.BBNET.G.spectator})'), await host.evaluate('() => ({guestPeer: !!window.BBNET.guestPeer})'))
            # host goes back to its lobby: the guest follows
            await host.evaluate('() => window.BBAPP.toMenu()'); await pump(4)
            log('host to lobby', await host.evaluate('() => ({mode: window.BBAPP.mode, screen: window.BBUI.current, role: window.BBNET.role})'), await guest.evaluate('() => ({mode: window.BBAPP.mode, screen: window.BBUI.current, status: document.getElementById("olStatus").textContent})'))
            # Esc out of a replay started from the pause menu keeps the match paused (host, local match)
            await host.evaluate('() => { window.BBNET.leave(true); window.BBAPP.start("practice"); }'); await pump(3)
            await host.evaluate(ADV, 20); await pump(2)
            await host.evaluate('() => window.BBAPP.togglePause()'); await host.click('#btnReplayPause'); await pump(3)
            await host.keyboard.press('Escape'); await pump(3)
            log('after Esc from replay', await host.evaluate('() => ({mode: window.BBAPP.mode, paused: window.BBAPP.paused, labels: document.getElementById("labels").hidden})'))
            log('\n'.join(errs[:30]) or 'no console errors')
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main())
