const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const SCHEMA_V1 = `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('user','admin')),
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (${NOW}),
    updated_at    TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE invites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    role       TEXT NOT NULL CHECK (role IN ('user','admin')),
    label      TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TEXT,
    token_enc  TEXT
  );

  CREATE TABLE reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX idx_reset_tokens_user ON reset_tokens(user_id);

  CREATE TABLE rate_limit_windows (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_rate_limit_expires ON rate_limit_windows(expires_at);

  CREATE TABLE galleries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    description TEXT,
    allow_zip   INTEGER NOT NULL DEFAULT 0 CHECK (allow_zip IN (0,1)),
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
  );
  CREATE INDEX idx_galleries_user ON galleries(user_id, deleted_at, id DESC);

  CREATE TABLE gallery_images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_id    INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    public_name   TEXT NOT NULL UNIQUE,
    title         TEXT,
    caption       TEXT,
    original_name TEXT NOT NULL,
    mime          TEXT NOT NULL,
    ext           TEXT NOT NULL,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    bytes_orig    INTEGER NOT NULL,
    bytes_web     INTEGER NOT NULL,
    bytes_thumb   INTEGER NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_gallery_images_order ON gallery_images(gallery_id, position);

  CREATE TABLE ingest_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gallery_id      INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
    total           INTEGER NOT NULL,
    bytes           INTEGER NOT NULL DEFAULT 0,
    processed       INTEGER NOT NULL DEFAULT 0,
    skipped         TEXT NOT NULL DEFAULT '[]',
    error           TEXT,
    notice_shown_at TEXT,
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    finished_at     TEXT
  );
  CREATE INDEX idx_ingest_jobs_gallery ON ingest_jobs(gallery_id, id);
  CREATE INDEX idx_ingest_jobs_user ON ingest_jobs(user_id);

  CREATE TABLE gallery_shares (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_id     INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL UNIQUE,
    nonce          TEXT,
    created_at     TEXT NOT NULL,
    revoked_at     TEXT,
    revoked_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    view_count     INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT
  );
  CREATE UNIQUE INDEX idx_gallery_shares_live ON gallery_shares(gallery_id) WHERE revoked_at IS NULL;

  CREATE TABLE gallery_share_views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id   INTEGER NOT NULL REFERENCES gallery_shares(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page','zip')),
    viewed_at  TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    country    TEXT
  );
  CREATE INDEX idx_gallery_share_views_share ON gallery_share_views(share_id, viewed_at DESC);
  CREATE INDEX idx_gallery_share_views_time ON gallery_share_views(viewed_at);
`;

export const SCHEMA_V2 = 'ALTER TABLE sessions RENAME COLUMN token TO token_hash';

export const SCHEMA_V3 = 'ALTER TABLE gallery_images ADD COLUMN phash TEXT';

export const SCHEMA_V4 = 'ALTER TABLE galleries ADD COLUMN grid_text INTEGER CHECK (grid_text IN (0, 1))';

export const SCHEMA_V5 = `
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  area TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'visitor', 'system')),
  actor_id INTEGER,
  actor_name TEXT,
  subject_user_id INTEGER,
  subject_name TEXT,
  gallery_id INTEGER,
  gallery_title TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_activity_actor ON activity (actor_id, id);
CREATE INDEX idx_activity_subject ON activity (subject_user_id, id);
CREATE INDEX idx_activity_gallery ON activity (gallery_id, id);
CREATE INDEX idx_activity_area ON activity (area, id);
CREATE INDEX idx_activity_at ON activity (at);
`;

export const SCHEMA_V6 = 'ALTER TABLE galleries ADD COLUMN share_theme TEXT';

export const SCHEMA_V7 = 'ALTER TABLE galleries ADD COLUMN image_view TEXT';

export const MIGRATIONS = [
  {
    version: 1,
    up: (db) => db.exec(SCHEMA_V1),
  },
  {
    version: 2,
    up: (db) => db.exec(SCHEMA_V2),
  },
  {
    version: 3,
    up: (db) => db.exec(SCHEMA_V3),
  },
  {
    version: 4,
    up: (db) => db.exec(SCHEMA_V4),
  },
  {
    version: 5,
    up: (db) => db.exec(SCHEMA_V5),
  },
  {
    version: 6,
    up: (db) => db.exec(SCHEMA_V6),
  },
  {
    version: 7,
    up: (db) => db.exec(SCHEMA_V7),
  },
];

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (${NOW})
  )`);
  const from = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
  let to = from;
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    })();
    to = m.version;
  }
  return { from, to };
}
