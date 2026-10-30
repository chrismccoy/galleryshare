import { NotFoundError } from '../../lib/errors.js';
import { mayManageOwnedBy } from '../../domain/roles.js';



export function createGalleryAccess({ galleries, galleryImages }) {
  const mayManage = (user, gallery) => Boolean(gallery) && mayManageOwnedBy(user, gallery.user_id);

  function getManageable(user, id, { includeTrashed = false } = {}) {
    const gallery = includeTrashed ? galleries.byIdIncludingTrashed(id) : galleries.liveById(id);
    return mayManage(user, gallery) ? gallery : null;
  }

  const canManage = (user, id, options) => getManageable(user, id, options) !== null;

  function getForEdit(user, id) {
    const gallery = getManageable(user, id);
    if (!gallery) throw new NotFoundError('Gallery not found');
    return { gallery, images: galleryImages.forGallery(gallery.id) };
  }

  function imageForViewer(user, imageId) {
    const image = imageId ? galleryImages.byId(imageId) : null;
    const gallery = image ? getManageable(user, image.gallery_id, { includeTrashed: true }) : null;
    return gallery ? { gallery, image } : null;
  }

  return { getManageable, canManage, getForEdit, imageForViewer };
}
