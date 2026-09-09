"""Independent structure/morph options sharing one prerequisite, including restoration."""
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
from itertools import product
from playwright.sync_api import sync_playwright
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument('--url', default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
ap.add_argument('--output-dir', type=Path, default=Path('test-results/motion-settings'))
args = ap.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
keys = ['symbolMotion', 'structureMotion', 'symbolMorph']
selectors = ['#symbol-motion', '#structure-motion', '#symbol-morph']
report = {'at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
          'browser': args.browser, 'playwright': version('playwright'), 'url': args.url, 'checks': []}
errors = []

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch()
    report['browserVersion'] = browser.version
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, timezone_id='Asia/Tokyo')
    page.on('pageerror', lambda e: errors.append(str(e)))

    def ready():
        page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout', timeout=35000)

    def check(bits, saved=False):
        opts = dict(zip(keys, bits))
        page.wait_for_function('(opts)=>Object.entries(opts).every(([k,v])=>FormulaClock.state.layout.display[k]===v)', arg=opts)
        assert page.evaluate('(keys)=>keys.map(k=>FormulaClock.state.display[k])', keys) == list(bits)
        for selector, checked, disabled in zip(selectors, bits, [False, not bits[0], not bits[0]]):
            assert page.locator(selector).is_checked() == checked
            assert page.locator(selector).is_disabled() == disabled
        if saved:
            assert page.evaluate('(keys)=>{const s=JSON.parse(localStorage.getItem("formula-clock-display-v2"));return keys.map(k=>s[k])}', keys) == list(bits)

    def display(**opts):
        page.evaluate('(opts)=>FormulaClock.setDisplay(opts)', opts)

    def preview(time):
        page.evaluate('(time)=>FormulaClock.preview("2026-09-09T"+time+"+09:00",true)', time)
        page.wait_for_function('([c,s])=>FormulaClock.state.layout.code===c && FormulaClock.state.layout.seconds===s && !document.querySelector("#stage").classList.contains("loading")', arg=[time[:2]+time[3:5], int(time[6:])])

    page.goto(args.url)
    ready()
    report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax'] == '4.1.3'
    preview('12:34:08')
    page.click('#settings-open')
    page.click('#advanced-settings summary')
    assert page.locator('#engine-status,.experimental-option small').count() == 0
    assert page.locator('#render-status').get_attribute('hidden') is not None
    assert 'MathJax' not in page.locator('#advanced-settings').inner_text()
    check([False, False, False])
    page.screenshot(path=str(args.output_dir/'desktop-disabled.png'))
    for index, bits in [(0, [True, False, False]), (2, [True, False, True]), (1, [True, True, True])]:
        page.check(selectors[index])
        check(bits, saved=True)
    page.uncheck(selectors[1]); check([True, False, True], saved=True)
    page.check(selectors[1]); check([True, True, True], saved=True)
    page.uncheck(selectors[2]); check([True, True, False], saved=True)
    page.check(selectors[2]); check([True, True, True], saved=True)
    page.uncheck(selectors[0]); check([False, False, False], saved=True)
    page.check(selectors[0]); check([True, False, False], saved=True)
    page.screenshot(path=str(args.output_dir/'desktop-basic.png'))
    page.keyboard.press('Escape')
    page.reload(); ready(); check([True, False, False])
    report['checks'].append('Basic motion enables both optional controls; structure and morph can each toggle without changing the other; disabling basic motion clears and disables both, with no automatic restoration; effective values persist')

    # Old releases allowed all eight combinations. Restoring any of them must
    # normalize only dependents, without silently enabling their prerequisites.
    migrations = []
    for basic, structure, morph in product([False, True], repeat=3):
        raw = dict(zip(keys, [basic, structure, morph]))
        page.evaluate('(raw)=>localStorage.setItem("formula-clock-display-v2",JSON.stringify(raw))', raw)
        page.reload(); ready()
        expected = [basic, basic and structure, basic and morph]
        check(expected)
        display(**raw); check(expected, saved=True)
        migrations.append({'saved': raw, 'effective': dict(zip(keys, expected))})
    report['restoredCombinations'] = migrations
    report['checks'].append('All eight legacy saved combinations and all eight API combinations normalize consistently; invalid option types still reject')
    before = page.evaluate('FormulaClock.state.display')
    assert page.evaluate('''async()=>{
      try {await FormulaClock.setDisplay({symbolMotion:false,structureMotion:'invalid',symbolMorph:true});return false;}
      catch(e){return e instanceof TypeError;}
    }''')
    assert page.evaluate('FormulaClock.state.display') == before

    page.evaluate('window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector("#equal-sign")')
    page.emulate_media(reduced_motion='reduce')
    for font, numerals in [('stix2', 'oldstyle'), ('termes', 'lining'), ('fira', 'oldstyle'), ('euler', 'lining')]:
        display(font=font, numerals=numerals, symbolMotion=True, structureMotion=True, symbolMorph=True)
        for time in ['12:34:08', '12:34:59', '00:00:08']:
            preview(time)
            page.wait_for_function('([f,n])=>FormulaClock.state.layout.display.font===f && FormulaClock.state.layout.display.numerals===n', arg=[font, numerals])
            assert not page.evaluate('FormulaClock.state.engineError')
            assert all(g['inStage'] for g in page.evaluate('FormulaClock.diagnostics().glyphs'))
            assert page.locator('#render-status').get_attribute('hidden') is not None
    report['checks'].append('Fractions, powers and plain time work across all four font families with persistent digits; normal render status remains hidden')

    # Trigger a real same-gap + to × morph, then disable each stage while it runs.
    page.evaluate('''()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
      const formulas={10:B('add',B('add',B('add',L(0),L(1)),L(2)),L(3)),
        9:B('add',B('add',B('mul',L(0),L(1)),L(2)),L(3))};
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,
        seconds:Array.from({length:60},(_,s)=>hhmm==='1234'?formulas[s]||null:null)};}});
    }''')
    display(font='stix2', numerals='oldstyle')
    for disabled_key, expected, count in [('symbolMorph', [True, True, False], 3), ('structureMotion', [True, False, True], 3), ('symbolMotion', [False, False,False], 0)]:
        page.emulate_media(reduced_motion='reduce')
        display(symbolMotion=True, structureMotion=True, symbolMorph=True)
        preview('12:34:10')
        page.emulate_media(reduced_motion='no-preference')
        # The media-change handler redraws instantly; let it finish before
        # starting the animation whose interruption we are measuring.
        page.wait_for_timeout(100)
        preview('12:34:09')
        page.wait_for_function('document.querySelector("[data-morphing]")')
        display(**{disabled_key: False}); check(expected, saved=True)
        page.wait_for_timeout(750)
        assert page.locator('[data-morphing],[data-morph-glyph]').count() == 0
        assert page.locator('#operator-root > g').count() == count
        assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual')
    report['checks'].append('Changing each setting during an active morph settles without temporary glyphs, preserves digit/equality nodes and leaves only the allowed symbols; disabling structure preserves the morph setting')

    page.set_viewport_size({'width': 320, 'height': 640})
    page.click('#settings-open'); page.click('#advanced-settings summary')
    page.locator('#settings').evaluate('(el)=>el.scrollTop=0')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.locator('#structure-motion').is_disabled() and page.locator('#symbol-morph').is_disabled()
    assert float(page.locator('#structure-motion').evaluate('(el)=>getComputedStyle(el.closest("label")).opacity')) < .6
    page.screenshot(path=str(args.output_dir/'mobile-disabled.png'))
    page.keyboard.press('Escape')

    # Keep actionable fallback diagnostics after removing the engine banner.
    page.evaluate('''()=>{
      const prototype=FormulaTypesetter.Typesetter.prototype;window.originalFrame=prototype.frame;
      prototype.frame=function(ast,...args){return ast?Promise.reject(new Error('Injected expression failure')):originalFrame.call(this,ast,...args);};
      FormulaClock.setDisplay({});
    }''')
    page.wait_for_function('FormulaClock.state.engineError?.includes("Injected expression failure") && FormulaClock.state.layout.mode==="time"')
    assert page.locator('#render-status').get_attribute('hidden') is None
    assert '通常の時計' in page.locator('#render-status').text_content()
    page.evaluate('FormulaTypesetter.Typesetter.prototype.frame=originalFrame;FormulaClock.setDisplay({})')
    page.wait_for_function('!FormulaClock.state.engineError && FormulaClock.state.layout.mode==="formula"')
    assert page.locator('#render-status').get_attribute('hidden') is not None

    failed = browser.new_page(timezone_id='Asia/Tokyo')
    failed.on('pageerror', lambda e: errors.append(str(e)))
    failed.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
    failed.goto(args.url)
    failed.wait_for_function('window.FormulaClock?.state.engineError')
    assert failed.locator('#plain-time').is_visible()
    assert failed.locator('#render-status').get_attribute('hidden') is None
    assert '通常の時計' in failed.locator('#render-status').text_content()
    report['checks'].append('Mobile disabled states are muted and fit; expression failure falls back to the SVG clock and recovers; CDN failure keeps the plain clock and failure message')
    failed.close()
    assert not errors, errors
    report['pageErrors'] = errors
    browser.close()

(args.output_dir/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
