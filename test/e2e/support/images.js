import { makeJpeg, makePng, makeWebp } from '../../helpers/images.js';
import { demoUploadFiles } from '../../../scripts/shared/demo-images.js';

export async function jpegFile(name = 'photo.jpg', { width = 320, height = 240, background = '#c9a227' } = {}) {
  return { name, mimeType: 'image/jpeg', buffer: await makeJpeg({ width, height, background }) };
}

export async function pngFile(name = 'photo.png', { width = 240, height = 240, background = '#5b3a1e' } = {}) {
  return { name, mimeType: 'image/png', buffer: await makePng({ width, height, background }) };
}

export async function webpFile(name = 'photo.webp', { width = 300, height = 200, background = '#2f7d6d' } = {}) {
  return { name, mimeType: 'image/webp', buffer: await makeWebp({ width, height, background }) };
}

export function textFile(name = 'notes.txt', text = 'this is not an image\n') {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(text) };
}

export async function threeImages(prefix = 'photo') {
  return [
    await jpegFile(`${prefix}-1.jpg`, { background: '#d9534f' }),
    await pngFile(`${prefix}-2.png`, { background: '#5bc0de' }),
    await webpFile(`${prefix}-3.webp`, { background: '#5cb85c' }),
  ];
}

export const sceneFiles = (count, { first = 0, prefix = 'scene', width = 900 } = {}) =>
  demoUploadFiles(count, { first, width, name: sceneNames(prefix, first) });

function sceneNames(prefix, first) {
  return (index, format) => `${prefix}-${first + index}.${format}`;
}
