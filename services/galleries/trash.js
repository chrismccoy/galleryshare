import { NotFoundError } from '../../lib/errors.js';
import { NOOP_ACTIVITY } from '../activity.service.js';
import { galleryEventFields } from '../../domain/gallery-activity.js';
import { plural } from '../../lib/plural.js';



export function createGalleryTrash({ galleries, removeMedia, getManageable, activityService = NOOP_ACTIVITY }) {
  function trash(user, id) {
    const before = getManageable(user, id);
    if (!before || !galleries.trashById(id)) throw new NotFoundError('Gallery not found');
    activityService.record({ kind: 'galleryTrashed', ...galleryEventFields(user, before) });
  }

  function restore(user, id) {
    const before = galleries.byIdIncludingTrashed(id);
    if (!galleries.restoreOwned(id, user.id)) throw new NotFoundError('Gallery in Trash not found');
    activityService.record({ kind: 'galleryRestored', ...galleryEventFields(user, before) });
  }

  async function purge(user, id) {
    const before = galleries.byIdIncludingTrashed(id);
    if (!galleries.purgeOwned(id, user.id)) throw new NotFoundError('Gallery in Trash not found');
    activityService.record({ kind: 'galleryDeleted', ...galleryEventFields(user, before) });
    await removeMedia([id]);
  }

  async function emptyTrash(user) {
    const ids = galleries.emptyTrash(user.id);
    if (ids.length) {
      activityService.record({
        kind: 'trashEmptied',
        actor: user,
        details: plural(ids.length, 'gallery', 'galleries'),
      });
    }
    return removeMedia(ids);
  }

  const purgeTrashedBefore = (cutoffIso) => removeMedia(galleries.purgeTrashedBefore(cutoffIso));

  return { trash, restore, purge, emptyTrash, purgeTrashedBefore };
}
