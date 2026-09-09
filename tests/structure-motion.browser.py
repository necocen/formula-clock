"""CDN glyph identity, exact final geometry, rule interpolation and DOM lifetime."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from importlib.metadata import version
import argparse, json, math, platform, sys

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path,default=Path('test-results/structure-motion'))
args=ap.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
L=lambda i,j=None:dict(op='lit',i=i,j=i+1 if j is None else j)
B=lambda op,a,b:dict(op=op,a=a,b=b)
U=lambda op,a:dict(op=op,a=a)
fixtures=[
 ('fraction-narrow','1212',1,B('div',L(0,2),L(2,4))),
 ('fraction-wide','1212',2,B('div',U('fact',B('add',L(0),L(1))),B('add',L(2),L(3)))),
 ('root-narrow','1444',16,B('add',U('sqrt',L(0,3)),L(3))),
 ('root-wide','1444',7,B('add',U('sqrt',B('add',B('add',L(0),L(1)),L(2))),L(3))),
 ('root-wide-mul','1444',8,B('add',U('sqrt',B('mul',B('mul',L(0),L(1)),L(2))),L(3))),
 ('root-tall','1444',5,B('add',U('sqrt',B('mul',B('div',L(0),L(1)),L(2))),L(3))),
 ('paren-wide','1444',36,B('mul',B('add',B('add',L(0),L(1)),L(2)),L(3))),
 ('paren-narrow','1444',32,B('mul',B('add',B('mul',L(0),L(1)),L(2)),L(3))),
 ('paren-tall','1444',17,B('mul',B('add',B('div',L(0),L(1)),L(2)),L(3))),
 ('root-attachment','1444',9,B('add',L(0),B('mul',U('sqrt',L(1)),U('sqrt',B('mul',L(2),L(3)))))),
]
deep=B('mul',L(0),B('mul',L(1),B('mul',L(2),L(3))))
for _ in range(18):deep=U('sqrt',deep)
fixtures.append(('assembled-root','1111',1,deep))
deep_base=B('mul',L(0),B('mul',L(1),L(2)))
for _ in range(18):deep_base=U('sqrt',deep_base)
fixtures.append(('assembled-paren','1112',1,B('pow',deep_base,L(3))))

def value(a,code):
    if a['op']=='lit':return int(code[a['i']:a['j']])
    x=value(a['a'],code);op=a['op']
    if op=='sqrt':return math.sqrt(x)
    if op=='fact':return math.factorial(int(x))
    y=value(a['b'],code)
    return {'add':lambda:x+y,'mul':lambda:x*y,'div':lambda:x/y,'pow':lambda:x**y}[op]()
# These are real equations. The browser remains responsible only for presentation.
for name,code,seconds,ast in fixtures:assert value(ast,code)==seconds,(name,value(ast,code),seconds)

report={'at':datetime.now(timezone.utc).isoformat(),'command':sys.argv,'browser':args.browser,
        'url':args.url,'python':platform.python_version(),'playwright':version('playwright'),
        'fonts':['stix2','termes','fira','euler'],'numerals':['lining','oldstyle'],'checks':[]}
errors=[];warnings=[];cdn=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch();report['browserVersion']=browser.version
    page=browser.new_page(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda msg:warnings.append(msg.text) if msg.type=='warning' else None)
    page.on('request',lambda req:cdn.append(req.url) if 'cdn.jsdelivr.net' in req.url else None)
    page.goto(args.url);page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
    assert not page.evaluate('FormulaClock.state.display.structureMotion')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax');assert report['mathjax']=='4.1.3'
    page.evaluate('''fixtures=>{
      window.fixtures=fixtures;window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector('#equal-sign');
      const minutes={};
      for(const [,code,seconds,ast] of fixtures){FormulaExpression.validateAst(ast,code);(minutes[code] ||= Array(60).fill(null))[seconds]=ast;}
      window.fixtureProvider={async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,seconds:minutes[hhmm] || Array(60).fill(null)};}};
      FormulaClock.setDataProvider(fixtureProvider);
    }''',fixtures)

    # Compare every visible path/rectangle after reconstructing the actual frame.
    # This catches displaced bars, duplicate extraction and missing delimiter pieces.
    report['geometry']=page.evaluate('''async()=>{
      const out=[],NS='http://www.w3.org/2000/svg';
      function geometry(frame){
        const svg=document.createElementNS(NS,'svg');
        svg.setAttribute('width','20000');svg.setAttribute('height','20000');
        svg.style.cssText='position:fixed;left:-100000px;top:0';
        svg.append(frame.decorations.cloneNode(true));
        for(const token of [...frame.tokens,...(frame.equality?[frame.equality]:[]),...frame.symbols]){
          const group=token.shape.cloneNode(true);group.setAttribute('transform',`matrix(${token.matrix.join(' ')})`);svg.append(group);
        }
        document.body.append(svg);
        try{return [...svg.querySelectorAll('path,rect')].map(el=>{
          const m=svg.getScreenCTM().inverse().multiply(el.getScreenCTM()),b=el.getBBox();
          const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
          return {key:el.localName==='path'?el.getAttribute('d'):'rule',
            box:[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))]};
        }).sort((a,b)=>a.key.localeCompare(b.key)||a.box[0]-b.box[0]||a.box[1]-b.box[1]);}
        finally{svg.remove();}
      }
      for(const font of ['stix2','termes','fira','euler'])for(const numerals of ['lining','oldstyle']){
        const engine=new FormulaTypesetter.Typesetter(font,numerals);await engine.boot;
        for(const division of ['fraction','inline'])for(const [name,code,seconds,ast] of fixtures){
          const baseline=await engine.frame(ast,code,seconds,{division});const expected=geometry(baseline);
          for(const symbolMotion of [false,true])for(const structureMotion of [false,true]){
            const frame=await engine.frame(ast,code,seconds,{division,symbolMotion,structureMotion});const actual=geometry(frame);
            if(JSON.stringify(expected.map(p=>p.key))!==JSON.stringify(actual.map(p=>p.key)))throw Error('Glyph count/content changed: '+font+name);
            const delta=Math.max(...expected.flatMap((p,i)=>p.box.map((x,j)=>Math.abs(x-actual[i].box[j]))));
            // Firefox's SVGMatrix rounds off-screen coordinates to float32.
            // One font unit is at most 0.112px at the app's maximum display scale.
            if(delta>1)throw Error('Geometry changed: '+JSON.stringify({font,name,division,symbolMotion,structureMotion,delta,
              differences:expected.map((p,i)=>({key:p.key.slice(0,40),before:p.box,after:actual[i].box})).filter(p=>p.before.some((x,j)=>Math.abs(x-p.after[j])>1)),
              digitDelta:Math.max(...baseline.tokens.flatMap((t,i)=>t.matrix.map((x,j)=>Math.abs(x-frame.tokens[i].matrix[j]))))}));
            if(JSON.stringify(baseline.viewBox)!==JSON.stringify(frame.viewBox))throw Error('ViewBox changed');
            out.push({font,numerals,name,division,symbolMotion,structureMotion,delta});
          }
        }
        engine.host.remove();engine.staging.remove();
      }return out;
    }''')
    report['checks'].append('All glyph/rule bounds and viewBox match in all four fonts and both numeral styles, division styles and all four experiment combinations')

    def display(**opts):
        page.evaluate('(opts)=>FormulaClock.setDisplay(opts)',opts)
        page.wait_for_function('(opts)=>Object.entries(opts).every(([k,v])=>FormulaClock.state.layout.display[k]===v)',arg=opts)
        page.wait_for_timeout(740)

    def preview(name,wait=740):
        fixture=next(x for x in fixtures if x[0]==name) if name!='null' else ('null','0000',8,None)
        _,code,seconds,_=fixture
        page.evaluate('([code,s])=>FormulaClock.preview(`2026-09-08T${code.slice(0,2)}:${code.slice(2)}:${String(s).padStart(2,"0")}+09:00`)',[code,seconds])
        page.wait_for_function('([c,s])=>FormulaClock.state.layout.code===c && FormulaClock.state.layout.seconds===s && !FormulaClock.state.engineError',arg=[code,seconds])
        if wait:page.wait_for_timeout(wait)

    def sample_transition(target,kinds):
        fixture=next(x for x in fixtures if x[0]==target)
        return page.evaluate('''async([code,seconds,kinds])=>{
          const find=kind=>document.querySelector(`#operator-root [data-kind="${kind}"]`);
          const old=kinds.map(kind=>{const el=find(kind);if(!el)throw Error('Missing '+kind);return {kind,el,shape:el.firstChild};});
          function capture(){
            const state=old.map(({el,shape,kind})=>{const r=el.getBoundingClientRect();return {kind,same:el.isConnected&&el.firstChild===shape,x:r.x,y:r.y,width:r.width,height:r.height,opacity:getComputedStyle(el).opacity};});
            const sign=find('root-sign'),rule=find('root-rule');let junction=null;
            if(sign&&rule){const m=rule.getScreenCTM(),inv=sign.getScreenCTM().inverse(),p=new DOMPoint(m.e,m.f).matrixTransform(inv);junction=[p.x,p.y];}
            return {state,junction};
          }
          const samples=[capture()];FormulaClock.preview(`2026-09-08T${code.slice(0,2)}:${code.slice(2)}:${String(seconds).padStart(2,'0')}+09:00`);
          const start=performance.now();while(performance.now()-start<850){await new Promise(requestAnimationFrame);samples.push(capture());}return samples;
        }''',[fixture[1],fixture[2],kinds])

    report['motion']=[]
    for font,numerals in [(f,n) for f in ['stix2','termes','fira','euler'] for n in ['lining','oldstyle']]:
        display(font=font,numerals=numerals,division='fraction',symbolMotion=True,structureMotion=True)
        preview('fraction-narrow');samples=sample_transition('fraction-wide',['fraction-rule'])
        assert all(s['state'][0]['same'] and s['state'][0]['opacity']=='1' for s in samples)
        assert len(set(round(s['state'][0]['width'],2) for s in samples))>8
        # Width interpolation must not stretch the bar's stroke along with its length.
        start=samples[0]['state'][0];end=samples[-1]['state'][0]
        for s in samples:
            row=s['state'][0];progress=(row['width']-start['width'])/(end['width']-start['width'])
            assert abs(row['height']-(start['height']+(end['height']-start['height'])*progress))<.12
        # Euler oldstyle's native + selects a larger radical than its low
        # digits. Multiplication keeps the same size while widening the rule.
        wide_root='root-wide-mul' if (font,numerals)==('euler','oldstyle') else 'root-wide'
        preview('root-narrow');samples=sample_transition(wide_root,['root-sign','root-rule'])
        assert all(r['same'] and r['opacity']=='1' for s in samples for r in s['state'])
        assert len(set(round(s['state'][1]['width'],2) for s in samples))>8
        origin=samples[0]['junction'];drift=max(abs(x-y) for s in samples for x,y in zip(s['junction'],origin))
        assert drift<2,(font,drift) # <0.224px at the largest 112px/em rendering scale.
        page.evaluate("window.oldRoot=[...document.querySelectorAll('[data-kind=\"root-sign\"],[data-kind=\"root-rule\"]')];window.oldRootKey=oldRoot[0].dataset.glyphKey")
        preview('root-tall')
        assert page.evaluate("oldRoot.every(x=>!x.isConnected) && document.querySelector('[data-kind=\"root-sign\"]').dataset.glyphKey!==oldRootKey")
        assert page.evaluate("document.querySelector('[data-kind=\"root-sign\"]').dataset.glyphKey===document.querySelector('[data-kind=\"root-rule\"]').dataset.glyphKey")
        page.screenshot(path=str(args.output_dir/f'root-{font}-{numerals}.png'))
        preview('paren-wide');samples=sample_transition('paren-narrow',['paren-left','paren-right'])
        assert all(r['same'] and r['opacity']=='1' for s in samples for r in s['state'])
        page.evaluate("window.oldParens=[...document.querySelectorAll('[data-kind=\"paren-left\"],[data-kind=\"paren-right\"]')];window.oldParenKeys=oldParens.map(x=>x.dataset.glyphKey)")
        preview('paren-tall')
        assert page.evaluate("oldParens.every(x=>!x.isConnected) && [...document.querySelectorAll('[data-kind=\"paren-left\"],[data-kind=\"paren-right\"]')].every(x=>!oldParenKeys.includes(x.dataset.glyphKey))")
        preview('root-wide');page.evaluate("window.oldRoot=document.querySelector('[data-kind=\"root-sign\"]')")
        preview('root-attachment');assert page.evaluate('!oldRoot.isConnected')
        preview('assembled-root')
        assert page.locator('#notation-root path').count()>0 # Larger radicals assembled from pieces still fade.
        assert page.evaluate('FormulaClock.state.layout.mode')=='formula'
        report['motion'].append({'font':font,'numerals':numerals,'maxRootJunctionDriftEm':drift/1000})
    report['checks'].append('Rules resize continuously with independent thickness; same radicals/parentheses retain DOM and glyphs; size/attachment changes replace them; assembled radicals keep fading')

    # Real dataset, rapid interruptions, resize, settings persistence and reduced motion.
    page.evaluate("document.querySelector('#restore-data').click()")
    for i in range(30):
        page.evaluate('(s)=>FormulaClock.preview("2026-09-08T12:34:"+String(s).padStart(2,"0")+"+09:00")',i)
        page.wait_for_function('(s)=>FormulaClock.state.layout.code==="1234" && FormulaClock.state.layout.seconds===s',arg=i)
    page.wait_for_timeout(800)
    assert page.locator('#operator-root > g').evaluate_all('(els)=>new Set(els.map(x=>[x.dataset.kind,x.dataset.site,x.dataset.glyphKey].join(":"))).size===els.length')
    page.set_viewport_size({'width':320,'height':640});page.wait_for_timeout(800)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.click('#settings-open');page.uncheck('#structure-motion');page.check('#structure-motion');page.keyboard.press('Escape')
    page.emulate_media(reduced_motion='reduce');page.evaluate('FormulaClock.setDataProvider(fixtureProvider)');preview('root-wide',80)
    assert page.locator('#operator-root').evaluate('(el)=>el.getAnimations({subtree:true}).length')==0
    page.screenshot(path=str(args.output_dir/'mobile.png'))
    preview('null',80);assert page.locator('#operator-root > g').count()==0
    display(symbolMotion=False,structureMotion=False);preview('root-wide')
    assert page.locator('#operator-root > g').count()==0
    display(structureMotion=True)
    assert page.locator('#operator-root [data-kind="root-sign"]').count()==1
    assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual')
    page.reload();page.wait_for_function('FormulaClock.state.engineReady && FormulaClock.state.layout');page.wait_for_timeout(750)
    assert page.evaluate('FormulaClock.state.display.structureMotion && !FormulaClock.state.display.symbolMotion')
    report['checks'].append('No stale symbols after rapid previews/null; mobile fits; independent toggle persists; reduced motion snaps; persistent digits/equality remain intact')
    assert not errors,errors
    browser.close()
report['pageErrors']=errors;report['warnings']=sorted(set(warnings));report['cdnRequests']=sorted(set(cdn))
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['geometry','cdnRequests']},ensure_ascii=False,indent=2))
