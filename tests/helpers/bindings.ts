import type { R2PutOptions } from '@cloudflare/workers-types';
import type { Env } from '../../src/worker/types.ts';

interface ImageStore {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, bytes: Uint8Array<ArrayBuffer>, metadata?: R2PutOptions): Promise<void>;
}
interface ShareStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ...options: unknown[]): Promise<void>;
}

// Unit-test doubles implement the binding operations the handler uses. The
// workerd integration suite checks the full Cloudflare binding contracts.
export const imageStore = (store: ImageStore): NonNullable<Env['OG_IMAGES']> =>
  store as unknown as NonNullable<Env['OG_IMAGES']>;
export const shareStore = (store: ShareStore): NonNullable<Env['SHARES']> =>
  store as unknown as NonNullable<Env['SHARES']>;
