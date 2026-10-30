import sharp from 'sharp';
import zlib from 'node:zlib';

export const GIF_BYTES = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

const SHADE_COLS = 9;
const SHADE_ROWS = 8;

let shadeCount = 0;

function shadingSvg(width, height) {
  let state = (++shadeCount * 2654435761) >>> 0;
  const cells = [];
  for (let row = 0; row < SHADE_ROWS; row++) {
    for (let col = 0; col < SHADE_COLS; col++) {
      state = (state * 1103515245 + 12345) >>> 0;
      const fill = state & 0x10000 ? 'white' : 'black';
      const x = (col * width) / SHADE_COLS;
      const y = (row * height) / SHADE_ROWS;
      cells.push(
        `<rect x="${x}" y="${y}" width="${width / SHADE_COLS}" height="${height / SHADE_ROWS}" fill="${fill}" opacity="0.35"/>`,
      );
    }
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells.join('')}</svg>`,
  );
}

function solid(width, height, background) {
  return sharp({ create: { width, height, channels: 3, background } }).composite([
    { input: shadingSvg(width, height) },
  ]);
}

export function distinctJpegs(count, options) {
  return Promise.all(Array.from({ length: count }, () => makeJpeg(options)));
}

export async function makeJpeg({
  width = 64,
  height = 48,
  background = '#888888',
  orientation,
  gps = false,
  quality = 80,
} = {}) {
  let img = solid(width, height, background);
  if (gps) {
    img = img.withExif({
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    });
  }
  if (orientation) img = img.withMetadata({ orientation });
  return img.jpeg({ quality }).toBuffer();
}

export async function makePng({ width = 800, height = 600, background = '#336699' } = {}) {
  return solid(width, height, background).png().toBuffer();
}

export async function makeWebp({ width = 8, height = 8, background = '#ffffff' } = {}) {
  return solid(width, height, background).webp().toBuffer();
}

const SECRET_XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="secret"/></rdf:RDF></x:xmpmeta>';

const EXIF_WITH_GPS = {
  IFD0: { Make: 'TestCam' },
  IFD3: { GPSLatitude: '51/1 30/1 0/1', GPSLatitudeRef: 'N' },
};

function gradient(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = ((x + y) * 7) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).composite([{ input: shadingSvg(width, height) }]);
}

function jpegSegment(marker, payload) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export async function jpegWithGps({ orientation = 6, progressive = false } = {}) {
  const base = await gradient(96, 64)
    .withExif(EXIF_WITH_GPS)
    .withMetadata({ orientation })
    .withXmp(SECRET_XMP)
    .withIccProfile('p3')
    .jpeg({ quality: 85, progressive })
    .toBuffer();
  const extra = Buffer.concat([
    jpegSegment(0xfe, Buffer.from('secret comment')),
    jpegSegment(0xed, Buffer.from('Photoshop 3.0\0secret iptc')),
  ]);
  return Buffer.concat([base.subarray(0, 2), extra, base.subarray(2)]);
}

export function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

export async function pngWithText() {
  const base = await gradient(40, 30).withIccProfile('p3').png().toBuffer();
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const exif = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .withExif(EXIF_WITH_GPS)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
    .then((j) => sharp(j).metadata())
    .then((m) => m.exif.subarray(6)); 
  const extra = Buffer.concat([
    pngChunk('tEXt', Buffer.from('Comment\0secret', 'latin1')),
    pngChunk('eXIf', exif),
    pngChunk('tIME', Buffer.from([0x07, 0xea, 10, 30, 12, 0, 0])),
  ]);
  return Buffer.concat([base.subarray(0, ihdrEnd), extra, base.subarray(ihdrEnd)]);
}

export async function webpWithExif() {
  return gradient(40, 30)
    .withExif(EXIF_WITH_GPS)
    .withMetadata({ orientation: 6 })
    .withXmp(SECRET_XMP)
    .withIccProfile('p3')
    .webp({ lossless: true })
    .toBuffer();
}

export function picture(seed, { width = 800, height = 600 } = {}) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const blobs = Array.from({ length: 6 }, () => ({
    x: random() * width,
    y: random() * height,
    r: (0.15 + random() * 0.3) * width,
    c: [random() * 255, random() * 255, random() * 255],
  }));
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = [40, 40, 40];
      for (const blob of blobs) {
        const weight = Math.max(0, 1 - Math.hypot(x - blob.x, y - blob.y) / blob.r);
        for (let k = 0; k < 3; k++) pixel[k] += blob.c[k] * weight;
      }
      for (let k = 0; k < 3; k++) data[(y * width + x) * 3 + k] = Math.min(255, pixel[k]);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
}
