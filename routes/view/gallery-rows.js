import { editedByAdmin, galleryTitle } from '../../domain/gallery.js';
import { formatBytes, formatUtc, formatUtcDate } from '../../lib/format.js';

export const TRASHED_NOTICE = Object.freeze({ trashed: 'Moved to Trash.' });


export function toGalleryRow(row, { sharedIds } = {}) {
  return {
    id: row.id,
    title: galleryTitle(row),
    imageCount: row.image_count,
    size: formatBytes(row.bytes),
    created: formatUtcDate(row.created_at),
    thumbImageId: row.thumb_image_id ?? null,
    trashedWhen: row.deleted_at ? formatUtc(row.deleted_at) : null,
    shared: Boolean(sharedIds?.has(row.id)),
    editedByAdmin: editedByAdmin(row),
  };
}
