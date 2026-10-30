const ROWS_READ = 500;

export function activityRows(context, kind, galleryId) {
  return context.activity
    .list({ limit: ROWS_READ })
    .filter((row) => row.kind === kind && (galleryId === undefined || row.gallery_id === galleryId));
}

export function activityLog(context, { kinds, area, galleryId, personId } = {}) {
  return context.activity
    .list({ limit: ROWS_READ, area, galleryId, personId })
    .filter((row) => !kinds || kinds.includes(row.kind))
    .reverse();
}
