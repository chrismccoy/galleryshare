import { cursorId, keysetPage } from '../../lib/paging.js';

export function listPage(req, { path, params, pageSize, fetch }) {
  const beforeId = cursorId(req.query.before_id) ?? undefined;
  return keysetPage((limit) => fetch({ beforeId, limit }), { path, params, pageSize });
}
