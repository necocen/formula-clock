"""Paused second stepping, live return and keyboard ownership with the CDN app."""
from _support import browser_args
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
from playwright.sync_api import sync_playwright
import argparse, json, sys

parser = argparse.ArgumentParser()
args = browser_args(parser, __file__, browsers=('chromium', 'webkit'))
report = {'at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
          'browser': args.browser, 'playwright': version('playwright'), 'checks': [], 'errors': []}

def ready(page, time):
    page.wait_for_function('t=>{const l=window.FormulaClock?.state.layout;return l&&l.code+String(l.seconds).padStart(2,"0")===t&&!document.querySelector("#share").disabled}', arg=time, timeout=45000)

def preview(page, time):
    page.evaluate('t=>FormulaClock.preview(FormulaShare.localDate(t))', time)
    ready(page, time)

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    report['browserVersion'] = browser.version
    for locale in ['ja-JP', 'en-US']:
        ctx = browser.new_context(locale=locale, timezone_id='Asia/Tokyo', viewport={'width': 1440, 'height': 1000})
        ctx.add_init_script('''const NativeDate=Date;
          window.testWall=+new NativeDate('2026-09-11T12:34:30.800+09:00');
          window.Date=class extends NativeDate {
            constructor(...args){super(...(args.length?args:[window.testWall]));}
            static now(){return window.testWall;}
          };''')
        page = ctx.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.goto(args.url+'?t=123459', wait_until='domcontentloaded')
        ready(page, '123459')
        report['mathjax'] = page.evaluate('FormulaClock.diagnostics().mathjax')
        assert report['mathjax'] == '4.1.3'
        page.evaluate('window.originalDigits=FormulaClock.digits;window.originalProvider=FORMULA_CLOCK_CONFIG.provider')
        assert page.locator('#play-pause,#slow,#playback').count() == 0
        assert page.locator('#transport button').count() == 1
        assert page.locator('#go-live').inner_text() == ('現在時刻へ' if locale == 'ja-JP' else 'Current time')
        assert page.locator('.seek-hint').inner_text() == ('← → 1秒ずつ移動' if locale == 'ja-JP' else '← → Step by 1 second')
        frozen = page.evaluate('FormulaClock.state.now')
        page.wait_for_timeout(1100)
        assert page.evaluate('FormulaClock.state.now') == frozen

        # Arrow keys also work when a ruler button has keyboard focus.
        page.locator('.tick').nth(59).click()
        # WebKit follows macOS and does not focus buttons on pointer clicks.
        page.locator('.tick').nth(59).focus()
        assert page.evaluate('document.activeElement.classList.contains("tick")')
        page.keyboard.press('ArrowRight'); ready(page, '123500')
        assert page.url == args.url and page.evaluate('FormulaClock.state.paused')
        page.keyboard.press('ArrowLeft'); ready(page, '123459')
        preview(page, '235959')
        page.keyboard.press('ArrowRight'); ready(page, '000000')
        page.keyboard.press('ArrowLeft'); ready(page, '235959')
        preview(page, '123459')
        for _ in range(12):
            page.keyboard.down('ArrowRight')
        page.keyboard.up('ArrowRight')
        for _ in range(4):
            page.keyboard.press('ArrowLeft')
        ready(page, '123507')
        assert page.evaluate('FormulaClock.state.paused')
        report['checks'].append(locale+': second/minute/day boundaries, focused ruler and held-key steps')

        # A slower old minute response cannot overwrite the last requested time.
        page.evaluate('''FormulaClock.setDataProvider({async getMinute(hhmm){
          if(hhmm==='1240')await new Promise(resolve=>setTimeout(resolve,350));
          return {schema:'formula-clock/1',hhmm,seconds:Array(60).fill(null)};
        }})''')
        preview(page, '123959')
        page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowLeft')
        ready(page, '123959'); page.wait_for_timeout(550)
        ready(page, '123959')
        page.evaluate('FormulaClock.setDataProvider(originalProvider)')
        preview(page, '123430')

        # Native form, dialog and button keys keep their own behavior.
        frozen = page.evaluate('FormulaClock.state.now')
        page.click('#settings-open')
        page.keyboard.press('ArrowRight')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.locator('#division-choice input:checked').focus()
        page.keyboard.press('ArrowRight')
        page.wait_for_function('FormulaClock.state.display.division==="inline"')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.locator('#custom-time').fill('12:34:30')
        page.keyboard.press('ArrowLeft')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.click('#licenses-open'); page.keyboard.press('ArrowRight')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.keyboard.press('Escape'); page.keyboard.press('Escape')
        page.evaluate('document.querySelector("#share-dialog").showModal();document.querySelector("#share-url").focus()')
        page.keyboard.press('ArrowRight'); page.keyboard.press('Space')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.keyboard.press('Escape')
        page.evaluate('const el=document.createElement("div");el.id="editable-test";el.contentEditable="true";el.textContent="text";document.body.append(el);el.focus()')
        page.keyboard.press('ArrowLeft'); page.keyboard.press('Space')
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.evaluate('document.querySelector("#editable-test").remove()')
        for key in ['Control+ArrowRight', 'Shift+ArrowLeft']:
            page.keyboard.press(key)
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.locator('#sound').focus(); before = page.evaluate('FormulaClock.state.soundEnabled')
        page.keyboard.press('Space')
        assert page.evaluate('FormulaClock.state.soundEnabled') != before
        assert page.evaluate('FormulaClock.state.now') == frozen
        page.click('#sound')
        report['checks'].append(locale+': native radio/input/contenteditable/button keys and modal shortcuts do not seek')

        page.evaluate('document.activeElement.blur()')
        page.keyboard.press('Space')
        page.wait_for_function('!FormulaClock.state.preview')
        ready(page, '123430')
        page.keyboard.press('ArrowRight')
        assert not page.evaluate('FormulaClock.state.preview')
        displayed = page.evaluate('FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")')
        page.keyboard.down('Space'); page.keyboard.down('Space'); page.keyboard.up('Space')
        assert page.evaluate('FormulaClock.state.paused')
        assert page.evaluate('''()=>{const event=new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,cancelable:true,bubbles:true});
          document.dispatchEvent(event);return event.defaultPrevented;}''')
        ready(page, displayed)
        page.evaluate('testWall+=12000;FormulaClock.pause()')
        page.wait_for_timeout(1100)
        ready(page, displayed)
        page.keyboard.press('Space')
        page.wait_for_function('!FormulaClock.state.preview')
        ready(page, '123442')
        page.evaluate('FormulaClock.pause()')
        page.keyboard.press('l')
        assert not page.evaluate('FormulaClock.state.preview')
        report['checks'].append(locale+': Space freezes the displayed second, ignores repeats and returns to actual current time; pause API is idempotent')

        preview(page, '123430')
        page.locator('#transport').screenshot(path=str(args.output_dir/(locale+'-transport.png')))
        for time, font, mode in [('235910','termes','formula'), ('022033','stix2','formula'), ('085846','fira','formula'), ('004159','euler','time')]:
            page.evaluate('f=>FormulaClock.setDisplay({font:f,division:"fraction"})', font)
            preview(page, time)
            page.wait_for_function('f=>FormulaClock.state.layout.display.font===f', arg=font, timeout=45000)
            page.wait_for_timeout(750)
            assert page.evaluate('FormulaClock.state.layout.mode') == mode
            assert page.evaluate('FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && FormulaClock.diagnostics().glyphs.every(g=>g.inStage)')
        page.set_viewport_size({'width':320,'height':700})
        page.wait_for_timeout(750)
        assert page.locator('#transport').evaluate('el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}')
        page.locator('#transport').screenshot(path=str(args.output_dir/(locale+'-transport-320.png')))
        page.click('#go-live')
        assert not page.evaluate('FormulaClock.state.preview')
        assert page.locator('#transport').is_hidden()
        report['checks'].append(locale+': fractions, powers, radical factorials, ordinary clock and four fonts retain digits; transport fits 320px')
        ctx.close()
    browser.close()
assert not report['errors'], report['errors']
(args.output_dir/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
