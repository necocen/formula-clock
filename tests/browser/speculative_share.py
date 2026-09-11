"""Speculative saves must shorten clicks without changing the captured frame."""
from _support import browser_args
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from importlib.metadata import version
import argparse, json, re, sys

ap = argparse.ArgumentParser()
args = browser_args(ap, __file__, browsers=('chromium', 'webkit'))
report = {'command':sys.argv,'at':datetime.now(timezone.utc).isoformat(),'browser':args.browser,
          'playwright':version('playwright'),'checks':[],'errors':[]}

def ready(page,time=None):
    page.wait_for_function('time=>{const l=window.FormulaClock?.state.layout;return l && (!time || l.code+String(l.seconds).padStart(2,"0")===time) && !document.querySelector("#share").disabled}',arg=time,timeout=45000)

def preview(page,time):
    page.evaluate('time=>FormulaClock.preview(FormulaShare.localDate(time),true)',time);ready(page,time)

with sync_playwright() as p:
    browser = getattr(p,args.browser).launch()
    report['browserVersion'] = browser.version
    ctx = browser.new_context(locale='ja-JP',timezone_id='Asia/Tokyo')
    ctx.add_init_script('''window.posts=[];window.nativeCalls=[];window.releaseSaves=[];window.saveMode='hold';
      const originalFetch=fetch;
      window.fetch=async function(input,init){
        if(String(input?.url||input)!=='/api/shares') return originalFetch(input,init);
        const entry={state:JSON.parse(init.body),started:performance.now(),finished:false};posts.push(entry);
        const mode=saveMode;
        if(mode==='hold')await new Promise(resolve=>releaseSaves.push(resolve));
        try {
          const response=mode==='fail'?new Response('{}',{status:503}):await originalFetch(input,init);
          entry.status=response.status;entry.result=await response.clone().json();return response;
        } finally {entry.finished=true;entry.finishedAt=performance.now();}
      };
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        nativeCalls.push({...data,at:performance.now(),activation:navigator.userActivation.isActive,
          state:FormulaClock.state.layout});return Promise.resolve();
      }});
      addEventListener('DOMContentLoaded',()=>{
        const button=document.querySelector('#share');
        if(!button)return;
        button.addEventListener('click',()=>{window.clickStart=performance.now();window.beforeClick=nativeCalls.length;},true);
        button.addEventListener('click',()=>{window.synchronousShare=nativeCalls.length===beforeClick+1;});
      });
    ''')
    page = ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.goto(args.url+'?t=123430',wait_until='domcontentloaded');ready(page,'123430')
    page.wait_for_function('posts.length===1')
    assert page.evaluate('posts[0].state.ast') == page.evaluate('FormulaClock.state.layout.ast')
    assert page.locator('#share-status').inner_text() == ''
    assert page.locator('#share').get_attribute('aria-busy') is None
    assert page.url.endswith('?t=123430')
    page.click('#share')
    assert page.evaluate('posts.length') == 1 and page.evaluate('nativeCalls.length') == 0
    page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())')
    page.wait_for_function('nativeCalls.length===1');ready(page,'123430')
    report['checks'].append('A paused frame saves before clicking without busy UI; a click joins the same pending request')

    page.evaluate('saveMode="normal"')
    preview(page,'123431')
    page.wait_for_function('posts.some(p=>p.state.t==="123431" && p.finished)')
    before = page.evaluate('posts.length')
    page.click('#share')
    assert page.evaluate('synchronousShare && nativeCalls.at(-1).activation')
    assert page.evaluate('posts.length') == before
    report['readyClickMs'] = page.evaluate('nativeCalls.at(-1).at-clickStart')
    report['preparationMs'] = page.evaluate('(()=>{const p=posts.find(p=>p.state.t==="123431");return p.finishedAt-p.started;})()')
    saved_url = page.evaluate('nativeCalls.at(-1).url')
    html = ctx.request.get(saved_url).text()
    stored = json.loads(re.search(r'<script id="shared-clock" type="application/json">(.*?)</script>',html)[1])['snapshot']
    assert stored == page.evaluate('posts.at(-1).state')
    report['checks'].append('A completed speculative save opens native sharing synchronously with the exact saved AST')

    page.evaluate('saveMode="fail"')
    preview(page,'123432')
    page.wait_for_function('posts.some(p=>p.state.t==="123432" && p.finished)')
    page.wait_for_timeout(500)
    assert page.locator('#share-status').inner_text() == ''
    assert page.evaluate('posts.filter(p=>p.state.t==="123432").length') == 1
    page.evaluate('saveMode="hold"')
    count = page.evaluate('nativeCalls.length')
    page.click('#share')
    assert page.evaluate('posts.filter(p=>p.state.t==="123432").length') == 2
    assert page.evaluate('nativeCalls.length') == count
    page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())')
    page.wait_for_function('count=>nativeCalls.length===count+1',arg=count);ready(page,'123432')
    report['checks'].append('Speculative failure stays quiet without retries in a loop; a real click retries successfully')

    page.evaluate('saveMode="normal";for(const t of ["123433","123434","123435"])FormulaClock.preview(FormulaShare.localDate(t),true)')
    ready(page,'123435');page.wait_for_function('posts.some(p=>p.state.t==="123435" && p.finished)')
    assert page.evaluate('posts.filter(p=>["123433","123434"].includes(p.state.t)).length') == 0
    page.evaluate('saveMode="hold"')
    preview(page,'123436');page.wait_for_function('posts.some(p=>p.state.t==="123436")')
    count = page.evaluate('nativeCalls.length')
    preview(page,'123437');page.wait_for_function('posts.some(p=>p.state.t==="123437")')
    page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())')
    page.wait_for_function('posts.filter(p=>["123436","123437"].includes(p.state.t)).every(p=>p.finished)')
    assert page.evaluate('nativeCalls.length') == count and page.locator('#share-dialog').is_hidden()
    assert page.locator('#share-status').inner_text() == ''
    page.click('#share');assert page.evaluate('synchronousShare')
    assert page.evaluate('nativeCalls.at(-1).state.seconds') == 37
    report['checks'].append('Quick time changes coalesce; cancelled speculative responses cannot share an obsolete frame')

    page.mouse.move(1,1)
    page.goto(args.url,wait_until='domcontentloaded');ready(page)
    page.evaluate('saveMode="normal"')
    page.wait_for_timeout(1200)
    assert page.evaluate('posts.length') == 0
    page.evaluate('FormulaClock.preview(FormulaShare.localDate("123430"),false)');ready(page,'123430')
    page.hover('#share');page.wait_for_function('posts.length===3 && posts.every(p=>p.finished)')
    assert not page.evaluate('FormulaClock.state.paused')
    assert page.evaluate('posts.map(p=>p.state.t)') == ['123430','123431','123432']
    page.wait_for_function('FormulaClock.state.layout.seconds===31')
    page.click('#share');assert page.evaluate('synchronousShare && nativeCalls.at(-1).state.seconds===31')
    assert page.evaluate('posts.filter(p=>p.state.t==="123431").length') == 1
    report['boundaryClickMs'] = page.evaluate('nativeCalls.at(-1).at-clickStart')
    page.mouse.move(1,1);page.locator('#share').blur()
    page.evaluate('FormulaClock.live()');ready(page)
    before = page.evaluate('posts.length');page.wait_for_timeout(2200)
    assert page.evaluate('posts.length') == before
    report['checks'].append('The running clock writes nothing without intent; a hover warms only three frames and a next-second click uses the matching id')
    report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax'] == '4.1.3'
    ctx.close();browser.close()
assert not report['errors'],report['errors']
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
