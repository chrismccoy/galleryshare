import { nowIso, systemNow } from '../lib/time.js';
import { readJsonColumn, writeJsonColumn } from './json-column.js';


export function createSettingsRepository(db, { now = systemNow } = {}) {
  const allStmt = db.prepare('SELECT key, value FROM settings');
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  );
  return {
    all() {
      const out = {};
      for (const row of allStmt.all()) {
        out[row.key] = readJsonColumn(row.value);
      }
      return out;
    },
    get(key) {
      const row = getStmt.get(key);
      return readJsonColumn(row?.value);
    },
    set(key, value, updatedBy = null) {
      setStmt.run(key, writeJsonColumn(value), updatedBy, nowIso(now));
    },
  };
}
