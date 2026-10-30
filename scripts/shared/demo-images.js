import sharp from 'sharp';
import { IMAGE_FORMATS } from '../../media/image-types.js';

const PALETTES = Object.freeze([
  { sky: ['#ffb88c', '#de6262'], sun: '#fff1c1', far: '#7b4b6a', near: '#3d2645', water: null },
  { sky: ['#a1c4fd', '#c2e9fb'], sun: '#fffbe6', far: '#7fa8c9', near: '#3b6e8f', water: '#2c5d7c' },
  { sky: ['#f6d365', '#fda085'], sun: '#fff7d6', far: '#c97b4b', near: '#8a4f2a', water: null },
  { sky: ['#0f2027', '#2c5364'], sun: '#f4f1de', far: '#1d3a46', near: '#0b1d24', water: '#16323d' },
  { sky: ['#d4fc79', '#96e6a1'], sun: '#fffde4', far: '#5a9a5b', near: '#2f6b3a', water: null },
  { sky: ['#e0c3fc', '#8ec5fc'], sun: '#ffffff', far: '#7d84b2', near: '#454b7a', water: '#5a6aa0' },
  { sky: ['#fbc2eb', '#a6c1ee'], sun: '#fff5fb', far: '#9a7fb0', near: '#5d4a78', water: null },
  { sky: ['#43cea2', '#185a9d'], sun: '#e8fff6', far: '#2d6f78', near: '#123f4f', water: '#1b4f63' },
]);

const LCG_MULTIPLIER = 9301;

const LCG_INCREMENT = 49297;

const LCG_MODULUS = 233280;

function seededRandom(seed) {
  let state = seed * LCG_MULTIPLIER + LCG_INCREMENT;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
}

function ridge(width, height, base, amplitude, steps, next) {
  const points = [`0,${height}`];
  for (let i = 0; i <= steps; i++) {
    const x = Math.round((i / steps) * width);
    const y = Math.round(base - next() * amplitude);
    points.push(`${x},${y}`);
  }
  points.push(`${width},${height}`);
  return points.join(' ');
}

export const DEFAULT_SCENE_SIZE = Object.freeze({ width: 1600, height: 1067 });

export function sceneSvg(index, { width = DEFAULT_SCENE_SIZE.width, height = DEFAULT_SCENE_SIZE.height } = {}) {
  const palette = PALETTES[index % PALETTES.length];
  const next = seededRandom(index + 1);
  const horizon = height * (0.55 + next() * 0.15);
  const sunX = width * (0.2 + next() * 0.6);
  const sunY = height * (0.18 + next() * 0.25);
  const sunR = Math.min(width, height) * (0.06 + next() * 0.05);
  const far = ridge(width, height, horizon, height * 0.22, 9, next);
  const near = ridge(width, height, horizon + height * 0.12, height * 0.18, 6, next);
  const water = palette.water
    ? `<rect x="0" y="${Math.round(horizon + height * 0.2)}" width="${width}" height="${height}" fill="${palette.water}" opacity="0.9"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${palette.sky[0]}"/><stop offset="1" stop-color="${palette.sky[1]}"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  <circle cx="${Math.round(sunX)}" cy="${Math.round(sunY)}" r="${Math.round(sunR)}" fill="${palette.sun}" opacity="0.95"/>
  <polygon points="${far}" fill="${palette.far}"/>
  <polygon points="${near}" fill="${palette.near}"/>
  ${water}
</svg>`;
}

const ENCODERS = Object.freeze({
  jpg: (img) => img.jpeg({ quality: 82 }),
  png: (img) => img.png({ compressionLevel: 9 }),
  webp: (img) => img.webp({ quality: 80 }),
});

export function demoImage(
  index,
  { width = DEFAULT_SCENE_SIZE.width, height = DEFAULT_SCENE_SIZE.height, format = 'jpg' } = {},
) {
  const encode = ENCODERS[format];
  if (!encode) throw new TypeError(`Unknown demo image format: ${format}`);
  return encode(sharp(Buffer.from(sceneSvg(index, { width, height })))).toBuffer();
}

export const DEMO_FORMATS = Object.freeze(IMAGE_FORMATS.map((format) => format.ext));

export const MIME_TYPES = Object.freeze(Object.fromEntries(IMAGE_FORMATS.map((format) => [format.ext, format.mime])));

export async function demoUploadFiles(
  count,
  {
    first = 0,
    width = DEFAULT_SCENE_SIZE.width,
    height = Math.round((width * 2) / 3),
    name = (index, format) => `IMG_${String(index + 1).padStart(4, '0')}.${format}`,
  } = {},
) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const format = DEMO_FORMATS[i % DEMO_FORMATS.length];
    files.push({
      name: name(i, format),
      mimeType: MIME_TYPES[format],
      buffer: await demoImage(first + i, { width, height, format }),
    });
  }
  return files;
}
