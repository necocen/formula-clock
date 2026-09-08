"""Default: delivered MathJax 4 configuration, requires CDN access.
--local-mathjax DIR substitutes an installed MathJax 3 for compatibility testing.
That run tests real CM oldstyle glyphs, but NOT the v4/Euler delivery path.
No font files are copied into this repository.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, shutil

ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--local-mathjax',type=Path);ap.add_argument('--screenshots',action='store_true');args=ap.parse_args()
report={'build':'r5-stix2','compatibilityOnly':bool(args.local_mathjax),'cases':[], 'checks':[]}
errors=[]
with sync_playwright() as p:
    exe=shutil.which('chromium')
    browser=p.chromium.launch(headless=True,**({'executable_path':exe} if exe else {}))
    ctx=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    if args.local_mathjax:
        lib=args.local_mathjax
        def route_local(route):
            url=route.request.url
            if url.endswith('/tex-svg-nofont.js'):
                route.fulfill(content_type='application/javascript',body='delete window.MathJax.output;\n'+(lib/'tex-svg.js').read_text());return
            f=lib/url.split('/mathjax@4.1.3/')[-1]
            if f.is_file():route.fulfill(path=str(f),content_type='application/javascript')
            else:route.abort()
        ctx.route('https://cdn.jsdelivr.net/**',route_local)
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
    page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout',timeout=35000)
    page.evaluate('window.originalDigits=FormulaClock.digits')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax')
    if not args.local_mathjax:assert report['mathjax']=='4.1.3'
    assert page.evaluate('FormulaClock.state.display.font')=='stix2'

    def preview(time,wait=700):
        page.evaluate('(t)=>FormulaClock.preview("2026-09-08T"+t+"+09:00",true)',time)
        code=time[:2]+time[3:5];sec=int(time[6:8])
        page.wait_for_function('([c,s])=>FormulaClock.state.layout?.code===c && FormulaClock.state.layout?.seconds===s && FormulaClock.state.coverage!==undefined',arg=[code,sec])
        if wait:page.wait_for_timeout(wait)
        assert not page.evaluate('FormulaClock.state.engineError')

    def settings(font,division):
        page.evaluate('([font,division])=>FormulaClock.setDisplay({font,division})',[font,division])
        page.wait_for_function('([f,d])=>FormulaClock.state.layout?.display.font===f && FormulaClock.state.layout?.display.division===d',arg=[font,division])
        page.wait_for_timeout(720)

    def check_geometry():
        diag=page.evaluate('FormulaClock.diagnostics()')
        assert all(x['inStage'] and x['visibility']=='visible' for x in diag['glyphs']),diag
        assert page.evaluate('FormulaClock.digits.every((el,i)=>el===window.originalDigits[i])')
        delta=page.evaluate('''()=>{
          const stage=document.querySelector('#stage'), sr=stage.getBoundingClientRect();
          const layer=document.querySelector('#notation-root').lastElementChild;
          const paths=[...layer.querySelectorAll('path[data-c="3D"]')];
          if(!paths.length)return null;
          const rects=paths.map(p=>p.getBoundingClientRect());
          return (Math.min(...rects.map(r=>r.top))+Math.max(...rects.map(r=>r.bottom)))/2-sr.top-sr.height/2;
        }''')
        if delta is not None:assert abs(delta)<.12,(delta,diag)
        return {'time':diag['time'],'display':diag['display'],'axisErrorPx':delta,'fontAxis':diag['typography']['axisEm']}

    for font in ['stix2','euler','oldstyle']:
        for division in ['fraction','inline']:
            settings(font,division)
            for time in ['12:34:08','12:34:16','12:34:17','12:34:30','12:34:31','12:34:59','08:59:05','00:00:08']:
                preview(time)
                report['cases'].append(check_geometry())
            diag=page.evaluate('FormulaClock.diagnostics()')
            if font!='euler':assert diag['typography']['axisEm']==diag['typography']['originalAxisEm']
            else:assert diag['typography']['axisEm']==diag['typography']['numericAxisEm']
    report['checks'].append('48 formula/time layouts; 3 font profiles × 2 division modes; persistent HHMM elements; equal-sign axis')

    settings('oldstyle','inline');preview('12:34:08')
    glyphs=page.evaluate('FormulaClock.diagnostics().glyphs')
    assert glyphs[2]['height']>glyphs[0]['height']*1.25
    assert page.evaluate('''()=>{
      const s=document.querySelector('#stage').getBoundingClientRect();
      const el=FormulaClock.digits[2], r=el.getBoundingClientRect();
      return r.bottom-s.top > FormulaClock.state.layout.items[2].matrix[5]+10;
    }''')
    report['checks'].append('Oldstyle 3 descends below the baseline; 1 is shorter; native axis is preserved')
    if args.screenshots:
        out=ROOT/'tests'/'screenshots';out.mkdir(exist_ok=True)
        page.screenshot(path=str(out/'oldstyle-inline.png'),full_page=True)

    # Switching changes typography, not the active expression, slots, or transport.
    ast=page.evaluate('JSON.stringify(FormulaClock.state.layout.ast)')
    for font in ['euler','oldstyle','euler','oldstyle']:
        settings(font,'fraction');assert page.evaluate('JSON.stringify(FormulaClock.state.layout.ast)')==ast
        check_geometry()
    assert page.locator('.math-engine-frame').count()==3
    report['checks'].append('Cached independent font engines; repeated font switching leaves expression and digit identity intact')

    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':840})
        for division in ['fraction','inline']:
            settings('oldstyle',division)
            for time in ['12:34:08','12:34:59','00:00:08']:
                preview(time);check_geometry()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        if args.screenshots:page.screenshot(path=str(out/f'oldstyle-mobile-{width}.png'),full_page=True)
    report['checks'].append('320 / 390 / 768 px: no horizontal overflow; fractions, superscripts and plain time visible')
    page.set_viewport_size({'width':1440,'height':1000})

    # Carefully chosen valid clock equation: 1 + 2 / (4 / 8) = 5.
    nested={'op':'add','a':{'op':'lit','i':0,'j':1},'b':{'op':'div','a':{'op':'lit','i':1,'j':2},'b':{'op':'div','a':{'op':'lit','i':2,'j':3},'b':{'op':'lit','i':3,'j':4}}}}
    preview('12:48:05')
    page.evaluate('''ast=>{window.customAst=ast;FormulaClock.setDataProvider({async getMinute(hhmm){const seconds=Array(60).fill(null);if(hhmm==='1248')seconds[5]=ast;return {schema:'formula-clock/1',hhmm,seconds};}});}''',nested)
    page.wait_for_function("FormulaClock.state.coverage===1 && FormulaClock.state.layout?.mode==='formula'")
    settings('oldstyle','inline');check_geometry()
    tex=page.evaluate('FormulaClock.state.layout.tex');assert tex.count('\\div')==2 and tex.count('\\left(')==1,tex
    report['checks'].append('Nested division produces visible denominator parentheses and remains a valid clock equation')

    # A provider is allowed to ignore AbortSignal: revision checks still reject late data.
    page.evaluate('''()=>{
      window.late=[];
      FormulaClock.setDataProvider({getMinute(hhmm){return new Promise(resolve=>late.push(()=>resolve({schema:'formula-clock/1',hhmm,seconds:Array(60).fill(null)})));}});
    }''')
    page.wait_for_function('late.length>=1')
    page.evaluate('''()=>FormulaClock.setDataProvider({async getMinute(hhmm){const seconds=Array(60).fill(null);if(hhmm==='1248')seconds[5]=customAst;return {schema:'formula-clock/1',hhmm,seconds};}})''')
    page.wait_for_function("FormulaClock.state.coverage===1 && FormulaClock.state.layout?.mode==='formula'")
    page.evaluate('late.forEach(resolve=>resolve())');page.wait_for_timeout(300)
    assert page.evaluate('FormulaClock.state.coverage')==1
    page.evaluate("FormulaClock.setDataProvider({async getMinute(){throw new Error('Test transport failure')}})")
    page.wait_for_function("FormulaClock.state.dataError && FormulaClock.state.layout?.mode==='time'")
    page.wait_for_timeout(700);check_geometry()
    assert '読み込めなかった' in page.locator('#state-label').inner_text()
    assert '—' in page.locator('#coverage').inner_text()
    report['checks'].append('Late old-provider response discarded; failed data delivery is distinct from null and displays ordinary time')
    page.evaluate("FormulaClock.setDataProvider(new FormulaData.TableProvider(()=>FormulaData.loadEmbedded(document.querySelector('#clock-data'))))")
    preview('12:34:30');settings('oldstyle','inline')

    # The visible import control accepts both envelopes; malformed imports are transactional.
    revision=page.evaluate('FormulaClock.state.dataRevision')
    page.locator('#data-file').set_input_files(str(ROOT/'data'/'example-1234.json'))
    page.wait_for_function('(r)=>FormulaClock.state.dataRevision>r',arg=revision)
    assert 'example-1234.json' in page.locator('#data-status').text_content()
    revision=page.evaluate('FormulaClock.state.dataRevision')
    page.locator('#data-file').set_input_files(str(ROOT/'data'/'example-table.json'))
    page.wait_for_function('(r)=>FormulaClock.state.dataRevision>r',arg=revision)
    revision=page.evaluate('FormulaClock.state.dataRevision')
    page.locator('#data-file').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{"schema":"formula-clock/1","minutes":{"1234":[]}}'})
    page.wait_for_function("document.querySelector('#data-status').textContent.includes('読込失敗')")
    assert page.evaluate('FormulaClock.state.dataRevision')==revision
    page.evaluate("document.querySelector('#restore-data').click()")
    page.wait_for_function('(r)=>FormulaClock.state.dataRevision>r',arg=revision)
    preview('12:34:30');settings('oldstyle','inline')
    report['checks'].append('Minute/table JSON import, malformed import leaves provider intact, restore initial data')

    # Sample the actual animated transforms at 30 -> 31 (all HHMM stay on baseline).
    samples=page.evaluate('''async()=>{
      const out=[];FormulaClock.preview('2026-09-08T12:34:31+09:00');
      const started=performance.now();
      while(performance.now()-started<850){
        await new Promise(requestAnimationFrame);
        out.push(FormulaClock.digits.map(x=>x.transform.baseVal.consolidate().matrix.f));
      }return out;
    }''')
    ranges=[max(x[i] for x in samples)-min(x[i] for x in samples) for i in range(4)]
    assert max(ranges)<.01,ranges
    report['animationSamples']=len(samples);report['baselineRangesPx']=ranges

    page.click('#sound');page.evaluate("FormulaClock.preview('2026-09-08T23:59:56.700+09:00',false)");page.wait_for_timeout(4750)
    audio=page.evaluate('FormulaClock.state.audio')
    assert [x['frequency'] for x in audio[-4:]]==[440,440,440,880],audio
    report['checks'].append('Midnight audio: three countdown tones followed by the minute signal')
    assert not errors,errors
    report['pageErrors']=errors
    browser.close()
name='browser-compatibility-results.json' if args.local_mathjax else 'browser-results.json'
(ROOT/'tests'/name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
