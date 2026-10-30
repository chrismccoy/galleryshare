import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGEST_STATUS, MAX_SKIPPED_LISTED, skippedCounts } from '../../domain/ingest.js';

test('INGEST_STATUS lists the four job states and cannot be changed', () => {
  assert.deepEqual(INGEST_STATUS, { pending: 'pending', running: 'running', done: 'done', failed: 'failed' });
  assert.ok(Object.isFrozen(INGEST_STATUS));
  assert.equal(MAX_SKIPPED_LISTED, 100);
});

test('skippedCounts counts named items, the closing "more" item, and upload-time items', () => {
  assert.deepEqual(skippedCounts([]), { total: 0, atUpload: 0 });
  assert.deepEqual(
    skippedCounts([
      { name: 'a.zip/x.txt', reason: 'Not an image.', atUpload: true },
      { name: 'b.jpg', reason: 'Unreadable.' },
      { name: '…', reason: 'and 5 more files were skipped', more: 5 },
    ]),
    { total: 7, atUpload: 1 },
  );
});
