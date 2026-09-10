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
ap.add_argument('--symbol-motion',action=argparse.BooleanOptionalAction,default=True)
ap.add_argument('--structure-motion',action=argparse.BooleanOptionalAction,default=True)
ap.add_argument('--symbol-morph',action=argparse.BooleanOptionalAction,default=True)
ap.add_argument('--url',default=(ROOT/'index.html').as_uri())
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path)
args=ap.parse_args()
# Either optional motion feature includes the basic-symbol prerequisite.
args.symbol_motion = args.symbol_motion or args.structure_motion or args.symbol_morph
out=args.output_dir or ROOT/'test-results'/args.browser
out.mkdir(parents=True,exist_ok=True)
report={'build':'r6-minimal','compatibilityOnly':bool(args.local_mathjax),'url':args.url,'browser':args.browser,'playwright':version('playwright'),'python':platform.python_version(),'command':sys.argv,'at':datetime.now(timezone.utc).isoformat(),'cases':[], 'checks':[]}
errors=[]; warnings=[]; requests=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch(headless=True)
    report['browserVersion']=browser.version
    ctx=browser.new_context(locale='ja-JP', viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    saved=json.dumps({'symbolMotion':args.symbol_motion,'structureMotion':args.structure_motion,'symbolMorph':args.symbol_morph})
    ctx.add_init_script("localStorage.setItem('formula-clock-display-v2',"+json.dumps(saved)+")")
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
    page.evaluate("window.originalSourceDigits=[...document.querySelectorAll('#source-time .source-digit')];window.originalSourceColons=[...document.querySelectorAll('#source-time .colon')]")
    page.evaluate("window.originalProvider=window.FORMULA_CLOCK_CONFIG?.provider || new FormulaData.TableProvider(()=>FormulaData.loadEmbedded(document.querySelector('#clock-data')))")
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax')
    if not args.local_mathjax:assert report['mathjax']=='4.1.3'
    assert page.evaluate('FormulaClock.state.display.font')=='stix2'
    assert page.evaluate('FormulaClock.state.display.numerals')=='oldstyle'
    assert page.locator('#numeral-choice input').evaluate_all('(options)=>options.map(x=>x.value)')==['lining','oldstyle']
    assert page.locator('#symbol-motion').is_checked()==args.symbol_motion
    assert page.locator('#structure-motion').is_checked()==args.structure_motion
    assert page.locator('#symbol-morph').is_checked()==args.symbol_morph

    assert page.locator('#font-choice option').evaluate_all('(options)=>options.map(x=>x.value)')==['stix2','termes','fira','euler']
    assert page.locator('#division-choice input').evaluate_all('(options)=>options.map(x=>x.value)')==['fraction','inline','slash']
    assert page.locator('#import-data,#restore-data,#data-file,#data-status').count()==0
    assert page.locator('#advanced-settings .experimental-option').count()==3
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
    report['checks'].append('Minimal UI, four fonts and an independent numeral selector, dialog dismissal/focus trapping, custom preview, stable stage position')

    def preview(time,wait=700):
        page.evaluate('(t)=>FormulaClock.preview("2026-09-08T"+t+"+09:00",true)',time)
        code=time[:2]+time[3:5];sec=int(time[6:8])
        page.wait_for_function('([c,s])=>FormulaClock.state.layout?.code===c && FormulaClock.state.layout?.seconds===s && FormulaClock.state.coverage!==undefined',arg=[code,sec])
        if wait:page.wait_for_timeout(wait)
        assert not page.evaluate('FormulaClock.state.engineError')

    def settings(font,division,numerals='oldstyle'):
        page.evaluate('([font,division,numerals])=>FormulaClock.setDisplay({font,division,numerals})',[font,division,numerals])
        page.wait_for_function('([f,d,n])=>FormulaClock.state.layout?.display.font===f && FormulaClock.state.layout?.display.division===d && FormulaClock.state.layout?.display.numerals===n',arg=[font,division,numerals])
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
        source=page.evaluate('''()=>{
          const el=document.querySelector('#source-time'),svg=el.querySelector('svg'),inverse=svg.getScreenCTM().inverse();
          const digits=[...el.querySelectorAll('.source-digit')],colons=[...el.querySelectorAll('.colon')];
          function bounds(g){
            const r=g.getBoundingClientRect(),p=new DOMPoint((r.left+r.right)/2,(r.top+r.bottom)/2).matrixTransform(inverse);
            return {x:p.x,y:p.y,inside:r.left>=el.getBoundingClientRect().left && r.right<=el.getBoundingClientRect().right && r.top>=el.getBoundingClientRect().top && r.bottom<=el.getBoundingClientRect().bottom};
          }
          return {font:el.dataset.font,numerals:el.dataset.numerals,text:digits.map(g=>g.dataset.value).join(''),
            persistent:digits.every((g,i)=>g===originalSourceDigits[i]) && colons.every((g,i)=>g===originalSourceColons[i]),
            digits:digits.map(bounds),colons:colons.map(bounds),
            glyphFonts:digits.map(g=>g.querySelector('path').getAttribute('data-glyph-key'))};
        }''')
        state=page.evaluate('FormulaClock.state.layout')
        assert source['font']==state['display']['font'] and source['persistent'],source
        assert source['numerals']==state['display']['numerals'],source
        assert source['text']==state['code']+f"{state['seconds']:02d}",source
        assert all(g['inside'] for g in source['digits']+source['colons']),source
        assert all(abs(g['x']-x)<1 for g,x in zip(source['digits'],[400,900,1850,2350,3300,3800])),source
        assert all(abs(g['x']-x)<1 and abs(g['y']-550)<1 for g,x in zip(source['colons'],[1375,2825])),source
        if not args.local_mathjax:
            assert all(key.startswith(source['font']+'@4.1.3:') for key in source['glyphFonts']),source
            assert all(('-tex-oldstyle:' in key)==(source['numerals']=='oldstyle') for key in source['glyphFonts']),source
        assert page.evaluate('''()=>[...document.querySelectorAll('#source-time .source-digit')].every((g,i,all)=>{
          const lower=i<4?FormulaClock.digits[i]:document.querySelector('.answer-digit[data-second="'+(i-4)+'"]');
          const paths=el=>JSON.stringify([...el.querySelectorAll('path')].map(p=>p.getAttribute('d')));
          return paths(g)===paths(lower) && (!i || all[i-1].getBoundingClientRect().right<g.getBoundingClientRect().left);
        })''')
        assert page.locator('#notation-root path[data-c="3D"]').count()==0
        return {'time':diag['time'],'display':diag['display'],'axisErrorPx':delta,'fontAxis':diag['typography']['axisEm']}

    numeral_shapes={}
    for font in ['stix2','termes','fira','euler']:
        for numerals in ['lining','oldstyle']:
            for division in ['fraction','inline','slash']:
                settings(font,division,numerals)
                for time in ['12:34:08','12:34:16','12:34:17','12:34:30','12:34:31','12:34:59','23:59:10','08:59:05','00:00:08']:
                    preview(time)
                    report['cases'].append(check_geometry())
                    if time=='12:34:08':
                        numeral_shapes[font,numerals]=page.locator('#source-time [data-digit="2"] path').first.get_attribute('d')
                diag=page.evaluate('FormulaClock.diagnostics()')
                assert diag['typography']['numerals']==numerals
                if numerals=='oldstyle':
                    assert diag['typography']['axisMode']=='font'
                    assert diag['typography']['axisEm']==diag['typography']['originalAxisEm']
                else:
                    assert diag['typography']['axisMode']=='numeric'
                    assert diag['typography']['axisEm']==diag['typography']['numericAxisEm']
            if args.screenshots:
                preview('16:39:19');page.screenshot(path=str(out/f'{font}-{numerals}.png'),full_page=True)
        if not args.local_mathjax:assert numeral_shapes[font,'lining']!=numeral_shapes[font,'oldstyle'],font
    if not args.local_mathjax:assert len(set(numeral_shapes.values()))==8
    report['checks'].append('216 formula/time layouts; 4 fonts × 2 numeral styles × 3 division modes; distinct native glyphs; persistent HHMM elements; lining numeric axis and oldstyle native axis')
    report['checks'].append('Small clock uses the selected math font with six persistent fixed-width digit cells, fixed colon centers, equal-size seconds and no clipped ascenders/descenders')

    # The two controls are independent; same-family style changes replace glyph
    # children, while retaining the six slots and the currently previewed formula.
    settings('stix2','fraction','lining');preview('12:34:08')
    page.click('#settings-open');page.select_option('#font-choice','fira')
    page.wait_for_function("FormulaClock.state.layout.display.font==='fira'")
    assert page.evaluate('FormulaClock.state.display.numerals')=='lining'
    page.evaluate("window.beforeStyle=[...document.querySelectorAll('#source-time .source-digit')][2].querySelector('path').getAttribute('d')")
    page.locator('#numeral-choice input[value=oldstyle]').check()
    page.wait_for_function("FormulaClock.state.layout.display.numerals==='oldstyle'")
    page.wait_for_timeout(750)
    if not args.local_mathjax:
        assert page.locator('#source-time [data-digit="2"] path').first.get_attribute('d')!=page.evaluate('beforeStyle')
    assert page.evaluate('FormulaClock.state.layout.code')=='1234'
    assert page.evaluate('FormulaClock.state.layout.seconds')==8
    stored=page.evaluate("JSON.parse(localStorage.getItem('formula-clock-display-v2'))")
    assert stored['font']=='fira' and stored['numerals']=='oldstyle'
    page.keyboard.press('Escape')
    # Rapid switches can complete out of order. Both the main and small clock
    # must settle to the last font AND numeral style.
    page.evaluate("Promise.all([FormulaClock.setDisplay({font:'euler',numerals:'lining'}),FormulaClock.setDisplay({font:'termes',numerals:'oldstyle'}),FormulaClock.setDisplay({font:'fira',numerals:'lining'}),FormulaClock.setDisplay({font:'stix2',numerals:'oldstyle'})])")
    page.wait_for_function("FormulaClock.state.layout.display.font==='stix2' && FormulaClock.state.layout.display.numerals==='oldstyle'")
    page.wait_for_timeout(750);check_geometry()
    report['checks'].append('Independent font/numeral UI controls preserve the chosen style, expression and time; style changes update both clocks; rapid switches discard stale results')

    # Reusing unchanged small-clock digits must preserve their glyph children too.
    settings('stix2','fraction');preview('12:34:30')
    page.evaluate("window.sourceChildren=originalSourceDigits.map(g=>g.firstChild);window.colonChildren=originalSourceColons.map(g=>g.firstChild)")
    preview('12:34:31')
    assert page.evaluate('originalSourceDigits.slice(0,5).every((g,i)=>g.firstChild===sourceChildren[i]) && originalSourceColons.every((g,i)=>g.firstChild===colonChildren[i])')
    assert page.evaluate('originalSourceDigits[5].firstChild!==sourceChildren[5]')
    assert page.evaluate('''()=>originalSourceDigits.every((g,i)=>{
      const lower=i<4?FormulaClock.digits[i]:document.querySelector('.answer-digit[data-second="'+(i-4)+'"]');
      return JSON.stringify([...g.querySelectorAll('path')].map(p=>p.getAttribute('d')))===JSON.stringify([...lower.querySelectorAll('path')].map(p=>p.getAttribute('d')));
    })''')
    report['checks'].append('Small-clock glyphs match the formula glyphs; unchanged digits and colon paths survive second changes')

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
    for font in ['euler','termes','fira','stix2']:
        for numerals in ['lining','oldstyle']:
            settings(font,'fraction',numerals);assert page.evaluate('JSON.stringify(FormulaClock.state.layout.ast)')==ast
            check_geometry()
    assert page.locator('.math-engine-frame').count()==8
    report['checks'].append('Cached independent font engines; repeated font switching leaves expression and digit identity intact')

    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':840})
        for division in ['fraction','inline','slash']:
            settings('stix2',division)
            for time in ['23:59:10','12:34:59','00:00:08']:
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
    preview('23:59:10');check_geometry()
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
    settings('stix2','slash');check_geometry()
    tex=page.evaluate('FormulaClock.state.layout.tex');assert tex.count('/')==2 and tex.count('\\left(')==1,tex
    assert page.locator('#operator-root path[data-c="2F"]').count()==2
    assert page.evaluate('FormulaClock.state.layout.ast')==nested
    report['checks'].append('Nested obelus and slash division preserve denominator parentheses, the AST and persistent digits')

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
    page.evaluate("FormulaClock.setDataProvider(originalProvider)")
    preview('12:34:30');settings('stix2','inline')

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
    if page.locator('#fullscreen').is_visible():
        preview('12:34:30')
        normal_size = page.evaluate('FormulaClock.state.layout.fontSize')
        page.click('#fullscreen')
        page.wait_for_function('document.fullscreenElement || document.webkitFullscreenElement')
        assert page.locator('#fullscreen').get_attribute('aria-pressed') == 'true'
        page.wait_for_function('size=>FormulaClock.state.layout.fontSize>size*1.4',arg=normal_size)
        assert page.evaluate('FormulaClock.state.layout.fontSize') <= 160.01
        assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i])')
        page.click('#fullscreen')
        page.wait_for_function('!document.fullscreenElement && !document.webkitFullscreenElement')
        assert page.locator('#fullscreen').get_attribute('aria-pressed') == 'false'
        page.wait_for_function('size=>Math.abs(FormulaClock.state.layout.fontSize-size)<.01',arg=normal_size)
        report['checks'].append('Native fullscreen enlarges the clock within 160px, preserves digit elements and restores the normal size on exit')
    else:
        assert not page.evaluate("document.body.classList.contains('fullscreen')")
        report['checks'].append('Unsupported fullscreen control is hidden')

    page.click('#sound');page.evaluate("FormulaClock.preview('2026-09-08T23:59:56.700+09:00',false)");page.wait_for_timeout(4750)
    audio=page.evaluate('FormulaClock.state.audio')
    midnight=[x for x in audio if x['type'] in ['countdown','minute']]
    assert [x['frequency'] for x in midnight[-4:]]==[500,500,500,1000],audio
    report['checks'].append('117-style midnight audio: three 500 Hz countdown pulses followed by the 1000 Hz minute signal')

    # Fix wall time while leaving rendering timers running. Observe the public
    # provider contract so the same scheduling checks apply to either delivery mode.
    page.click('#sound')
    def live_at(time):
        page.clock.set_fixed_time('2026-09-09T'+time+'+09:00')
        page.evaluate('FormulaClock.live()')

    def track_prefetch():
        page.evaluate('''()=>{
          Math.random=()=>.5;
          window.prefetchReads=[];
          FormulaClock.setDataProvider({async getMinute(hhmm){
            prefetchReads.push(hhmm);
            return {schema:'formula-clock/1',hhmm,seconds:Array(60).fill(null)};
          }});
        }''')
        page.wait_for_function('FormulaClock.state.coverage===0')

    live_at('12:59:00');track_prefetch()
    assert page.evaluate('prefetchReads')==['1259']
    page.evaluate('Math.random=()=>0') # A redraw must not draw a new deadline.
    live_at('12:59:14')
    assert page.evaluate('prefetchReads')==['1259']
    live_at('12:59:15')
    page.wait_for_function("prefetchReads.includes('1300')")
    live_at('12:59:29')
    assert page.evaluate('prefetchReads')==['1259','1300']

    live_at('23:59:00');track_prefetch()
    assert page.evaluate('prefetchReads')==['2359']
    live_at('23:59:15')
    page.wait_for_function("prefetchReads.includes('0000')")
    assert page.evaluate('prefetchReads')==['2359','0000']

    live_at('12:59:00');track_prefetch()
    page.evaluate("FormulaClock.preview('2026-09-09T12:59:00+09:00')")
    page.wait_for_function("prefetchReads.includes('1300')")
    assert page.evaluate('prefetchReads')==['1259','1300']

    live_at('13:59:50');track_prefetch()
    page.wait_for_function("prefetchReads.includes('1400')")
    assert page.evaluate('prefetchReads')==['1359','1400']

    live_at('12:59:00');track_prefetch()
    live_at('14:00:00') # Resume after skipping the pending hour boundary.
    page.wait_for_function("prefetchReads.includes('1401')")
    assert page.evaluate('prefetchReads')==['1259','1400','1401']
    track_prefetch() # Replacing the provider must discard the earlier plan.
    live_at('14:00:30')
    assert page.evaluate('prefetchReads')==['1400','1401']
    report['checks'].append('Live hour prefetch is jittered once within :59:00–30; midnight, immediate current/preview/late-entry requests and skipped-minute/provider cleanup')
    migrations=[({'font':'stix2'},'stix2','oldstyle'),({'font':'euler'},'euler','lining'),({'font':'oldstyle'},'stix2','oldstyle'),({'font':'termes','numerals':'lining'},'termes','lining'),({'font':'euler','numerals':'oldstyle'},'euler','oldstyle')]
    for saved,font,numerals in migrations:
        migration_ctx=browser.new_context(locale='ja-JP', timezone_id='Asia/Tokyo')
        if args.local_mathjax:migration_ctx.route('https://cdn.jsdelivr.net/**',route_local)
        migration=migration_ctx.new_page()
        # A session flag applies the input once, allowing reload to read the
        # settings written by the real controls/API on the previous page load.
        migration.add_init_script("if(!sessionStorage.fontMigration){localStorage.setItem('formula-clock-display-v2',"+json.dumps(json.dumps(saved))+");sessionStorage.fontMigration='1';}")
        migration.goto(args.url)
        migration.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
        assert migration.evaluate('FormulaClock.state.display.font')==font
        assert migration.evaluate('FormulaClock.state.display.numerals')==numerals
        assert migration.locator('#font-choice').input_value()==font
        assert migration.locator('#numeral-choice input:checked').input_value()==numerals
        migration.evaluate("FormulaClock.setDisplay({font:'fira',numerals:'lining'})")
        migration.reload();migration.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
        assert migration.evaluate('FormulaClock.state.display.font')=='fira'
        assert migration.evaluate('FormulaClock.state.display.numerals')=='lining'
        migration_ctx.close()
    report['checks'].append('Old STIX/Euler/Computer Modern settings migrate without changing their appearance; independent font/numeral selections survive reload')
    assert not errors,errors
    report['pageErrors']=errors
    report['warnings']=warnings
    report['cdnRequests']=sorted(set(url for url in requests if 'cdn.jsdelivr.net' in url))
    report['dataRequests']=sorted(set(url for url in requests if '/data/' in url))
    browser.close()
name='browser-compatibility-results.json' if args.local_mathjax else 'browser-results.json'
(out/name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'browser':args.browser,'version':report['browserVersion'],'mathjax':report['mathjax'],'cases':len(report['cases']),'checks':report['checks'],'warnings':report['warnings'],'report':str(out/name)},ensure_ascii=False,indent=2))
