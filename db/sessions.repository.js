import { hashToken } from '../lib/tokens.js';
import { nowIso, systemNow, toIso } from '../lib/time.js';



export function createSessionsRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  );
  const liveByHashStmt = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?');
  const removeStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const removeForUserStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const sweepStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  return {
    insert({ userId, token, csrfToken, expiresAt }) {
      insertStmt.run(hashToken(token), userId, csrfToken, nowIso(now), toIso(expiresAt));
    },
    liveByToken: (token) => liveByHashStmt.get(hashToken(token), nowIso(now)) ?? null,
    remove: (token) => removeStmt.run(hashToken(token)).changes === 1,
    removeForUser: (userId) => removeForUserStmt.run(userId).changes,
    sweep: () => sweepStmt.run(nowIso(now)).changes,
  };
}
