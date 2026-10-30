import { nowIso, systemNow } from '../lib/time.js';




export function createGalleryImagesRepository(db, { now = systemNow } = {}) {
  const maxPositionStmt = db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM gallery_images WHERE gallery_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO gallery_images (gallery_id, position, public_name, title, caption, original_name, mime, ext,
                                 width, height, bytes_orig, bytes_web, bytes_thumb, created_at, phash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const forGalleryStmt = db.prepare('SELECT * FROM gallery_images WHERE gallery_id = ? ORDER BY position, id');
  const byIdStmt = db.prepare('SELECT * FROM gallery_images WHERE id = ?');
  const byPublicNameStmt = db.prepare('SELECT * FROM gallery_images WHERE gallery_id = ? AND public_name = ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM gallery_images WHERE gallery_id = ?');
  const updateStmt = db.prepare('UPDATE gallery_images SET title = ?, caption = ? WHERE id = ?');
  const setBytesStmt = db.prepare(
    'UPDATE gallery_images SET bytes_orig = ?, bytes_web = ?, bytes_thumb = ? WHERE id = ?',
  );
  const removeStmt = db.prepare('DELETE FROM gallery_images WHERE id = ?');
  const idsStmt = db.prepare('SELECT id FROM gallery_images WHERE gallery_id = ? ORDER BY position, id');
  const setPositionStmt = db.prepare('UPDATE gallery_images SET position = ? WHERE id = ?');
  const renumberStmt = db.prepare(
    `UPDATE gallery_images SET position = ranked.n
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS n FROM gallery_images WHERE gallery_id = ?) AS ranked
      WHERE gallery_images.id = ranked.id`,
  );
  const unwrittenStmt = db.prepare(
    'SELECT * FROM gallery_images WHERE bytes_orig = 0 AND bytes_web = 0 AND bytes_thumb = 0 ORDER BY id',
  );
  const phashesStmt = db
    .prepare('SELECT phash FROM gallery_images WHERE gallery_id = ? AND phash IS NOT NULL ORDER BY id')
    .pluck();
  const withoutPhashStmt = db.prepare(
    'SELECT * FROM gallery_images WHERE phash IS NULL AND bytes_web > 0 AND id > ? ORDER BY id LIMIT ?',
  );
  const setPhashStmt = db.prepare('UPDATE gallery_images SET phash = ? WHERE id = ?');

  const insertTx = db.transaction((row) => {
    const position = maxPositionStmt.get(row.galleryId).p + 1;
    const info = insertStmt.run(
      row.galleryId,
      position,
      row.publicName,
      row.title ?? null,
      row.caption ?? null,
      row.originalName,
      row.mime,
      row.ext,
      row.width,
      row.height,
      row.bytesOrig,
      row.bytesWeb,
      row.bytesThumb,
      nowIso(now),
      row.phash ?? null,
    );
    return Number(info.lastInsertRowid);
  });

  const renumber = (galleryId) => {
    renumberStmt.run(galleryId);
  };

  const removeTx = db.transaction((id) => {
    const row = byIdStmt.get(id);
    if (!row) return null;
    removeStmt.run(id);
    renumber(row.gallery_id);
    return row;
  });

  const removeUnwrittenTx = db.transaction(() => {
    const rows = unwrittenStmt.all();
    for (const row of rows) removeStmt.run(row.id);
    for (const galleryId of new Set(rows.map((r) => r.gallery_id))) renumber(galleryId);
    return rows;
  });

  const reorderTx = db.transaction((galleryId, ids) => {
    const current = idsStmt.all(galleryId).map((r) => r.id);
    const wanted = new Set(ids);
    if (wanted.size !== ids.length || wanted.size !== current.length || !current.every((id) => wanted.has(id))) {
      return false;
    }
    ids.forEach((id, i) => setPositionStmt.run(i + 1, id));
    return true;
  });

  return {
    insert: (row) => insertTx(row),
    forGallery: (galleryId) => forGalleryStmt.all(galleryId),
    byId: (id) => byIdStmt.get(id) ?? null,
    byPublicName: (galleryId, publicName) => byPublicNameStmt.get(galleryId, publicName) ?? null,
    count: (galleryId) => countStmt.get(galleryId).n,
    update: (id, { title, caption }) => updateStmt.run(title ?? null, caption ?? null, id).changes === 1,
    setBytes: (id, { bytesOrig, bytesWeb, bytesThumb }) =>
      setBytesStmt.run(bytesOrig, bytesWeb, bytesThumb, id).changes === 1,
    remove: (id) => removeTx(id),
    removeUnwritten: () => removeUnwrittenTx(),
    reorder: (galleryId, ids) => reorderTx(galleryId, ids),
    phashes: (galleryId) => phashesStmt.all(galleryId),
    withoutPhash: (limit, afterId = 0) => withoutPhashStmt.all(afterId, limit),
    setPhash: (id, phash) => setPhashStmt.run(phash, id).changes === 1,
  };
}
