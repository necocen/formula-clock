"""Native fullscreen and the unavailable/rejected API paths, with the real CDN app."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from importlib.metadata import version
import argparse, json, sys

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8788/')
parser.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
report = {'at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
          'browser': args.browser, 'playwright': version('playwright'), 'checks': [], 'errors': []}

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    report['browserVersion'] = browser.version
    for scenario in ['native', 'unavailable', 'policy-disabled', 'rejected', 'prefixed']:
        ctx = browser.new_context(locale='ja-JP', viewport={'width': 390, 'height': 844}, has_touch=True)
        if scenario in ['unavailable', 'policy-disabled']:
            ctx.add_init_script('''Object.defineProperty(document,'fullscreenEnabled',{value:false});
              Object.defineProperty(document,'webkitFullscreenEnabled',{value:false});''')
        if scenario == 'unavailable':
            ctx.add_init_script('''Element.prototype.requestFullscreen=undefined;
              Element.prototype.webkitRequestFullscreen=undefined;''')
        if scenario == 'rejected':
            ctx.add_init_script('''Object.defineProperty(document,'fullscreenEnabled',{value:true});
              Element.prototype.requestFullscreen=()=>Promise.reject(new TypeError('Test rejection'));''')
        if scenario == 'prefixed':
            ctx.add_init_script('''Object.defineProperty(document,'fullscreenEnabled',{value:false});
              Object.defineProperty(document,'webkitFullscreenEnabled',{value:true});
              Object.defineProperty(document,'webkitFullscreenElement',{writable:true,value:null});
              Element.prototype.webkitRequestFullscreen=function(){document.webkitFullscreenElement=this;document.dispatchEvent(new Event('webkitfullscreenchange'));};
              document.webkitExitFullscreen=()=>{document.webkitFullscreenElement=null;document.dispatchEvent(new Event('webkitfullscreenchange'));};''')
        page = ctx.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.goto(args.url+'?t=123430', wait_until='domcontentloaded')
        page.wait_for_function('window.FormulaClock')
        button = page.locator('#fullscreen')
        if scenario in ['unavailable', 'policy-disabled']:
            assert button.is_hidden()
            page.keyboard.press('f')
            assert not page.evaluate("document.body.classList.contains('fullscreen')")
            assert not page.evaluate('document.fullscreenElement || document.webkitFullscreenElement')
        elif scenario == 'rejected':
            assert button.is_visible()
            page.click('#fullscreen')
            page.wait_for_function('document.querySelector("#share-status").textContent.includes("切り替えられませんでした")')
            assert button.get_attribute('aria-pressed') == 'false'
            assert not page.evaluate("document.body.classList.contains('fullscreen')")
        elif button.is_visible():
            page.click('#fullscreen')
            page.wait_for_function('document.fullscreenElement || document.webkitFullscreenElement')
            assert button.get_attribute('aria-pressed') == 'true'
            assert button.get_attribute('aria-label') == '全画面表示を終了'
            page.click('#fullscreen')
            page.wait_for_function('!document.fullscreenElement && !document.webkitFullscreenElement')
            assert button.get_attribute('aria-pressed') == 'false'
        else:
            assert scenario == 'native'
            report['nativeUnavailable'] = True
        if scenario == 'native':
            page.wait_for_function('FormulaClock.state.layout && !document.querySelector("#share").disabled', timeout=45000)
            report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
            for t, font, mode in [('235910', 'stix2', 'formula'), ('123459', 'fira', 'formula'), ('004159', 'euler', 'time')]:
                page.evaluate('([t,font])=>{FormulaClock.setDisplay({font});FormulaClock.preview(FormulaShare.localDate(t),true)}', [t,font])
                page.wait_for_function('([t,font])=>{const l=FormulaClock.state.layout;return l?.code===t.slice(0,4)&&l.seconds===Number(t.slice(4))&&l.display.font===font}', arg=[t,font], timeout=45000)
                assert page.evaluate('FormulaClock.state.layout.mode') == mode
                assert page.evaluate('FormulaClock.diagnostics().glyphs.every(g=>g.inStage)')
            report['checks'].append('CDN fractions, exponent, ordinary clock and font changes remain visible at 390px')
        report['checks'].append(scenario)
        page.screenshot(path=str(args.output_dir/(scenario+'.png')))
        ctx.close()
    browser.close()
assert not report['errors'], report['errors']
(args.output_dir/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
