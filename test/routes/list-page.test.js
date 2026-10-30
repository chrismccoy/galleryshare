import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPage } from '../../routes/view/list-page.js';

const rowsOf = (count) => Array.from({ length: count }, (_, i) => ({ id: count - i }));

test('listPage reads before_id, asks for one row more than the page size in effect and keeps the filters', () => {
  const calls = [];
  const page = listPage(
    { query: { before_id: '40' } },
    {
      path: '/dashboard/galleries',
      pageSize: 5,
      params: { q: 'x' },
      fetch: (args) => {
        calls.push(args);
        return rowsOf(6);
      },
    },
  );
  assert.deepEqual(calls, [{ beforeId: 40, limit: 6 }]);
  assert.equal(page.rows.length, 5);
  assert.equal(page.olderUrl, '/dashboard/galleries?q=x&before_id=2');
});

test('listPage passes beforeId undefined for a missing or malformed before_id', () => {
  for (const query of [{}, { before_id: 'abc' }, { before_id: '012' }, { before_id: '-1' }]) {
    let seen = null;
    const page = listPage(
      { query },
      {
        path: '/dashboard/trash',
        pageSize: 5,
        fetch: (args) => {
          seen = args;
          return rowsOf(2);
        },
      },
    );
    assert.ok(Object.hasOwn(seen, 'beforeId'));
    assert.equal(seen.beforeId, undefined);
    assert.equal(page.olderUrl, null);
  }
});
