import type { SharedClockState, SharedView } from '../types.ts';
import type { Assets, Env, Context, Rewriter, HandlerOptions, ImageResult } from './types.ts';
declare const HTMLRewriter: { new (): Rewriter };
import Share from '../share.ts';
import * as Data from '../data.ts';
import { createShare, readShare, ShareError, json } from './shares.ts';
import I18n from '../i18n.ts';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const normalDescription = 'A clock that displays a different mathematical expression every second.';
const keyFor = (state: SharedClockState, revision: string) =>
  `og/${revision}/${state.t}-${state.font}-${state.numerals}-${state.division}.png`;
function deadline<T>(
  task: (signal: AbortSignal) => T | Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  return Promise.race([Promise.resolve().then(() => task(controller.signal)), expired]).finally(
    () => clearTimeout(timer),
  );
}
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason;
};

// The entrypoint supplies the renderer, leaving routing/cache failures testable
// without loading MathJax. No URL or TeX supplied by a visitor is ever rendered.
export function createHandler({
  renderOg,
  revision,
  timeoutMs = 8000,
  writeTimeoutMs = 1000,
  log = (value) => console.log(JSON.stringify(value)),
}: HandlerOptions) {
  const providers = new WeakMap<Assets, Data.FetchHourProvider>(),
    pending = new Map<string, Promise<ImageResult>>();
  function providerFor(assets: Assets) {
    if (!providers.has(assets))
      providers.set(
        assets,
        new Data.FetchHourProvider('https://assets.local/data/manifest.json', {
          fetch: (url, options) => assets.fetch(new Request(url, options)),
        }),
      );
    return providers.get(assets)!;
  }
  function record(fields: Record<string, unknown>) {
    log({ event: 'og', revision, ...fields });
  }
  function imageJob(state: SharedClockState, env: Env, shared?: SharedView) {
    const key = shared ? `og/${revision}/shares/${shared.id}.png` : keyFor(state, revision);
    if (pending.has(key)) return { task: pending.get(key)!, coalesced: true };
    const task = deadline<ImageResult>(
      async (signal) => {
        if (env.OG_IMAGES) {
          try {
            const object = await env.OG_IMAGES.get(key);
            check(signal);
            if (object)
              return { bytes: new Uint8Array(await object.arrayBuffer()), cache: 'hit', key };
          } catch (error) {
            check(signal);
            record({
              status: 'cache-read-error',
              reason: String(error instanceof Error ? error.message : error),
            });
          }
        }
        const ast = shared
          ? shared.snapshot.ast
          : (await providerFor(env.ASSETS).getMinute(state.t.slice(0, 4), { signal })).seconds[
              Number(state.t.slice(4))
            ];
        check(signal);
        const bytes = await renderOg({ state, ast });
        check(signal);
        return { bytes, cache: 'miss', key };
      },
      timeoutMs,
      'Image generation',
    )
      .then(async (result) => {
        if (result.cache === 'miss' && env.OG_IMAGES) {
          try {
            await deadline(
              () =>
                env.OG_IMAGES!.put(key, result.bytes, {
                  httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
                  customMetadata: { revision },
                }),
              writeTimeoutMs,
              'Image cache write',
            );
          } catch (error) {
            record({
              status: 'cache-write-error',
              reason: String(error instanceof Error ? error.message : error),
            });
          }
        }
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return { task, coalesced: false };
  }
  async function fallback(request: Request, env: Env, reason: string) {
    record({ status: 'default', reason });
    const asset = await env.ASSETS.fetch(new Request(new URL('/og-default.png', request.url)));
    const headers = new Headers(asset.headers);
    headers.set('Content-Type', 'image/png');
    headers.set('Cache-Control', 'public, max-age=60');
    headers.set('X-Content-Type-Options', 'nosniff');
    // The bundled fallback is independent of R2 and the renderer.
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      status: asset.status,
      headers,
    });
  }
  async function image(request: Request, env: Env, ctx: Context, url: URL, shared?: SharedView) {
    const state = shared?.snapshot || Share.parse(url);
    if (!state) return fallback(request, env, 'no-shared-state');
    const started = Date.now();
    const { task, coalesced } = imageJob(state, env, shared);
    ctx.waitUntil(task.catch(() => {}));
    try {
      const result = await task,
        etag = `"${result.key}"`;
      const headers: Record<string, string> = {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      };
      record({
        status: 'ok',
        cache: coalesced ? 'coalesced' : result.cache,
        time: state.t,
        elapsedMs: Date.now() - started,
        bytes: result.bytes.byteLength,
      });
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers });
      headers['Content-Length'] = String(result.bytes.byteLength);
      return new Response(request.method === 'HEAD' ? null : result.bytes, { headers });
    } catch (error) {
      return fallback(request, env, String(error instanceof Error ? error.message : error));
    }
  }
  async function html(request: Request, env: Env, url: URL, shared?: SharedView) {
    const state = shared?.snapshot || Share.parse(url),
      canonical = shared
        ? Share.shortUrl(url.origin, shared.id)
        : state
          ? Share.url(url.origin, state)
          : new URL('/', url.origin);
    const imageUrl = new URL(shared ? `/s/${shared.id}/og.png` : '/og.png', url.origin);
    if (state && !shared) imageUrl.search = Share.params(state).toString();
    imageUrl.searchParams.set('r', revision);
    let ast = shared?.snapshot.ast;
    if (state && !shared) {
      try {
        ast = (
          await deadline(
            (signal) => providerFor(env.ASSETS).getMinute(state.t.slice(0, 4), { signal }),
            timeoutMs,
            'Shared metadata',
          )
        ).seconds[Number(state.t.slice(4))];
      } catch {
        /* Legacy links retain the time title when the dataset is unavailable. */
      }
    }
    const reading = state ? { ...state, ast } : null,
      title = Share.title(reading),
      card = Share.card(reading);
    const description = card.description || normalDescription;
    const metadata: Record<string, string> = {
      description: description,
      'og:title': card.title,
      'og:description': description,
      'og:image': imageUrl.href,
      'twitter:title': card.title,
      'twitter:image': imageUrl.href,
    };
    // Clear query and conditional headers: the source asset's ETag cannot stand
    // for the dynamically rewritten representation of every shared state.
    const source = await env.ASSETS.fetch(
      new Request(new URL('/', url.origin), { method: request.method }),
    );
    const headers = new Headers(source.headers);
    headers.delete('ETag');
    headers.delete('Last-Modified');
    headers.delete('Content-Length');
    headers.set('Cache-Control', 'no-cache');
    const response = new Response(source.body, { status: source.status, headers });
    if (request.method === 'HEAD' || source.status !== 200) return response;
    return new HTMLRewriter()
      .on('title', {
        element(element) {
          element.setInnerContent(title);
        },
      })
      .on('meta', {
        element(element) {
          const name = element.getAttribute('property') || element.getAttribute('name');
          if (name && Object.hasOwn(metadata, name))
            element.setAttribute('content', metadata[name]);
        },
      })
      .on('head', {
        element(element) {
          if (shared) {
            // Root-relative data fetching also works while the address is /s/{id}.
            const payload = JSON.stringify(shared)
              .replace(/</g, '\\u003c')
              .replace(/\u2028/g, '\\u2028')
              .replace(/\u2029/g, '\\u2029');
            element.prepend(
              `<base href="/"><script id="shared-clock" type="application/json">${payload}</script>`,
              { html: true },
            );
          }
          element.append(
            `<meta property="og:url" content="${escape(canonical.href)}"><meta property="og:image:alt" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical.href)}">`,
            { html: true },
          );
        },
      })
      .transform(response);
  }
  return {
    async fetch(request: Request, env: Env, ctx: Context) {
      const url = new URL(request.url);
      if (url.pathname === '/api/shares') {
        if (request.method !== 'POST')
          return json({ error: 'method-not-allowed' }, 405, { Allow: 'POST' });
        const started = Date.now();
        let response: Response;
        try {
          response = await deadline(
            () =>
              createShare(request, env, ctx, (fields) =>
                log({ event: 'share-store', revision, ...fields }),
              ),
            timeoutMs,
            'Share creation',
          );
        } catch (error) {
          response = json(
            { error: error instanceof ShareError ? error.message : 'share-storage-unavailable' },
            error instanceof ShareError ? error.status : 503,
          );
        }
        response.headers.append('Server-Timing', `share;dur=${Date.now() - started}`);
        return response;
      }
      const imagePath = url.pathname.endsWith('/og.png'),
        id = Share.id(imagePath ? url.pathname.slice(0, -7) : url.pathname);
      if (!['/', '/og.png'].includes(url.pathname) && !url.pathname.startsWith('/s/'))
        return env.ASSETS.fetch(request);
      if (!['GET', 'HEAD'].includes(request.method))
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      if (url.pathname.startsWith('/s/')) {
        try {
          if (!id) throw new ShareError(404, 'share-not-found');
          const shared = await deadline(() => readShare(id, env), timeoutMs, 'Share lookup');
          return imagePath
            ? image(request, env, ctx, url, shared)
            : html(request, env, url, shared);
        } catch (error) {
          const status = error instanceof ShareError ? error.status : 503;
          if (imagePath)
            return new Response(
              request.method === 'HEAD' ? null : JSON.stringify({ error: 'share-unavailable' }),
              {
                status,
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-store',
                  'Retry-After': '60',
                },
              },
            );
          const { t, locale } = I18n.create(
            request.headers.get('Accept-Language')?.split(',')[0]?.split(';')[0],
          );
          const body = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('shareUnavailable')} — Formula Clock</title><style>body{margin:0;background:#111710;color:#d8dccf;font:16px/1.8 system-ui}main{max-width:32em;margin:15vh auto;padding:24px}h1{font-size:22px}p{color:#a4aa9b}a{color:inherit;display:inline-block;margin-right:24px}</style><main><h1>${t('shareUnavailable')}</h1><p>${t(status === 404 ? 'shareNotFound' : 'shareLoadFailed')}</p><a href="${escape(url.pathname)}">${t('reload')}</a><a href="/">Formula Clock</a></main></html>`;
          return new Response(request.method === 'HEAD' ? null : body, {
            status,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'Retry-After': '60',
            },
          });
        }
      }
      return url.pathname === '/' ? html(request, env, url) : image(request, env, ctx, url);
    },
  };
}
