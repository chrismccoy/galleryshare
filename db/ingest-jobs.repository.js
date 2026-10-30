import { nowIso, systemNow } from '../lib/time.js';
import { INGEST_STATUS } from '../domain/ingest.js';
import { readJsonColumn, writeJsonColumn } from './json-column.js';




const UNFINISHED = `status IN ('${INGEST_STATUS.pending}', '${INGEST_STATUS.running}')`;

const toJob = (row) => (row ? { ...row, skipped: readJsonColumn(row.skipped) } : null);

export function createIngestJobsRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    `INSERT INTO ingest_jobs (user_id, gallery_id, status, total, bytes, created_at) VALUES (?, ?, '${INGEST_STATUS.pending}', ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM ingest_jobs WHERE id = ?');
  const setRunningStmt = db.prepare(
    `UPDATE ingest_jobs SET status = '${INGEST_STATUS.running}', started_at = ? WHERE id = ? AND status = '${INGEST_STATUS.pending}'`,
  );
  const progressStmt = db.prepare(`UPDATE ingest_jobs SET processed = ?, skipped = ? WHERE id = ? AND ${UNFINISHED}`);
  const setDoneStmt = db.prepare(
    `UPDATE ingest_jobs SET status = '${INGEST_STATUS.done}', finished_at = ? WHERE id = ? AND ${UNFINISHED}`,
  );
  const setFailedStmt = db.prepare(
    `UPDATE ingest_jobs SET status = '${INGEST_STATUS.failed}', error = ?, finished_at = ? WHERE id = ? AND ${UNFINISHED}`,
  );
  const unfinishedStmt = db.prepare(`SELECT * FROM ingest_jobs WHERE ${UNFINISHED} ORDER BY id`);
  const pendingNoticeStmt = db.prepare(
    `SELECT * FROM ingest_jobs
      WHERE gallery_id = ? AND status = '${INGEST_STATUS.done}' AND skipped <> '[]' AND notice_shown_at IS NULL
      ORDER BY id DESC LIMIT 1`,
  );
  const activeForGalleryStmt = db.prepare(
    `SELECT * FROM ingest_jobs WHERE gallery_id = ? AND ${UNFINISHED} ORDER BY id DESC LIMIT 1`,
  );
  const pendingImagesStmt = db.prepare(
    `SELECT COALESCE(SUM(total - processed), 0) AS n FROM ingest_jobs WHERE gallery_id = ? AND ${UNFINISHED}`,
  );
  const pendingBytesForUserStmt = db.prepare(
    `SELECT COALESCE(SUM(j.bytes), 0) AS n FROM ingest_jobs j JOIN galleries g ON g.id = j.gallery_id
      WHERE g.user_id = ? AND j.${UNFINISHED}`,
  );
  const markNoticeShownStmt = db.prepare(
    'UPDATE ingest_jobs SET notice_shown_at = ? WHERE id = ? AND notice_shown_at IS NULL',
  );

  return {
    insert: ({ userId, galleryId, total, bytes = 0 }) =>
      Number(insertStmt.run(userId, galleryId, total, bytes, nowIso(now)).lastInsertRowid),
    byId: (id) => toJob(byIdStmt.get(id)),
    setRunning: (id) => setRunningStmt.run(nowIso(now), id).changes === 1,
    progress: (id, processed, skipped) => progressStmt.run(processed, writeJsonColumn(skipped), id).changes === 1,
    setDone: (id) => setDoneStmt.run(nowIso(now), id).changes === 1,
    setFailed: (id, error) => setFailedStmt.run(error, nowIso(now), id).changes === 1,
    unfinished: () => unfinishedStmt.all().map(toJob),
    pendingNotice: (galleryId) => toJob(pendingNoticeStmt.get(galleryId)),
    pendingImages: (galleryId) => pendingImagesStmt.get(galleryId).n,
    pendingBytesForUser: (userId) => pendingBytesForUserStmt.get(userId).n,
    activeForGallery: (galleryId) => toJob(activeForGalleryStmt.get(galleryId)),
    markNoticeShown: (id) => markNoticeShownStmt.run(nowIso(now), id).changes === 1,
  };
}
