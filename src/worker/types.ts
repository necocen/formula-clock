import type {
  R2Bucket,
  KVNamespace,
  HTMLRewriterElementContentHandlers,
} from '@cloudflare/workers-types';
import type { SharedClockState, Expr } from '../shared/types.ts';
export interface RenderInput {
  state: SharedClockState;
  ast: Expr | null;
}
// Use the standard fetch surface so the same handler runs in Worker and Node
// integration tests; bindings retain their actual R2 method signatures.
export interface Assets {
  fetch(request: Request): Promise<Response>;
}
export interface Env {
  ASSETS: Assets;
  OG_IMAGES?: Pick<R2Bucket, 'get' | 'put'>;
  SHARES?: Pick<KVNamespace, 'get' | 'put'>;
}
export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
export interface Rewriter {
  on(selector: string, handlers: HTMLRewriterElementContentHandlers): Rewriter;
  transform(response: Response): Response;
}
export interface HandlerOptions {
  /** Build-baked manifest snapshot (virtual:clock-hours) adopted without a fetch. */
  hours?: unknown;
  renderOg(input: RenderInput): Promise<Uint8Array<ArrayBuffer>>;
  revision: string;
  timeoutMs?: number;
  writeTimeoutMs?: number;
  log?(fields: Record<string, unknown>): void;
}
export interface ImageResult {
  bytes: Uint8Array<ArrayBuffer>;
  cache: 'hit' | 'miss';
  key: string;
}
