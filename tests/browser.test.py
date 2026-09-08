"""Default: delivered MathJax 4 configuration, requires CDN access.
--local-mathjax DIR substitutes an installed MathJax 3 for compatibility testing.
That run tests real CM oldstyle glyphs, but NOT the v4/Euler delivery path.
No font files are copied into this repository.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, shutil, sys, platform
from datetime import datetime, timezone
from importlib.metadata import version

ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser()
ap.add_argument('--local-mathjax',type=Path)
ap.add_argument('--screenshots',action='store_true')
ap.add_argument('--symbol-motion',action='store_true')
ap.add_argument('--url',default=(ROOT/'index.html').as_uri())
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path)
args=ap.parse_args()
out=args.output_dir or ROOT/'test-results'/args.browser
out.mkdir(parents=True,exist_ok=True)
report={'build':'r6-minimal','compatibilityOnly':bool(args.local_mathjax),'url':args.url,'browser':args.browser,'playwright':version('playwright'),'python':platform.python_version(),'command':sys.argv,'at':datetime.now(timezone.utc).isoformat(),'cases':[], 'checks':[]}
errors=[]; warnings=[]; requests=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch(headless=True)
    report['browserVersion']=browser.version
    ctx=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    if args.symbol_motion:
        ctx.add_init_script("localStorage.setItem('formula-clock-display-v2',JSON.stringify({symbolMotion:true}))")
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
    page.on('console',lambda msg:warnings.append(msg.text) if msg.type=='warning' else None)
    page.on('request',lambda request:requests.append(request.url))
    page.goto(args.url,wait_until='domcontentloaded')
    page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout',timeout=35000)
    page.evaluate('window.originalDigits=FormulaClock.digits')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax')
    if not args.local_mathjax:assert report['mathjax']=='4.1.3'
    assert page.evaluate('FormulaClock.state.display.font')=='stix2'
    assert page.locator('#symbol-motion').is_checked()==args.symbol_motion

    assert page.locator('#font-choice option').evaluate_all('(options)=>options.map(x=>x.value)')==['stix2','euler']
    assert page.locator('.intro,.source-caption,.mode,.minute-head,.demo-panel,footer,#info,#coverage,#date,#zone').count()==0
    assert page.locator('#settings').is_hidden()
    stage_before=page.locator('#stage').bounding_box()
    page.click('#settings-open')
    assert page.locator('#settings').is_visible()
    assert page.evaluate('document.activeElement.id')=='settings-close'
    page.locator('.settings-links a').focus();page.keyboard.press('Tab')
    assert page.evaluate("document.querySelector('#settings').contains(document.activeElement)")
    page.keyboard.press('Escape')
    assert page.locator('#settings').is_hidden()
    assert page.evaluate('document.activeElement.id')=='settings-open'
    page.click('#settings-open');page.click('#settings-close')
    assert page.locator('#settings').is_hidden()
    page.click('#settings-open');page.mouse.click(8,8)
    assert page.locator('#settings').is_hidden()
    assert page.locator('#stage').bounding_box()==stage_before
    page.click('#settings-open');page.click('#licenses-open')
    assert page.locator('#licenses').is_visible()
    assert page.evaluate('document.activeElement.id')=='licenses-close'
    assert page.locator('#licenses').evaluate('(el)=>el.scrollTop')==0
    assert 'Latin Modern' in page.locator('#licenses').inner_text()
    page.locator('#licenses summary').last.focus();page.keyboard.press('Tab')
    assert page.evaluate('document.activeElement.id')=='licenses-close'
    page.keyboard.press('Escape')
    assert page.locator('#licenses').is_hidden() and page.locator('#settings').is_visible()
    assert page.evaluate('document.activeElement.id')=='licenses-open'
    page.click('#licenses-open');page.click('#licenses-close')
    page.click('#licenses-open');page.mouse.click(8,8)
    assert page.locator('#licenses').is_hidden()
    assert page.locator('.settings-links a').get_attribute('href')=='https://github.com/necocen/formula-clock'
    assert page.locator('#sound').inner_text()==''
    page.keyboard.press('Escape')
    page.click('#settings-open');page.fill('#custom-time','16:39:19');page.click('#custom-go')
    page.wait_for_function("FormulaClock.state.layout?.code==='1639' && FormulaClock.state.layout?.seconds===19")
    assert page.locator('#settings').is_hidden()
    assert page.locator('#transport').is_visible()
    assert page.locator('#stage').bounding_box()==stage_before
    page.click('#go-live')
    assert page.locator('#transport').is_hidden()
    assert page.locator('#stage').bounding_box()==stage_before
    report['checks'].append('Minimal UI, two fonts, dialog dismissal/focus trapping, custom preview, stable stage position')

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
          if(FormulaClock.state.layout.mode!=='formula')return null;
          const paths=[...document.querySelectorAll('#equal-sign path[data-c="3D"]')];
          if(!paths.length)throw new Error('Missing persistent equality');
          const rects=paths.map(p=>p.getBoundingClientRect());
          return (Math.min(...rects.map(r=>r.top))+Math.max(...rects.map(r=>r.bottom)))/2-sr.top-sr.height/2;
        }''')
        if delta is not None:
            assert abs(delta)<.12,(delta,diag)
            assert page.locator('#equal-sign path').first.evaluate('(el)=>getComputedStyle(el).fill')=='rgb(195, 200, 186)'
        formula=page.evaluate("FormulaClock.state.layout.mode==='formula'")
        assert page.locator('#source-time').is_visible()==formula
        assert page.evaluate("getComputedStyle(document.querySelector('#source-second')).fontSize===getComputedStyle(document.querySelector('#source-time [data-digit]')).fontSize")
        assert page.locator('#notation-root path[data-c="3D"]').count()==0
        return {'time':diag['time'],'display':diag['display'],'axisErrorPx':delta,'fontAxis':diag['typography']['axisEm']}

    for font in ['stix2','euler']:
        for division in ['fraction','inline']:
            settings(font,division)
            for time in ['12:34:08','12:34:16','12:34:17','12:34:30','12:34:31','12:34:59','08:59:05','00:00:08']:
                preview(time)
                report['cases'].append(check_geometry())
            diag=page.evaluate('FormulaClock.diagnostics()')
            if font!='euler':assert diag['typography']['axisEm']==diag['typography']['originalAxisEm']
            else:assert diag['typography']['axisEm']==diag['typography']['numericAxisEm']
    report['checks'].append('32 formula/time layouts; 2 font profiles × 2 division modes; persistent HHMM elements; equal-sign axis')

    settings('stix2','inline');preview('12:34:08')
    glyphs=page.evaluate('FormulaClock.diagnostics().glyphs')
    assert glyphs[2]['height']>glyphs[0]['height']*1.25
    assert page.evaluate('''()=>{
      const s=document.querySelector('#stage').getBoundingClientRect();
      const el=FormulaClock.digits[2], r=el.getBoundingClientRect();
      return r.bottom-s.top > FormulaClock.state.layout.items[2].matrix[5]+10;
    }''')
    report['checks'].append('Oldstyle 3 descends below the baseline; 1 is shorter; native axis is preserved')
    if args.screenshots:
        page.screenshot(path=str(out/'stix2-inline.png'),full_page=True)

    # Switching changes typography, not the active expression, slots, or transport.
    ast=page.evaluate('JSON.stringify(FormulaClock.state.layout.ast)')
    for font in ['euler','stix2','euler','stix2']:
        settings(font,'fraction');assert page.evaluate('JSON.stringify(FormulaClock.state.layout.ast)')==ast
        check_geometry()
    assert page.locator('.math-engine-frame').count()==2
    report['checks'].append('Cached independent font engines; repeated font switching leaves expression and digit identity intact')

    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':840})
        for division in ['fraction','inline']:
            settings('stix2',division)
            for time in ['12:34:08','12:34:59','00:00:08']:
                preview(time);check_geometry()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.click('#settings-open')
        r=page.locator('#settings').bounding_box()
        assert r['x']>=0 and r['x']+r['width']<=width+1
        assert r['y']>=0 and r['y']+r['height']<=840
        page.click('#advanced-settings summary') if not page.locator('#advanced-settings').get_attribute('open') is not None else None
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        if args.screenshots:page.screenshot(path=str(out/f'settings-{width}.png'),full_page=True)
        page.click('#licenses-open')
        r=page.locator('#licenses').bounding_box()
        assert r['x']>=0 and r['x']+r['width']<=width+1 and r['y']>=0 and r['y']+r['height']<=840
        page.locator('#licenses summary').first.click()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        if args.screenshots:page.screenshot(path=str(out/f'licenses-{width}.png'),full_page=True)
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        if args.screenshots:page.screenshot(path=str(out/f'stix2-mobile-{width}.png'),full_page=True)
    report['checks'].append('320 / 390 / 768 px: no horizontal overflow; fractions, superscripts and plain time visible')
    page.set_viewport_size({'width':1440,'height':1000})

    for time in ['12:59:58','13:00:00','23:59:58','00:00:00']:
        preview(time);check_geometry()
    report['checks'].append('HTTP provider crosses hour and midnight boundaries')
    page.emulate_media(reduced_motion='reduce')
    preview('12:34:08');check_geometry()
    preview('12:34:59');check_geometry()
    page.emulate_media(reduced_motion='no-preference')
    report['checks'].append('Reduced-motion fractions and powers stay visible')

    # Carefully chosen valid clock equation: 1 + 2 / (4 / 8) = 5.
    nested={'op':'add','a':{'op':'lit','i':0,'j':1},'b':{'op':'div','a':{'op':'lit','i':1,'j':2},'b':{'op':'div','a':{'op':'lit','i':2,'j':3},'b':{'op':'lit','i':3,'j':4}}}}
    preview('12:48:05')
    page.evaluate('''ast=>{window.customAst=ast;FormulaClock.setDataProvider({async getMinute(hhmm){const seconds=Array(60).fill(null);if(hhmm==='1248')seconds[5]=ast;return {schema:'formula-clock/1',hhmm,seconds};}});}''',nested)
    page.wait_for_function("FormulaClock.state.coverage===1 && FormulaClock.state.layout?.mode==='formula'")
    settings('stix2','inline');check_geometry()
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
    report['checks'].append('Late old-provider response discarded; failed data delivery is distinct from null and displays ordinary time')
    page.evaluate("document.querySelector('#restore-data').click()")
    preview('12:34:30');settings('stix2','inline')

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
    preview('12:34:30');settings('stix2','inline')
    report['checks'].append('Minute/table JSON import, malformed import leaves provider intact, restore initial data')

    # The equal sign retains its group AND paths while moving between formulas.
    equality=page.evaluate("""async()=>{
      const el=document.querySelector('#equal-sign'), child=el.firstChild, samples=[];
      FormulaClock.preview('2026-09-08T12:34:31+09:00');
      const started=performance.now();
      while(performance.now()-started<850){
        await new Promise(requestAnimationFrame);
        const r=el.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();
        samples.push({x:r.x,axis:(r.top+r.bottom)/2-stage.top-stage.height/2,
          opacity:getComputedStyle(el).opacity,same:el.firstChild===child});
      }return samples;
    }""")
    assert all(s['same'] and s['opacity']=='1' and abs(s['axis'])<.12 for s in equality),equality
    xs=[s['x'] for s in equality]
    assert max(xs)-min(xs)>1 and len(set(round(x,2) for x in xs))>5,xs
    report['checks'].append('Persistent equal-sign glyph moves continuously on the fixed axis; source time only appears above formulas with equal-size seconds')
    preview('12:34:30')

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

    settings('stix2','fraction');preview('16:39:19')
    if args.screenshots:page.screenshot(path=str(out/'stix2-163919.png'),full_page=True)
    page.evaluate('FormulaClock.live()');page.wait_for_timeout(1000)
    if args.screenshots:page.screenshot(path=str(out/'live.png'),full_page=True)
    page.click('#fullscreen');page.wait_for_timeout(300)
    assert page.evaluate("document.body.classList.contains('fullscreen')")
    page.click('#fullscreen');page.wait_for_timeout(300)
    assert not page.evaluate("document.body.classList.contains('fullscreen')")
    report['checks'].append('Fullscreen enters and exits without losing controls')

    page.click('#sound');page.evaluate("FormulaClock.preview('2026-09-08T23:59:56.700+09:00',false)");page.wait_for_timeout(4750)
    audio=page.evaluate('FormulaClock.state.audio')
    assert [x['frequency'] for x in audio[-4:]]==[440,440,440,880],audio
    report['checks'].append('Midnight audio: three countdown tones followed by the minute signal')
    assert not errors,errors
    report['pageErrors']=errors
    report['warnings']=warnings
    report['cdnRequests']=sorted(set(url for url in requests if 'cdn.jsdelivr.net' in url))
    report['dataRequests']=sorted(set(url for url in requests if '/data/' in url))
    browser.close()
name='browser-compatibility-results.json' if args.local_mathjax else 'browser-results.json'
(out/name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'browser':args.browser,'version':report['browserVersion'],'mathjax':report['mathjax'],'cases':len(report['cases']),'checks':report['checks'],'warnings':report['warnings'],'report':str(out/name)},ensure_ascii=False,indent=2))
