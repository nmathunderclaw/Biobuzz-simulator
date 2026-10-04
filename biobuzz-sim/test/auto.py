# v4: AUTO strategy editor, camera adjustment, gamepad-first controls, render interpolation
import asyncio, sys, json
from playwright.async_api import async_playwright
SK = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#fafafa}[hidden]{display:none!important}</style></head><body>'
ADV = '''(tt) => { const S = window.BBAPP; const sim = S.sim; let n = 0; if (sim.phase === 'pre') { S.countdown = 0; window.BB.startMatch(sim); }
  const humans = new Set(S.humans.map(h => h.id));
  while (sim.t < tt && n < 300*200 && sim.phase !== 'done') { if (S.step % 5 === 0) { sim.robots.forEach(r => { if (!humans.has(r.id) || sim.phase === 'auto') window.BBAI.control(sim, r, 5*window.BB.DT); }); } window.BB.advance(sim); S.step++; n++; }
  return {phase: sim.phase, t: +sim.t.toFixed(2), n}; }'''
def log(*a): print(*a, flush=True)
async def main():
    html = open('dist/biobuzz-sim.html').read()
    open('dist/_test.html', 'w').write(SK + html + '</body></html>')
    three = open('node_modules/three/build/three.min.js').read()
    fails = []
    def check(c, msg):
        if not c: fails.append(msg); log('FAIL', msg)
        else: log('ok  ', msg)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
        async def route(r):
            u = r.request.url
            if 'three.min.js' in u: await r.fulfill(body=three, content_type='application/javascript')
            elif 'fonts.g' in u: await r.fulfill(body='', content_type='text/css')
            else: await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('file:///home/claude/biobuzz/dist/_test.html')
        await pg.wait_for_function('document.getElementById("loading").hidden === true', timeout=120000)
        await pg.wait_for_timeout(1200)
        st = await pg.evaluate('() => ({kb: window.BBAPP.set.kbDrive, reset: window.BBAPP.set.keys.global.reset, d1: window.BBAPP.set.dDev1, cad: window.BBR.cad.ready})')
        check(st['kb'] is False and st['reset'] == 'Delete' and st['d1'] == 'gp0', f'defaults: keyboard driving off, reset on Delete, duo on gamepads {st}')
        # ---------------- AUTO editor
        await pg.click('.nav-btn[data-screen="auto"]'); await pg.wait_for_timeout(1500)
        info = await pg.evaluate('() => ({id: window.BBAE.id, steps: window.BBAE.plan.steps.length, opts: document.getElementById("aeList").options.length, w: document.getElementById("aeMap").width})')
        log('editor', info)
        check(info['steps'] > 0 and info['opts'] >= 3 and info['w'] > 300, 'editor opens with the example plans and a sized map')
        await pg.screenshot(path='shots/v4_1_editor.png', timeout=150000)
        # click on the map: adds a "drive to" step (a copy of the example is made first)
        box = await pg.locator('#aeMap').bounding_box()
        n0 = info['steps']
        await pg.mouse.click(box['x'] + box['width'] * 0.30, box['y'] + box['height'] * 0.72)
        await pg.wait_for_timeout(400)
        info2 = await pg.evaluate('() => ({id: window.BBAE.id, steps: window.BBAE.plan.steps.map(s => s.k), sel: window.BBAE.sel, custom: window.BBAPP.autos.list.length, note: document.getElementById("aeNote").textContent})')
        log('after click', info2)
        check(len(info2['steps']) == n0 + 1 and info2['custom'] == 1 and not info2['id'].startswith('ex_'), 'map click adds a step to an own copy of the example')
        # drag that waypoint somewhere else
        sel = info2['sel']
        pos = await pg.evaluate(f'() => {{ const n = window.BBAE.nodes[{sel}]; const cv = document.getElementById("aeMap"); const r = cv.getBoundingClientRect(); return [r.left + n.hit.x * r.width / cv.width, r.top + n.hit.y * r.height / cv.height, n.x, n.y]; }}')
        await pg.mouse.move(pos[0], pos[1]); await pg.mouse.down(); await pg.mouse.move(pos[0] + 40, pos[1] - 30, steps=6); await pg.mouse.up()
        await pg.wait_for_timeout(300)
        moved = await pg.evaluate(f'() => {{ const s = window.BBAE.plan.steps[{sel}]; return [s.x, s.y]; }}')
        log('dragged', pos[2:], '->', moved)
        check(abs(moved[0] - pos[2]) > 3 or abs(moved[1] - pos[3]) > 3, 'waypoint can be dragged')
        # add steps with the buttons, edit a parameter
        await pg.click('#aeAdd [data-add="shoot"]'); await pg.wait_for_timeout(200)
        await pg.click('#aeAdd [data-add="wait"]'); await pg.wait_for_timeout(200)
        await pg.fill('#aeSteps .ae-step.sel input[data-p="s"]', '0.5'); await pg.press('#aeSteps .ae-step.sel input[data-p="s"]', 'Enter'); await pg.wait_for_timeout(200)
        ks = await pg.evaluate('() => window.BBAE.plan.steps.map(s => s.k + (s.k === "wait" ? s.s : ""))')
        log('steps now', ks)
        check('wait0.5' in ks and ks[-1] == 'park', 'buttons add steps before PARK and parameters save')
        # warnings, share code round trip
        await pg.click('#aeCopy'); await pg.wait_for_timeout(200)
        code = await pg.input_value('#aeCode')
        check(code.startswith('BBA1.') and len(code) < 800, f'share code ({len(code)} chars)')
        await pg.fill('#aeCode', code); await pg.click('#aeImport'); await pg.wait_for_timeout(300)
        imp = await pg.evaluate('() => ({n: window.BBAPP.autos.list.length, same: JSON.stringify(window.BBAE.plan.steps) === JSON.stringify(window.BBAPP.autos.list[0].plan.steps)})')
        check(imp['n'] == 2 and imp['same'], f'import makes an identical copy {imp}')
        # shot map
        await pg.check('#aeHeat'); await pg.wait_for_function('!!window.BBAE.heat', timeout=60000)
        check(True, 'shot map computed')
        # run the preview at "Tức thì"
        await pg.click('#aeSpeed button[data-v="0"]')
        await pg.click('#aeRun')
        await pg.wait_for_function('!window.BBAE.run && !!window.BBAE.lastRun', timeout=120000)
        res = await pg.evaluate('() => { const L = window.BBAE.lastRun; return {pts: L.pts, shots: L.shots, made: L.made, log: L.log.map(l => [l.i, +(l.t - l.t0).toFixed(1), l.ok, l.text]), html: document.getElementById("aeResult").innerText.slice(0, 200)}; }')
        log('preview', json.dumps(res, ensure_ascii=False))
        check(res['shots'] >= 1 and len(res['log']) >= 3, 'preview runs the plan with the real engine')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/v4_2_editor_run.png', timeout=150000)
        el = await pg.query_selector('.autoed'); await el.screenshot(path='shots/v4_3_editor_panel.png', timeout=150000)
        # use it in a match: the human robot starts where the plan says and runs it in AUTO
        await pg.click('#aeTry'); await pg.wait_for_timeout(1500)
        m = await pg.evaluate('() => { const S = window.BBAPP, me = S.primary(), br = me.brain; return {mode: S.mode, routine: br.routine, steps: br.plan && br.plan.steps.length, x: +me.x.toFixed(1), y: +me.y.toFixed(1), psi: +(me.psi*57.3).toFixed(0), al: me.alliance}; }')
        log('match', m)
        check(m['mode'] == 'play' and m['routine'] == 'plan', 'the match runs the plan as your AUTO')
        log(await pg.evaluate(ADV, 29.9))
        pl = await pg.evaluate('() => { const me = window.BBAPP.primary(); return {i: me.brain.ps && me.brain.ps.i, log: me.brain.ps && me.brain.ps.log.length, shots: me.stats.shots}; }')
        log('after AUTO', pl)
        check(pl['log'] and pl['log'] >= 2, 'plan steps executed during the match AUTO')
        await pg.evaluate('() => { document.getElementById("banner").hidden = true; }')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/v4_4_match_auto.png', timeout=150000)
        # ---------------- controls: keyboard off by default, notice without a gamepad, turning it on
        pw = await pg.evaluate('() => !document.getElementById("padWarn").hidden')
        check(pw, 'no-gamepad notice shows when keyboard driving is off')
        log(await pg.evaluate(ADV, 42))
        await pg.keyboard.down('KeyW'); await pg.wait_for_timeout(600)
        v0 = await pg.evaluate('() => { const i = window.BBIN.player("kbA", "both"); return i.my; }')
        await pg.keyboard.up('KeyW')
        check(v0 == 0, 'W does nothing while keyboard driving is off')
        await pg.click('#padWarnKb'); await pg.wait_for_timeout(300)
        await pg.keyboard.down('KeyW')
        ramp = []
        for k in range(6):
            await pg.evaluate('(t) => window.BBAPP._frame(t)', 100000 + k * 33)
            ramp.append(await pg.evaluate('() => +window.BBIN.player("kbA", "both").my.toFixed(2)'))
        await pg.keyboard.up('KeyW')
        log('keyboard ramp', ramp)
        check(ramp[0] < 1 and ramp[-1] == 1 and ramp == sorted(ramp), 'keyboard axis ramps up smoothly to full')
        check(await pg.evaluate('() => document.getElementById("padWarn").hidden'), 'notice hides after turning keyboard driving on')
        # input method packets are dropped and noticed
        await pg.evaluate('''() => { const e = new KeyboardEvent('keydown', {key: 'ư', code: '', bubbles: true}); window.dispatchEvent(e); }''')
        ime = await pg.evaluate('() => window.BBIN.imeN')
        check(ime >= 1, 'Vietnamese input-method key packets are detected')
        # ---------------- camera: drag, wheel, double click, per-mode memory
        await pg.keyboard.press('Digit3'); await pg.wait_for_timeout(500)
        c = await pg.locator('#gl').bounding_box()
        cx, cy = c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.6
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx + 160, cy + 60, steps=8); await pg.mouse.up()
        await pg.mouse.wheel(0, 400); await pg.wait_for_timeout(700)
        adj = await pg.evaluate('() => JSON.parse(JSON.stringify(window.BBR.view.adj))')
        log('camera adj', adj)
        check('broadcast' in adj and abs(adj['broadcast']['yaw']) > 0.3 and adj['broadcast']['zoom'] > 1.2, 'drag orbits and the wheel zooms the broadcast view')
        await pg.screenshot(path='shots/v4_5_cam_adjusted.png', timeout=150000)
        await pg.mouse.move(cx, cy); await pg.keyboard.down('Shift'); await pg.mouse.down(); await pg.mouse.move(cx - 120, cy + 40, steps=6); await pg.mouse.up(); await pg.keyboard.up('Shift')
        adj2 = await pg.evaluate('() => window.BBR.view.adj.broadcast')
        check(abs(adj2['px']) + abs(adj2['pz']) > 5, 'shift-drag slides the view')
        await pg.wait_for_timeout(600)
        saved = await pg.evaluate('() => JSON.parse(localStorage.getItem("biobuzz-sim-v2")).camAdj')
        check('broadcast' in saved, 'camera offsets are remembered')
        await pg.mouse.dblclick(cx, cy); await pg.wait_for_timeout(300)
        check(await pg.evaluate('() => !window.BBR.camAdjusted("broadcast")'), 'double click resets the view')
        # drive frame follows the robot in the chase camera
        await pg.keyboard.press('Digit2'); await pg.wait_for_timeout(300)
        df = await pg.evaluate('() => { const me = window.BBAPP.primary(); const f = window.BBR.driveFrame("follow", me); const q = window.BBR.poseOf(me); return [f.fx, f.fy, Math.cos(q.psi), Math.sin(q.psi)]; }')
        check(abs(df[0] - df[2]) < 1e-6 and abs(df[1] - df[3]) < 1e-6, 'chase camera drives along the robot heading')
        # paused camera editing
        await pg.evaluate('() => { const S = window.BBAPP; S.setCam("follow"); if (!S.paused) S.togglePause(); }'); await pg.wait_for_timeout(300)
        await pg.click('#btnCamEdit'); await pg.wait_for_timeout(300)
        ce = await pg.evaluate('() => ({edit: window.BBAPP.camEdit, bar: !document.getElementById("camEdit").hidden, pause: document.getElementById("pause").hidden})')
        await pg.keyboard.down('ArrowLeft'); await pg.wait_for_timeout(400)
        for k in range(8): await pg.evaluate('(t) => window.BBAPP._frame(t)', 200000 + k * 33)
        await pg.keyboard.up('ArrowLeft')
        await pg.screenshot(path='shots/v4_6_camedit.png', timeout=150000)
        yaw = await pg.evaluate('() => window.BBR.camAdj("follow").yaw')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        for k in range(2): await pg.evaluate('(t) => window.BBAPP._frame(t)', 300000 + k * 33)
        ce2 = await pg.evaluate('() => ({edit: window.BBAPP.camEdit, pause: !document.getElementById("pause").hidden, paused: window.BBAPP.paused})')
        log('cam edit', ce, 'yaw', yaw, ce2)
        check(ce['edit'] and ce['bar'] and ce['pause'] and abs(yaw) > 0.05 and not ce2['edit'] and ce2['pause'], 'pause menu camera editing with keys, Esc returns to the menu')
        await pg.click('#btnResume'); await pg.wait_for_timeout(200)
        # interpolation state exists and the frame loop keeps running
        it = await pg.evaluate('() => { const S = window.BBAPP; for (let k = 0; k < 5; k++) S._frame(400000 + k * 16.7); const me = S.primary(), q = window.BBR.poseOf(me); return {d: Math.hypot(q.x - me.x, q.y - me.y), dyn: window.BBR.dyn.scale}; }')
        log('interp', it)
        check(it['d'] < 3, 'drawn pose stays within a physics step of the real one')
        # settings rows
        await pg.evaluate('() => window.BBAPP.toMenu("settings")'); await pg.wait_for_timeout(600)
        rows = await pg.evaluate('() => Array.from(document.querySelectorAll("#sBody .srow b")).map(b => b.textContent)')
        await pg.click('#sTabs button[data-tab="view"]'); await pg.wait_for_timeout(300)
        rows += await pg.evaluate('() => Array.from(document.querySelectorAll("#sBody .srow b")).map(b => b.textContent)')
        log('settings', rows)
        check(any('bàn phím' in r for r in rows) and any('FOV' in r for r in rows) and any('độ phân giải' in r for r in rows), 'settings expose keyboard driving, FOV and auto resolution')
        await pg.screenshot(path='shots/v4_7_settings.png', timeout=150000)
        await pg.evaluate('() => window.BBAPP.toMenu("match")'); await pg.wait_for_timeout(600)
        opts = await pg.evaluate('() => Array.from(document.getElementById("mAuto").options).map(o => o.value)')
        check(any(o.startswith('plan:') for o in opts), f'match setup lists the plans ({len(opts)} options)')
        await pg.screenshot(path='shots/v4_8_match_setup.png', timeout=150000)
        bad = [e for e in errs if 'PAGEERROR' in e or 'error' in e.lower()]
        log('\n'.join(errs[:30]) or 'no console errors')
        check(not bad, 'no page errors')
        await b.close()
    log('FAILS:', fails if fails else 'none')
asyncio.run(main())
