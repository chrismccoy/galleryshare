import { openDatabase } from '../../db/database.js';
import { migrate, MIGRATIONS } from '../../db/migrations.js';

export function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

let migrationsDdl;

function schemaMigrationsDdl() {
  if (migrationsDdl) return migrationsDdl;
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    migrationsDdl = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get().sql;
    return migrationsDdl;
  } finally {
    db.close();
  }
}

export function rowCount(db, table, where, ...params) {
  const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  return db.prepare(sql).get(...params).n;
}

export function dbAtVersion(version) {
  const db = openDatabase(':memory:');
  db.exec(schemaMigrationsDdl());
  for (const m of MIGRATIONS.filter((x) => x.version <= version)) {
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    })();
  }
  return db;
}
