import { Router } from 'express';
import { VIEW_KINDS, isPreviewBot } from '../../domain/share-links.js';
import { galleryTitle, gridTextShown, zipOffered } from '../../domain/gallery.js';
import { shareThemeFor } from '../../domain/share-themes.js';
import { IMAGE_VIEW_KEYS, imageViewFor } from '../../domain/image-views.js';
import { renderPublic, seeOther } from '../view/respond.js';
import { PATH_TO, ROUTES } from '../../config/urls.js';
import { photoCount, toShareImage } from '../view/share-view.js';
import { SHARE_META, keepPrivate, shareHeaders, unavailable, visitOf } from '../view/share-responses.js';

const EMPTY_MESSAGE = 'This gallery has no images yet.';

export function createShareRouter({ sharesService, limits, effectiveConfigService }) {
  const router = Router();

  function forPage(req, res, token, show) {
    const found = sharesService.resolve(token);
    if (!found) return limits.page(req, res, () => unavailable(res));
    if (isPreviewBot(req.get('user-agent'))) {
      return renderPublic(res, 'pages/share-preview', { title: SHARE_META.title, meta: SHARE_META });
    }
    return show(found);
  }

  function sharePageLocals(gallery) {
    const title = galleryTitle(gallery);
    return {
      title,
      meta: SHARE_META,
      gallery: { title, description: gallery.description ?? null },
      theme: shareThemeFor(gallery, effectiveConfigService.shareTheme().value),
    };
  }

  router.get(ROUTES.share, shareHeaders, (req, res) => {
    const { token } = req.params;
    return forPage(req, res, token, ({ share, gallery, images }) => {
      if (req.method !== 'HEAD') sharesService.recordView(share.id, visitOf(req, gallery, VIEW_KINDS.page));
      const shown = images.map((image, index) => toShareImage(token, image, index + 1));
      const locals = {
        ...sharePageLocals(gallery),
        zipUrl: zipOffered(gallery, shown.length) ? PATH_TO.shareZip(token) : null,
        count: photoCount(shown.length),
      };
      if (shown.length >= 2) {
        const showText = gridTextShown(gallery, effectiveConfigService.shareGridText().value);
        const view = imageViewFor(gallery, effectiveConfigService.shareImageView().value);
        const scripts = view === IMAGE_VIEW_KEYS.lightbox ? ['lightbox', 'copy-link'] : [];
        return renderPublic(res, 'pages/share', { ...locals, images: shown, showText, view, scripts }, { wide: true });
      }
      return renderPublic(
        res,
        'pages/share-single',
        { ...locals, image: shown[0] ?? null, emptyMessage: EMPTY_MESSAGE, scripts: shown[0] ? ['copy-link'] : [] },
        { wide: true },
      );
    });
  });

  router.get(ROUTES.shareImage, (req, res) => {
    const { token, publicName } = req.params;
    keepPrivate(res);
    return forPage(req, res, token, ({ gallery, images }) => {
      const index = images.findIndex((image) => image.public_name === publicName);
      if (index < 0) return limits.page(req, res, () => unavailable(res));
      if (imageViewFor(gallery, effectiveConfigService.shareImageView().value) !== IMAGE_VIEW_KEYS.page) {
        return seeOther(res, PATH_TO.share(token));
      }
      const neighbour = (at) => (images[at] ? PATH_TO.shareImagePage(token, images[at].public_name) : null);
      return renderPublic(
        res,
        'pages/share-image',
        {
          ...sharePageLocals(gallery),
          zipUrl: zipOffered(gallery, images.length) ? PATH_TO.shareZip(token) : null,
          counter: `Photo ${index + 1} of ${images.length}`,
          image: toShareImage(token, images[index], index + 1),
          nav: { prevUrl: neighbour(index - 1), nextUrl: neighbour(index + 1), galleryUrl: PATH_TO.share(token) },
          scripts: ['copy-link', 'image-page'],
        },
        { wide: true },
      );
    });
  });

  return router;
}
