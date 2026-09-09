"""117-style timing and actual Web Audio envelopes, including transport cancellation."""
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
from playwright.sync_api import sync_playwright
import argparse, base64, json, sys

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:8000/dist-external/')
ap.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
ap.add_argument('--output-dir',type=Path,default=Path('test-results/audio'))
args=ap.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
report={'at':datetime.now(timezone.utc).isoformat(),'command':sys.argv,'browser':args.browser,
        'url':args.url,'playwright':version('playwright'),'checks':[]}
errors=[]
with sync_playwright() as p:
    browser=getattr(p,args.browser).launch();report['browserVersion']=browser.version
    page=browser.new_page(viewport={'width':1440,'height':1000},timezone_id='Asia/Tokyo')
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script('''
      window.audioVoices=[];window.audioGains=[];
      const NativeAudio=window.AudioContext || window.webkitAudioContext;
      window.AudioContext=class extends NativeAudio {
        constructor(...args){super(...args);window.testAudioContext=this;}
        createGain(){
          const node=super.createGain();node.commands=[];audioGains.push(node);
          // Keep the instrumented AudioParam wrapper alive between operations
          // (WebKit can otherwise recreate it and lose these JS-only hooks).
          const param=node.gain;node.testParam=param;
          for(const method of ['setValueAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime','setTargetAtTime']){
            const original=param[method].bind(param);
            param[method]=(...args)=>{node.commands.push({method,args});return original(...args);};
          }
          return node;
        }
        createOscillator(){
          const node=super.createOscillator(),voice={stops:[]};
          const connect=node.connect.bind(node),start=node.start.bind(node),stop=node.stop.bind(node);
          node.connect=destination=>{voice.gain=destination;return connect(destination);};
          node.start=when=>{Object.assign(voice,{when,frequency:node.frequency.value,type:node.type});audioVoices.push(voice);return start(when);};
          node.stop=(...args)=>{voice.stops.push(args.length?args[0]:this.currentTime);return stop(...args);};
          return node;
        }
      };
      window.audioSnapshot=()=>audioVoices.map(v=>({when:v.when,frequency:v.frequency,type:v.type,
        stops:v.stops.slice(),commands:v.gain.commands}));
      window.renderVoice=async index=>{
        const voice=audioVoices[index],duration=voice.stops[0]-voice.when,rate=48000,offset=.03;
        const ctx=new OfflineAudioContext(1,Math.ceil((duration+.06)*rate),rate);
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type=voice.type;osc.frequency.value=voice.frequency;
        for(const {method,args} of voice.gain.commands){
          const replay=args.slice();replay[1]=offset+replay[1]-voice.when;gain.gain[method](...replay);
        }
        osc.connect(gain);gain.connect(ctx.destination);osc.start(offset);osc.stop(offset+duration);
        const samples=(await ctx.startRendering()).getChannelData(0),crossings=[];
        let first=-1,last=-1,peak=0;
        for(let i=1;i<samples.length;i++){
          const value=Math.abs(samples[i]);peak=Math.max(peak,value);
          if(value>1e-7){if(first<0)first=i;last=i;}
          if(samples[i]>0 && samples[i-1]<=0 && i>offset*rate+1 && i<(offset+duration)*rate-1)
            crossings.push(i-samples[i]/(samples[i]-samples[i-1]));
        }
        const frequency=rate*(crossings.length-1)/(crossings.at(-1)-crossings[0]);
        const rms=(a,b)=>{
          const start=Math.ceil((offset+a)*rate),end=Math.floor((offset+b)*rate);
          let sum=0;for(let i=start;i<end;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/(end-start));
        };
        const wav=new ArrayBuffer(44+samples.length*2),view=new DataView(wav);
        const text=(pos,value)=>[...value].forEach((c,i)=>view.setUint8(pos+i,c.charCodeAt(0)));
        text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
        view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
        view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
        text(36,'data');view.setUint32(40,samples.length*2,true);
        samples.forEach((value,i)=>view.setInt16(44+i*2,Math.round(value*32767),true));
        let bytes='';for(const value of new Uint8Array(wav))bytes+=String.fromCharCode(value);
        return {duration,frequency,peak,audibleDuration:(last-first+1)/rate,
          quietBefore:first>=Math.floor(offset*rate),quietAfter:last<Math.ceil((offset+duration)*rate),
          earlyRms:rms(duration*.15,duration*.3),lateRms:rms(duration*.8,duration*.95),wav:btoa(bytes)};
      };
    ''')
    # A fixed wall clock leaves Web Audio and browser timers running normally.
    def wall(second,minute=34,millis=50):
        page.clock.set_fixed_time(datetime(2026,9,9,3,minute,second,millis*1000,tzinfo=timezone.utc))

    wall(0,millis=500)
    page.goto(args.url);page.wait_for_function('window.FormulaClock?.state.engineReady && FormulaClock.state.layout')
    report['mathjax']=page.evaluate('FormulaClock.diagnostics().mathjax')
    assert report['mathjax']=='4.1.3'
    page.click('#sound');page.wait_for_function('FormulaClock.state.soundEnabled')
    page.wait_for_timeout(200) # The short enable feedback is separate from clock signals.
    baseline=page.evaluate('audioVoices.length')
    for second in range(60):
        wall(second)
        page.wait_for_function('(n)=>audioVoices.length>=n',arg=baseline+second+1)
        page.wait_for_timeout(75)
        assert page.evaluate('audioVoices.length')==baseline+second+1,second
    voices=page.evaluate('audioSnapshot()')[baseline:]
    expected=lambda s:(1000,.9) if s%10==0 else (500,.05) if s%30>=27 else (2000,.007)
    for second,voice in enumerate(voices):
        frequency,duration=expected(second)
        assert voice['type']=='sine' and voice['frequency']==frequency,(second,voice)
        assert abs(voice['stops'][0]-voice['when']-duration)<1e-7,(second,voice)
        times=[command['args'][1] for command in voice['commands']]
        assert times==sorted(times),(second,voice) # A 7 ms pulse must not have an 8 ms attack.
        assert abs(times[0]-voice['when'])<1e-7 and abs(times[-1]-voice['stops'][0])<1e-7
    report['minuteFrequencies']=[v['frequency'] for v in voices]
    report['checks'].append('All 60 seconds produce exactly one native sine oscillator: 48 ticks, 6 countdowns and 6 ten-second markers, with 7/50/900 ms durations')

    rendered={}
    for second,name in [(1,'tick'),(27,'countdown'),(30,'marker')]:
        result=page.evaluate('(index)=>renderVoice(index)',baseline+second)
        wav=result.pop('wav');(args.output_dir/f'{name}.wav').write_bytes(base64.b64decode(wav))
        frequency,duration=expected(second)
        assert abs(result['frequency']-frequency)<1,result
        assert abs(result['audibleDuration']-duration)<.0001,result
        assert result['quietBefore'] and result['quietAfter'] and 0<result['peak']<=1,result
        if name=='marker':assert result['lateRms']<result['earlyRms']*.02,result
        else:assert .75<result['lateRms']/result['earlyRms']<1.25,result
        rendered[name]=result
    report['renderedAudio']=rendered
    report['checks'].append('OfflineAudioContext replay of the actual oscillator/gain commands confirms frequencies, audible durations, silent boundaries, short pulse sustain and decaying marker')

    # A late timer never catches up on missed seconds.
    before=page.evaluate('audioVoices.length');wall(5,minute=35,millis=500);page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length')==before
    wall(6,minute=35);page.wait_for_function('(n)=>audioVoices.length===n',arg=before+1)
    assert page.evaluate('audioVoices.at(-1).frequency')==2000

    before=page.evaluate('audioVoices.length')
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length')==before # The same second must not replay.

    # Hiding cancels audio; returning after a gap plays only the current second.
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
    before=page.evaluate('audioVoices.length');wall(8,minute=35);page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length')==before
    wall(10,minute=35)
    page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_function('(n)=>audioVoices.length===n',arg=before+1)
    assert page.evaluate('audioVoices.at(-1).frequency')==1000
    page.click('#sound')
    cancelled=page.evaluate('audioSnapshot().at(-1)')
    assert len(cancelled['stops'])==2 and cancelled['stops'][1]<cancelled['stops'][0],cancelled
    before=page.evaluate('audioVoices.length');page.click('#sound');page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length')==before+1 # Enable feedback only, no duplicate marker.
    page.click('#sound')
    before=page.evaluate('audioVoices.length');wall(11,minute=35);page.wait_for_timeout(200)
    assert page.evaluate('audioVoices.length')==before

    page.evaluate("FormulaClock.preview('2026-09-09T12:35:26.700+09:00',true)")
    page.click('#sound');page.wait_for_timeout(200)
    before=page.evaluate('audioVoices.length');page.wait_for_timeout(250)
    assert page.evaluate('audioVoices.length')==before
    page.click('#settings-open')
    page.locator('#volume').evaluate("el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));}")
    page.keyboard.press('Escape')
    page.wait_for_timeout(250)
    volume=page.evaluate('({value:audioGains[0].gain.value,commands:audioGains[0].commands,input:document.querySelector("#volume").value})')
    # AudioParam.value can retain the intrinsic value while automation runs.
    # Verify that the slider schedules the real master node's smooth gain change.
    assert volume['commands'][-1]['method']=='setTargetAtTime' and abs(volume['commands'][-1]['args'][0]-.128)<1e-7,volume
    page.click('#slow');page.click('#play-pause')
    page.wait_for_function('(n)=>audioVoices.length>=n+2',arg=before)
    slowed=page.evaluate('audioSnapshot()')[before:before+2]
    assert [v['frequency'] for v in slowed]==[500,500],slowed
    assert abs(slowed[1]['when']-slowed[0]['when']-2)<.09,slowed
    assert all(abs(v['stops'][0]-v['when']-.05)<1e-7 for v in slowed),slowed
    page.click('#play-pause');before=page.evaluate('audioVoices.length');page.wait_for_timeout(250)
    assert page.evaluate('audioVoices.length')==before
    report['checks'].append('Missed seconds are skipped; visibility/off cancels audio; volume updates the master gain; paused previews are silent; half speed doubles spacing while preserving pitch and pulse length')
    page.click('#sound')
    assert not errors,errors
    report['pageErrors']=errors
    browser.close()
(args.output_dir/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
