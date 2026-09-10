"""Shared-link startup and user-activation-sensitive controls, using MathJax 4 CDN."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, sys, platform, re
from datetime import datetime, timezone
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8788/')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
parser.add_argument('--output-dir', type=Path)
args = parser.parse_args()
output = args.output_dir or ROOT/'test-results'/f'share-{args.browser}'
output.mkdir(parents=True, exist_ok=True)
saved = {'font': 'fira', 'numerals': 'lining', 'division': 'inline', 'symbolMotion': True, 'structureMotion': True, 'symbolMorph': True}
checks, errors, requests = [], [], []
report = {'command': sys.argv, 'browser': args.browser, 'playwright': version('playwright'), 'python': platform.python_version(),
          'at': datetime.now(timezone.utc).isoformat(), 'checks': checks, 'errors': errors, 'requests': requests}

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    report['browserVersion'] = browser.version
    ctx = browser.new_context(locale='ja-JP', viewport={'width': 1200, 'height': 800}, timezone_id='Asia/Tokyo')
    ctx.add_init_script("localStorage.setItem('formula-clock-display-v2'," + json.dumps(json.dumps(saved)) + ");localStorage.setItem('formula-clock-audio-v1',JSON.stringify({enabled:true,volume:.25}));")
    # Observe the real fetch instead of Playwright routing, which can stall
    # MathJax's dynamically imported blob modules in WebKit.
    ctx.add_init_script('''window.shareLoadingChecks=[];const originalFetch=window.fetch;
      window.fetch=function(input,...args){
        if(String(input?.url||input).includes('/data/hours/')){
          shareLoadingChecks.push(document.querySelector('#share').disabled && FormulaClock.state.preview && FormulaClock.state.paused);
        }
        return originalFetch.call(this,input,...args);
      };''')
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(args.url + '?v=1&t=123430&font=stix2&numerals=oldstyle&division=fraction', wait_until='domcontentloaded')
    page.wait_for_function('window.FormulaClock')
    initial = page.evaluate('FormulaClock.state')
    assert initial['preview'] and initial['paused'] and initial['display']['font'] == 'stix2'
    assert page.evaluate('new Date(FormulaClock.state.now).getHours()') == 12
    assert page.evaluate('JSON.parse(localStorage.getItem("formula-clock-display-v2"))') == saved
    try:
        page.wait_for_function('!document.querySelector("#share").disabled', timeout=45000)
    except Exception:
        report['startup'] = page.evaluate('({state:FormulaClock.state,diagnostics:FormulaClock.diagnostics()})')
        report['loadingChecks'] = page.evaluate('shareLoadingChecks')
        (output/'failure.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        page.screenshot(path=str(output/'failure.png'))
        raise
    loading_checks = page.evaluate('shareLoadingChecks')
    assert loading_checks and all(loading_checks)
    assert page.evaluate('FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")') == '123430'
    assert page.evaluate('FormulaClock.state.audio.length') == 0
    checks.append('Shared state is applied before the first engine/frame; loading disables sharing; saved display/audio preferences stay intact')
    page.evaluate('''() => {
      window.originalShareDigits=FormulaClock.digits;
      window.shared=[];
      document.querySelector('#share').addEventListener('click',()=>{
        const l=FormulaClock.state.layout;window.beforeShare=l.code+String(l.seconds).padStart(2,'0');
      },true);
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        window.shared.push({...data,activation:navigator.userActivation?.isActive,paused:FormulaClock.state.paused});return Promise.resolve();
      }});
    }''')
    page.evaluate("FormulaClock.preview('2000-01-15T12:34:31',false)")
    page.wait_for_function('FormulaClock.state.layout.seconds===31')
    page.click('#share')
    page.wait_for_function('shared.length || document.querySelector("#share-dialog").open')
    if page.locator('#share-dialog').is_visible():
        page.click('#share-native')
        page.keyboard.press('Escape')
    actual = page.evaluate('({call:shared.at(-1),before:beforeShare,state:FormulaClock.state})')
    assert actual['call']['paused'] and actual['state']['paused']
    assert actual['call']['activation'] is not False
    assert re.search(r'/s/[A-Za-z0-9]{10}$', actual['call']['url'])
    # The sheet opens on ID acceptance, before the background KV write finishes.
    page.wait_for_timeout(2000)
    shared_html = ctx.request.get(actual['call']['url']).text()
    restored = json.loads(re.search(r'<script id="shared-clock" type="application/json">(.*?)</script>', shared_html).group(1))['snapshot']
    assert restored == {'v':1,'t':actual['before'],'font':'stix2','numerals':'oldstyle','division':'fraction','ast':actual['state']['layout']['ast']}
    assert page.evaluate('location.pathname+location.search') == '/'
    audio_count = len(actual['state']['audio'])
    page.wait_for_timeout(850)
    assert page.evaluate('FormulaClock.state.audio.length') == audio_count
    assert page.evaluate('FormulaClock.digits.every((d,i)=>d===originalShareDigits[i])')
    assert page.evaluate('FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")') == actual['before']
    checks.append('Sharing freezes the displayed second synchronously, keeps digit objects, cancels audio, and preserves native user activation')
    page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new DOMException('cancelled','AbortError'))})")
    page.click('#share')
    page.wait_for_timeout(100)
    assert page.locator('#share-dialog').is_hidden() and page.locator('#share-status').inner_text() == ''
    assert page.evaluate('FormulaClock.state.paused')
    page.evaluate('''() => {
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:url=>{window.copied=url;return Promise.resolve();}}});
      Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new Error('unavailable'))});
    }''')
    page.click('#share')
    page.wait_for_function('document.querySelector("#share-dialog").open')
    page.click('#share-copy')
    page.wait_for_function('window.copied')
    assert page.locator('#share-status').inner_text() == '共有URLをコピーしました'
    page.keyboard.press('Escape')
    page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:undefined});window.copied=null")
    page.click('#share')
    page.wait_for_function('window.copied')
    page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})")
    page.click('#share')
    assert page.locator('#share-dialog').is_visible()
    assert page.evaluate('document.activeElement.id') == 'share-url'
    assert page.locator('#share-url').evaluate('(input)=>input.selectionEnd-input.selectionStart===input.value.length')
    page.keyboard.press('Escape')
    assert page.locator('#share-dialog').is_hidden() and page.evaluate('document.activeElement.id') == 'share'
    checks.append('Native cancellation stays quiet; failed native sharing offers share/copy controls; unavailable native sharing copies; clipboard failure opens a selected URL with focus restored on close')
    page.click('#go-live')
    assert not page.evaluate('FormulaClock.state.preview')
    assert page.locator('#transport').is_hidden()
    page.evaluate("FormulaClock.preview('2000-01-15T00:41:59',true)")
    page.wait_for_function('FormulaClock.state.layout.code==="0041" && FormulaClock.state.layout.seconds===59 && !document.querySelector("#share").disabled')
    assert page.evaluate('FormulaClock.state.layout.mode') == 'time'
    page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.nullShared=data;return Promise.resolve();}})")
    page.click('#share')
    page.wait_for_function('window.nullShared || document.querySelector("#share-dialog").open')
    if page.locator('#share-dialog').is_visible():
        page.click('#share-native')
        page.keyboard.press('Escape')
    null_html = ctx.request.get(page.evaluate('nullShared.url')).text()
    null_snapshot = json.loads(re.search(r'<script id="shared-clock" type="application/json">(.*?)</script>',null_html).group(1))['snapshot']
    assert null_snapshot['t'] == '004159' and null_snapshot['ast'] is None
    checks.append('Shared preview returns to live mode; a legitimate null expression is shareable as the ordinary clock')
    for width in [320, 390, 768, 1200]:
        page.set_viewport_size({'width': width, 'height': 800})
        page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), width
        assert page.locator('#share').is_visible()
        page.screenshot(path=str(output/f'share-{width}.png'))
    checks.append('Header and controls remain usable at 320/390/768/1200 pixels')
    report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax'] == '4.1.3'
    for zone in ['America/Los_Angeles', 'Europe/London']:
        other = browser.new_context(locale='ja-JP', timezone_id=zone)
        target = other.new_page()
        target.goto(args.url + '?t=023000', wait_until='domcontentloaded')
        target.wait_for_function('window.FormulaClock')
        assert target.evaluate('[new Date(FormulaClock.state.now).getHours(),new Date(FormulaClock.state.now).getMinutes(),FormulaClock.state.paused]') == [2, 30, True]
        other.close()
    checks.append('Recipient timezone does not change HH:MM:SS')
    ctx.close()
    browser.close()
assert not errors, errors
(output/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'browser': args.browser, 'version': report['browserVersion'], 'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2))
