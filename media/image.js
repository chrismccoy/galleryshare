import sharp from 'sharp';
import { UnreadableImageError } from '../lib/errors.js';
import { UNREADABLE_IMAGE_MESSAGE, UNSUPPORTED_IMAGE_MESSAGE, extForMime, sniffImageType } from './image-types.js';
import { stripMetadata } from './strip-metadata/index.js';
import { dhash } from './phash.js';

const MAX_INPUT_PIXELS = 100_000_000;

const WEB_EDGE = 2000;

const THUMB_EDGE = 600;

const WEBP_QUALITY = 82;


export async function processImage(buf) {
  const mime = sniffImageType(buf);
  if (!mime) throw new UnreadableImageError(UNSUPPORTED_IMAGE_MESSAGE);
  try {
    const original = stripMetadata(buf, mime);

    const source = () => sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

    const derive = (edge) =>
      source()
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY });
    const [web, thumb, phash] = await Promise.all([
      derive(WEB_EDGE).toBuffer({ resolveWithObject: true }),
      derive(THUMB_EDGE).toBuffer(),
      dhash(buf, { limitInputPixels: MAX_INPUT_PIXELS }),
    ]);
    return {
      mime,
      ext: extForMime(mime),
      original,
      web: web.data,
      thumb,
      width: web.info.width,
      height: web.info.height,
      phash,
    };
  } catch (cause) {
    if (cause instanceof UnreadableImageError) throw cause;
    throw new UnreadableImageError(UNREADABLE_IMAGE_MESSAGE, { cause });
  }
}
