"""Part 3: all same-gap arithmetic pairs, continuous interruptions and native final glyphs."""
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
        'url':args.url,'playwright':version('playwright'),'fonts':['stix2','termes','fira','euler'],'numerals':['lining','oldstyle'],'checks':[]}
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
    for font,numerals in [(f,n) for f in ['stix2','termes','fira','euler'] for n in ['lining','oldstyle']]:
        for division in ['fraction','inline']:
            for time in ['12:34:08','12:34:30','12:34:31','12:34:59','16:39:19','00:00:08']:
                display(font=font,numerals=numerals,division=division,symbolMotion=False,structureMotion=False,symbolMorph=False);preview(time)
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
    report['checks'].append('Every settled glyph/rule matches the original layout with part 3 alone and combined with parts 1/2 in all four fonts and both numeral styles/division styles')
    page.evaluate('''()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
      const formulas={
        10:B('add',B('add',B('add',L(0),L(1)),L(2)),L(3)),
        9:B('add',B('add',B('mul',L(0),L(1)),L(2)),L(3)),
        13:B('add',B('mul',B('add',L(0),L(1)),L(2)),L(3)),
        6:B('add',B('add',B('sub',L(0),L(1)),L(2)),L(3)),
        24:B('mul',B('mul',B('mul',L(0),L(1)),L(2)),L(3))
      };
      // 12 op 3 + 6 gives four distinct, valid seconds at the same b2 gap.
      const arithmetic=Object.fromEntries(Object.entries({add:21,sub:15,mul:42,div:10}).map(([op,s])=>
        [s,B('add',B(op,{op:'lit',i:0,j:2},L(2)),L(3))]));
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,
        seconds:Array.from({length:60},(_,s)=>(hhmm==='1234'?formulas:hhmm==='1236'?arithmetic:{})[s]||null)};}});
    }''')
    page.emulate_media(reduced_motion='no-preference')
    for font,numerals in [(f,n) for f in ['stix2','termes','fira','euler'] for n in ['lining','oldstyle']]:
        display(font=font,numerals=numerals,division='fraction',symbolMotion=False,structureMotion=False,symbolMorph=True)
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
        page.screenshot(path=str(args.output_dir/f'rotating-{font}-{numerals}.png'))
        preview('12:34:06',750)
        assert page.evaluate("gap1.isConnected && gap1.dataset.kind==='−'")
        assert page.locator('[data-morphing]').count()==0
    report['checks'].append('Same-gap +↔× retains its group, rotates 45° around glyph centers with complementary opacity, and reverses continuously; simultaneous changes retain their own gaps')

    arithmetic=[('+','add',21),('−','sub',15),('×','mul',42),('÷','div',10)]
    directed_pairs=0
    for font,numerals in [(f,n) for f in ['stix2','termes','fira','euler'] for n in ['lining','oldstyle']]:
        page.emulate_media(reduced_motion='reduce')
        display(font=font,numerals=numerals,division='inline',symbolMotion=False,structureMotion=False,symbolMorph=False)
        baseline={}
        for kind,op,second in arithmetic:
            preview(f'12:36:{second:02}')
            baseline[kind]=page.evaluate('geometry()')
        display(symbolMorph=True)
        # Warm all frames so the samples measure animation, not typesetting latency.
        for kind,op,second in arithmetic:preview(f'12:36:{second:02}')
        page.emulate_media(reduced_motion='no-preference')
        for source,source_op,source_second in arithmetic:
            for target,target_op,target_second in arithmetic:
                if source==target:continue
                preview(f'12:36:{source_second:02}',750)
                samples=page.evaluate('''async({site,second})=>{
                  const el=document.querySelector(`[data-site="${site}"]`);window.arithmeticSign=el;
                  FormulaClock.preview(`2026-09-08T12:36:${String(second).padStart(2,'0')}+09:00`);
                  const started=performance.now(),out=[];
                  while(performance.now()-started<760){await new Promise(requestAnimationFrame);out.push(morphSample(el));}
                  return out;
                }''',{'site':f'{source_op}-b2-0','second':target_second})
                assert all(s['alive'] for s in samples),(font,source,target)
                middle=[s for s in samples if s['morphing']]
                assert len(middle)>8,(font,source,target,middle)
                for s in middle:
                    parts={part['kind']:part for part in s['parts']}
                    assert set(parts)=={source,target},(font,source,target,s)
                    assert abs(sum(p['opacity'] for p in parts.values())-1)<1e-7,s
                    angles=[p['angle']+(45 if p['kind']=='×' else 0) for p in parts.values()]
                    assert max(angles)-min(angles)<1e-7,s
                    if '×' not in (source,target):assert all(abs(a)<1e-7 for a in angles),s
                target_opacities=[next(p['opacity'] for p in s['parts'] if p['kind']==target) for s in middle]
                assert len(set(round(v,2) for v in target_opacities))>8,(font,source,target)
                assert not samples[-1]['morphing'] and samples[-1]['kind']==target
                actual=page.evaluate('geometry()')
                assert [x['key'] for x in baseline[target]]==[x['key'] for x in actual],(font,source,target)
                delta=max(abs(a-b) for x,y in zip(baseline[target],actual) for a,b in zip(x['box'],y['box']))
                assert delta<.12,(font,source,target,delta)
                directed_pairs+=1

        # A third/fourth destination keeps every still-visible glyph continuous.
        preview('12:36:21',750)
        page.evaluate("window.multiSign=document.querySelector('[data-site=\"add-b2-0\"]')")
        for second in [42,15,10,21,10,42,15]:
            change=page.evaluate('''async(second)=>{
              const before=morphSample(multiSign),parts=[...multiSign.children];
              FormulaClock.preview(`2026-09-08T12:36:${String(second).padStart(2,'0')}+09:00`);
              while(FormulaClock.state.layout.seconds!==second)await new Promise(requestAnimationFrame);
              return {before,after:morphSample(multiSign),retained:before.morphing?parts.every(p=>p.parentNode===multiSign):true};
            }''',second)
            assert change['retained'] and change['after']['alive'],change
            assert len(change['after']['parts'])<=4,change
            after={p['kind']:p for p in change['after']['parts']}
            for part in change['before']['parts']:
                assert abs(part['angle']-after[part['kind']]['angle'])<8,change
                assert abs(part['opacity']-after[part['kind']]['opacity'])<.2,change
            assert abs(sum(p['opacity'] for p in after.values())-1)<1e-7,change
            page.wait_for_timeout(65)
        page.wait_for_timeout(750)
        assert page.evaluate("multiSign.isConnected && multiSign.dataset.kind==='−' && !multiSign.dataset.morphing")
        assert page.locator('[data-morph-glyph]').count()==0
        # Fraction rules and unary signs are outside this arithmetic morph.
        preview('12:36:10',80);display(division='fraction');page.wait_for_timeout(750)
        assert page.evaluate('!multiSign.isConnected')
        assert page.locator('[data-morph-glyph],[data-morphing]').count()==0
    report['directedArithmeticPairs']=directed_pairs
    report['checks'].append('All 12 directed +/−/×/÷ pairs in each font/numeral combination retain their gap, crossfade continuously, keep horizontal signs level, rotate × by 45°, and settle to exact original geometry')
    report['checks'].append('Third/fourth destinations preserve current opacity, angle and child nodes with at most four glyphs; fraction mode retires the obelus without morphing a rule')

    for i in range(42):
        preview(['12:34:10','12:34:24','12:34:13','12:34:06'][i%4])
        assert page.locator('[data-morph-glyph]').count()<=12
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
    page.click('#settings-open')
    if page.locator('#advanced-settings').get_attribute('open') is None:page.click('#advanced-settings summary')
    page.check('#symbol-morph');page.keyboard.press('Escape')
    page.wait_for_function('FormulaClock.state.layout.display.symbolMorph')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual')
    page.reload();page.wait_for_function('FormulaClock.state.engineReady && FormulaClock.state.layout')
    assert page.evaluate('FormulaClock.state.display.symbolMorph && !FormulaClock.state.display.symbolMotion')
    assert not errors,errors
    report['checks'].append('Rapid interruptions keep bounded glyph layers and clean up fully; reduced motion cancels rotation/fades; null/off clear signs; independent mobile setting persists')
    browser.close()
report['pageErrors']=errors;report['warnings']=sorted(set(warnings))
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
