import Share from '../share.js';
import Data from '../data.js';

const escape = value => String(value).replace(/[&<>"']/g,character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const normalDescription = '時刻の4桁が、秒を表す数式に変わる。';
const keyFor = (state,revision) => `og/${revision}/${state.t}-${state.font}-${state.numerals}-${state.division}.png`;
function deadline(task, milliseconds, label) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_,reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      controller.abort(error); reject(error);
    },milliseconds);
  });
  return Promise.race([Promise.resolve().then(() => task(controller.signal)),expired]).finally(() => clearTimeout(timer));
}
const check = signal => { if (signal.aborted) throw signal.reason; };

// The entrypoint supplies the renderer, leaving routing/cache failures testable
// without loading MathJax. No URL or TeX supplied by a visitor is ever rendered.
export function createHandler({renderOg,revision,timeoutMs = 8000,writeTimeoutMs = 1000,log = value => console.log(JSON.stringify(value))}) {
  const providers = new WeakMap(), pending = new Map();
  function providerFor(assets) {
    if (!providers.has(assets)) providers.set(assets,new Data.FetchHourProvider('https://assets.local/data/manifest.json',{
      fetch:(url,options) => assets.fetch(new Request(url,options))
    }));
    return providers.get(assets);
  }
  function record(fields) { log({event:'og',revision,...fields}); }
  function imageJob(state,env) {
    const key = keyFor(state,revision);
    if (pending.has(key)) return {task:pending.get(key),coalesced:true};
    const task = deadline(async signal => {
      if (env.OG_IMAGES) {
        try {
          const object = await env.OG_IMAGES.get(key);
          check(signal);
          if (object) return {bytes:new Uint8Array(await object.arrayBuffer()),cache:'hit',key};
        } catch (error) { check(signal); record({status:'cache-read-error',reason:String(error.message || error)}); }
      }
      const minute = await providerFor(env.ASSETS).getMinute(state.t.slice(0,4),{signal});
      check(signal);
      const bytes = await renderOg({state,ast:minute.seconds[Number(state.t.slice(4))]});
      check(signal);
      return {bytes,cache:'miss',key};
    },timeoutMs,'Image generation').then(async result => {
      if (result.cache === 'miss' && env.OG_IMAGES) {
        try {
          await deadline(() => env.OG_IMAGES.put(key,result.bytes,{httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=86400'},
            customMetadata:{revision}}),writeTimeoutMs,'Image cache write');
        } catch (error) { record({status:'cache-write-error',reason:String(error.message || error)}); }
      }
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key,task);
    return {task,coalesced:false};
  }
  async function fallback(request,env,reason) {
    record({status:'default',reason});
    const asset = await env.ASSETS.fetch(new Request(new URL('/og-default.png',request.url)));
    const headers = new Headers(asset.headers);
    headers.set('Content-Type','image/png'); headers.set('Cache-Control','public, max-age=60');
    headers.set('X-Content-Type-Options','nosniff');
    // The bundled fallback is independent of R2 and the renderer.
    return new Response(request.method === 'HEAD' ? null : asset.body,{status:asset.status,headers});
  }
  async function image(request,env,ctx,url) {
    const state = Share.parse(url);
    if (!state) return fallback(request,env,'no-shared-state');
    const started = Date.now();
    const {task,coalesced} = imageJob(state,env);
    ctx.waitUntil(task.catch(() => {}));
    try {
      const result = await task, etag = `"${result.key}"`;
      const headers = {'Content-Type':'image/png','Cache-Control':'public, max-age=86400','ETag':etag,'X-Content-Type-Options':'nosniff'};
      record({status:'ok',cache:coalesced ? 'coalesced' : result.cache,time:state.t,elapsedMs:Date.now() - started,bytes:result.bytes.byteLength});
      if (request.headers.get('If-None-Match') === etag) return new Response(null,{status:304,headers});
      headers['Content-Length'] = String(result.bytes.byteLength);
      return new Response(request.method === 'HEAD' ? null : result.bytes,{headers});
    } catch (error) { return fallback(request,env,String(error.message || error)); }
  }
  async function html(request,env,url) {
    const state = Share.parse(url), canonical = state ? Share.url(url.origin,state) : new URL('/',url.origin);
    const imageUrl = new URL('/og.png',url.origin);
    if (state) imageUrl.search = Share.params(state).toString();
    imageUrl.searchParams.set('r',revision);
    const title = Share.title(state), description = state ? `${Share.timeLabel(state)}のFormula Clock。` : normalDescription;
    const metadata = {'description':description,'og:title':title,'og:description':description,'og:image':imageUrl.href,
      'twitter:title':title,'twitter:image':imageUrl.href};
    // Clear query and conditional headers: the source asset's ETag cannot stand
    // for the dynamically rewritten representation of every shared state.
    const source = await env.ASSETS.fetch(new Request(new URL('/',url.origin),{method:request.method}));
    const headers = new Headers(source.headers);
    headers.delete('ETag'); headers.delete('Last-Modified'); headers.delete('Content-Length');
    headers.set('Cache-Control','no-cache');
    const response = new Response(source.body,{status:source.status,headers});
    if (request.method === 'HEAD' || source.status !== 200) return response;
    return new HTMLRewriter()
      .on('title',{element(element) { element.setInnerContent(title); }})
      .on('meta',{element(element) {
        const name = element.getAttribute('property') || element.getAttribute('name');
        if (Object.hasOwn(metadata,name)) element.setAttribute('content',metadata[name]);
      }})
      .on('head',{element(element) {
        element.append(`<meta property="og:url" content="${escape(canonical.href)}"><meta property="og:image:alt" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical.href)}">`,{html:true});
      }})
      .transform(response);
  }
  return {async fetch(request,env,ctx) {
    const url = new URL(request.url);
    if (!['/','/og.png'].includes(url.pathname)) return env.ASSETS.fetch(request);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    return url.pathname === '/' ? html(request,env,url) : image(request,env,ctx,url);
  }};
}
