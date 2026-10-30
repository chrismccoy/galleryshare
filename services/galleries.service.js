import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { delegateMethods } from '../lib/delegate.js';
import { boundedText, mergePresent } from '../lib/params.js';
import { MAX_CAPTION, MAX_DESCRIPTION, MAX_TITLE } from '../domain/limits.js';
import {
  GALLERY_DETAIL_LABELS,
  GRID_TEXT_MESSAGE,
  gridTextColumn,
  newPublicName as randomPublicName,
} from '../domain/gallery.js';
import { SHARE_THEME_CHOICE } from '../domain/share-themes.js';
import { IMAGE_VIEW_CHOICE } from '../domain/image-views.js';
import { NOOP_LOGGER } from '../lib/logger.js';
import { createGalleryAccess } from './galleries/access.js';
import { createUploadQuota } from './galleries/upload-quota.js';
import { createGalleryMedia } from './galleries/media.js';
import { createGalleryTrash } from './galleries/trash.js';
import { galleryEventFields } from '../domain/gallery-activity.js';
import { NOOP_ACTIVITY } from './activity.service.js';
import { plural } from '../lib/plural.js';

const STALE_GALLERY_MESSAGE = 'This gallery changed. Reload and try again.';

function optionalText(value, max, label) {
  return boundedText(typeof value === 'string' ? value : '', max, `${label} can be at most ${max} characters.`, {
    blankAsNull: true,
  });
}

const textField = (max, label) => (value) => optionalText(value, max, label);

const choiceField = (fromChoice, message) => (value) => {
  const stored = fromChoice(value);
  if (stored === undefined) throw new ValidationError(message);
  return stored;
};

const storedMeta = (gallery) => ({
  title: gallery.title,
  description: gallery.description,
  allowZip: Boolean(gallery.allow_zip),
  gridText: gallery.grid_text ?? null,
  shareTheme: gallery.share_theme ?? null,
  imageView: gallery.image_view ?? null,
});

function cleanMeta(gallery, fields) {
  const current = storedMeta(gallery);
  return mergePresent(fields, current, {
    title: textField(MAX_TITLE, 'Title'),
    description: textField(MAX_DESCRIPTION, 'Description'),
    allowZip: Boolean,
    gridText: choiceField(gridTextColumn, GRID_TEXT_MESSAGE),
    shareTheme: choiceField(SHARE_THEME_CHOICE.fromChoice, SHARE_THEME_CHOICE.message),
    imageView: choiceField(IMAGE_VIEW_CHOICE.fromChoice, IMAGE_VIEW_CHOICE.message),
  });
}

function changedMetaFields(gallery, next) {
  const before = storedMeta(gallery);
  return Object.entries(GALLERY_DETAIL_LABELS)
    .filter(([key]) => next[key] !== before[key])
    .map(([, label]) => label);
}

const cleanImageText = (image, fields) =>
  mergePresent(
    fields,
    { title: image.title, caption: image.caption },
    { title: textField(MAX_TITLE, 'Title'), caption: textField(MAX_CAPTION, 'Caption') },
  );






export function createGalleriesService({
  galleries,
  galleryImages,
  ingestJobs,
  mediaStore,
  effectiveConfigService,
  runInTransaction = (fn) => fn(),
  newPublicName = randomPublicName,
  logger = NOOP_LOGGER,
  activityService = NOOP_ACTIVITY,
}) {
  const access = createGalleryAccess({ galleries, galleryImages });
  const quota = createUploadQuota({ galleries, galleryImages, ingestJobs, effectiveConfigService });
  const { removeImageFiles, ...media } = createGalleryMedia({
    galleries,
    galleryImages,
    mediaStore,
    newPublicName,
    logger,
  });
  const trash = createGalleryTrash({
    galleries,
    removeMedia: media.removeMedia,
    getManageable: access.getManageable,
    activityService,
  });
  const { getForEdit } = access;

  const markEdited = (galleryId, actorId) => galleries.markEdited(galleryId, actorId);

  function dashboardTotals(userId) {
    const { galleries: count, images } = galleries.totalsForUser(userId);
    return { galleries: count, images, bytes: galleries.bytesForUser(userId) };
  }

  function create(user) {
    const id = galleries.insert({ userId: user.id });
    activityService.record({
      kind: 'galleryCreated',
      ...galleryEventFields(user, { id, user_id: user.id, title: null }),
    });
    return id;
  }

  function recordDetailsChanged(user, gallery, fields, imageTexts = 0) {
    const parts = imageTexts ? [...fields, plural(imageTexts, 'image text')] : fields;
    if (!parts.length) return;
    activityService.record({
      kind: 'galleryDetailsChanged',
      ...galleryEventFields(user, gallery),
      details: parts.join(', '),
    });
  }

  const recordImageRemoved = (user, gallery, position) =>
    activityService.record({
      kind: 'imageRemoved',
      ...galleryEventFields(user, gallery),
      details: `Image #${position}`,
    });

  async function saveEdits(user, id, { meta, images }) {
    const { gallery, images: rows } = getForEdit(user, id);
    const nextMeta = cleanMeta(gallery, meta);
    const positions = new Map(rows.map((row, index) => [row.id, { row, position: index + 1 }]));
    const imageUpdates = [];
    const removals = [];
    let imageTextsChanged = 0;
    for (const { imageId, remove = false, ...fields } of images) {
      const found = positions.get(imageId);
      if (!found) continue;
      if (remove) {
        removals.push({ imageId, position: found.position });
        continue;
      }
      try {
        const next = cleanImageText(found.row, fields);
        imageUpdates.push([imageId, next]);
        if (next.title !== found.row.title || next.caption !== found.row.caption) imageTextsChanged += 1;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        throw new ValidationError(`Image #${found.position}: ${error.publicMessage}`, { cause: error });
      }
    }
    const removed = runInTransaction(() => {
      galleries.updateMeta(id, { ...nextMeta, actorId: user.id });
      for (const [imageId, next] of imageUpdates) galleryImages.update(imageId, next);
      return removals
        .map(({ imageId, position }) => ({ row: galleryImages.remove(imageId), position }))
        .filter(({ row }) => row);
    });
    const after = { ...gallery, title: nextMeta.title };
    recordDetailsChanged(user, after, changedMetaFields(gallery, nextMeta), imageTextsChanged);
    for (const { position } of removed) recordImageRemoved(user, after, position);
    await Promise.all(removed.map(({ row }) => removeImageFiles(row)));
  }

  function reorder(user, galleryId, ids) {
    const { gallery } = getForEdit(user, galleryId);
    if (!galleryImages.reorder(galleryId, ids)) throw new ConflictError(STALE_GALLERY_MESSAGE);
    markEdited(galleryId, user.id);
    activityService.record({ kind: 'imagesReordered', ...galleryEventFields(user, gallery) });
  }

  async function removeImage(user, galleryId, imageId) {
    const { gallery, images } = getForEdit(user, galleryId);
    const index = images.findIndex((image) => image.id === imageId);
    if (index < 0) throw new NotFoundError('Image not found');
    const row = galleryImages.remove(imageId);
    markEdited(galleryId, user.id);
    if (!row) return;
    recordImageRemoved(user, gallery, index + 1);
    await removeImageFiles(row);
  }

  return {
    ...access,
    ...quota,
    ...media,
    ...trash,
    dashboardTotals,
    listForUser: (userId, page) => galleries.forUser(userId, page),
    listTrash: (userId, page) => galleries.trashedForUser(userId, page),
    listAll: (filter) => galleries.listLive(filter),
    ...delegateMethods(galleries, ['countTrashed', 'countLive', 'idsForUser']),
    findLive: (id) => galleries.liveById(id),
    imagesOf: (galleryId) => galleryImages.forGallery(galleryId),
    imageByPublicName: (galleryId, publicName) => galleryImages.byPublicName(galleryId, publicName),
    markEdited,
    create,
    saveEdits,
    reorder,
    removeImage,
  };
}
