import { clampLimit, cursorId } from '../lib/paging.js';
import { nowIso, systemNow } from '../lib/time.js';







const LIVE = 'deleted_at IS NULL';
const TRASHED = 'deleted_at IS NOT NULL';

const BYTES = 'COALESCE(SUM(i.bytes_orig + i.bytes_web + i.bytes_thumb), 0)';

const LIST_SELECT = `
  SELECT g.*,
         (SELECT COUNT(*) FROM gallery_images i WHERE i.gallery_id = g.id) AS image_count,
         (SELECT ${BYTES} FROM gallery_images i WHERE i.gallery_id = g.id) AS bytes,
         (SELECT i.id FROM gallery_images i WHERE i.gallery_id = g.id ORDER BY i.position, i.id LIMIT 1) AS thumb_image_id`;

export function createGalleriesRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare('INSERT INTO galleries (user_id, created_at, updated_at) VALUES (?, ?, ?)');
  const backdateStmt = db.prepare('UPDATE galleries SET created_at = ?, updated_at = ? WHERE id = ?');
  const liveByIdStmt = db.prepare(`SELECT * FROM galleries g WHERE g.id = ? AND ${LIVE}`);
  const byIdIncludingTrashedStmt = db.prepare('SELECT * FROM galleries WHERE id = ?');
  const forUserStmt = db.prepare(
    `${LIST_SELECT} FROM galleries g WHERE g.user_id = ? AND ${LIVE} AND (? IS NULL OR g.id < ?) ORDER BY g.id DESC LIMIT ?`,
  );
  const listLiveStmt = db.prepare(
    `${LIST_SELECT}, u.display_name AS owner_name, u.email AS owner_email
       FROM galleries g JOIN users u ON u.id = g.user_id
      WHERE ${LIVE} AND (? IS NULL OR g.user_id = ?) AND (? IS NULL OR g.id < ?)
      ORDER BY g.id DESC LIMIT ?`,
  );
  const updateMetaStmt = db.prepare(
    `UPDATE galleries SET title = ?, description = ?, allow_zip = ?, grid_text = ?, share_theme = ?, image_view = ?,
                          updated_by = ?, updated_at = ?
      WHERE id = ? AND ${LIVE}`,
  );
  const markEditedStmt = db.prepare('UPDATE galleries SET updated_by = ?, updated_at = ? WHERE id = ?');
  const trashOwnedStmt = db.prepare(`UPDATE galleries SET deleted_at = ? WHERE id = ? AND user_id = ? AND ${LIVE}`);
  const trashByIdStmt = db.prepare(`UPDATE galleries SET deleted_at = ? WHERE id = ? AND ${LIVE}`);
  const restoreStmt = db.prepare(`UPDATE galleries SET deleted_at = NULL WHERE id = ? AND user_id = ? AND ${TRASHED}`);
  const trashCursorStmt = db.prepare(
    `SELECT id, deleted_at FROM galleries WHERE id = ? AND user_id = ? AND ${TRASHED}`,
  );
  const trashedPageStmt = db.prepare(
    `${LIST_SELECT} FROM galleries g WHERE g.user_id = ? AND ${TRASHED}
        AND (? IS NULL OR g.deleted_at < ? OR (g.deleted_at = ? AND g.id < ?))
      ORDER BY g.deleted_at DESC, g.id DESC LIMIT ?`,
  );
  const countTrashedStmt = db.prepare(`SELECT COUNT(*) AS n FROM galleries WHERE user_id = ? AND ${TRASHED}`);
  const purgeOwnedStmt = db.prepare(`DELETE FROM galleries WHERE id = ? AND user_id = ? AND ${TRASHED}`);
  const emptyStmt = db.prepare(`DELETE FROM galleries WHERE user_id = ? AND ${TRASHED} RETURNING id`);
  const purgeDueStmt = db.prepare(`DELETE FROM galleries WHERE ${TRASHED} AND deleted_at < ? RETURNING id`);
  const idsForUserStmt = db.prepare('SELECT id FROM galleries WHERE user_id = ? ORDER BY id');
  const bytesForUserStmt = db.prepare(
    `SELECT ${BYTES} AS n FROM gallery_images i JOIN galleries g ON g.id = i.gallery_id WHERE g.user_id = ?`,
  );
  const userTotalsStmt = db.prepare(
    `SELECT COUNT(DISTINCT g.id) AS galleries, COUNT(i.id) AS images
       FROM galleries g LEFT JOIN gallery_images i ON i.gallery_id = g.id
      WHERE g.user_id = ? AND ${LIVE}`,
  );
  const liveCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM galleries g WHERE ${LIVE}`);
  const liveCountForUserStmt = db.prepare(`SELECT COUNT(*) AS n FROM galleries g WHERE g.user_id = ? AND ${LIVE}`);
  const trashedCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM galleries g WHERE ${TRASHED}`);
  const liveTotalsStmt = db.prepare(
    `SELECT COUNT(i.id) AS images, ${BYTES} AS bytes FROM gallery_images i JOIN galleries g ON g.id = i.gallery_id WHERE ${LIVE}`,
  );
  const largestStmt = db.prepare(
    `SELECT g.id, g.title, u.display_name AS owner_name, COUNT(i.id) AS image_count, ${BYTES} AS bytes
       FROM galleries g JOIN users u ON u.id = g.user_id LEFT JOIN gallery_images i ON i.gallery_id = g.id
      WHERE ${LIVE} GROUP BY g.id ORDER BY bytes DESC, g.id DESC LIMIT ?`,
  );

  const deletedIds = (stmt, param) =>
    stmt
      .all(param)
      .map((r) => r.id)
      .sort((a, b) => a - b);

  return {
    insert: ({ userId }) => {
      const at = nowIso(now);
      return Number(insertStmt.run(userId, at, at).lastInsertRowid);
    },
    backdate: (id, at) => backdateStmt.run(at, at, id).changes === 1,
    liveById: (id) => liveByIdStmt.get(id) ?? null,
    byIdIncludingTrashed: (id) => byIdIncludingTrashedStmt.get(id) ?? null,
    forUser(userId, { beforeId, limit } = {}) {
      const before = cursorId(beforeId);
      return forUserStmt.all(userId, before, before, clampLimit(limit));
    },
    listLive({ userId, beforeId, limit } = {}) {
      const before = cursorId(beforeId);
      const owner = userId ?? null;
      return listLiveStmt.all(owner, owner, before, before, clampLimit(limit));
    },
    updateMeta(id, { title, description, allowZip, gridText = null, shareTheme = null, imageView = null, actorId }) {
      return (
        updateMetaStmt.run(
          title ?? null,
          description ?? null,
          allowZip ? 1 : 0,
          gridText,
          shareTheme,
          imageView,
          actorId ?? null,
          nowIso(now),
          id,
        ).changes === 1
      );
    },
    markEdited: (id, actorId) => markEditedStmt.run(actorId ?? null, nowIso(now), id).changes === 1,
    trashOwned: (id, userId) => trashOwnedStmt.run(nowIso(now), id, userId).changes === 1,
    trashById: (id) => trashByIdStmt.run(nowIso(now), id).changes === 1,
    restoreOwned: (id, userId) => restoreStmt.run(id, userId).changes === 1,
    trashedForUser(userId, { beforeId, limit } = {}) {
      const before = cursorId(beforeId);
      const cursor = before ? trashCursorStmt.get(before, userId) : undefined;
      const at = cursor?.deleted_at ?? null;
      return trashedPageStmt.all(userId, at, at, at, cursor?.id ?? null, clampLimit(limit));
    },
    countTrashed: (userId) => countTrashedStmt.get(userId).n,
    countLive: (userId = null) => (userId === null ? liveCountStmt.get().n : liveCountForUserStmt.get(userId).n),
    purgeOwned: (id, userId) => purgeOwnedStmt.run(id, userId).changes === 1,
    emptyTrash: (userId) => deletedIds(emptyStmt, userId),
    purgeTrashedBefore: (iso) => deletedIds(purgeDueStmt, iso),
    idsForUser: (userId) => idsForUserStmt.all(userId).map((r) => r.id),
    bytesForUser: (userId) => bytesForUserStmt.get(userId).n,
    totalsForUser: (userId) => userTotalsStmt.get(userId),
    stats() {
      const galleries = liveCountStmt.get().n;
      const { images, bytes } = liveTotalsStmt.get();
      return {
        galleries,
        images,
        avgImages: galleries === 0 ? 0 : Math.round((images / galleries) * 10) / 10,
        bytes,
        trashed: trashedCountStmt.get().n,
      };
    },
    largest: (limit = 5) => largestStmt.all(limit),
  };
}
