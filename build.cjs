// Build a standalone HTML, or an HTTP site with one JSON file per minute.
// Font libraries remain CDN dependencies. No fonts are bundled.
'use strict';
const fs=require('node:fs'), path=require('node:path'), zlib=require('node:zlib');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const external=process.argv.includes('--external'), raw=process.argv.includes('--raw-json');
const outDir=external ? path.join(__dirname,'dist-external') : __dirname;
fs.mkdirSync(outDir,{recursive:true});
let html=read('_head.html');
for(const name of ['expression','data','typesetter']) html+=`\n<script id="${name}-code">\n${read(name+'.js')}\n</script>\n`;
const data=read('data/expressions.json');
if(external) {
  const table=JSON.parse(data), folder=path.join(outDir,'data','minutes');fs.mkdirSync(folder,{recursive:true});
  for(const [hhmm,seconds] of Object.entries(table.minutes)) fs.writeFileSync(path.join(folder,hhmm+'.json'),JSON.stringify({schema:table.schema,hhmm,seconds})+'\n');
  html+=`<script>window.FORMULA_CLOCK_CONFIG={provider:new FormulaData.FetchMinuteProvider(hhmm=>'data/minutes/'+hhmm+'.json')};</script>\n`;
} else if(raw) {
  html+=`<script id="clock-data" type="application/json">${data.replace(/</g,'\\u003c')}</script>\n`;
} else {
  html+=`<script id="clock-data" type="application/octet-stream" data-encoding="gzip-base64">${zlib.gzipSync(data,{level:9}).toString('base64')}</script>\n`;
}
html+=`<script id="app-code">\n${read('app.js')}\n</script>\n</body>\n</html>\n`;
fs.writeFileSync(path.join(outDir,'index.html'),html);
console.log(`${outDir}/index.html: ${Buffer.byteLength(html)} bytes (${external?'async minute JSON':raw?'embedded JSON':'embedded gzip JSON'})`);
