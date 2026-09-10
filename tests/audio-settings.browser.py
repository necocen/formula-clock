"""Audio preference persistence, delayed autoplay resumption and stale responses."""
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
from playwright.sync_api import sync_playwright
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument('--url', default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
ap.add_argument('--output-dir', type=Path, default=Path('test-results/audio-settings'))
args = ap.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
report = {'at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
          'browser': args.browser, 'playwright': version('playwright'), 'url': args.url, 'checks': []}
errors = []
key = 'formula-clock-audio-v1'

# Retain native Web Audio nodes but hold restored resume requests to model a
# browser requiring interaction. Both pending and rejected resumes are tested.
instrument = '''
  window.audioGains=[];window.audioVoices=[];window.audioResumeCalls=0;
  try {window.holdAudioResume=JSON.parse(localStorage.getItem('formula-clock-audio-v1')||'{}')?.enabled===true;}
  catch {window.holdAudioResume=false;}
  const NativeAudio=window.AudioContext||window.webkitAudioContext;
  window.AudioContext=class extends NativeAudio {
    constructor(...args){
      super(...args);window.audioContext=this;this.waiters=[];
      if(holdAudioResume)super.suspend();
    }
    get state(){return holdAudioResume?'suspended':super.state;}
    createGain(){const gain=super.createGain();audioGains.push(gain);return gain;}
    createOscillator(){
      const osc=super.createOscillator(),start=osc.start.bind(osc);
      osc.start=(...args)=>{audioVoices.push({frequency:osc.frequency.value,when:args[0]});return start(...args);};
      return osc;
    }
    resume(){
      audioResumeCalls++;
      if(holdAudioResume)return new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));
      return this.finishResume();
    }
    finishResume(){return super.resume().then(()=>{this.waiters.splice(0).forEach(w=>w.resolve());});}
    forceResume(){window.holdAudioResume=false;return this.finishResume();}
  };
'''

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch()
    report['browserVersion'] = browser.version

    def new_page(prefix='', suffix=''):
        page = browser.new_page(locale='ja-JP', viewport={'width': 1440, 'height': 1000}, timezone_id='Asia/Tokyo')
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script(prefix + instrument + suffix)
        page.goto(args.url)
        ready(page)
        return page

    def ready(page):
        page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout', timeout=35000)
        # Keep all scheduled clock tones silent so only explicit enable feedback
        # can contribute an oscillator during these persistence checks.
        page.evaluate("FormulaClock.preview('2026-09-09T12:34:08+09:00',true)")

    def settings(page, enabled, volume, persisted=True):
        assert page.evaluate('FormulaClock.state.soundEnabled') == enabled
        assert page.locator('#sound').get_attribute('aria-pressed') == str(enabled).lower()
        assert abs(page.evaluate('FormulaClock.state.soundVolume') - volume) < 1e-9
        assert abs(float(page.locator('#volume').input_value()) - volume*100) < 1e-9
        if persisted:
            assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', key) == {'enabled': enabled, 'volume': volume}

    def volume(page, percent):
        page.click('#settings-open')
        page.locator('#volume').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));}', str(percent))
        page.keyboard.press('Escape')

    page = new_page()
    report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax'] == '4.1.3'
    settings(page, False, .25, persisted=False)
    assert page.evaluate('!window.audioContext')
    display_before = page.evaluate("localStorage.getItem('formula-clock-display-v2')")
    volume(page, 40); settings(page, False, .4)
    assert page.evaluate("localStorage.getItem('formula-clock-display-v2')") == display_before
    page.reload(); ready(page); settings(page, False, .4)
    page.click('#sound'); page.wait_for_function('FormulaClock.state.soundReady')
    settings(page, True, .4)
    assert len(page.evaluate('audioVoices')) == 1
    assert abs(page.evaluate('audioGains[0].gain.value') - .128) < 1e-7
    report['checks'].append('Fresh defaults remain off/25%; changing volume while off persists; reload preserves off/40%; enabling persists on and applies the restored volume to the native master gain')

    page.reload(); ready(page); settings(page, True, .4)
    assert not page.evaluate('FormulaClock.state.soundReady')
    assert '画面を操作すると再開' in page.locator('#sound').get_attribute('aria-label')
    page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length') == 0
    resumes = page.evaluate('audioResumeCalls')
    page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"a",bubbles:true}))')
    assert page.evaluate('audioResumeCalls') == resumes
    page.evaluate('window.holdAudioResume=false')
    page.click('#settings-open')
    page.wait_for_function('FormulaClock.state.soundReady')
    assert page.evaluate('audioResumeCalls') >= 2
    assert page.evaluate('audioVoices.length') == 0
    assert abs(page.evaluate('audioGains[0].gain.value') - .128) < 1e-7
    page.keyboard.press('Escape')
    report['checks'].append('A pending restored resume keeps the on preference and button state; the first click resumes native audio at the saved gain, without an enable-feedback tone')

    volume(page, 0); settings(page, True, 0)
    page.reload(); ready(page); settings(page, True, 0)
    resumes = page.evaluate('audioResumeCalls')
    page.click('#sound'); settings(page, False, 0)
    assert page.evaluate('audioResumeCalls') == resumes
    page.evaluate('audioContext.forceResume()')
    page.wait_for_timeout(180)
    settings(page, False, 0)
    assert not page.evaluate('FormulaClock.state.soundReady')
    assert page.evaluate('audioVoices.length') == 0
    page.reload(); ready(page); settings(page, False, 0)
    page.keyboard.press('m'); page.wait_for_function('FormulaClock.state.soundReady')
    settings(page, True, 0)
    page.keyboard.press('m'); settings(page, False, 0)
    report['checks'].append('Zero volume is preserved; muting a pending restore does not resume it or lose the saved off state when the old request finishes; keyboard M persists both states')

    # Two enable attempts separated by off must not both play feedback when
    # their pending resumes finally resolve on the same later gesture.
    baseline = page.evaluate('audioVoices.length')
    page.evaluate('async()=>{await audioContext.suspend();window.holdAudioResume=true;}')
    page.click('#sound'); settings(page, True, 0)
    resumes = page.evaluate('audioResumeCalls')
    # WebKit on macOS does not focus buttons on a mouse click.
    page.locator('#sound').focus()
    page.keyboard.press('Space'); settings(page, False, 0)
    assert page.evaluate('audioResumeCalls') == resumes
    page.click('#sound'); settings(page, True, 0)
    page.evaluate('window.holdAudioResume=false')
    page.locator('#sound').focus()
    page.keyboard.press('a')
    page.wait_for_function('FormulaClock.state.soundReady')
    page.wait_for_timeout(180)
    assert page.evaluate('audioVoices.length') == baseline + 1
    report['checks'].append('Rapid on/off/on while resume is pending keeps the latest choice; Space on the sound button mutes without resuming; another key resumes even with the sound button focused, and only the latest enable attempt produces feedback')
    page.close()

    cases = [('{bad', False, .25), ('{"enabled":"true","volume":"0.4"}', False, .25),
             ('{"enabled":false,"volume":0}', False, 0), ('{"enabled":false,"volume":1}', False, 1),
             ('{"enabled":false,"volume":-1}', False, .25), ('{"enabled":false,"volume":2}', False, .25),
             ('{"enabled":true,"volume":null}', True, .25)]
    for raw, enabled, level in cases:
        page = new_page(f'localStorage.setItem({json.dumps(key)},{json.dumps(raw)});')
        settings(page, enabled, level, persisted=False)
        page.close()
    page = new_page('Storage.prototype.getItem=()=>{throw new Error("Storage unavailable")};Storage.prototype.setItem=()=>{throw new Error("Storage unavailable")};')
    settings(page, False, .25, persisted=False)
    volume(page, 60)
    page.click('#sound'); page.wait_for_function('FormulaClock.state.soundReady')
    settings(page, True, .6, persisted=False)
    page.close()
    report['checks'].append('Malformed JSON, invalid types and out-of-range levels recover safely; valid 0%/100% survive; unavailable storage does not break volume, toggling or the clock')

    # Some browsers reject rather than leave the promise pending. A rejected
    # resume must also keep the preference and allow a subsequent interaction.
    rejection = '''
      const resume=AudioContext.prototype.resume;let rejectOnce=true;
      AudioContext.prototype.resume=function(){
        if(rejectOnce){rejectOnce=false;return Promise.reject(new DOMException('Interaction required','NotAllowedError'));}
        return resume.call(this);
      };
    '''
    page = browser.new_page(locale='ja-JP', timezone_id='Asia/Tokyo')
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(f'localStorage.setItem({json.dumps(key)},\'{json.dumps({"enabled":True,"volume":.4})}\');' + instrument + rejection)
    page.goto(args.url); ready(page); settings(page, True, .4)
    assert not page.evaluate('FormulaClock.state.soundReady')
    page.evaluate('window.holdAudioResume=false')
    page.keyboard.press('a'); page.wait_for_function('FormulaClock.state.soundReady')
    settings(page, True, .4)
    assert page.evaluate('audioVoices.length') == 0
    page.close()
    report['checks'].append('A rejected autoplay resume retains on/volume, retries on a trusted key event and starts without restore feedback')

    # Also exercise the browser's native startup policy without the test gate.
    page = new_page(f'localStorage.setItem({json.dumps(key)},\'{json.dumps({"enabled":True,"volume":.35})}\');', 'window.holdAudioResume=false;')
    settings(page, True, .35)
    report['nativeReadyBeforeInteraction'] = page.evaluate('FormulaClock.state.soundReady')
    baseline = page.evaluate('audioVoices.length')
    if not report['nativeReadyBeforeInteraction']:
        page.click('#settings-open')
        page.wait_for_function('FormulaClock.state.soundReady')
    assert abs(page.evaluate('audioGains[0].gain.value') - .112) < 1e-7
    assert page.evaluate('audioVoices.length') == baseline
    page.close()
    report['checks'].append('The native browser policy also restores the saved on/35% state, starts immediately when allowed or resumes on a click, and adds no restore feedback')
    assert not errors, errors
    report['pageErrors'] = errors
    browser.close()

(args.output_dir/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
