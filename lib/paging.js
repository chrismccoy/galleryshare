import { digitsInt, positiveInt } from './params.js';

export const DEFAULT_PAGE_SIZE = 25;

export const MIN_PAGE_SIZE = 5;

export const MAX_PAGE_SIZE = 100;

const MAX_FETCH = MAX_PAGE_SIZE + 1;

export function clampLimit(limit) {
  const n = Number.isInteger(limit) ? limit : digitsInt(limit);
  return n !== null && n >= 1 ? Math.min(n, MAX_FETCH) : DEFAULT_PAGE_SIZE;
}

export const cursorId = (beforeId) => positiveInt(beforeId);

export function keysetPage(fetchRows, { path, params = {}, pageSize = DEFAULT_PAGE_SIZE }) {
  const fetched = fetchRows(pageSize + 1);
  const rows = fetched.slice(0, pageSize);
  if (fetched.length <= pageSize) return { rows, olderUrl: null };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  }
  query.set('before_id', String(rows.at(-1).id));
  return { rows, olderUrl: `${path}?${query}` };
}
