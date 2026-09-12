import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import hoursSnapshot from 'virtual:clock-hours';
import { createHandler } from './handler.ts';
import { initRenderer, renderOg } from './render.ts';
import type { Context, Env } from './types.ts';

let handler: ReturnType<typeof createHandler>;

export default {
  fetch(request: Request, env: Env & { WORKER_VERSION: { id: string } }, ctx: Context) {
    handler ??= createHandler({
      revision: env.WORKER_VERSION.id,
      hours: hoursSnapshot,
      renderOg: async (input) => {
        await initRenderer(wasm);
        return renderOg(input);
      },
    });
    // Vite HMR keeps the local version id. Render fresh during development so
    // an R2 entry cannot hide an edit; preview/deploy exercise the real cache.
    return handler.fetch(
      request,
      import.meta.env.DEV ? { ...env, OG_IMAGES: undefined } : env,
      ctx,
    );
  },
};
