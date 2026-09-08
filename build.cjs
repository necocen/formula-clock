// Build a standalone HTML, or an HTTP site with one content-addressed JSON per hour.
// Font libraries remain CDN dependencies. No fonts are bundled.
'use strict';
const fs=require('node:fs'), path=require('node:path'), zlib=require('node:zlib'), crypto=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const external=process.argv.includes('--external'), raw=process.argv.includes('--raw-json');
const outDir=external ? path.join(__dirname,'dist-external') : __dirname;
// Only the dedicated generated directory is cleaned. Never publish the repository root.
if(external) fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
const licenseContent=read('licenses.html').match(/<!-- licenses-content:start -->([\s\S]*?)<!-- licenses-content:end -->/);
if(!licenseContent) throw new Error('License content markers are missing');
let html=read('_head.html').replace('<!-- licenses-content -->',()=>licenseContent[1]);
for(const name of ['expression','data','symbols','typesetter']) html+=`\n<script id="${name}-code">\n${read(name+'.js')}\n</script>\n`;
const data=read('data/expressions.json');
if(external) {
  const table=JSON.parse(data), folder=path.join(outDir,'data','hours');fs.mkdirSync(folder,{recursive:true});
  const hours={};
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  for(let h=0;h<24;h++) {
    const hour=String(h).padStart(2,'0'), minutes={};
    for(let m=0;m<60;m++) {
      const code=hour+String(m).padStart(2,'0');
      if(!Object.hasOwn(table.minutes,code)) throw new Error(`Missing source minute ${code}`);
      minutes[code]=table.minutes[code];
    }
    const json=JSON.stringify({schema:table.schema,minutes})+'\n', filename=`${hour}.${hash(json)}.json`;
    fs.writeFileSync(path.join(folder,filename),json);
    hours[hour]=`hours/${filename}`;
  }
  const manifest={schema:'formula-clock-hours/1',version:hash(JSON.stringify(hours)),hours};
  fs.writeFileSync(path.join(outDir,'data','manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.copyFileSync(path.join(__dirname,'_headers'),path.join(outDir,'_headers'));
  html+=`<script>window.FORMULA_CLOCK_CONFIG={provider:new FormulaData.FetchHourProvider('data/manifest.json')};</script>\n`;
} else if(raw) {
  html+=`<script id="clock-data" type="application/json">${data.replace(/</g,'\\u003c')}</script>\n`;
} else {
  html+=`<script id="clock-data" type="application/octet-stream" data-encoding="gzip-base64">${zlib.gzipSync(data,{level:9}).toString('base64')}</script>\n`;
}
html+=`<script id="app-code">\n${read('app.js')}\n</script>\n</body>\n</html>\n`;
fs.writeFileSync(path.join(outDir,'index.html'),html);
if(external) fs.copyFileSync(path.join(__dirname,'licenses.html'),path.join(outDir,'licenses.html'));
console.log(`${outDir}/index.html: ${Buffer.byteLength(html)} bytes (${external?'async hourly JSON':raw?'embedded JSON':'embedded gzip JSON'})`);
