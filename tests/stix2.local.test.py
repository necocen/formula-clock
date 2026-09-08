from pathlib import Path
import json,sys,shutil,argparse
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser()
ap.add_argument('--local-mathjax',type=Path,required=True)
ap.add_argument('--stix-fonts',type=Path,required=True)
args=ap.parse_args()
sys.path.insert(0,str(R/'tests'))
from local_stix_fixture import make_fixture
print('fixture',flush=True)
fixture=make_fixture(args.stix_fonts)
lib=args.local_mathjax
# Inject actual STIX Two shapes/metrics into a local MathJax 3 engine for testing.
# The external MathJax 4 STIX2 loading path is NOT tested here.
patch=r'''
const requested=window.MathJax.output.font;
delete window.MathJax.output;
if(requested==='mathjax-stix2'){
 const fixture=__FIXTURE__;
 window.MathJax.startup.ready=()=>{
   MathJax.startup.defaultReady();
   const font=MathJax.startup.document.outputJax.font;
   font.defineChars('normal',fixture.normal);
   font.defineChars('-tex-oldstyle',fixture.oldstyle);
   font.params.axis_height=fixture.axis;
 };
}
'''.replace('__FIXTURE__',json.dumps(fixture,separators=(',',':')))
report={'build':'r5-stix2','testEngine':'MathJax 3.2.1 + local STIX Two glyph/metric fixture','fontVersion':fixture['fontVersion'],'deliveryEngine':'MathJax 4.1.3 + mathjax-stix2 (CDN untested)','cases':[]}
errors=[]
print('playwright',flush=True)
with sync_playwright() as p:
 print('launch',flush=True)
 browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo',device_scale_factor=1,reduced_motion='reduce')
 def route_local(route):
  u=route.request.url
  print('route',u,flush=True)
  if u.endswith('/tex-svg-nofont.js'):
   route.fulfill(content_type='application/javascript',body=patch+(lib/'tex-svg.js').read_text());return
  f=lib/u.split('/mathjax@4.1.3/')[-1]
  if f.is_file():route.fulfill(path=str(f),content_type='application/javascript')
  else:route.abort()
 ctx.route('https://cdn.jsdelivr.net/**',route_local)
 page=ctx.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
 page.on('console',lambda m: print('console',m.type,m.text) if m.type in ['warning','error'] else None)
 print('set content',flush=True)
 page.set_content((R/'index.html').read_text(),wait_until='domcontentloaded')
 print('await engine',flush=True)
 page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout',timeout=35000)
 page.evaluate('window.originalDigits=FormulaClock.digits')
 print('engine ready:',page.evaluate('FormulaClock.diagnostics().mathjax'))
 assert page.evaluate('FormulaClock.state.display.font')=='stix2'
 def preview(time):
  page.evaluate('(t)=>FormulaClock.preview("2026-09-08T"+t+"+09:00",true)',time)
  page.wait_for_function('([c,s])=>FormulaClock.state.layout?.code===c&&FormulaClock.state.layout?.seconds===s',arg=[time[:2]+time[3:5],int(time[6:8])])
  page.wait_for_timeout(80)
 def settings(font,div):
  page.evaluate('([font,division])=>FormulaClock.setDisplay({font,division})',[font,div])
  page.wait_for_function('([f,d])=>FormulaClock.state.layout?.display.font===f&&FormulaClock.state.layout?.display.division===d',arg=[font,div])
  page.wait_for_timeout(80)
 def geometry():
  diag=page.evaluate('FormulaClock.diagnostics()')
  assert not diag['engineError'],diag
  assert all(x['inStage'] for x in diag['glyphs']),diag
  assert page.evaluate('FormulaClock.digits.every((x,i)=>x===originalDigits[i])')
  delta=page.evaluate('''()=>{
   const sr=document.querySelector('#stage').getBoundingClientRect();
   const paths=[...document.querySelector('#notation-root').lastElementChild.querySelectorAll('path[data-c="3D"]')];
   if(!paths.length)return null;
   const rects=paths.map(p=>p.getBoundingClientRect());
   return (Math.min(...rects.map(r=>r.top))+Math.max(...rects.map(r=>r.bottom)))/2-sr.top-sr.height/2;
  }''')
  if delta is not None: assert abs(delta)<.12,(delta,diag)
  report['cases'].append({'time':diag['time'],'display':diag['display'],'axisErrorPx':delta,'axisEm':diag['typography']['axisEm']})
 for font in ['stix2','euler','oldstyle']:
  for div in ['fraction','inline']:
   settings(font,div)
   for time in ['16:39:19','12:34:08','12:34:30','12:34:31','12:34:59','08:59:05','00:00:08']:
    preview(time);geometry()
   if font!='euler': assert page.evaluate('FormulaClock.diagnostics().typography.axisEm===FormulaClock.diagnostics().typography.originalAxisEm')
 settings('stix2','fraction');preview('16:39:19')
 # Confirm these are STIX Two outlines, not a silent fallback to TeX/lining.
 expected=fixture['oldstyle'][str(ord('6'))][3]['p']
 actual=page.locator('#stage .digit[data-digit="1"] path').get_attribute('d')
 assert actual=='M'+expected+'Z',(actual,expected)
 out=R/'tests/screenshots';out.mkdir(exist_ok=True)
 page.screenshot(path=str(out/'stix2-local-163919.png'),full_page=True)
 page.locator('.stage-wrap').screenshot(path=str(out/'stix2-local-equation.png'))
 preview('12:34:59');page.screenshot(path=str(out/'stix2-local-power.png'),full_page=True)
 for w in [320,390,768]:
  page.set_viewport_size({'width':w,'height':840})
  for div in ['fraction','inline']:
   settings('stix2',div)
   for time in ['16:39:19','12:34:59','00:00:08']:
    preview(time);geometry()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  page.screenshot(path=str(out/f'stix2-local-mobile-{w}.png'),full_page=True)
 report['pageErrors']=errors
 assert not errors,errors
 report['checks']=['default STIX2','STIX Two 6 path exact match','3 profile switching','2 division modes','persistent digits','fixed equal axis','native STIX/CM axis','320/390/768 responsive layout','plain clock fallback']
 (R/'tests/stix2-compatibility-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print('PASS',len(report['cases']),'cases')
 browser.close()
