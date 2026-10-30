import { nowIso, systemNow } from '../lib/time.js';
import { hashToken } from '../lib/tokens.js';
import { clampLimit, cursorId } from '../lib/paging.js';
import { SHARE_VIEWS_SHOWN, VIEW_KINDS, VIEW_USER_AGENT_MAX } from '../domain/share-links.js';






export function createGallerySharesRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    'INSERT INTO gallery_shares (gallery_id, token_hash, nonce, created_at) VALUES (?, ?, ?, ?)',
  );
  const liveForGalleryStmt = db.prepare('SELECT * FROM gallery_shares WHERE gallery_id = ? AND revoked_at IS NULL');
  const byHashStmt = db.prepare(
    `SELECT s.*, g.deleted_at, g.user_id, u.disabled AS owner_disabled
       FROM gallery_shares s
       JOIN galleries g ON g.id = s.gallery_id
       JOIN users u ON u.id = g.user_id
      WHERE s.token_hash = ?`,
  );
  const byIdStmt = db.prepare('SELECT * FROM gallery_shares WHERE id = ?');
  const revokeStmt = db.prepare(
    'UPDATE gallery_shares SET revoked_at = ?, revoked_by = ?, nonce = NULL WHERE id = ? AND revoked_at IS NULL',
  );
  const insertViewStmt = db.prepare(
    'INSERT INTO gallery_share_views (share_id, kind, viewed_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
  );
  const bumpStmt = db.prepare('UPDATE gallery_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?');
  const liveSelect = `SELECT s.id, s.gallery_id, s.created_at, s.view_count, s.last_viewed_at,
            g.title, g.deleted_at, g.user_id,
            u.display_name AS owner_name, u.email AS owner_email, u.disabled AS owner_disabled
       FROM gallery_shares s
       JOIN galleries g ON g.id = s.gallery_id
       JOIN users u ON u.id = g.user_id`;
  const listLiveStmt = db.prepare(
    `${liveSelect}
      WHERE s.revoked_at IS NULL AND (? IS NULL OR s.id < ?)
      ORDER BY s.id DESC
      LIMIT ?`,
  );
  const liveByIdStmt = db.prepare(`${liveSelect} WHERE s.id = ? AND s.revoked_at IS NULL`);
  const countLiveStmt = db.prepare('SELECT COUNT(*) AS n FROM gallery_shares WHERE revoked_at IS NULL');
  const countLiveForUserStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM gallery_shares s
       JOIN galleries g ON g.id = s.gallery_id
      WHERE g.user_id = ? AND g.deleted_at IS NULL AND s.revoked_at IS NULL`,
  );
  const viewsStmt = db.prepare(
    'SELECT * FROM gallery_share_views WHERE share_id = ? ORDER BY viewed_at DESC, id DESC LIMIT ?',
  );
  const liveAmongStmt = db.prepare(
    `SELECT DISTINCT gallery_id FROM gallery_shares
      WHERE revoked_at IS NULL AND gallery_id IN (SELECT value FROM json_each(?))`,
  );
  const liveIdsStmt = db.prepare(
    `SELECT s.gallery_id FROM gallery_shares s
       JOIN galleries g ON g.id = s.gallery_id
      WHERE g.user_id = ? AND s.revoked_at IS NULL`,
  );
  const purgeStmt = db.prepare('DELETE FROM gallery_share_views WHERE viewed_at < ?');
  const recordViewTx = db.transaction((shareId, kind, ip, userAgent) => {
    const at = nowIso(now);
    insertViewStmt.run(shareId, kind, at, ip, userAgent);
    if (kind === VIEW_KINDS.page) bumpStmt.run(at, shareId);
  });
  return {
    insert({ galleryId, token, nonce }) {
      return Number(insertStmt.run(galleryId, hashToken(token), nonce, nowIso(now)).lastInsertRowid);
    },

    liveForGallery(galleryId) {
      return liveForGalleryStmt.get(galleryId) ?? null;
    },

    byToken(token) {
      return byHashStmt.get(hashToken(token)) ?? null;
    },

    byId(id) {
      return byIdStmt.get(id) ?? null;
    },

    revoke(id, revokedBy) {
      return revokeStmt.run(nowIso(now), revokedBy ?? null, id).changes === 1;
    },

    recordView(shareId, { ip, userAgent, kind = VIEW_KINDS.page } = {}) {
      recordViewTx(
        shareId,
        kind,
        ip ?? null,
        userAgent == null ? null : String(userAgent).slice(0, VIEW_USER_AGENT_MAX),
      );
    },

    listLive({ beforeId, limit } = {}) {
      const before = cursorId(beforeId);
      return listLiveStmt.all(before, before, clampLimit(limit));
    },

    liveById(id) {
      return liveByIdStmt.get(id) ?? null;
    },

    countLive() {
      return countLiveStmt.get().n;
    },

    countLiveForUser(userId) {
      return countLiveForUserStmt.get(userId).n;
    },

    views(shareId, limit = SHARE_VIEWS_SHOWN) {
      return viewsStmt.all(shareId, limit);
    },

    liveGalleryIds(userId) {
      return new Set(liveIdsStmt.all(userId).map((r) => r.gallery_id));
    },

    liveAmong(galleryIds) {
      if (galleryIds.length === 0) return new Set();
      return new Set(liveAmongStmt.all(JSON.stringify(galleryIds)).map((r) => r.gallery_id));
    },

    purgeViewsBefore(iso) {
      return purgeStmt.run(iso).changes;
    },
  };
}
