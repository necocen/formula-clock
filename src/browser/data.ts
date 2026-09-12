import Data from '../shared/data.ts';
import type { FetchHourOptions, FormulaTable } from '../shared/types.ts';

export class FetchHourProvider extends Data.FetchHourProvider {
  constructor(manifestUrl: string | URL, options: FetchHourOptions = {}) {
    super(new URL(manifestUrl, document.baseURI), options);
  }
}

export async function loadEmbedded(element: HTMLElement | null): Promise<FormulaTable> {
  if (!element) throw new Error('Embedded formula table is missing');
  if (element.dataset.encoding !== 'gzip-base64') return JSON.parse(element.textContent || '');
  const bytes = Uint8Array.from(atob((element.textContent || '').trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json() as Promise<FormulaTable>;
}

export default Object.freeze({ ...Data, FetchHourProvider, loadEmbedded });
