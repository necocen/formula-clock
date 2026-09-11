/**
 * Browser-only probes run in a separate realm and may refer to injected mocks.
 * Node Playwright requires an actual function to call a serialized function body.
 * Keep the probe self-contained: this constructor captures no Node variables.
 */
export function script<Result>(source: string): (...args: unknown[]) => Result {
  return new Function('...args', `return (${source})(...args);`) as (...args: unknown[]) => Result;
}
