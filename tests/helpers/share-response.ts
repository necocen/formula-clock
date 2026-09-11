import assert from 'node:assert/strict';
import Share from '../../src/shared/share.ts';
import { isRecord } from '../../src/shared/types.ts';

export function shareId(value: unknown): string {
  assert.ok(isRecord(value) && typeof value.id === 'string');
  assert.match(value.id, /^[A-Za-z0-9]{10}$/);
  return value.id;
}

export function sharedSnapshot(html: string) {
  const embedded = html.match(
    /<script id="shared-clock" type="application\/json">(.*?)<\/script>/s,
  );
  assert.ok(embedded, 'Shared page must contain the saved snapshot');
  const raw: unknown = JSON.parse(embedded[1]);
  const view = Share.view(raw);
  assert.ok(isRecord(raw));
  assert.deepEqual(raw.snapshot, view.snapshot, 'Saved AST must already be canonical');
  return view.snapshot;
}
