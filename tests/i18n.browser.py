"""Japanese UI and English fallback with real MathJax CDN rendering."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from importlib.metadata import version
import argparse, json, re, sys, html

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8788/')
parser.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
report = {'at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
          'browser': args.browser, 'playwright': version('playwright'), 'checks': [], 'errors': []}
saved = {'font':'fira','numerals':'lining','division':'inline','symbolMotion':True,'structureMotion':True,'symbolMorph':False}
legal = [html.unescape(text).removeprefix('\n') for text in re.findall(r'<pre(?: [^>]*)?>(.*?)</pre>', (ROOT/'app.html').read_text(), re.S)]
query = '?v=1&t=123430&font=stix2&numerals=oldstyle&division=fraction'
license_content = None

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    report['browserVersion'] = browser.version
    for language in ['ja-JP', 'en-US', 'fr-FR']:
        locale = 'ja' if language == 'ja-JP' else 'en'
        ctx = browser.new_context(locale=language, timezone_id='Asia/Tokyo', viewport={'width':390,'height':844})
        ctx.add_init_script('localStorage.setItem("formula-clock-display-v2",'+json.dumps(json.dumps(saved))+');')
        if language == 'fr-FR':
            ctx.add_init_script('Object.defineProperty(navigator,"languages",{value:["fr-FR","ja-JP"]});')
        page = ctx.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.goto(args.url+query, wait_until='domcontentloaded')
        page.wait_for_function('window.FormulaClock && !document.querySelector("#share").disabled', timeout=45000)
        assert page.locator('html').get_attribute('lang') == locale
        assert page.evaluate('FormulaClock.diagnostics().locale') == locale
        assert page.evaluate('FormulaClock.state.paused && FormulaClock.state.preview')
        assert page.evaluate('FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds)') == '123430'
        assert page.evaluate('JSON.parse(localStorage.getItem("formula-clock-display-v2"))') == saved
        assert page.evaluate('FormulaClock.state.display.font') == 'stix2'
        report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
        assert report['mathjax'] == '4.1.3'
        page.evaluate('window.originalDigits=FormulaClock.digits')
        page.click('#settings-open')
        assert page.locator('#settings-title').inner_text() == ('設定' if locale == 'ja' else 'Settings')
        assert page.locator('#font-choice').get_attribute('aria-label') == ('数式のフォント' if locale == 'ja' else 'Formula font')
        page.click('#advanced-settings > summary')
        if locale == 'en':
            assert not re.search(r'[ぁ-んァ-ヶ一-龠]',page.locator('#settings').inner_text())
        for width in [320,390,768]:
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert page.locator('#settings').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
            assert page.locator('#structure-motion').bounding_box()['width'] >= 15
            page.screenshot(path=str(args.output_dir/f'{language}-settings-{width}.png'))
        page.click('#licenses-open')
        assert page.locator('#licenses-title').inner_text() == 'LICENSE'
        assert page.locator('.license-content pre').all_text_contents() == legal
        assert page.locator('.license-content').get_attribute('lang') == 'ja'
        if license_content is None:
            license_content = page.locator('.license-content').text_content()
        assert page.locator('.license-content').text_content() == license_content
        page.click('#licenses-close')
        page.keyboard.press('Escape')
        page.evaluate('''() => {
          Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{window.copied=url;}}});
        }''')
        page.click('#share')
        page.wait_for_function('window.copied')
        assert page.evaluate('new URL(copied).search') == ''
        assert re.fullmatch(r'/s/[A-Za-z0-9]{10}',page.evaluate('new URL(copied).pathname'))
        assert page.locator('#share-status').inner_text() == ('共有URLをコピーしました' if locale == 'ja' else 'Share link copied')
        page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Test denial'))}})")
        page.click('#share')
        assert page.locator('#share-title').inner_text() == ('Share' if locale == 'ja' else 'Share this view')
        page.keyboard.press('Escape')
        assert page.locator('#play-pause,#slow').count() == 0
        assert page.locator('#transport button').count() == 1
        assert page.locator('#go-live').inner_text() == ('現在時刻へ' if locale == 'ja' else 'Current time')
        assert page.locator('.seek-hint').inner_text() == ('← → 1秒ずつ移動' if locale == 'ja' else '← → Step by 1 second')
        assert page.evaluate('FormulaClock.state.paused')
        for time, font, mode in [('235910','stix2','formula'),('123459','fira','formula'),('004159','euler','time')]:
            page.evaluate('([time,font])=>{FormulaClock.setDisplay({font});FormulaClock.preview(FormulaShare.localDate(time),true)}',[time,font])
            # A cache miss may first render this time as a loading clock.
            # Sharing is enabled only once data and the final frame are ready.
            page.wait_for_function('([time,font])=>{const l=FormulaClock.state.layout;return l?.code===time.slice(0,4)&&l.seconds===Number(time.slice(4))&&l.display.font===font&&!document.querySelector("#share").disabled}',arg=[time,font],timeout=45000)
            assert page.evaluate('FormulaClock.state.layout.mode') == mode, page.evaluate('FormulaClock.state')
            assert page.evaluate('FormulaClock.digits.every((digit,i)=>digit===originalDigits[i])')
            assert page.evaluate('FormulaClock.diagnostics().glyphs.every(g=>g.inStage)')
        page.evaluate("FormulaClock.setDataProvider({getMinute:async()=>{throw new Error('Test data failure')}})")
        page.wait_for_function('FormulaClock.state.dataError')
        assert page.locator('#state-label').text_content() == ('式データを読み込めなかった。通常の時計を表示中。' if locale == 'ja' else 'Could not load formula data. Showing the clock.')
        report['checks'].append({'language':language,'locale':locale,'savedPreferencesUnchanged':True,'shortShareUrl':True,
          'settingsControlsAndMessages':True,'legalTextUnchanged':True,'licenseExplanationsAlwaysJapanese':True,'narrowWidths':[320,390,768],'persistentDigitsAndLayouts':True})
        ctx.close()
    ctx = browser.new_context(locale='en-US')
    page = ctx.new_page()
    page.goto((ROOT/'index.html').as_uri()+query)
    page.wait_for_function('window.FormulaClock?.state.layout',timeout=45000)
    assert page.locator('html').get_attribute('lang') == 'en'
    assert page.locator('#settings-title').text_content() == 'Settings'
    assert page.locator('#share').is_hidden()
    assert page.evaluate('FormulaClock.state.paused')
    page.click('#go-live')
    assert not page.evaluate('FormulaClock.state.preview')
    assert page.url == (ROOT/'index.html').as_uri()
    report['standaloneEnglish'] = True
    ctx.close()
    browser.close()
assert not report['errors'], report['errors']
(args.output_dir/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
