import { imageCaption, imageTitle } from '../../domain/gallery.js';
import { plural } from '../../lib/plural.js';
import { isPublicImageSize } from '../../media/media-store.js';
import { PATH_TO } from '../../config/urls.js';

export function toShareImage(token, image, position) {
  return {
    title: imageTitle(image),
    caption: imageCaption(image, position),
    position,
    thumbUrl: PATH_TO.shareImage(token, image.public_name, 'thumb'),
    webUrl: PATH_TO.shareImage(token, image.public_name, 'web'),
    pageUrl: PATH_TO.shareImagePage(token, image.public_name),
    download: `${image.public_name}.webp`,
  };
}

const IMAGE_FILE = /^([0-9A-Za-z]+)(-thumb)?\.webp$/;

export function imageFileOf(segment) {
  const match = IMAGE_FILE.exec(String(segment));
  return match ? { publicName: match[1], size: match[2] ? 'thumb' : 'web' } : null;
}

export function imageSizeOf(file) {
  const size = String(file).replace(/\.webp$/, '');
  return isPublicImageSize(size) ? size : null;
}

export const photoCount = (count) => (count === 0 ? null : plural(count, 'photo'));
