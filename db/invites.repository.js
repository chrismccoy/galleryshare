import { hashToken } from '../lib/tokens.js';
import { nowIso, systemNow } from '../lib/time.js';



export function createInvitesRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    'INSERT INTO invites (token_hash, role, label, created_by, created_at, expires_at, token_enc) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const byHashStmt = db.prepare('SELECT * FROM invites WHERE token_hash = ?');
  const allStmt = db.prepare('SELECT * FROM invites ORDER BY id DESC');
  const revokeStmt = db.prepare(
    'UPDATE invites SET revoked_at = ?, token_enc = NULL WHERE id = ? AND revoked_at IS NULL AND used_at IS NULL',
  );
  const revokePendingStmt = db.prepare(
    'UPDATE invites SET revoked_at = ?, token_enc = NULL WHERE created_by = ? AND used_at IS NULL AND revoked_at IS NULL',
  );
  const markUsedStmt = db.prepare(
    'UPDATE invites SET used_at = ?, used_by = ?, token_enc = NULL WHERE id = ? AND used_at IS NULL',
  );
  return {
    insert({ token, role, label, createdBy, expiresAt, tokenEnc }) {
      const info = insertStmt.run(
        hashToken(token),
        role,
        label ?? null,
        createdBy ?? null,
        nowIso(now),
        expiresAt,
        tokenEnc ?? null,
      );
      return Number(info.lastInsertRowid);
    },
    byToken: (token) => byHashStmt.get(hashToken(token)) ?? null,
    all: () => allStmt.all(),
    revoke: (id) => revokeStmt.run(nowIso(now), id).changes === 1,
    revokePendingBy: (userId) => revokePendingStmt.run(nowIso(now), userId).changes,
    markUsed: (id, userId) => markUsedStmt.run(nowIso(now), userId, id).changes === 1,
  };
}
