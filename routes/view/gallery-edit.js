import { IMAGE_TYPES_TEXT, UPLOAD_ACCEPT, UPLOAD_RULES } from '../../media/image-types.js';
import { skippedCounts } from '../../domain/ingest.js';
import {
  DEFAULT_CAPTION_TEMPLATE,
  DEFAULT_GALLERY_TITLE,
  DEFAULT_IMAGE_TITLE,
  GRID_TEXT_OPTIONS,
  editedByAdmin,
  galleryTitle,
  gridTextChoice,
  gridTextColumn,
  gridTextLabel,
  imageCaption,
} from '../../domain/gallery.js';
import { GALLERY_FIELD_MAX } from '../../domain/limits.js';
import { SHARE_THEME_CHOICE } from '../../domain/share-themes.js';
import { IMAGE_VIEW_CHOICE } from '../../domain/image-views.js';
import { siteDefaultChoices } from '../../domain/gallery-choice.js';
import { noStore, renderInShell } from './respond.js';
import { formatUtc } from '../../lib/format.js';
import { PATH_TO } from '../../config/urls.js';

export function uploadHelp(limits) {
  const limitsText =
    `Images: ${IMAGE_TYPES_TEXT}, up to ${limits.maxImageMb} MB each. ` +
    `ZIP files: up to ${limits.maxZipUploadMb} MB each. ` +
    `Up to ${limits.maxUploadBatchMb} MB per upload and ${limits.maxImagesPerGallery} images per gallery.`;
  return {
    accept: UPLOAD_ACCEPT,
    rules: UPLOAD_RULES,
    limitsText,
    maxImageMb: limits.maxImageMb,
    maxUploadBatchMb: limits.maxUploadBatchMb,
    maxZipUploadMb: limits.maxZipUploadMb,
    userQuotaMb: limits.userQuotaMb,
  };
}


function withTyped({ gallery, images }, { meta, images: imageFields }) {
  const text = (sent, storedValue) => (typeof sent === 'string' ? sent : storedValue);
  let shownGallery = gallery;
  if (meta) {
    const gridText = gridTextColumn(meta.gridText);
    const shareTheme = SHARE_THEME_CHOICE.fromChoice(meta.shareTheme);
    const imageView = IMAGE_VIEW_CHOICE.fromChoice(meta.imageView);
    shownGallery = {
      ...gallery,
      title: text(meta.title, gallery.title),
      description: text(meta.description, gallery.description),
      allow_zip: meta.allowZip ? 1 : 0,
      grid_text: gridText === undefined ? gallery.grid_text : gridText,
      share_theme: shareTheme === undefined ? gallery.share_theme : shareTheme,
      image_view: imageView === undefined ? gallery.image_view : imageView,
    };
  }
  return {
    gallery: shownGallery,
    images: images.map((image) => {
      const sent = imageFields.get(image.id);
      return sent
        ? {
            ...image,
            title: text(sent.title, image.title),
            caption: text(sent.caption, image.caption),
            removing: sent.remove !== undefined,
          }
        : image;
    }),
  };
}

export function createGalleryEditView({
  galleriesService,
  ingestService,
  effectiveConfigService,
  sharesService,
  publicSharingOn,
  links,
}) {
  function shareView(req, galleryId) {
    const link = sharesService.linkFor(req.user, galleryId);
    if (!link) return null;
    const url = link.token ? links.share(req, link.token) : null;
    return { url, createdAt: formatUtc(link.createdAt), reshowable: url !== null };
  }

  return function renderEdit(req, res, { status = 200, error = null, notice = null, takeNotice = false, typed } = {}) {
    const stored = galleriesService.getForEdit(req.user, req.idParam);
    const { gallery, images } = typed ? withTyped(stored, typed) : stored;
    const activeJob = ingestService.activeForGallery(gallery.id);
    const finished = activeJob || !takeNotice ? null : ingestService.takeFinishedNotice(gallery.id);
    noStore(res);
    return renderInShell(res.status(status), 'pages/gallery-edit', {
      title: galleryTitle(gallery),
      gallery,
      ownGallery: gallery.user_id === req.user.id,
      images: images.map((image, index) => ({
        ...image,
        position: index + 1,
        defaultCaption: imageCaption(null, index + 1),
      })),
      defaults: {
        galleryTitle: DEFAULT_GALLERY_TITLE,
        imageTitle: DEFAULT_IMAGE_TITLE,
        captionTemplate: DEFAULT_CAPTION_TEMPLATE,
      },
      fieldMax: GALLERY_FIELD_MAX,
      gridText: {
        choice: gridTextChoice(gallery),
        choices: siteDefaultChoices(gridTextLabel(effectiveConfigService.shareGridText().value), GRID_TEXT_OPTIONS),
      },
      theme: {
        choice: SHARE_THEME_CHOICE.choiceOf(gallery),
        choices: SHARE_THEME_CHOICE.buttons(effectiveConfigService.shareTheme().value),
      },
      imageView: {
        choice: IMAGE_VIEW_CHOICE.choiceOf(gallery),
        choices: IMAGE_VIEW_CHOICE.buttons(effectiveConfigService.shareImageView().value),
      },
      editedByAdmin: editedByAdmin(gallery),
      activeJob,
      skipped: finished?.skipped ?? [],
      skippedTotal: skippedCounts(finished?.skipped ?? []).total,
      share: shareView(req, gallery.id),
      sharingOn: publicSharingOn(),
      upload: uploadHelp(effectiveConfigService.limitValues()),
      uploadAction: PATH_TO.gallery(gallery.id, 'upload'),
      error,
      notice,
      scripts: ['gallery-upload-rules', 'gallery-upload', 'reorder', 'save-bar'],
    });
  };
}
