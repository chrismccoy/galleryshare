import { hashToken } from '../lib/tokens.js';
import { nowIso, systemNow } from '../lib/time.js';



export function createResetTokensRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    'INSERT INTO reset_tokens (user_id, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byHashStmt = db.prepare('SELECT * FROM reset_tokens WHERE token_hash = ?');
  const removeUnusedStmt = db.prepare('DELETE FROM reset_tokens WHERE user_id = ? AND used_at IS NULL');
  const markUsedStmt = db.prepare('UPDATE reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL');
  return {
    insert({ userId, token, createdBy, expiresAt }) {
      return Number(
        insertStmt.run(userId, hashToken(token), createdBy ?? null, nowIso(now), expiresAt).lastInsertRowid,
      );
    },
    byToken: (token) => byHashStmt.get(hashToken(token)) ?? null,
    removeUnusedForUser: (userId) => removeUnusedStmt.run(userId).changes,
    markUsed: (id) => markUsedStmt.run(nowIso(now), id).changes === 1,
  };
}
