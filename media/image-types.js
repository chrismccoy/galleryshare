import { deepFreeze } from '../lib/deep-freeze.js';


export const IMAGE_FORMATS = deepFreeze([
  { mime: 'image/jpeg', ext: 'jpg', names: ['jpg', 'jpeg'], label: 'JPEG', signature: 'jpeg' },
  { mime: 'image/png', ext: 'png', names: ['png'], label: 'PNG', signature: 'png' },
  { mime: 'image/webp', ext: 'webp', names: ['webp'], label: 'WebP', signature: 'webp' },
]);

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const PNG_SNIFF_BYTES = 4;

const SIGNATURES = Object.freeze({
  jpeg: (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  png: (buf) => buf.subarray(0, PNG_SNIFF_BYTES).equals(PNG_SIGNATURE.subarray(0, PNG_SNIFF_BYTES)),
  webp: (buf) => buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
});

export const SNIFF_BYTES = 12;

export function assertSignatures(formats) {
  for (const { mime, signature } of formats) {
    if (!Object.hasOwn(SIGNATURES, signature)) throw new Error(`Image format ${mime} has no signature "${signature}".`);
  }
}

assertSignatures(IMAGE_FORMATS);

export const IMAGE_TYPES = Object.freeze(IMAGE_FORMATS.map((format) => format.mime));

export const IMAGE_EXTENSIONS = Object.freeze(IMAGE_FORMATS.flatMap((format) => format.names));

export const ORIGINAL_EXTENSIONS = Object.freeze(IMAGE_FORMATS.map((format) => format.ext));

export const ZIP_EXTENSIONS = Object.freeze(['zip']);

export const ZIP_TYPES = Object.freeze(['application/zip', 'application/x-zip-compressed', 'application/x-zip']);

const LABELS = IMAGE_FORMATS.map((format) => format.label);

export const IMAGE_TYPES_TEXT = `${LABELS.slice(0, -1).join(', ')} or ${LABELS.at(-1)}`;

export const UNSUPPORTED_IMAGE_MESSAGE = `Use a ${IMAGE_TYPES_TEXT} photo.`;

export const UNSUPPORTED_UPLOAD_MESSAGE = `Only ${LABELS.join(', ')} images or ZIP files can be uploaded.`;

export const UNREADABLE_IMAGE_MESSAGE = 'This image could not be read.';

export const UPLOAD_ACCEPT = [...IMAGE_TYPES, ...ZIP_EXTENSIONS.map((ext) => `.${ext}`), ZIP_TYPES[0]].join(',');

export const UPLOAD_RULES = Object.freeze({
  imageExts: IMAGE_EXTENSIONS.join(','),
  imageTypes: IMAGE_TYPES.join(','),
  zipExts: ZIP_EXTENSIONS.join(','),
  zipTypes: ZIP_TYPES.join(','),
  unsupported: UNSUPPORTED_UPLOAD_MESSAGE,
});

const endsWithOneOf = (extensions) => new RegExp(`\\.(${extensions.join('|')})$`, 'i');

const IMAGE_NAME = endsWithOneOf(IMAGE_EXTENSIONS);

const ZIP_NAME = endsWithOneOf(ZIP_EXTENSIONS);

export const isImageName = (name) => IMAGE_NAME.test(name);

export function uploadKind(name, mime) {
  if (IMAGE_NAME.test(name)) return 'image';
  if (ZIP_NAME.test(name)) return 'zip';
  if (IMAGE_TYPES.includes(mime)) return 'image';
  if (ZIP_TYPES.includes(mime)) return 'zip';
  return null;
}

export const isZipUpload = (file) => uploadKind(file.originalname, file.mimetype) === 'zip';

export function extForMime(mime) {
  return IMAGE_FORMATS.find((format) => format.mime === mime)?.ext ?? null;
}

export function hasSignature(buf, signature) {
  return Buffer.isBuffer(buf) && buf.length >= SNIFF_BYTES && SIGNATURES[signature](buf);
}

export function sniffImageType(buf) {
  return IMAGE_FORMATS.find((format) => hasSignature(buf, format.signature))?.mime ?? null;
}
