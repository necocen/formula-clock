"""Part 3: same-gap +/× rotation, crossfade, interruptions and exact final glyphs."""
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
from playwright.sync_api import sync_playwright
import argparse,json,sys

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path,default=Path('test-results/symbol-morph'))
args=ap.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
report={'at':datetime.now(timezone.utc).isoformat(),'command':sys.argv,'browser':args.browser,
        'url':args.url,'playwright':version('playwright'),'fonts':['stix2','euler'],'checks':[]}
errors=[];warnings=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch();report['browserVersion']=browser.version
    page=browser.new_page(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda msg:warnings.append(msg.text) if msg.type=='warning' else None)
    page.goto(args.url);page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax');assert report['mathjax']=='4.1.3'
    assert not page.evaluate('FormulaClock.state.display.symbolMorph')
    page.evaluate('''()=>{
      window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector('#equal-sign');
      window.geometry=()=>[...document.querySelectorAll('#math-scene path,#math-scene rect')].map(el=>{
        const r=el.getBoundingClientRect();return {key:el.localName==='path'?el.getAttribute('d'):'rule',box:[r.x,r.y,r.width,r.height]};
      }).filter(x=>x.key&&x.box[2]&&x.box[3]).sort((a,b)=>a.key.localeCompare(b.key)||a.box[0]-b.box[0]||a.box[1]-b.box[1]);
      window.morphSample=el=>({alive:el.isConnected,kind:el.dataset.kind,morphing:!!el.dataset.morphing,
        parts:[...el.querySelectorAll('[data-morph-glyph]')].map(g=>({kind:g.dataset.morphGlyph,
          angle:Number(g.getAttribute('transform').match(/rotate\\(([^)]+)\\)/)[1]),opacity:Number(g.getAttribute('opacity'))}))});
    }''')

    def display(**opts):
        page.evaluate('(opts)=>FormulaClock.setDisplay(opts)',opts)
        page.wait_for_function('(opts)=>Object.entries(opts).every(([k,v])=>FormulaClock.state.layout.display[k]===v)',arg=opts)

    def preview(time,wait=0):
        page.evaluate('(time)=>FormulaClock.preview("2026-09-08T"+time+"+09:00")',time)
        page.wait_for_function('([c,s])=>FormulaClock.state.layout.code===c && FormulaClock.state.layout.seconds===s && typeof FormulaClock.state.coverage==="number" && !document.querySelector("#stage").classList.contains("loading")',arg=[time[:2]+time[3:5],int(time[6:8])])
        if wait:page.wait_for_timeout(wait)

    page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(750) # Let any initial live frame's pre-existing fade retire.
    max_delta=0;comparisons=0
    for font in ['stix2','euler']:
        for division in ['fraction','inline']:
            for time in ['12:34:08','12:34:30','12:34:31','12:34:59','16:39:19','00:00:08']:
                display(font=font,division=division,symbolMotion=False,structureMotion=False,symbolMorph=False);preview(time)
                baseline=page.evaluate('geometry()')
                for basic in [False,True]:
                    for structure in [False,True]:
                        display(symbolMotion=basic,structureMotion=structure,symbolMorph=True)
                        actual=page.evaluate('geometry()')
                        assert [x['key'] for x in baseline]==[x['key'] for x in actual],(font,division,time,basic,structure,len(baseline),len(actual))
                        delta=max(abs(a-b) for x,y in zip(baseline,actual) for a,b in zip(x['box'],y['box']))
                        assert delta<.12,(font,division,time,basic,structure,delta)
                        max_delta=max(max_delta,delta);comparisons+=1
    report['geometryComparisons']=comparisons;report['maxGlyphBoundsDeltaPx']=max_delta
    report['checks'].append('Every settled glyph/rule matches the original layout with part 3 alone and combined with parts 1/2 in both fonts/division styles')
    page.evaluate('''()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
      const formulas={
        10:B('add',B('add',B('add',L(0),L(1)),L(2)),L(3)),
        9:B('add',B('add',B('mul',L(0),L(1)),L(2)),L(3)),
        13:B('add',B('mul',B('add',L(0),L(1)),L(2)),L(3)),
        6:B('add',B('add',B('sub',L(0),L(1)),L(2)),L(3)),
        24:B('mul',B('mul',B('mul',L(0),L(1)),L(2)),L(3))
      };
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,
        seconds:Array.from({length:60},(_,s)=>hhmm==='1234'?formulas[s]||null:null)};}});
    }''')
    page.emulate_media(reduced_motion='no-preference')
    for font in ['stix2','euler']:
        display(font=font,division='fraction',symbolMotion=False,structureMotion=False,symbolMorph=True)
        preview('12:34:10',750)
        samples=page.evaluate('''async()=>{
          const el=document.querySelector('[data-site="add-b1-0"]');window.rotating=el;
          FormulaClock.preview('2026-09-08T12:34:09+09:00');const started=performance.now(),out=[];
          while(performance.now()-started<850){await new Promise(requestAnimationFrame);out.push(morphSample(el));}return out;
        }''')
        assert all(s['alive'] for s in samples)
        middle=[s for s in samples if s['morphing']]
        assert len(middle)>10
        for s in middle:
            assert len(s['parts'])==2
            plus,times=sorted(s['parts'],key=lambda x:x['kind'])
            assert abs(plus['angle']-times['angle']-45)<1e-7
            assert abs(plus['opacity']+times['opacity']-1)<1e-7
        assert len(set(round(s['parts'][0]['angle'],1) for s in middle))>10
        assert not samples[-1]['morphing'] and samples[-1]['kind']=='×'
        assert page.locator('[data-morph-glyph]').count()==0

        # Reverse a partially completed rotation: reuse the same two glyphs.
        preview('12:34:10',750);preview('12:34:09',170)
        reversal=page.evaluate('''async()=>{
          const el=document.querySelector('[data-site="mul-b1-0"]'),parts=[...el.children],before=morphSample(el);
          FormulaClock.preview('2026-09-08T12:34:10+09:00');
          while(FormulaClock.state.layout.seconds!==10)await new Promise(requestAnimationFrame);
          return {before,after:morphSample(el),same:parts.every((p,i)=>p===el.children[i])};
        }''')
        assert reversal['same'],reversal
        assert abs(reversal['after']['parts'][0]['angle']-reversal['before']['parts'][0]['angle'])<8,reversal
        page.wait_for_timeout(760)
        assert page.locator('[data-morphing]').count()==0
        assert page.evaluate("rotating.isConnected && rotating.dataset.kind==='+'");

        # Both signs may rotate, but each keeps its own HHMM boundary.
        preview('12:34:13',750)
        page.evaluate("window.gap1=document.querySelector('[data-site=\"add-b1-0\"]');window.gap2=document.querySelector('[data-site=\"mul-b2-0\"]')")
        preview('12:34:09',200)
        assert page.evaluate("gap1.dataset.site==='mul-b1-0' && gap2.dataset.site==='add-b2-0' && gap1.dataset.morphing && gap2.dataset.morphing")
        page.screenshot(path=str(args.output_dir/f'rotating-{font}.png'))
        preview('12:34:06',750)
        assert page.evaluate('!gap1.isConnected') # +/× must not turn into a minus.
        assert page.locator('[data-morphing]').count()==0
    report['checks'].append('Same-gap +↔× retains its group, rotates 45° around glyph centers with complementary opacity, and reverses continuously; minus and different gaps keep normal identity rules')

    for i in range(42):
        preview(['12:34:10','12:34:24','12:34:13'][i%3])
        assert page.locator('[data-morph-glyph]').count()<=6
    page.wait_for_timeout(800)
    assert page.locator('[data-morph-glyph],[data-morphing]').count()==0
    assert page.locator('#operator-root > g').count()==3
    preview('12:34:24',100);page.emulate_media(reduced_motion='reduce')
    page.wait_for_function('!document.querySelector("[data-morphing]")')
    assert page.locator('#operator-root').evaluate('(el)=>el.getAnimations({subtree:true}).length')==0
    preview('00:00:08');assert page.locator('#operator-root > g').count()==0
    preview('12:34:10');display(symbolMorph=False)
    assert page.locator('#operator-root > g').count()==0
    page.set_viewport_size({'width':320,'height':640})
    page.click('#settings-open');page.check('#symbol-morph');page.keyboard.press('Escape')
    page.wait_for_function('FormulaClock.state.layout.display.symbolMorph')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual')
    page.reload();page.wait_for_function('FormulaClock.state.engineReady && FormulaClock.state.layout')
    assert page.evaluate('FormulaClock.state.display.symbolMorph && !FormulaClock.state.display.symbolMotion')
    assert not errors,errors
    report['checks'].append('Rapid interruptions keep at most two glyphs per sign and clean up fully; reduced motion cancels rotation/fades; null/off clear signs; independent mobile setting persists')
    browser.close()
report['pageErrors']=errors;report['warnings']=sorted(set(warnings))
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
