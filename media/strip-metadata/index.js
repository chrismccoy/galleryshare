import { IMAGE_FORMATS } from '../image-types.js';
import { readOrientation, stripJpeg } from './jpeg.js';
import { stripPng } from './png.js';
import { stripWebp } from './webp.js';
import { unreadableError } from './unreadable.js';

export { readOrientation };

const BY_SIGNATURE = Object.freeze({ jpeg: stripJpeg, png: stripPng, webp: stripWebp });

export const STRIPPERS = Object.freeze(
  Object.fromEntries(
    IMAGE_FORMATS.map(({ mime, signature }) => {
      if (!Object.hasOwn(BY_SIGNATURE, signature)) throw new Error(`No metadata stripper for ${mime}.`);
      return [mime, BY_SIGNATURE[signature]];
    }),
  ),
);

export function stripMetadata(buf, mime) {
  const strip = Object.hasOwn(STRIPPERS, mime) ? STRIPPERS[mime] : null;
  if (!strip || !Buffer.isBuffer(buf)) throw unreadableError();
  return strip(buf);
}
