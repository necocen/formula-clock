"""Compare the server's actual glyph paths/metrics with the delivered CDN engine."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, sys
from datetime import datetime, timezone
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8788/')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
parser.add_argument('--render-results', type=Path, default=ROOT/'test-results/share-og/render-results.json')
parser.add_argument('--output-dir', type=Path)
args = parser.parse_args()
output = args.output_dir or ROOT/'test-results'/f'og-parity-{args.browser}'
output.mkdir(parents=True, exist_ok=True)
server = json.loads(args.render_results.read_text())
cases, errors, requests = [], [], []
with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1200, 'height': 800}, timezone_id='Asia/Tokyo', reduced_motion='reduce')
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(args.url+'?t=123430', wait_until='domcontentloaded')
    page.wait_for_function('window.FormulaClock?.state.layout && !document.querySelector("#share").disabled', timeout=45000)
    # The static renderer omits motion markers; compare the same TeX settings.
    page.evaluate('FormulaClock.setDisplay({symbolMotion:false,structureMotion:false,symbolMorph:false})')
    profile = None
    for sample in server['cases']:
        state = sample['state']
        current = [state['font'], state['numerals'], state['division']]
        if profile != current:
            page.evaluate('([font,numerals,division])=>FormulaClock.setDisplay({font,numerals,division})', current)
            profile = current
        t = state['t']
        page.evaluate('(t)=>FormulaClock.preview(FormulaShare.localDate(t),true)', t)
        page.wait_for_function('s=>{const l=FormulaClock.state.layout;return l?.code===s.t.slice(0,4)&&l.seconds===Number(s.t.slice(4))&&l.display.font===s.font&&l.display.numerals===s.numerals&&l.display.division===s.division&&!document.querySelector("#share").disabled}', arg=state, timeout=45000)
        actual = page.evaluate('''() => {
          const layout=FormulaClock.state.layout;
          const slots=[...FormulaClock.digits,...document.querySelectorAll('#math-scene .answer-digit')].map(group=>[...group.querySelectorAll('path')].map(path=>path.getAttribute('d')));
          return {tex:layout.tex,axisY:layout.localAxisY,viewBox:layout.viewBox,typography:layout.typography,slots};
        }''')
        assert actual['tex'] == sample['tex'], sample['name']
        assert actual['slots'] == sample['slots'], sample['name']
        assert abs(actual['axisY']-sample['axisY']) < .1, (sample['name'], actual['axisY'], sample['axisY'])
        for key in ['x', 'y', 'w', 'h']:
            assert abs(actual['viewBox'][key]-sample['viewBox'][key]) < .1, (sample['name'], key, actual['viewBox'], sample['viewBox'])
        for key in ['numericAxisEm', 'axisEm', 'equalCenterY']:
            assert abs(actual['typography'][key]-sample['typography'][key]) < .001, (sample['name'], key)
        cases.append({'name': sample['name'], 'glyphsMatch': True, 'axisDelta': actual['axisY']-sample['axisY']})
        if state['division'] == 'fraction' and t in ['123430', '100836', '022033', '004159']:
            page.locator('#stage').screenshot(path=str(output/(sample['name']+'.png')))
    report = {'command': sys.argv, 'at': datetime.now(timezone.utc).isoformat(), 'browser': args.browser, 'browserVersion': browser.version,
              'playwright': version('playwright'), 'mathjax': page.evaluate('FormulaClock.diagnostics().mathjax'), 'cases': cases, 'errors': errors, 'requests': requests}
    ctx.close()
    browser.close()
assert not errors, errors
(output/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'browser': args.browser, 'version': report['browserVersion'], 'mathjax': report['mathjax'], 'cases': len(cases), 'errors': errors}, indent=2))
