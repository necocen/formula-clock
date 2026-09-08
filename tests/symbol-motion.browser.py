"""Experimental operator motion: delivered CDN fonts, layout parity and DOM lifetime."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, sys
from datetime import datetime, timezone

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path,default=Path('test-results/symbol-motion'))
args=ap.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
report={'at':datetime.now(timezone.utc).isoformat(),'command':sys.argv,'browser':args.browser,'url':args.url,'fonts':['stix2','euler'],'checks':[]}
errors=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch()
    report['browserVersion']=browser.version
    page=browser.new_page(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(args.url);page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
    assert not page.evaluate('FormulaClock.state.display.symbolMotion')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax']=='4.1.3'
    page.evaluate('window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector("#equal-sign")')

    def preview(time,wait=720):
        page.evaluate('(time)=>FormulaClock.preview("2026-09-08T"+time+"+09:00")',time)
        page.wait_for_function('([code,seconds])=>FormulaClock.state.layout.code===code && FormulaClock.state.layout.seconds===seconds',arg=[time[:2]+time[3:5],int(time[6:8])])
        if wait:page.wait_for_timeout(wait)

    def display(**opts):
        page.evaluate('(opts)=>FormulaClock.setDisplay(opts)',opts)
        page.wait_for_function('(opts)=>Object.entries(opts).every(([key,value])=>FormulaClock.state.layout.display[key]===value)',arg=opts)
        page.wait_for_timeout(720)

    def check_symbols():
        return page.evaluate('''()=>{
          const layout=FormulaClock.state.layout,expected={};
          const kinds={add:'+',sub:'−',neg:'−',mul:'×',fact:'!',...(layout.display.division==='inline'?{div:'÷'}:{})};
          function walk(ast){if(!ast)return;if(kinds[ast.op])expected[kinds[ast.op]]=(expected[kinds[ast.op]]||0)+1;if(ast.a)walk(ast.a);if(ast.b)walk(ast.b);}
          if(layout.display.symbolMotion)walk(layout.ast);
          const actual={};
          for(const el of document.querySelectorAll('#operator-root > g')){
            actual[el.dataset.kind]=(actual[el.dataset.kind]||0)+1;
            const r=el.getBoundingClientRect();
            if(!r.width || !r.height || r.right<0 || r.left>innerWidth)throw new Error('Invisible moving symbol');
            if(getComputedStyle(el.querySelector('path')).fill!=='rgb(195, 200, 186)')throw new Error('Wrong symbol color');
          }
          if(JSON.stringify(Object.entries(expected).sort())!==JSON.stringify(Object.entries(actual).sort()))throw new Error(JSON.stringify({expected,actual}));
          if(!FormulaClock.digits.every((el,i)=>el===originalDigits[i]) || document.querySelector('#equal-sign')!==originalEqual)throw new Error('Persistent digits/equality replaced');
          return actual;
        }''')

    # Marking a symbol must preserve MathJax spacing, glyph sizes and digit placement.
    max_delta=0
    for font in ['stix2','euler']:
        for division in ['fraction','inline']:
            for time in ['12:34:08','12:34:30','12:34:31','12:34:59','16:39:19','00:00:08']:
                display(font=font,division=division,symbolMotion=False);preview(time)
                baseline=page.evaluate('FormulaClock.state.layout.items.map(x=>x.matrix).flat()')
                display(symbolMotion=True)
                moved=page.evaluate('FormulaClock.state.layout.items.map(x=>x.matrix).flat()')
                delta=max(abs(a-b) for a,b in zip(baseline,moved));max_delta=max(max_delta,delta)
                assert delta<.12,(font,division,time,delta)
                check_symbols()
    report['checks'].append('24 font/division/time comparisons preserve digit layout within 0.12px')
    report['maxMatrixDelta']=max_delta

    display(font='stix2',division='fraction',symbolMotion=True);preview('12:34:30')
    samples=page.evaluate('''async()=>{
      const plus=document.querySelector('#operator-root [data-kind="+"]'),shape=plus.firstChild,out=[];
      FormulaClock.preview('2026-09-08T12:34:31+09:00');const started=performance.now();
      while(performance.now()-started<850){await new Promise(requestAnimationFrame);out.push({same:plus.isConnected && plus.firstChild===shape,x:plus.getBoundingClientRect().x,opacity:getComputedStyle(plus).opacity});}
      return out;
    }''')
    assert all(x['same'] and x['opacity']=='1' for x in samples),samples
    assert len(set(round(x['x'],2) for x in samples))>5,samples
    check_symbols()
    report['checks'].append('Shared plus retains its element and glyph, moving continuously at full opacity; surplus multiplication disappears')
    page.screenshot(path=str(args.output_dir/'moving-symbols.png'))

    # Reuse duplicate plus signs while one expression becomes the next.
    preview('16:39:19')
    page.evaluate('window.oldPluses=[...document.querySelectorAll("#operator-root [data-kind=\\"+\\"]")]')
    preview('12:34:31');check_symbols()
    assert page.evaluate('oldPluses.filter(x=>x.isConnected).length')==2
    report['checks'].append('Two of three repeated plus signs are reused without duplicating nodes')

    # Interrupt movement and fades repeatedly, including hour changes and time-only frames.
    for i in range(36):
        preview(['12:34:30','12:34:31','16:39:19','00:00:08'][i%4],wait=0)
    page.wait_for_timeout(800);check_symbols()
    preview('12:34:31');display(symbolMotion=False)
    assert page.locator('#operator-root > g').count()==0
    check_symbols()
    report['checks'].append('Rapid previews and disabling the experiment leave no stale or duplicate glyphs')

    page.click('#settings-open');page.check('#symbol-motion');page.keyboard.press('Escape')
    page.wait_for_function('FormulaClock.state.layout.display.symbolMotion');page.wait_for_timeout(750);check_symbols()
    page.emulate_media(reduced_motion='reduce');preview('12:34:59',wait=60);check_symbols()
    assert page.locator('#operator-root').evaluate('(el)=>el.getAnimations({subtree:true}).length')==0
    page.reload();page.wait_for_function('FormulaClock.state.engineReady && FormulaClock.state.layout');page.wait_for_timeout(750)
    assert page.evaluate('FormulaClock.state.display.symbolMotion')
    report['checks'].append('Settings switch persists across reload; reduced motion immediately places symbols')
    assert not errors,errors
    browser.close()
report['pageErrors']=errors
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
