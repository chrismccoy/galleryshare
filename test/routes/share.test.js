import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { activityRows } from '../helpers/activity.js';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  attrsOf,
  countAttr,
  elementByAttr,
  elementsByAttr,
  elementsByTag,
  escapeHtml,
  startApp,
  withApp,
  startTags,
  stripCsrfMeta,
  textOf,
} from '../helpers/http.js';
import { makeJpeg } from '../helpers/images.js';
import { seedSharedGallery } from '../helpers/uploads.js';
import { setGalleryChoices, withSettings } from '../helpers/settings.js';
import { imageRow } from '../helpers/gallery-seed.js';
import { BROWSER_UA } from '../helpers/constants.js';
import { UNAVAILABLE_MESSAGE } from '../../domain/share-links.js';
import { SHARE_THEMES } from '../../domain/share-themes.js';
import { PATH_TO } from '../../config/urls.js';
const SHARE_TITLE = 'A shared gallery on GalleryShare';
const SHARE_DESCRIPTION = 'Open the link to see the gallery.';
const ORIGINAL_NAMES = [
  'IMG_20240101_120000-secret.jpg',
  'IMG_20240102_130000-secret.jpg',
  'IMG_20240103_140000-secret.jpg',
];

let app;
before(async () => {
  app = await startApp({ RATE_LIMIT_PUBLIC_FORM_MAX: '1000' }, { media: 'gs-share-' });
});
after(() => app.close());

const withRateLimitedApp = (fn) =>
  withApp({ RATE_LIMIT_PUBLIC_FORM_MAX: '100', RATE_LIMIT_SHARE_MAX: '3' }, { media: 'gs-share-limit-' }, fn);

async function sharedGallery(target = app, { count = 3, title, description, allowZip = false } = {}) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const data = await makeJpeg({
      width: 800 + i * 10,
      height: 600,
      background: ['#aa3333', '#33aa33', '#3333aa'][i % 3],
    });
    files.push({ name: ORIGINAL_NAMES[i % 3], data });
  }
  const shared = await seedSharedGallery(target, {
    files,
    owner: { displayName: 'Olive Ownerson' },
    title,
    description,
    allowZip,
  });
  return { ...shared, owner: shared.session };
}

const imageUrl = (token, image, size) => PATH_TO.shareImage(token, image.public_name, size);
const visit = (token, headers = {}) =>
  app.request(PATH_TO.share(token), { headers: { 'user-agent': BROWSER_UA, ...headers } });

function assertGenericHead(html) {
  assert.ok(html.includes(`<title>${SHARE_TITLE}</title>`), 'title');
  assert.ok(html.includes(`<meta property="og:title" content="${SHARE_TITLE}"`), 'og:title');
  assert.ok(html.includes(`<meta name="description" content="${SHARE_DESCRIPTION}"`), 'description');
  assert.doesNotMatch(html, /og:image/);
}

const VOLATILE_HEADERS = new Set([
  'date',
  'set-cookie',
  'etag',
  'content-length',
  'keep-alive',
  'connection',
  'ratelimit-remaining',
  'ratelimit-reset',
]);

function stableHeaders(res) {
  return Object.fromEntries([...res.headers].filter(([name]) => !VOLATILE_HEADERS.has(name)));
}

test('with grid text off, the grid shows thumbnails only and the lightbox still gets the title and caption', async (t) => {
  const { owner, galleryId, token, images } = await sharedGallery(app);
  app.context.galleriesService.saveEdits(owner.user, galleryId, {
    meta: {},
    images: [{ imageId: images[1].id, title: 'Harbour', caption: 'At dusk' }],
  });
  withSettings(t, app.context, { overrideShareGridText: true, shareGridText: false });
  const html = await (await visit(token)).text();
  assert.equal(countAttr(html, 'data-shot'), 3);
  assert.equal(elementsByTag(html, 'figcaption').length, 0, 'no text under the tiles');
  const cards = startTags(html).filter((tag) => 'data-shot' in tag.attrs);
  assert.deepEqual(
    cards.map((tag) => [tag.attrs['data-title'], tag.attrs['data-text']]),
    [
      ['', 'Image #1'],
      ['Harbour', 'At dusk'],
      ['', 'Image #3'],
    ],
    'the lightbox reads the title and caption from the card',
  );
  assert.ok(html.includes('alt="Harbour"') && html.includes('alt="Image #1"'), 'images keep their description');
});

test("a gallery's grid text choice wins over the site setting; site default follows it", async (t) => {
  const { owner, galleryId, token } = await sharedGallery(app);
  const setSettings = withSettings(t, app.context, { overrideShareGridText: true });
  const captions = async (site, gridText) => {
    setSettings({ shareGridText: site });
    await setGalleryChoices(app.context, owner.user, galleryId, { gridText });
    return elementsByTag(await (await visit(token)).text(), 'figcaption').length;
  };
  assert.equal(await captions(true, null), 3, 'site on, default');
  assert.equal(await captions(false, null), 0, 'site off, default');
  assert.equal(await captions(true, false), 0, 'site on, gallery hides');
  assert.equal(await captions(false, true), 3, 'site off, gallery shows');
});

test('every share theme wraps the heading and grid in its shell, with the photo count; None stays plain', async () => {
  const { owner, galleryId, token } = await sharedGallery(app, { title: 'Themed trip', description: 'Three of them' });
  for (const { key } of SHARE_THEMES) {
    await setGalleryChoices(app.context, owner.user, galleryId, { shareTheme: key });
    const html = await (await visit(token)).text();
    const shell = elementByAttr(html, 'data-share-theme', key);
    assert.ok(shell, `${key}: shell drawn`);
    assert.equal(countAttr(shell, 'data-shot'), 3, `${key}: the grid is inside the shell`);
    assert.equal(elementsByTag(html, 'h1').length, 1, `${key}: one heading`);
    assert.match(textOf(elementsByTag(html, 'h1')[0]), /Themed trip/, key);
    assert.match(textOf(elementByAttr(shell, 'data-share-description')), /Three of them/, `${key}: description inside`);
    if (key === 'none') {
      assert.equal(elementByAttr(html, 'data-share-count'), null, 'None shows no count');
      assert.doesNotMatch(shell, /share-theme-/, 'None adds no theme styles');
    } else {
      assert.equal(textOf(elementByAttr(shell, 'data-share-count')), '3 photos', `${key}: count`);
      assert.match(shell, new RegExp(`class="share-shell share-theme-${key}"`), key);
    }
  }
});

test('App window: the title is only in the window bar; the description, count and ZIP sit inside', async () => {
  const { owner, galleryId, token } = await sharedGallery(app, {
    title: 'Window trip',
    description: 'Inside',
    allowZip: true,
  });
  await setGalleryChoices(app.context, owner.user, galleryId, { shareTheme: 'app-window' });
  const html = await (await visit(token)).text();
  const [h1] = elementsByTag(html, 'h1');
  assert.match(h1, /class="share-window-title"/);
  assert.equal(textOf(h1), 'Window trip');
  const header = elementByAttr(html, 'data-share-header');
  assert.doesNotMatch(header, /Window trip/, 'no second title in the header');
  assert.match(textOf(header), /Inside/);
  assert.match(textOf(header), /3 photos/);
  assert.ok(elementByAttr(header, 'data-share-zip'), 'ZIP button inside');
});

test("a gallery's own theme wins over the site theme; site default follows SHARE_THEME or its override", async (t) => {
  const { owner, galleryId, token } = await sharedGallery(app);
  const themeShown = async () => attrsOf(await (await visit(token)).text(), 'data-share-theme')?.['data-share-theme'];
  assert.equal(await themeShown(), 'none', 'nothing set');
  withSettings(t, app.context, { overrideShareTheme: true, shareTheme: 'glass' });
  assert.equal(await themeShown(), 'glass', 'site theme');
  await setGalleryChoices(app.context, owner.user, galleryId, { shareTheme: 'frame' });
  assert.equal(await themeShown(), 'frame', "the gallery's own");
});

test('a single-image and an empty gallery are themed too; the count says 1 photo and is left out when empty', async () => {
  const single = await sharedGallery(app, { count: 1 });
  await setGalleryChoices(app.context, single.owner.user, single.galleryId, { shareTheme: 'polaroid' });
  const one = await (await visit(single.token)).text();
  const shell = elementByAttr(one, 'data-share-theme', 'polaroid');
  assert.ok(elementByAttr(shell, 'data-share-single'), 'the image is inside the shell');
  assert.equal(textOf(elementByAttr(shell, 'data-share-count')), '1 photo');

  const empty = await sharedGallery(app, { count: 1 });
  await setGalleryChoices(app.context, empty.owner.user, empty.galleryId, { shareTheme: 'frame' });
  await app.context.galleriesService.removeImage(empty.owner.user, empty.galleryId, empty.images[0].id);
  const none = await (await visit(empty.token)).text();
  const emptyShell = elementByAttr(none, 'data-share-theme', 'frame');
  assert.match(textOf(emptyShell), /no images yet/i);
  assert.equal(elementByAttr(emptyShell, 'data-share-count'), null);
});

test('with grid text off, a single-image gallery still shows its title and caption', async (t) => {
  const { owner, galleryId, token, images } = await sharedGallery(app, { count: 1 });
  app.context.galleriesService.saveEdits(owner.user, galleryId, {
    meta: {},
    images: [{ imageId: images[0].id, title: 'Solo', caption: 'Alone' }],
  });
  withSettings(t, app.context, { overrideShareGridText: true, shareGridText: false });
  const html = await (await visit(token)).text();
  assert.ok(html.includes('>Solo<') && html.includes('>Alone<'));
});

test('2+ images render the grid and lightbox with titles/defaults and no owner data', async () => {
  const { owner, galleryId, token, images } = await sharedGallery(app, {
    title: 'Summer & sea',
    description: 'Three days on the coast.',
  });
  app.context.galleriesService.saveEdits(owner.user, galleryId, {
    meta: {},
    images: [{ imageId: images[1].id, title: 'Harbour', caption: 'At dusk' }],
  });
  const res = await visit(token);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assertGenericHead(html);
  assert.ok(html.includes(escapeHtml('Summer & sea')), 'gallery title heading');
  assert.ok(html.includes('Three days on the coast.'), 'description');
  assert.equal(countAttr(html, 'data-shot'), 3, 'one card per image');
  assert.ok(html.includes('Harbour') && html.includes('At dusk'), 'custom title and caption');
  assert.doesNotMatch(html, />Title</, 'no placeholder title for an image without one');
  assert.ok(html.includes('alt="Image #1"'), 'an untitled image is described by its caption');
  assert.ok(html.includes('Image #1') && html.includes('Image #3'), 'default captions by position');
  assert.ok(!html.includes('Image #2'), 'image 2 has its own caption');
  for (const image of images) {
    assert.ok(html.includes(`src="${imageUrl(token, image, 'thumb')}"`), 'card thumb from the share URL');
    assert.ok(html.includes(`href="${imageUrl(token, image, 'web')}"`), 'card links to the web copy');
    assert.ok(html.includes(`data-download="${image.public_name}.webp"`), 'Save filename');
    assert.ok(html.includes(`data-thumb="${imageUrl(token, image, 'thumb')}"`), 'strip thumb');
  }
  assert.ok('hidden' in attrsOf(html, 'id', 'lightbox'), 'the lightbox starts hidden');
  assert.ok('download' in attrsOf(html, 'id', 'lb-save'), 'Save is a download link');
  assert.ok(html.includes('<script src="/js/lightbox.js"></script>'));
  assert.ok(!html.includes('/media/'), 'no signed-in media URLs');
  assert.ok(!html.includes(owner.user.email), 'no owner email');
  assert.ok(!html.includes('Olive Ownerson'), 'no owner name');
  assert.ok(!html.includes('Download ZIP'), 'no ZIP button while allow_zip is off');
});

test('page HTML never contains original_name', async () => {
  const { token, galleryId } = await sharedGallery(app);
  for (const image of app.context.galleryImages.forGallery(galleryId)) {
    assert.ok(ORIGINAL_NAMES.includes(image.original_name), 'stored');
  }
  const html = await (await visit(token)).text();
  for (const name of ORIGINAL_NAMES) {
    assert.ok(!html.includes(name), name);
    assert.ok(!html.includes(name.replace(/\.jpg$/, '')), `${name} without extension`);
  }
  assert.doesNotMatch(html, /IMG_2024|secret/);
});

test('exactly 1 image renders embedded, links to the web copy in a new tab, no lightbox script', async () => {
  const { token, images } = await sharedGallery(app, { count: 1, title: 'Solo' });
  const [image] = images;
  const res = await visit(token);
  const html = await res.text();
  assert.equal(res.status, 200);
  const web = imageUrl(token, image, 'web');
  const links = elementsByAttr(html, 'href', web);
  assert.equal(links.length, 1, 'one link to the web copy');
  const link = attrsOf(links[0], 'href');
  assert.deepEqual([link.tag, link.target, link.rel], ['a', '_blank', 'noopener'], 'opens in a new tab');
  const [anchor, first] = startTags(links[0]);
  assert.deepEqual([first?.name, first?.attrs.src], ['img', web], 'the link wraps the embedded web copy');
  assert.match(links[0].slice(anchor.end, first.start), /^\s*$/, 'the image is the first thing in the link');
  assert.ok(html.includes('Solo'));
  assert.doesNotMatch(html, />Title</);
  assert.ok(html.includes('alt="Image #1"'));
  assert.ok(html.includes('Image #1'));
  assert.ok(!html.includes('/js/lightbox.js'), 'no lightbox script');
  assert.ok(!html.includes('id="lightbox"'), 'no lightbox markup');
  assert.ok(!html.includes('data-shot'), 'no grid');
  assert.ok(!html.includes('/thumb'), 'the single layout uses the web copy only');
});

test('a shared gallery reduced to 1 then 0 images switches layout without error', async () => {
  const { owner, galleryId, token, images } = await sharedGallery(app, { count: 3, allowZip: true });
  let html = await (await visit(token)).text();
  assert.ok(html.includes('/js/lightbox.js'));

  await app.context.galleriesService.removeImage(owner.user, galleryId, images[0].id);
  await app.context.galleriesService.removeImage(owner.user, galleryId, images[1].id);
  let res = await visit(token);
  html = await res.text();
  assert.equal(res.status, 200, 'one image left');
  assert.ok(html.includes(`<img src="${imageUrl(token, images[2], 'web')}"`), 'the remaining image is embedded');
  assert.ok(html.includes('Image #1'), 'caption follows the new position');
  assert.ok(!html.includes('/js/lightbox.js'));
  assert.equal((await app.request(imageUrl(token, images[0], 'thumb'))).status, 404, 'removed image is gone');

  await app.context.galleriesService.removeImage(owner.user, galleryId, images[2].id);
  res = await visit(token);
  html = await res.text();
  assert.equal(res.status, 200, 'no images left');
  assert.ok(html.includes('This gallery has no images yet.'));
  assert.ok(!html.includes('<img src="/s/'), 'no image');
  assert.ok(!html.includes('/js/lightbox.js'));
  assert.ok(!html.includes('Download ZIP'), 'nothing to download');
});

test('an image row whose files are still being written (zero bytes) is not shown or served', async () => {
  const { galleryId, token, images } = await sharedGallery(app, { count: 2 });
  const pendingId = app.context.galleryImages.insert(
    imageRow(galleryId, { publicName: 'inflight00', originalName: 'pending.jpg', bytesOrig: 0 }),
  );
  const pending = app.context.galleryImages.byId(pendingId);
  const html = await (await visit(token)).text();
  assert.ok(!html.includes(pending.public_name), 'pending image not on the page');
  for (const image of images) assert.ok(html.includes(image.public_name));
  assert.equal(await app.status(imageUrl(token, pending, 'thumb'), { headers: { 'user-agent': BROWSER_UA } }), 404);
});

test('Download ZIP button only when allow_zip is on', async () => {
  const { owner, galleryId, token, images } = await sharedGallery(app, { count: 2, allowZip: true });
  const zipHref = `href="${PATH_TO.shareZip(token)}"`;
  let html = await (await visit(token)).text();
  assert.ok(html.includes('Download ZIP'));
  assert.ok(html.includes(zipHref));

  app.context.galleriesService.saveEdits(owner.user, galleryId, { meta: { allowZip: false }, images: [] });
  html = await (await visit(token)).text();
  assert.ok(!html.includes('Download ZIP'));
  assert.ok(!html.includes(zipHref));

  app.context.galleriesService.saveEdits(owner.user, galleryId, { meta: { allowZip: true }, images: [] });
  await app.context.galleriesService.removeImage(owner.user, galleryId, images[0].id);
  html = await (await visit(token)).text();
  assert.ok(html.includes(zipHref), 'single layout has the button too');
});

test('image requests serve the web and thumb copies with private caching and noindex', async () => {
  const { token, images } = await sharedGallery(app, { count: 2 });
  const thumb = await app.request(imageUrl(token, images[0], 'thumb'));
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get('content-type'), 'image/webp');
  assert.equal(thumb.headers.get('cache-control'), 'private, max-age=300');
  assert.equal(thumb.headers.get('x-robots-tag'), 'noindex');
  const thumbMeta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
  assert.equal(Math.max(thumbMeta.width, thumbMeta.height), 600);
  const web = await app.request(imageUrl(token, images[0], 'web'));
  assert.equal(web.status, 200);
  assert.equal((await sharp(Buffer.from(await web.arrayBuffer())).metadata()).width, 800);

  for (const url of [
    imageUrl(token, images[0], 'orig'),
    imageUrl(token, images[0], 'big'),
    PATH_TO.shareImage(token, 'nosuchname1', 'web'),
    imageUrl(`${token}x`, images[0], 'web'),
    imageUrl(token.slice(1), images[0], 'web'),
  ]) {
    const res = await app.request(url);
    assert.equal(res.status, 404, url);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', url);
    assert.notEqual(res.headers.get('cache-control'), 'private, max-age=300', url);
    await res.arrayBuffer();
  }
});

test("an image of another gallery is 404 under this gallery's token", async () => {
  const a = await sharedGallery(app, { count: 1 });
  const b = await sharedGallery(app, { count: 1 });
  assert.equal(await app.status(imageUrl(a.token, b.images[0], 'web')), 404);
});

test('re-sharing returns the same link; revoke kills page and images at once', async () => {
  const { owner, galleryId, token, images } = await sharedGallery(app, { count: 2 });
  assert.equal(app.context.sharesService.share(owner.user, galleryId).token, token);
  assert.equal((await visit(token)).status, 200);
  assert.equal(await app.status(imageUrl(token, images[0], 'thumb')), 200);

  app.context.sharesService.revokeFor(owner.user, galleryId);
  const page = await visit(token);
  assert.equal(page.status, 404);
  assert.ok((await page.text()).includes(escapeHtml(UNAVAILABLE_MESSAGE)));
  for (const size of ['thumb', 'web']) {
    assert.equal(await app.status(imageUrl(token, images[0], size)), 404, size);
  }
});

test('trashed gallery, disabled owner, sharing off, bad shape, unknown token: identical unavailable page', async (t) => {
  const setSettings = withSettings(t, app.context);
  const unknown = await visit('Zz9Zz9Z');
  const expected = {
    status: unknown.status,
    headers: stableHeaders(unknown),
    body: stripCsrfMeta(await unknown.text()),
  };
  assert.equal(expected.status, 404);
  assert.ok(expected.body.includes(escapeHtml(UNAVAILABLE_MESSAGE)));
  assertGenericHead(expected.body);

  const trashed = await sharedGallery(app, { count: 1 });
  app.context.galleries.trashOwned(trashed.galleryId, trashed.owner.user.id);
  const disabled = await sharedGallery(app, { count: 1 });
  app.context.users.setDisabled(disabled.owner.user.id, true);
  const revoked = await sharedGallery(app, { count: 1 });
  app.context.sharesService.revokeFor(revoked.owner.user, revoked.galleryId);
  const switchedOff = await sharedGallery(app, { count: 1 });

  const unavailableAnswer = async (token) => {
    const res = await visit(token);
    return { status: res.status, headers: stableHeaders(res), body: stripCsrfMeta(await res.text()) };
  };
  const imageStatus = ({ token, images }) => app.status(imageUrl(token, images[0], 'web'));
  assert.deepEqual(await unavailableAnswer(trashed.token), expected, 'trashed');
  assert.equal(await imageStatus(trashed), 404, 'trashed image');
  assert.deepEqual(await unavailableAnswer(disabled.token), expected, 'owner disabled');
  assert.equal(await imageStatus(disabled), 404, 'disabled owner image');
  assert.deepEqual(await unavailableAnswer(revoked.token), expected, 'revoked');
  for (const bad of [`${switchedOff.token}x`, switchedOff.token.slice(1), 'abc-def', 'a'.repeat(32)]) {
    assert.deepEqual(await unavailableAnswer(bad), expected, `bad shape ${bad}`);
  }
  assert.equal(await imageStatus(switchedOff), 200, 'image works before the switch');
  setSettings({ publicSharing: false });
  assert.deepEqual(await unavailableAnswer(switchedOff.token), expected, 'switch off');
  assert.equal(await imageStatus(switchedOff), 404, 'switch off image');
});

test('link-preview bots get a bare stub with no gallery content and are not counted', async () => {
  const { galleryId, token } = await sharedGallery(app, { count: 2, title: 'Private Title' });
  for (const ua of ['Slackbot-LinkExpanding 1.0', 'facebookexternalhit/1.1', 'Twitterbot/1.0']) {
    const res = await app.request(PATH_TO.share(token), { headers: { 'user-agent': ua } });
    const html = await res.text();
    assert.equal(res.status, 200, ua);
    assertGenericHead(html);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', ua);
    assert.ok(!html.includes('Private Title'), `${ua}: no title`);
    assert.ok(!html.includes(`${PATH_TO.share(token)}/i/`), `${ua}: no images`);
  }
  assert.equal(app.context.shares.liveForGallery(galleryId).view_count, 0);
});

test('owner and admin views are not counted; anonymous views are', async () => {
  const { owner, galleryId, token } = await sharedGallery(app, { count: 1 });
  const admin = await app.signedIn({ role: 'admin' });
  const other = await app.signedIn();
  const count = () => app.context.shares.liveForGallery(galleryId).view_count;
  for (const session of [owner, admin]) {
    const status = await app.status(PATH_TO.share(token), {
      cookie: session.cookie,
      headers: { 'user-agent': BROWSER_UA },
    });
    assert.equal(status, 200);
  }
  assert.equal(count(), 0, 'owner and admin not counted');
  const head = await app.request(PATH_TO.share(token), { method: 'HEAD', headers: { 'user-agent': BROWSER_UA } });
  assert.equal(head.status, 200);
  assert.equal(count(), 0, 'HEAD not counted');
  await (await visit(token)).arrayBuffer();
  assert.equal(count(), 1, 'anonymous counted');
  await app.status(PATH_TO.share(token), { cookie: other.cookie, headers: { 'user-agent': BROWSER_UA } });
  assert.equal(count(), 2, 'another signed-in user counted');
  const [view] = app.context.shares.views(app.context.shares.liveForGallery(galleryId).id);
  assert.equal(view.kind, 'page');
});

test('activity: an anonymous visit is recorded as galleryVisited, owner and bot views are not', async () => {
  const { owner, galleryId, token } = await sharedGallery(app, { count: 1, title: 'Visit Me' });
  const visits = () => activityRows(app.context, 'galleryVisited', galleryId);
  await app.status(PATH_TO.share(token), { cookie: owner.cookie, headers: { 'user-agent': BROWSER_UA } });
  await app.status(PATH_TO.share(token), { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } });
  assert.equal(visits().length, 0);
  await (await visit(token)).arrayBuffer();
  const [event] = visits();
  assert.equal(event.actor_type, 'visitor');
  assert.equal(event.gallery_title, 'Visit Me');
  assert.equal(event.user_agent, BROWSER_UA);
  assert.ok(event.ip);
  assert.ok(!JSON.stringify(event).includes(token));
});

test('30 image requests with a valid token do not trip the share rate limit', async () => {
  await withRateLimitedApp(async (small) => {
    const { token, images } = await sharedGallery(small, { count: 3 });
    assert.equal(await small.status(PATH_TO.share(token)), 200);
    for (let i = 0; i < 30; i++) {
      const image = images[i % images.length];
      assert.equal(await small.status(imageUrl(token, image, i % 2 ? 'web' : 'thumb')), 200, `image request ${i + 1}`);
    }
    for (let i = 2; i <= 6; i++) {
      assert.equal(await small.status(PATH_TO.share(token)), 200, `page load ${i}`);
    }
  });
});

test('reloading a valid share page past the limit is never refused', async () => {
  await withRateLimitedApp(async (small) => {
    const { token } = await sharedGallery(small, { count: 1 });
    for (let i = 1; i <= 10; i++) {
      assert.equal(await small.status(PATH_TO.share(token)), 200, `page load ${i}`);
    }
  });
});

test('page requests with a wrong token count toward the limit, then get 429', async () => {
  await withRateLimitedApp(async (small) => {
    for (let i = 1; i <= 3; i++) {
      assert.equal(await small.status(PATH_TO.share(`wrongToken${i}`)), 404, `wrong token ${i}`);
    }
    const refused = await small.request(PATH_TO.share('wrongToken4'));
    assert.equal(refused.status, 429, 'the fourth wrong token is over the limit');
    assert.ok(refused.headers.get('retry-after'));
    assertGenericHead(await refused.text());
  });
});

test('image requests with a wrong token count toward the limit and 404', async () => {
  await withRateLimitedApp(async (small) => {
    const { token, images } = await sharedGallery(small, { count: 1 });
    for (const url of [
      imageUrl('Zz9Zz9Z', images[0], 'web'),
      PATH_TO.shareImage(token, 'nosuchname1', 'thumb'),
      imageUrl('bad', images[0], 'web'),
    ]) {
      assert.equal(await small.status(url), 404, url);
    }
    const page = await small.request(PATH_TO.share('Zz9Zz9Z'));
    const html = await page.text();
    assert.equal(page.status, 429, 'failed lookups used up the limit');
    assertGenericHead(html);
    assert.ok(!html.includes('href="/login"'), 'no link to sign in');
    assert.ok(
      elementsByAttr(html, 'href', '/').some((link) => textOf(link) === 'Go to GalleryShare'),
      'a link home named Go to GalleryShare',
    );
    assert.equal(await small.status(imageUrl(token, images[0], 'thumb')), 200, 'a valid image request still works');
  });
});

test('wrong-token image requests past the limit get a plain 429, and the burst is recorded once', async () => {
  await withRateLimitedApp(async (small) => {
    const { token, images } = await sharedGallery(small, { count: 1 });
    const hits = () => activityRows(small.context, 'rateLimitHit');
    for (let i = 1; i <= 3; i++) {
      assert.equal(await small.status(imageUrl(`wrongToken${i}`, images[0], 'web')), 404, `wrong token ${i}`);
    }
    assert.equal(hits().length, 0, 'nothing is recorded under the limit');
    const refused = await small.request(imageUrl('wrongToken4', images[0], 'web'));
    assert.equal(refused.status, 429);
    assert.match(refused.headers.get('content-type'), /^text\/plain/);
    assert.ok(refused.headers.get('retry-after'));
    assert.equal(refused.headers.get('cache-control'), 'no-store');
    assert.ok(!(await refused.text()).includes('<'), 'no HTML for an image');
    assert.equal(await small.status(imageUrl('wrongToken5', images[0], 'web')), 429);
    assert.equal(await small.status(PATH_TO.share('wrongToken6')), 429, 'one count with the page');
    const [hit, ...more] = hits();
    assert.equal(more.length, 0, 'one row per burst');
    assert.equal(hit.details, 'share links');
    assert.equal(hit.actor_type, 'visitor');
    assert.ok(!JSON.stringify(hit).includes('wrongToken'), 'the guessed tokens are not stored');
    assert.equal(await small.status(imageUrl(token, images[0], 'thumb')), 200, 'a valid image request still works');
  });
});

test('a read error after the stream opens (file gone) is a 404, not a crash', async (t) => {
  const { token, images } = await sharedGallery(app, { count: 1 });
  const { mediaStore } = app.context;
  const stream = t.mock.method(mediaStore, 'stream', () => fs.createReadStream(path.join(app.root, 'vanished.webp')));
  const res = await app.request(imageUrl(token, images[0], 'thumb'));
  assert.equal(res.status, 404);
  assert.notEqual(res.headers.get('content-type'), 'image/webp');
  await res.arrayBuffer();
  stream.mock.restore();
  const file = mediaStore.paths({ galleryId: images[0].gallery_id, imageId: images[0].id, ext: images[0].ext }).web;
  fs.rmSync(file);
  assert.equal(await app.status(imageUrl(token, images[0], 'web')), 404, 'a missing file is a 404');
});

test('the page links images as <name>.webp and <name>-thumb.webp; the older addresses serve the same files', async () => {
  const { token, images } = await sharedGallery(app, { count: 2 });
  const html = await (await visit(token)).text();
  const name = images[0].public_name;
  assert.ok(html.includes(`/s/${token}/i/${name}-thumb.webp"`), 'thumbnails: <name>-thumb.webp');
  assert.ok(html.includes(`/s/${token}/i/${name}.webp"`), 'large images: <name>.webp');
  assert.doesNotMatch(html, new RegExp(`/i/${name}/`), 'no address of the older shape');
  const fetchWebp = async (path) => {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), 'image/webp', path);
    assert.equal(res.headers.get('cache-control'), 'private, max-age=300', path);
    return Buffer.from(await res.arrayBuffer());
  };
  const web = await fetchWebp(`/s/${token}/i/${name}.webp`);
  const thumb = await fetchWebp(`/s/${token}/i/${name}-thumb.webp`);
  assert.ok(!web.equals(thumb), 'two different copies');
  for (const old of ['web.webp', 'web']) assert.ok((await fetchWebp(`/s/${token}/i/${name}/${old}`)).equals(web), old);
  for (const old of ['thumb.webp', 'thumb']) {
    assert.ok((await fetchWebp(`/s/${token}/i/${name}/${old}`)).equals(thumb), old);
  }
  for (const path of [
    `/i/${name}.png`,
    `/i/${name}-orig.webp`,
    `/i/${name}-thumb.WEBP`,
    `/i/${name}.webp.webp`,
    `/i/NoSuchName1.webp`,
    `/i/${name}/web.png`,
    `/i/${name}/orig`,
  ]) {
    assert.equal((await app.request(`/s/${token}${path}`)).status, 404, path);
  }
});

test('Copy image link: in the lightbox of a grid page, and under the image of a single-image page', async () => {
  const grid = await sharedGallery(app, { count: 2 });
  const gridHtml = await (await visit(grid.token)).text();
  const copy = attrsOf(gridHtml, 'id', 'lb-copy');
  assert.equal(copy.tag, 'button');
  assert.ok('data-copy-link' in copy, 'filled by lightbox.js with the image shown');
  assert.match(textOf(elementByAttr(gridHtml, 'id', 'lb-copy')), /Copy image link/);
  assert.equal(attrsOf(gridHtml, 'id', 'lb-copy-thumb'), null, 'no thumbnail link button');
  assert.match(gridHtml, /<script src="\/js\/copy-link\.js"/);

  const single = await sharedGallery(app, { count: 1 });
  const singleHtml = await (await visit(single.token)).text();
  const button = attrsOf(singleHtml, 'data-share-copy-image');
  assert.equal(button['data-copy-link'], `/s/${single.token}/i/${single.images[0].public_name}.webp`);
  assert.equal(attrsOf(singleHtml, 'data-share-copy-thumb'), null, 'no thumbnail link button');
  assert.match(singleHtml, /<script src="\/js\/copy-link\.js"/);
});

const setView = (shared, view) =>
  setGalleryChoices(app.context, shared.owner.user, shared.galleryId, { imageView: view });

test('the grid follows the image view: lightbox (script, new tab), new tab (no script) or image pages (same tab)', async () => {
  const shared = await sharedGallery(app, { count: 2 });
  const { token, images } = shared;
  const name = images[0].public_name;
  let html = await (await visit(token)).text();
  let link = attrsOf(elementsByAttr(html, 'data-shot')[0], 'href');
  assert.equal(link.href, `/s/${token}/i/${name}.webp`);
  assert.equal(link.target, '_blank');
  assert.match(html, /\/js\/lightbox\.js/);
  assert.ok(attrsOf(html, 'id', 'lightbox'), 'lightbox markup');

  await setView(shared, 'new-tab');
  html = await (await visit(token)).text();
  link = attrsOf(elementsByAttr(html, 'data-shot')[0], 'href');
  assert.equal(link.href, `/s/${token}/i/${name}.webp`);
  assert.equal(link.target, '_blank');
  assert.doesNotMatch(html, /\/js\/lightbox\.js/);
  assert.equal(attrsOf(html, 'id', 'lightbox'), null, 'no lightbox');

  await setView(shared, 'page');
  html = await (await visit(token)).text();
  link = attrsOf(elementsByAttr(html, 'data-shot')[0], 'href');
  assert.equal(link.href, `/s/${token}/i/${name}`);
  assert.ok(!('target' in link), 'same tab');
  assert.doesNotMatch(html, /\/js\/lightbox\.js/);
});

test('an image page: the image in the theme, "Photo n of N", Previous and Next disabled at the ends, Save, Copy', async () => {
  const shared = await sharedGallery(app, { count: 3, title: 'Paged', allowZip: true });
  const { token, images } = shared;
  await setGalleryChoices(app.context, shared.owner.user, shared.galleryId, {
    imageView: 'page',
    shareTheme: 'polaroid',
  });
  const page = (i) => `/s/${token}/i/${images[i].public_name}`;
  const first = await app.request(page(0));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const html = await first.text();
  const shell = elementByAttr(html, 'data-share-theme', 'polaroid');
  assert.ok(elementByAttr(shell, 'data-image-page'), 'the image is inside the theme');
  assert.equal(textOf(elementByAttr(shell, 'data-image-counter')), 'Photo 1 of 3');
  assert.equal(elementByAttr(shell, 'data-share-count'), null, 'no gallery photo count on an image page');
  assert.match(textOf(elementsByTag(html, 'h1')[0]), /Paged/);
  assert.equal(attrsOf(html, 'data-image-prev').tag, 'button');
  assert.ok('disabled' in attrsOf(html, 'data-image-prev'), 'Previous is disabled on the first image');
  assert.equal(attrsOf(html, 'data-image-next').href, page(1));
  assert.equal(attrsOf(html, 'data-image-gallery').href, `/s/${token}`);
  assert.equal(attrsOf(html, 'data-image-save').href, `/s/${token}/i/${images[0].public_name}.webp`);
  assert.ok(attrsOf(html, 'data-share-copy-image'));
  for (const hook of ['data-image-next', 'data-image-save', 'data-share-copy-image']) {
    assert.match(attrsOf(html, hook).class, /\bbtn-primary\b/, hook);
  }
  assert.match(attrsOf(html, 'data-image-prev').class, /\bbtn-quiet\b/, 'disabled Previous stays quiet');
  assert.ok(elementByAttr(shell, 'data-share-zip'), 'Download ZIP stays');
  assert.match(html, /\/js\/image-page\.js/);
  assert.match(html, /\/js\/copy-link\.js/);

  const middle = await (await app.request(page(1))).text();
  assert.equal(attrsOf(middle, 'data-image-prev').href, page(0));
  assert.equal(attrsOf(middle, 'data-image-next').href, page(2));
  assert.match(attrsOf(middle, 'data-image-prev').class, /\bbtn-primary\b/, 'live Previous is primary');
  const last = await (await app.request(page(2))).text();
  assert.ok('disabled' in attrsOf(last, 'data-image-next'), 'Next is disabled on the last image');
  assert.equal(textOf(elementByAttr(last, 'data-image-counter')), 'Photo 3 of 3');
});

test('image pages record no visit; a wrong name, a revoked link and another view are handled', async () => {
  const shared = await sharedGallery(app, { count: 2 });
  const { owner, galleryId, token, images, shareId } = shared;
  await setView(shared, 'page');
  const views = () => app.context.shares.byId(shareId).view_count;
  const before = views();
  assert.equal(
    (await app.request(`/s/${token}/i/${images[1].public_name}`, { headers: { 'user-agent': BROWSER_UA } })).status,
    200,
  );
  assert.equal(views(), before, 'no visit counted');

  const wrong = await app.request(`/s/${token}/i/NoSuchName9`);
  assert.equal(wrong.status, 404);
  assert.ok((await wrong.text()).includes(escapeHtml(UNAVAILABLE_MESSAGE)), 'the same unavailable page');

  await setView(shared, 'lightbox');
  const other = await app.request(`/s/${token}/i/${images[1].public_name}`);
  assert.equal(other.status, 303);
  assert.equal(other.headers.get('location'), `/s/${token}`);

  await setView(shared, 'page');
  app.context.sharesService.revokeFor(owner.user, galleryId);
  const revoked = await app.request(`/s/${token}/i/${images[1].public_name}`);
  assert.equal(revoked.status, 404);
});
