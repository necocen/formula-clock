import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const root=fileURLToPath(new URL('../',import.meta.url)),built=path.join(root,'dist-worker');
test('workerd serves state-specific metadata, real PNGs, R2 cache, and static assets',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({name:'formula-clock-og-test',compatibilityDate:'2026-09-09',cf:false,
    modulesRoot:built,modules:[{type:'ESModule',path:path.join(built,'index.mjs'),contents:await fs.readFile(path.join(built,'index.mjs'),'utf8')},
      {type:'CompiledWasm',path:path.join(built,'resvg.wasm'),contents:await fs.readFile(path.join(built,'resvg.wasm'))}],
    assets:{directory:path.join(root,'dist-external'),binding:'ASSETS',run_worker_first:['/','/og.png','/s/*','/api/shares'],routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'none'}},
    r2Buckets:['OG_IMAGES'],kvNamespaces:['SHARES'],host:'127.0.0.1',port:0}));
  try {
    const rootUrl='https://clock.example/?v=1&t=123430&font=euler&numerals=lining&division=inline';
    const page=await mf.dispatchFetch(rootUrl),html=await page.text();assert.equal(page.status,200);
    assert.match(html,/<title>Formula Clock — 12:34:30<\/title>/);
    assert.match(html,/property="og:image" content="https:\/\/clock.example\/og.png\?/);
    assert.match(html,/name="twitter:card" content="summary_large_image"/);
    assert.match(html,/rel="canonical" href="https:\/\/clock.example\/\?v=1&amp;t=123430/);
    assert.equal(page.headers.get('ETag'),null);assert.equal(page.headers.get('Cache-Control'),'no-cache');
    const other=await (await mf.dispatchFetch('https://clock.example/?t=235334')).text();
    assert.match(other,/<title>Formula Clock — 23:53:34<\/title>/);assert.ok(!other.includes('Formula Clock — 12:34:30'));
    const head=await mf.dispatchFetch(rootUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    const imageUrl=new URL('/og.png',rootUrl);imageUrl.search=new URL(rootUrl).search;
    const first=await mf.dispatchFetch(imageUrl),png=Buffer.from(await first.arrayBuffer());
    assert.equal(first.status,200);assert.equal(first.headers.get('Cache-Control'),'public, max-age=86400');
    assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
    const bucket=await mf.getR2Bucket('OG_IMAGES'),objects=await bucket.list();assert.equal(objects.objects.length,1);
    assert.deepEqual(Buffer.from(await (await bucket.get(objects.objects[0].key)).arrayBuffer()),png);
    const second=await mf.dispatchFetch(imageUrl);assert.deepEqual(Buffer.from(await second.arrayBuffer()),png);
    const modified=await mf.dispatchFetch(imageUrl,{headers:{'If-None-Match':first.headers.get('ETag')}});assert.equal(modified.status,304);
    await bucket.delete(objects.objects[0].key);
    const again=await mf.dispatchFetch(imageUrl);assert.deepEqual(Buffer.from(await again.arrayBuffer()),png);
    assert.equal((await bucket.list()).objects.length,1);
    const invalid=await mf.dispatchFetch('https://clock.example/og.png?t=999999');
    assert.equal(invalid.headers.get('Cache-Control'),'public, max-age=60');
    assert.deepEqual(Buffer.from(await invalid.arrayBuffer()),await fs.readFile(path.join(root,'dist-external/og-default.png')));
    assert.equal((await mf.dispatchFetch('https://clock.example/missing')).status,404);
    assert.equal((await mf.dispatchFetch('https://clock.example/data/manifest.json')).status,200);
    const defaults=await (await mf.dispatchFetch('https://clock.example/?t=bad&font=%22%3E%3Cscript%3E')).text();
    assert.match(defaults,/<title>Formula Clock<\/title>/);assert.ok(!defaults.includes('font=%22'));
    const snapshot={v:1,t:'123421',font:'euler',numerals:'lining',division:'inline',ast:{op:'mul',a:{op:'add',a:{op:'lit',i:0,j:1},b:{op:'lit',i:1,j:2}},b:{op:'add',a:{op:'lit',i:2,j:3},b:{op:'lit',i:3,j:4}}}};
    const created=await mf.dispatchFetch('https://clock.example/api/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
    assert.equal(created.status,201);const {id}=await created.json();assert.match(id,/^[A-Za-z0-9]{10}$/);
    const namespace=await mf.getKVNamespace('SHARES');assert.deepEqual(await namespace.get('share/'+id,'json'),snapshot);
    const stored=await mf.dispatchFetch(`https://clock.example/s/${id}?t=000000`),storedHtml=await stored.text();
    assert.equal(stored.status,200);assert.match(storedHtml,/<title>Formula Clock — 12:34:21<\/title>/);
    assert.ok(storedHtml.includes(`<base href="/">`));assert.ok(storedHtml.includes(`rel="canonical" href="https://clock.example/s/${id}"`));
    const embedded=JSON.parse(storedHtml.match(/<script id="shared-clock" type="application\/json">(.*?)<\/script>/s)[1]);assert.deepEqual(embedded,{id,snapshot});
    assert.ok(storedHtml.includes(`https://clock.example/s/${id}/og.png?r=`));
    const sharedImage=await mf.dispatchFetch(`https://clock.example/s/${id}/og.png`),sharedPng=Buffer.from(await sharedImage.arrayBuffer());
    assert.equal(sharedImage.status,200);assert.equal(sharedPng.readUInt32BE(16),1200);
    assert.ok((await bucket.list()).objects.some(object=>object.key.endsWith(`/shares/${id}.png`)));
    const missing=await mf.dispatchFetch('https://clock.example/s/XXXXXXXXXX',{headers:{'Accept-Language':'ja-JP'}});
    assert.equal(missing.status,404);assert.equal(missing.headers.get('Cache-Control'),'no-store');assert.match(await missing.text(),/共有リンクを開けませんでした/);
  } finally { await mf.dispose(); }
});
