import { nowIso, systemNow } from '../lib/time.js';
import { clampLimit, cursorId } from '../lib/paging.js';
import { USER_HIDDEN_AREAS } from '../domain/activity.js';







export function activityListSql(used) {
  return `SELECT * FROM activity${activityWhere(used)} ORDER BY id DESC LIMIT @limit`;
}

const HIDDEN_AREAS_SQL = USER_HIDDEN_AREAS.map((area) => `'${area}'`).join(', ');

const personClause = (param) => `((actor_type = 'user' AND actor_id = ${param}) OR subject_user_id = ${param})`;

function activityWhere(used) {
  const where = [];
  if (used.before) where.push('id < @before');
  if (used.person) where.push(personClause('@person'));
  if (used.area) where.push('area = @area');
  if (used.gallery) where.push('gallery_id = @gallery');
  if (used.viewer) {
    where.push(personClause('@viewer'));
    where.push(`area NOT IN (${HIDDEN_AREAS_SQL})`);
  }
  return where.length ? ` WHERE ${where.join(' AND ')}` : '';
}

export function createActivityRepository(db, { now = systemNow } = {}) {
  const insertStmt = db.prepare(
    `INSERT INTO activity (at, area, kind, actor_type, actor_id, actor_name, subject_user_id, subject_name,
                           gallery_id, gallery_title, details, ip, user_agent)
     VALUES (@at, @area, @kind, @actorType, @actorId, @actorName, @subjectUserId, @subjectName,
             @galleryId, @galleryTitle, @details, @ip, @userAgent)`,
  );
  const listStmts = new Map();

  const listStmt = (used) => {
    const sql = activityListSql(used);
    if (!listStmts.has(sql)) listStmts.set(sql, db.prepare(sql));
    return listStmts.get(sql);
  };
  const purgeStmt = db.prepare('DELETE FROM activity WHERE at < ?');
  const lastIdStmt = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM activity');
  const deleteAfterStmt = db.prepare('DELETE FROM activity WHERE id > ?');
  const countAllStmt = db.prepare('SELECT COUNT(*) AS n FROM activity');
  const countViewerStmt = db.prepare(`SELECT COUNT(*) AS n FROM activity${activityWhere({ viewer: true })}`);
  const peopleStmt = db.prepare(
    `SELECT person AS id, name, MAX(row_id) AS latest FROM (
       SELECT actor_id AS person, actor_name AS name, id AS row_id FROM activity
        WHERE actor_type = 'user' AND actor_id IS NOT NULL
       UNION ALL
       SELECT subject_user_id, subject_name, id FROM activity WHERE subject_user_id IS NOT NULL
     ) GROUP BY person`,
  );
  const galleriesStmt = db.prepare(
    `SELECT gallery_id AS id, gallery_title AS title, MAX(id) AS latest FROM activity
      WHERE gallery_id IS NOT NULL GROUP BY gallery_id`,
  );
  const viewerGalleriesStmt = db.prepare(
    `SELECT gallery_id AS id, gallery_title AS title, MAX(id) AS latest FROM activity
      WHERE gallery_id IS NOT NULL AND ${personClause('@viewer')} AND area NOT IN (${HIDDEN_AREAS_SQL})
      GROUP BY gallery_id`,
  );
  const withoutLatest = ({ latest: _latest, ...rest }) => rest;
  return {
    insert(row) {
      return Number(
        insertStmt.run({
          actorId: null,
          actorName: null,
          subjectUserId: null,
          subjectName: null,
          galleryId: null,
          galleryTitle: null,
          details: null,
          ip: null,
          userAgent: null,
          ...row,
          at: nowIso(now),
        }).lastInsertRowid,
      );
    },

    count({ viewerId = null } = {}) {
      return viewerId === null ? countAllStmt.get().n : countViewerStmt.get({ viewer: viewerId }).n;
    },

    filterValues({ viewerId = null } = {}) {
      if (viewerId !== null) {
        return { people: [], galleries: viewerGalleriesStmt.all({ viewer: viewerId }).map(withoutLatest) };
      }
      return { people: peopleStmt.all().map(withoutLatest), galleries: galleriesStmt.all().map(withoutLatest) };
    },

    list({ beforeId, limit, personId, area, galleryId, viewerId } = {}) {
      const params = {
        before: cursorId(beforeId),
        person: personId ?? null,
        area: area ?? null,
        gallery: galleryId ?? null,
        viewer: viewerId ?? null,
      };
      const used = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, value !== null]));
      const bound = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null));
      return listStmt(used).all({ ...bound, limit: clampLimit(limit) });
    },

    purgeBefore(iso) {
      return purgeStmt.run(iso).changes;
    },

    lastId() {
      return lastIdStmt.get().n;
    },

    deleteAfter(id) {
      return deleteAfterStmt.run(id).changes;
    },
  };
}
