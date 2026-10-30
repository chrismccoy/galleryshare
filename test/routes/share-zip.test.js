import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { activityRows } from '../helpers/activity.js';
import fs from 'node:fs';
import { setTimeout as setTimeout_ } from 'node:timers/promises';
import { escapeHtml, startApp, stripCsrfMeta } from '../helpers/http.js';
import { jpegWithGps } from '../helpers/images.js';
import { entriesOf } from '../helpers/zip.js';
import { seedSharedGallery } from '../helpers/uploads.js';
import { imageRow } from '../helpers/gallery-seed.js';
import { BROWSER_UA } from '../helpers/constants.js';
import { slowStream } from '../helpers/streams.js';
import { UNAVAILABLE_MESSAGE } from '../../domain/share-links.js';
import { withSettings } from '../helpers/settings.js';
import { PATH_TO } from '../../config/urls.js';

const NAMES = ['IMG_20240101_secret-one.jpg', 'IMG_20240102_secret-two.jpg'];
const HIGH_LIMITS = { RATE_LIMIT_PUBLIC_FORM_MAX: '1000', RATE_LIMIT_SHARE_MAX: '1000', RATE_LIMIT_ZIP_MAX: '1000' };

let app;
before(async () => {
  app = await startApp(HIGH_LIMITS, { media: 'gs-sharezip-' });
});
after(() => app.close());

async function sharedGallery(target = app, { count = 2, allowZip = true } = {}) {
  const files = [];
  for (let i = 0; i < count; i++) files.push({ name: NAMES[i % 2], data: await jpegWithGps() });
  const shared = await seedSharedGallery(target, { files, allowZip });
  return { ...shared, owner: shared.session };
}

const getZip = (target, token, { headers = {}, cookie, method } = {}) =>
  target.request(PATH_TO.shareZip(token), { method, cookie, headers: { 'user-agent': BROWSER_UA, ...headers } });
const kinds = (shareId) => app.context.shares.views(shareId).map((v) => v.kind);
const reorder = (galleryId, ids) => assert.ok(app.context.galleryImages.reorder(galleryId, ids));

test('ZIP contains the stripped originals in gallery order with <public_name>-NNN.<ext> names', async () => {
  const { galleryId, token, images } = await sharedGallery(app);
  const [a, b] = images;
  reorder(galleryId, [b.id, a.id]);
  const res = await getZip(app, token);
  assert.equal(res.status, 200);
  const entries = await entriesOf(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(
    entries.map((e) => e.name),
    [`${b.public_name}-001.jpg`, `${a.public_name}-002.jpg`],
  );
  const stored = fs.readFileSync(app.context.mediaStore.paths({ galleryId, imageId: b.id, ext: 'jpg' }).orig);
  assert.ok(!entries[0].data.includes(Buffer.from('TestCam')), 'no camera make');
  assert.ok(entries[0].data.equals(stored), 'byte-identical to the stripped original');
});

test('ZIP leaves out an image row whose files are still being written (zero bytes)', async () => {
  const { galleryId, token, images } = await sharedGallery(app);
  app.context.galleryImages.insert(
    imageRow(galleryId, { publicName: 'inflight01', originalName: 'pending.jpg', bytesOrig: 0 }),
  );
  const res = await getZip(app, token);
  assert.equal(res.status, 200);
  const entries = await entriesOf(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(
    entries.map((e) => e.name),
    images.map((image, i) => `${image.public_name}-${String(i + 1).padStart(3, '0')}.jpg`),
  );
});

test('response headers: zip, attachment, no-store, noindex', async () => {
  const { token } = await sharedGallery(app, { count: 1 });
  const res = await getZip(app, token);
  await res.arrayBuffer();
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="gallery-${token}.zip"`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});

test('ZIP entries are stored (compression method 0) and dated now', async () => {
  const { token } = await sharedGallery(app);
  const before = Date.now();
  const res = await getZip(app, token);
  const entries = await entriesOf(Buffer.from(await res.arrayBuffer()));
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.equal(e.method, 0);
    const d = e.date;
    const written = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    assert.ok(Math.abs(written - before) < 60_000, `entry date ${d.toISOString()}`);
  }
});

test('ZIP is 404 when allow_zip is off, gallery trashed, link revoked, empty, or unknown', async () => {
  const unknown = await getZip(app, 'Zz9Zz9Z');
  const expected = await unknown.text();
  assert.equal(unknown.status, 404);
  assert.ok(expected.includes(escapeHtml(UNAVAILABLE_MESSAGE)));
  const assertSameUnavailable = async (token) => {
    const res = await getZip(app, token);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type')?.startsWith('text/html'), true);
    assert.equal(res.headers.get('content-disposition'), null);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(stripCsrfMeta(await res.text()), stripCsrfMeta(expected));
  };
  await assertSameUnavailable((await sharedGallery(app, { allowZip: false })).token);
  const trashed = await sharedGallery(app);
  app.context.galleries.trashOwned(trashed.galleryId, trashed.owner.user.id);
  await assertSameUnavailable(trashed.token);
  const revoked = await sharedGallery(app);
  app.context.sharesService.revokeFor(revoked.owner.user, revoked.galleryId);
  await assertSameUnavailable(revoked.token);
  const empty = await sharedGallery(app, { count: 1 });
  await app.context.galleriesService.removeImage(empty.owner.user, empty.galleryId, empty.images[0].id);
  assert.equal(app.context.galleryImages.forGallery(empty.galleryId).length, 0);
  await assertSameUnavailable(empty.token);
  await assertSameUnavailable('abc-def');
});

test('ZIP is 404 when public sharing is switched off', async (t) => {
  const setSettings = withSettings(t, app.context);
  const { token } = await sharedGallery(app);
  setSettings({ publicSharing: false });
  assert.equal((await getZip(app, token)).status, 404);
});

test('a missing original file answers 404 before any ZIP bytes', async () => {
  const { token, galleryId, images } = await sharedGallery(app);
  fs.rmSync(app.context.mediaStore.paths({ galleryId, imageId: images[0].id, ext: 'jpg' }).orig);
  const res = await getZip(app, token);
  await res.arrayBuffer();
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-disposition'), null);
  assert.match(res.headers.get('content-type'), /^text\/html/);
});

test('zip views are recorded for visitors only, not owner, admin, bots or HEAD', async () => {
  const { owner, token, shareId } = await sharedGallery(app);
  await (await getZip(app, token)).arrayBuffer();
  assert.deepEqual(kinds(shareId), ['zip']);
  await (await getZip(app, token, { cookie: owner.cookie })).arrayBuffer();
  await (await getZip(app, token, { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } })).arrayBuffer();
  const head = await getZip(app, token, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'application/zip');
  assert.deepEqual(kinds(shareId), ['zip']);
});

test('activity: a ZIP download is recorded as zipDownloaded for visitors only', async () => {
  const { owner, galleryId, token } = await sharedGallery(app);
  const zips = () => activityRows(app.context, 'zipDownloaded', galleryId);
  await (await getZip(app, token, { cookie: owner.cookie })).arrayBuffer();
  assert.equal(zips().length, 0);
  await (await getZip(app, token)).arrayBuffer();
  const [event] = zips();
  assert.equal(event.actor_type, 'visitor');
  assert.equal(event.user_agent, BROWSER_UA);
  assert.ok(!JSON.stringify(event).includes(token));
});

test('ZIP download is rate limited separately from the share page', async () => {
  const limited = await startApp({ ...HIGH_LIMITS, RATE_LIMIT_ZIP_MAX: '3' }, { media: 'gs-sharezip-limit-' });
  try {
    const { token, shareId } = await sharedGallery(limited, { count: 1 });
    for (let i = 0; i < 3; i++) {
      const res = await getZip(limited, token);
      await res.arrayBuffer();
      assert.equal(res.status, 200);
    }
    const refused = await getZip(limited, token);
    const html = await refused.text();
    assert.equal(refused.status, 429);
    assert.ok(refused.headers.get('retry-after'));
    assert.ok(html.includes('Too many'));
    const page = await limited.request(PATH_TO.share(token), { headers: { 'user-agent': BROWSER_UA } });
    assert.equal(page.status, 200, 'page limiter unaffected');
    const views = limited.context.shares.views(shareId);
    assert.equal(views.filter((v) => v.kind === 'zip').length, 3, 'refused request not recorded');
  } finally {
    await limited.close();
  }
});

test('no ZIP entry name contains the original filename', async () => {
  const { token } = await sharedGallery(app);
  const res = await getZip(app, token);
  const buffer = Buffer.from(await res.arrayBuffer());
  for (const e of await entriesOf(buffer)) assert.doesNotMatch(e.name, /secret|IMG_/);
  assert.ok(!buffer.includes(Buffer.from('secret-one')));
});

test('a client that aborts mid-download leaves no open stream and no error', async (t) => {
  const { token } = await sharedGallery(app, { count: 2 });
  const opened = [];
  t.mock.method(app.context.mediaStore, 'stream', () => {
    const slow = slowStream();
    opened.push(slow);
    return slow;
  });
  const problems = [];
  const onProblem = (e) => problems.push(e);
  process.on('unhandledRejection', onProblem);
  process.on('uncaughtException', onProblem);
  t.after(() => {
    process.off('unhandledRejection', onProblem);
    process.off('uncaughtException', onProblem);
  });

  const res = await getZip(app, token);
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.ok(value.length > 0, 'first chunk arrived');
  await reader.cancel();

  for (let i = 0; i < 100 && !opened.every((s) => s.destroyed); i++) await setTimeout_(20);
  assert.ok(opened.length >= 1);
  assert.ok(
    opened.every((s) => s.destroyed),
    'every opened stream destroyed',
  );
  await setTimeout_(50);
  assert.deepEqual(problems, []);
  const health = await app.request(PATH_TO.share(token), { headers: { 'user-agent': BROWSER_UA } });
  assert.equal(health.status, 200, 'server still serves');
});
