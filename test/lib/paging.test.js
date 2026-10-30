import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE, clampLimit, keysetPage } from '../../lib/paging.js';

const rowsOf = (count) => Array.from({ length: count }, (_, i) => ({ id: count - i }));

test('a short list has no older page and asks for one row more than a page', () => {
  let asked = 0;
  const page = keysetPage(
    (limit) => {
      asked = limit;
      return rowsOf(3);
    },
    { path: '/x' },
  );
  assert.equal(asked, DEFAULT_PAGE_SIZE + 1);
  assert.equal(page.rows.length, 3);
  assert.equal(page.olderUrl, null);
});

test('exactly one page has no older link; one more row adds it from the last shown id', () => {
  assert.equal(keysetPage(() => rowsOf(DEFAULT_PAGE_SIZE), { path: '/x' }).olderUrl, null);
  const page = keysetPage(() => rowsOf(DEFAULT_PAGE_SIZE + 1), { path: '/dashboard/trash' });
  assert.equal(page.rows.length, DEFAULT_PAGE_SIZE);
  assert.equal(page.olderUrl, `/dashboard/trash?before_id=${page.rows.at(-1).id}`);
});

test('filters are kept in the older link and empty ones are left out', () => {
  const page = keysetPage(() => rowsOf(4), {
    path: '/admin/galleries',
    params: { owner: 'maya', user_id: 7, empty: '', none: null },
    pageSize: 3,
  });
  assert.equal(page.olderUrl, '/admin/galleries?owner=maya&user_id=7&before_id=2');
});

test('page-size bounds: 5 to 100, default 25', () => {
  assert.deepEqual([MIN_PAGE_SIZE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE], [5, 25, 100]);
});

test('clampLimit keeps 1..MAX_PAGE_SIZE + 1 and falls back to DEFAULT_PAGE_SIZE', () => {
  assert.equal(clampLimit(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(clampLimit('abc'), DEFAULT_PAGE_SIZE);
  assert.equal(clampLimit(0), DEFAULT_PAGE_SIZE);
  assert.equal(clampLimit('7'), 7);
  assert.equal(clampLimit(MAX_PAGE_SIZE + 50), MAX_PAGE_SIZE + 1);
  for (const junk of ['10abc', '1.5', ' 7', '-3', 1.5, null])
    assert.equal(clampLimit(junk), DEFAULT_PAGE_SIZE, String(junk));
});
