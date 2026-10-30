import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_TO } from '../../config/urls.js';
import { imageFileOf, imageSizeOf, toShareImage } from '../../routes/view/share-view.js';

test('toShareImage gives titles, captions and share URLs only, never the original name or ids', () => {
  const image = {
    id: 9,
    gallery_id: 4,
    public_name: 'pub123',
    title: null,
    caption: 'Sunset',
    original_name: 'IMG_1.jpg',
  };
  const shown = toShareImage('Tok1234', image, 2);
  assert.deepEqual(Object.keys(shown).sort(), [
    'caption',
    'download',
    'pageUrl',
    'position',
    'thumbUrl',
    'title',
    'webUrl',
  ]);
  assert.equal(shown.pageUrl, '/s/Tok1234/i/pub123');
  assert.equal(shown.caption, 'Sunset');
  assert.equal(shown.position, 2);
  assert.equal(shown.thumbUrl, PATH_TO.shareImage('Tok1234', 'pub123', 'thumb'));
  assert.equal(shown.webUrl, PATH_TO.shareImage('Tok1234', 'pub123', 'web'));
  assert.equal(shown.download, 'pub123.webp');
  assert.doesNotMatch(JSON.stringify(shown), /IMG_1/);
});

test('imageSizeOf reads the older addresses: web.webp, thumb.webp, web and thumb; nothing else', () => {
  assert.equal(imageSizeOf('web.webp'), 'web');
  assert.equal(imageSizeOf('thumb.webp'), 'thumb');
  assert.equal(imageSizeOf('web'), 'web');
  assert.equal(imageSizeOf('thumb'), 'thumb');
  for (const bad of ['orig', 'orig.webp', 'web.png', 'web.webp.webp', 'web.WEBP', '.webp', '']) {
    assert.equal(imageSizeOf(bad), null, bad);
  }
});

test('imageFileOf reads <name>.webp and <name>-thumb.webp; a bare name is the image page', () => {
  assert.deepEqual(imageFileOf('k2P9x7Qa1Z.webp'), { publicName: 'k2P9x7Qa1Z', size: 'web' });
  assert.deepEqual(imageFileOf('k2P9x7Qa1Z-thumb.webp'), { publicName: 'k2P9x7Qa1Z', size: 'thumb' });
  for (const other of ['k2P9x7Qa1Z', 'k2P9x7Qa1Z.png', 'k2P9x7Qa1Z-orig.webp', '.webp', 'a.b.webp', '']) {
    assert.equal(imageFileOf(other), null, other);
  }
});
