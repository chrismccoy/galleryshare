import { normalizeEmail } from '../lib/email.js';
import { nowIso, systemNow } from '../lib/time.js';
import { ADMIN, USER } from '../domain/roles.js';




const PUBLIC_COLS = 'id, email, display_name, role, disabled, created_at, updated_at';

export function createUsersRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    'INSERT INTO users (email, display_name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const byEmailStmt = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE email = ?`);
  const byIdStmt = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`);
  const allStmt = db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`);
  const hashStmt = db.prepare('SELECT password_hash FROM users WHERE id = ?');
  const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
  const setRoleStmt = db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?');
  const setDisabledStmt = db.prepare('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?');
  const removeStmt = db.prepare('DELETE FROM users WHERE id = ?');
  const backdateStmt = db.prepare('UPDATE users SET created_at = ? WHERE id = ?');
  const countAdminsStmt = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = '${ADMIN}' AND disabled = 0`);
  const statsStmt = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(role = '${ADMIN}'), 0) AS admins, COALESCE(SUM(role = '${USER}'), 0) AS users,
            COALESCE(SUM(disabled = 1), 0) AS disabled FROM users`,
  );

  return {
    insert({ email, displayName, passwordHash, role }) {
      const at = nowIso(now);
      return Number(insertStmt.run(normalizeEmail(email), displayName, passwordHash, role, at, at).lastInsertRowid);
    },
    backdate: (id, at) => backdateStmt.run(at, id).changes === 1,
    byEmail: (email) => byEmailStmt.get(normalizeEmail(email)) ?? null,
    byId: (id) => byIdStmt.get(id) ?? null,
    all: () => allStmt.all(),
    passwordHashById: (id) => hashStmt.get(id)?.password_hash ?? null,
    setPassword: (id, hash) => setPasswordStmt.run(hash, nowIso(now), id).changes === 1,
    setRole: (id, role) => setRoleStmt.run(role, nowIso(now), id).changes === 1,
    setDisabled: (id, disabled) => setDisabledStmt.run(disabled ? 1 : 0, nowIso(now), id).changes === 1,
    remove: (id) => removeStmt.run(id).changes === 1,
    countActiveAdmins: () => countAdminsStmt.get().n,
    stats() {
      const row = statsStmt.get();
      return {
        total: row.total,
        admins: row.admins,
        byRole: { [ADMIN]: row.admins, [USER]: row.users },
        disabled: row.disabled,
      };
    },
  };
}
