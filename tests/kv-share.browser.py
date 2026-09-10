"""Immutable KV snapshots, history cleanup and delayed sharing, using real MathJax CDN."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from importlib.metadata import version
import argparse, json, re, sys, time

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8787/')
parser.add_argument('--browser', choices=['chromium', 'webkit', 'firefox'], default='chromium')
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
report = {'command':sys.argv, 'at':datetime.now(timezone.utc).isoformat(), 'browser':args.browser,
          'playwright':version('playwright'), 'checks':[], 'errors':[]}
ast = {'op':'mul','a':{'op':'add','a':{'op':'lit','i':0,'j':1},'b':{'op':'lit','i':1,'j':2}},
       'b':{'op':'add','a':{'op':'lit','i':2,'j':3},'b':{'op':'lit','i':3,'j':4}}}
snapshot = {'v':1,'t':'123421','font':'stix2','numerals':'oldstyle','division':'fraction','ast':ast}
saved = {'font':'fira','numerals':'lining','division':'inline','symbolMotion':False,'structureMotion':False,'symbolMorph':False}

def ready(page, time):
    page.wait_for_function('time=>{const l=window.FormulaClock?.state.layout;return l && l.code+String(l.seconds).padStart(2,"0")===time && !document.querySelector("#share").disabled}', arg=time, timeout=45000)

def read_snapshot(ctx, url):
    # Acceptance precedes persistence. Allow the asynchronous write to finish
    # before testing restoration (the gated Worker test covers early acceptance).
    time.sleep(2)
    html = ctx.request.get(url).text()
    return json.loads(re.search(r'<script id="shared-clock" type="application/json">(.*?)</script>',html).group(1))['snapshot']

with sync_playwright() as p:
    browser = getattr(p,args.browser).launch(headless=True)
    report['browserVersion'] = browser.version
    ctx = browser.new_context(locale='ja-JP', timezone_id='Asia/Tokyo', viewport={'width':1200,'height':800})
    ctx.add_init_script('localStorage.setItem("formula-clock-display-v2",'+json.dumps(json.dumps(saved))+');')
    # Fetch interception avoids WebKit route stalls on MathJax blob imports.
    ctx.add_init_script('''window.postBodies=[];window.shareMode='normal';window.nativeCalls=[];window.copies=[];
      const originalFetch=window.fetch;
      window.fetch=async function(input,init){
        if(String(input?.url||input)==='/api/shares'){
          postBodies.push(JSON.parse(init.body));
          if(shareMode==='fail') return new Response('{}',{status:503});
          if(shareMode==='slow') await new Promise(resolve=>setTimeout(resolve,6000));
        }
        return originalFetch.call(this,input,init);
      };
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        nativeCalls.push({...data,activation:navigator.userActivation.isActive});return Promise.resolve();
      }});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{copies.push(url);}}});
    ''')
    created = ctx.request.post(args.url+'api/shares',data=snapshot)
    assert created.status == 202, created.text()
    url = args.url+'s/'+created.json()['id']
    assert read_snapshot(ctx,url) == snapshot
    page = ctx.new_page()
    page.on('pageerror',lambda error:report['errors'].append(str(error)))
    page.goto(url,wait_until='domcontentloaded')
    ready(page,'123421')
    assert page.evaluate('FormulaClock.state.layout.ast') == ast
    assert page.title() == '(1 + 2) × (3 + 4) = 21'
    assert page.locator('meta[property="og:title"]').get_attribute('content') == 'Formula Clock - 12:34:21'
    assert page.locator('meta[property="og:description"]').get_attribute('content') == '(1+2)×(3+4)=21'
    assert page.evaluate('FormulaClock.state.preview && FormulaClock.state.paused')
    assert page.evaluate('JSON.parse(localStorage.getItem("formula-clock-display-v2"))') == saved
    assert page.url == url
    assert page.evaluate('new URL("data/manifest.json",document.baseURI).pathname') == '/data/manifest.json'
    current = page.evaluate('async()=> (await FORMULA_CLOCK_CONFIG.provider.getMinute("1234")).seconds[21]')
    assert current != ast, 'Fixture must differ from the current formula dataset'
    page.evaluate('window.sameDocument=true;window.initialHistoryLength=history.length;window.originalDigits=FormulaClock.digits')
    page.click('#share')
    assert page.evaluate('nativeCalls.at(-1).url') == url
    assert page.evaluate('nativeCalls.at(-1).title') == 'Formula Clock - 12:34:21'
    assert page.evaluate('!("text" in nativeCalls.at(-1))')
    assert page.evaluate('nativeCalls.at(-1).activation')
    assert page.evaluate('postBodies.length') == 0
    page.set_viewport_size({'width':390,'height':844})
    ready(page,'123421')
    assert page.evaluate('FormulaClock.state.layout.ast') == ast
    page.screenshot(path=str(args.output_dir/'saved-formula.png'))
    page.evaluate('FormulaClock.setDisplay({font:"termes",division:"slash"})')
    page.wait_for_function('FormulaClock.state.layout.display.font==="termes" && !document.querySelector("#share").disabled',timeout=45000)
    assert page.url == args.url
    assert page.title() == 'Formula Clock'
    assert page.evaluate('sameDocument && history.length===initialHistoryLength')
    assert page.evaluate('FormulaClock.state.layout.ast') == ast
    page.click('#share')
    page.wait_for_function('nativeCalls.length===2 || document.querySelector("#share-dialog").open')
    if page.locator('#share-dialog').is_visible():
        page.click('#share-native'); page.keyboard.press('Escape')
    restyled = page.evaluate('nativeCalls.at(-1).url')
    assert restyled != url
    assert read_snapshot(ctx,restyled) == {**snapshot,'font':'termes','division':'slash'}
    page.click('#play-pause')
    page.wait_for_function('!FormulaClock.state.paused')
    page.wait_for_function('FormulaClock.state.layout.seconds!==21',timeout=5000)
    assert page.evaluate('FormulaClock.digits.every((digit,i)=>digit===originalDigits[i])')
    report['checks'].append('Saved AST overrides updated data and survives resize/restyling; resharing reuses unchanged ids; history is replaced without reload')

    # Null must remain a saved ordinary clock even where the dataset has a formula.
    null_snapshot = {**snapshot,'t':'123430','ast':None}
    null_id = ctx.request.post(args.url+'api/shares',data=null_snapshot).json()['id']
    assert read_snapshot(ctx,args.url+'s/'+null_id) == null_snapshot
    page.goto(args.url+'s/'+null_id,wait_until='domcontentloaded')
    ready(page,'123430')
    assert page.evaluate('FormulaClock.state.layout.mode') == 'time'
    assert page.title() == 'Formula Clock — 12:34:30'
    page.click('#share')
    assert page.evaluate('nativeCalls.at(-1).title') == 'Formula Clock - 12:34:30'
    assert page.evaluate('!("text" in nativeCalls.at(-1))')
    assert page.evaluate('async()=>!!(await FORMULA_CLOCK_CONFIG.provider.getMinute("1234")).seconds[30]')
    page.evaluate('FormulaClock.preview(FormulaShare.localDate("123430"),true)')
    ready(page,'123430')
    page.wait_for_function('FormulaClock.state.layout.mode === "formula"')
    assert page.url == args.url
    assert page.evaluate('FormulaClock.state.layout.mode') == 'formula'
    report['checks'].append('An explicit null snapshot stays an ordinary clock until a time operation resumes current data')

    # A saved view remains renderable and shareable even when the current data fails.
    failed_ctx = browser.new_context(locale='en-US',timezone_id='America/Los_Angeles')
    failed_ctx.add_init_script('''const originalFetch=fetch;window.fetch=(input,...args)=>String(input?.url||input).includes('data/')?Promise.reject(new Error('Dataset offline')):originalFetch(input,...args);''')
    failed_page = failed_ctx.new_page()
    failed_page.goto(url,wait_until='domcontentloaded');ready(failed_page,'123421')
    assert failed_page.evaluate('FormulaClock.state.layout.ast') == ast
    assert failed_page.evaluate('new Date(FormulaClock.state.now).getHours()') == 12
    assert failed_page.locator('#state-label').inner_text() == ''
    failed_page.click('#go-live')
    assert failed_page.url == args.url and not failed_page.evaluate('FormulaClock.state.preview')
    failed_ctx.close()
    report['checks'].append('Saved formula loads with the current dataset offline and preserves wall-clock time across timezones')

    # The network can outlast transient activation: offer a fresh native click.
    page.evaluate('window.nativeCalls=[];window.shareMode="slow";FormulaClock.preview(FormulaShare.localDate("123431"),true)')
    ready(page,'123431')
    page.click('#share')
    assert page.evaluate('FormulaClock.state.paused && document.querySelector("#share").disabled')
    assert page.locator('#share-status').text_content() == ''
    page.wait_for_function('document.querySelector("#share-dialog").open',timeout=15000)
    assert page.evaluate('nativeCalls.length') == 0
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.locator('#share-dialog').evaluate('el=>el.scrollWidth<=el.clientWidth')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(args.output_dir/f'delayed-share-{width}.png'))
    page.click('#share-native')
    assert page.evaluate('nativeCalls.at(-1).activation')
    delayed_url = page.evaluate('nativeCalls.at(-1).url')
    assert re.search(r'/s/[A-Za-z0-9]{10}$',delayed_url)
    assert read_snapshot(ctx,delayed_url) == page.evaluate('postBodies.at(-1)')
    page.keyboard.press('Escape')
    report['checks'].append('A slow ID request stays silent, preserves the displayed AST and offers native sharing with fresh user activation at 320/390/768 px')

    page.evaluate('window.shareMode="fail";FormulaClock.preview(FormulaShare.localDate("123432"),true)')
    ready(page,'123432'); page.click('#share')
    page.wait_for_function('document.querySelector("#share-status").textContent.includes("作成できません") && !document.querySelector("#share").disabled')
    assert page.evaluate('FormulaClock.state.paused && !document.querySelector("#share-dialog").open')
    for width in [320,390]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.locator('#share-status').evaluate('el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth')
    page.evaluate('window.shareMode="normal";Object.defineProperty(navigator,"share",{configurable:true,value:undefined})')
    page.click('#share'); page.wait_for_function('copies.length')
    assert read_snapshot(ctx,page.evaluate('copies.at(-1)')) == page.evaluate('postBodies.at(-1)')
    page.evaluate('window.shareMode="slow";FormulaClock.preview(FormulaShare.localDate("123433"),true)')
    ready(page,'123433'); page.click('#share'); page.click('#go-live')
    page.wait_for_timeout(6500)
    assert not page.evaluate('FormulaClock.state.preview')
    assert page.locator('#share-dialog').is_hidden()
    assert page.evaluate('copies.length') == 1
    assert page.locator('#share-status').inner_text() == ''
    report['checks'].append('ID request errors enable retry; leaving the view cancels pending shares without stale copies or dialogs')
    title_ast = {'op':'add','a':{'op':'lit','i':0,'j':1},'b':{'op':'div',
                 'a':{'op':'pow','a':{'op':'lit','i':1,'j':2},'b':{'op':'lit','i':2,'j':3}},
                 'b':{'op':'sqrt','a':{'op':'lit','i':3,'j':4}}}}
    title_id = ctx.request.post(args.url+'api/shares',data={**snapshot,'t':'123405','ast':title_ast}).json()['id']
    assert read_snapshot(ctx,args.url+'s/'+title_id)['ast'] == title_ast
    page.goto(args.url+'s/'+title_id,wait_until='domcontentloaded');ready(page,'123405')
    assert page.title() == '1 + 2^3 / √4 = 5'
    for selector in ['meta[property="og:title"]','meta[name="twitter:title"]']:
        assert page.locator(selector).get_attribute('content') == 'Formula Clock - 12:34:05'
    for selector in ['meta[property="og:description"]','meta[name="twitter:description"]','meta[name="description"]']:
        assert page.locator(selector).get_attribute('content') == '1+2^3/√4=5'
    page.click('#share')
    assert page.evaluate('nativeCalls.at(-1).title') == 'Formula Clock - 12:34:05'
    assert page.evaluate('!("text" in nativeCalls.at(-1))')
    assert page.evaluate('nativeCalls.at(-1).url') == args.url+'s/'+title_id
    report['checks'].append('Native sharing passes the card title and saved URL without text; OG/Twitter descriptions keep the compact equation')
    report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax'] == '4.1.3'
    ctx.close();browser.close()
assert not report['errors'],report['errors']
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
