import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  attrsOf,
  countAttr,
  decodeEntities,
  elementByAttr,
  elementsByAttr,
  elementsByTag,
  startApp,
  tagsWith,
  textOf,
} from '../helpers/http.js';
import { distinctJpegs, makePng } from '../helpers/images.js';
import { multipart, withLimits } from '../helpers/uploads.js';
import { MAX_CAPTION, MAX_DESCRIPTION, MAX_TITLE } from '../../domain/limits.js';
import { UPLOAD_ACCEPT } from '../../media/image-types.js';
import { PATHS, PATH_TO } from '../../config/urls.js';
import { galleryKit } from './support/galleries-kit.js';
import { DEFAULT_CAPTION_TEMPLATE } from '../../domain/gallery.js';
import { activityLog } from '../helpers/activity.js';
import { assertSignInRedirect } from '../helpers/assertions.js';

let app;
let photos;
before(async () => {
  app = await startApp({}, { media: 'gs-galleries-' });
  photos = await distinctJpegs(40);
});
after(() => app.close());

const {
  galleryCount,
  tmpFiles,
  upload,
  nextPhoto,
  jpegs,
  zipFile,
  jobOf,
  newGallery,
  imageIds,
  originalNames,
  reorder,
  renderedIds,
} = galleryKit(() => ({ app, photos }));

const ACCEPT = 'image/jpeg,image/png,image/webp,.zip,application/zip';

async function newGalleryPage(t) {
  const session = await app.signedIn();
  withLimits(t, app.context, { maxImageMb: 7 });
  const { res, html } = await app.get(session, PATHS.newGallery);
  assert.equal(res.status, 200);
  return html;
}

test('Add gallery page opens with a compact hero: icon tile, the one h1 and a short lead', async (t) => {
  const html = await newGalleryPage(t);
  const hero = elementByAttr(html, 'data-page-hero');
  assert.ok(hero, 'the hero is drawn');
  assert.deepEqual(elementsByTag(hero, 'h1').map(textOf), ['Add gallery']);
  assert.match(hero, /<i class="fa-solid fa-images" aria-hidden="true">/);
  assert.match(textOf(hero), /Upload images or ZIP files to start a new gallery\./);
  assert.equal(elementsByAttr(html, 'data-page-head').length, 1, 'it replaces the plain heading row');
  assert.ok(!html.includes('mixed as you like'), 'the old intro text is gone');
});

test('other shell pages keep the plain heading row', async () => {
  const session = await app.signedIn();
  const { html } = await app.get(session, PATHS.galleries);
  assert.equal(elementByAttr(html, 'data-page-hero'), null);
  assert.equal(elementsByAttr(html, 'data-page-head').length, 1);
});

test('Add gallery page shows one JS drop zone that posts images and ZIP files to the upload route', async (t) => {
  const html = await newGalleryPage(t);
  assert.deepEqual(elementsByTag(html, 'h1').map(textOf), ['Add gallery']);
  const root = attrsOf(html, 'data-upload-root');
  assert.equal(root.tag, 'div');
  assert.ok('hidden' in root, 'hidden until the script runs');
  const form = attrsOf(html, 'data-upload-form');
  assert.equal(form.tag, 'form');
  assert.equal(form.action, PATHS.newGalleryUpload);
  assert.equal(form.method, 'post');
  assert.equal(form.enctype, 'multipart/form-data');
  assert.deepEqual(
    [form['data-max-image-mb'], form['data-max-zip-mb'], form['data-max-batch-mb']],
    ['7', '500', '1000'],
  );
  assert.doesNotMatch(html, /data-(images|zip)-action/);
  const inputs = tagsWith(html, 'data-upload-input');
  assert.equal(inputs.length, 1, 'one JS-driven file input');
  const input = inputs[0].attrs;
  assert.equal(inputs[0].name, 'input');
  assert.equal(input.type, 'file');
  assert.equal(input.name, 'files');
  assert.ok('multiple' in input);
  assert.equal(input.accept, ACCEPT);
  assert.equal(input.accept, UPLOAD_ACCEPT);
  assert.ok(elementByAttr(elementByAttr(html, 'data-upload-form'), 'data-upload-input'), 'the input is in the form');
  assert.equal(countAttr(html, 'data-drop-zone'), 1);
  assert.ok(elementByAttr(elementByAttr(html, 'data-drop-zone'), 'data-upload-input'), 'the input is in the zone');
});

test('Add gallery page states the effective limits in the drop zone help', async (t) => {
  const zone = textOf(elementByAttr(await newGalleryPage(t), 'data-drop-zone'));
  assert.match(zone, /Mix images and \.zip files/);
  assert.match(zone, /up to 7 MB each/);
  assert.match(zone, /ZIP files: up to 500 MB each/);
  assert.match(zone, /1000 MB per upload/);
  assert.match(zone, /500 images per gallery/);
});

test('Add gallery page keeps a plain form for browsers without JavaScript', async (t) => {
  const html = await newGalleryPage(t);
  const noscripts = elementsByTag(html, 'noscript');
  assert.equal(noscripts.length, 1);
  const [noscript] = noscripts;
  const plain = attrsOf(noscript, 'action');
  assert.equal(plain.tag, 'form');
  assert.equal(plain.action, PATHS.newGalleryUpload);
  assert.equal(plain.enctype, 'multipart/form-data');
  const input = attrsOf(noscript, 'id', 'upload-files-plain');
  assert.equal(input.tag, 'input');
  assert.equal(input.type, 'file');
  assert.equal(input.name, 'files');
  assert.ok('multiple' in input);
  assert.equal(input.accept, ACCEPT);
  assert.equal(attrsOf(noscript, 'for', 'upload-files-plain')?.tag, 'label');
  assert.doesNotMatch(html, /needs JavaScript/);
});

test('Add gallery page is accessible, loads its script from a file and marks the nav link', async (t) => {
  const html = await newGalleryPage(t);
  assert.equal(attrsOf(html, 'for', 'upload-files')?.tag, 'label');
  assert.equal(attrsOf(html, 'id', 'upload-files')?.['data-upload-input'], '', 'the label names the JS input');
  assert.equal(textOf(elementByAttr(html, 'data-upload-pick')), 'Choose files');
  const form = elementByAttr(html, 'data-upload-form');
  assert.ok(tagsWith(form, 'aria-live', 'polite').length >= 1, 'a polite live region in the form');
  assert.doesNotMatch(html, /\son(click|change|drop)=/);
  const script = attrsOf(html, 'src', '/js/gallery-upload.js');
  assert.equal(script?.tag, 'script');
  assert.ok(
    html.indexOf('/js/gallery-upload-rules.js') > 0 &&
      html.indexOf('/js/gallery-upload-rules.js') < html.indexOf('/js/gallery-upload.js'),
    'the rules load before the drop zone script',
  );
  const current = elementsByAttr(html, 'aria-current', 'page').map(textOf);
  assert.ok(current.length >= 1);
  for (const text of current) assert.equal(text, 'Add gallery');
});

test('uploading 3 images redirects to the job page, then to the edit view with 3 rows in natural order', async () => {
  const session = await app.signedIn();
  const before = galleryCount();
  const res = await upload(session, PATHS.newGalleryUpload, jpegs('img10.jpg', 'img2.jpg', 'img1.jpg'));
  assert.equal(res.status, 303);
  const jobPath = res.headers.get('location');
  assert.match(jobPath, new RegExp(`^${PATHS.ingestJobs}/\\d+$`));
  assert.equal(galleryCount(), before + 1);
  await app.context.ingestService.idle();

  const job = await app.request(jobPath, { cookie: session.cookie });
  assert.equal(job.status, 303);
  const galleryId = jobOf(res).gallery_id;
  assert.equal(job.headers.get('location'), `${PATH_TO.gallery(galleryId)}?notice=added`);

  const { res: edit, html } = await app.get(session, job.headers.get('location'));
  assert.equal(edit.status, 200);
  assert.match(
    textOf(elementByAttr(html, 'role', 'status')),
    /^Images added and saved\. .*Save gallery appears once you change something\.$/,
    'the notice says the images are already saved',
  );
  assert.equal(renderedIds(html).length, 3);
  assert.deepEqual(originalNames(galleryId), ['img1.jpg', 'img2.jpg', 'img10.jpg']);
  assert.deepEqual(renderedIds(html), imageIds(galleryId));
  assert.deepEqual(elementsByTag(html, 'h1').map(textOf), ['Untitled gallery']);
  const list = elementByAttr(html, 'data-reorder-list');
  assert.ok(list, 'the reorder list');
  assert.deepEqual(
    tagsWith(list, 'data-image-id').map(
      (tag) => attrsOf(elementByAttr(list, 'data-image-id', tag.attrs['data-image-id']), 'src').src,
    ),
    imageIds(galleryId).map((id) => PATH_TO.media(id, 'thumb')),
    'each row shows its own thumbnail',
  );
  assert.equal(attrsOf(html, 'src', '/js/reorder.js')?.tag, 'script');
  assert.equal(attrsOf(html, 'src', '/js/save-bar.js')?.tag, 'script');
  assert.ok(html.includes(`action="${PATH_TO.gallery(galleryId, 'upload')}"`), 'add images form');
  assert.deepEqual(tmpFiles(), []);
});

test('a finished job that added no image (all skipped) goes to the edit view without the "added" notice', async () => {
  const session = await app.signedIn();
  const galleryId = app.context.galleries.insert({ userId: session.user.id });
  const jobs = app.context.ingestJobs;
  const jobId = jobs.insert({ userId: session.user.id, galleryId, total: 2 });
  jobs.progress(jobId, 2, [
    { name: 'a.jpg', reason: 'Already in this gallery.' },
    { name: 'b.jpg', reason: 'Already in this gallery.' },
  ]);
  jobs.setDone(jobId);
  const job = await app.request(PATH_TO.ingestJob(jobId), { cookie: session.cookie });
  assert.equal(job.status, 303);
  assert.equal(job.headers.get('location'), PATH_TO.gallery(galleryId));
});

test('the edit view caps its text fields at the service limits from domain/limits.js', async () => {
  const session = await app.signedIn();
  const galleryId = app.context.galleries.insert({ userId: session.user.id });
  await upload(session, PATH_TO.gallery(galleryId, 'upload'), jpegs('a.jpg'));
  await app.context.ingestService.idle();
  const { res, html } = await app.get(session, PATH_TO.gallery(galleryId));
  assert.equal(res.status, 200);
  const field = (id) => {
    const attrs = attrsOf(html, 'id', id);
    return [attrs?.tag, attrs?.name, attrs?.type, attrs?.maxlength];
  };
  const [imageId] = imageIds(galleryId);
  assert.deepEqual(field('gallery-title'), ['input', 'title', 'text', String(MAX_TITLE)]);
  assert.deepEqual(field('gallery-description'), ['textarea', 'description', undefined, String(MAX_DESCRIPTION)]);
  assert.deepEqual(field(`title-${imageId}`), ['input', `images[${imageId}][title]`, 'text', String(MAX_TITLE)]);
  assert.deepEqual(field(`caption-${imageId}`), ['input', `images[${imageId}][caption]`, 'text', String(MAX_CAPTION)]);
});

test('the job page shows progress and refreshes while the job is waiting', async () => {
  const session = await app.signedIn();
  const galleryId = app.context.galleries.insert({ userId: session.user.id });
  const jobId = app.context.ingestJobs.insert({ userId: session.user.id, galleryId, total: 4 });
  app.context.ingestJobs.setRunning(jobId);
  app.context.ingestJobs.progress(jobId, 1, []);
  const { res, html } = await app.get(session, PATH_TO.ingestJob(jobId));
  assert.equal(res.status, 200);
  assert.match(html, /Processed 1 of 4/);
  assert.match(html, /<meta http-equiv="refresh" content="3"/);

  const edit = await app.get(session, PATH_TO.gallery(galleryId));
  assert.match(edit.html, /Still processing 1 of 4/);
  assert.ok(edit.html.includes(`href="${PATH_TO.ingestJob(jobId)}"`));

  const uploadSkips = Array.from({ length: 5 }, (_, i) => ({ name: `z.zip/${i}.jpg`, reason: 'x', atUpload: true }));
  app.context.ingestJobs.progress(jobId, 3, uploadSkips);
  app.context.ingestJobs.setFailed(jobId, 'Interrupted by restart. Upload the remaining images again.');
  const failed = await app.get(session, PATH_TO.ingestJob(jobId));
  assert.match(failed.html, /The images added before this stopped are kept\./);
  assert.match(failed.html, /Not added \(5 files\):/);
  assert.equal(failed.res.status, 200);
  assert.doesNotMatch(failed.html, /http-equiv="refresh"/);
  assert.match(failed.html, /Interrupted by restart/);
  assert.ok(failed.html.includes(`href="${PATH_TO.gallery(galleryId)}"`));
  const after = await app.get(session, PATH_TO.gallery(galleryId));
  assert.doesNotMatch(after.html, /Still processing/);

  const other = await app.signedIn();
  assert.equal((await app.get(other, PATH_TO.ingestJob(jobId))).res.status, 404);
});

test('creating a gallery by upload and saving its edits are recorded in Activity, with what changed', async () => {
  const session = await app.signedIn();
  const events = (id) =>
    activityLog(app.context, { galleryId: id }).map((row) => [row.kind, row.gallery_title, row.details]);
  const galleryId = await newGallery(session);
  assert.deepEqual(events(galleryId), [
    ['galleryCreated', 'Untitled gallery', null],
    ['imagesAdded', 'Untitled gallery', '3 added'],
  ]);

  const [first, second] = imageIds(galleryId);
  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Holiday',
    description: 'Beach days',
    allow_zip: 'on',
    grid_text: 'hide',
    [`images[${first}][title]`]: 'Sunset',
    [`images[${second}][caption]`]: 'Low tide',
  });
  assert.equal(saved.res.status, 303);
  assert.deepEqual(events(galleryId).at(-1), [
    'galleryDetailsChanged',
    'Holiday',
    'title, description, ZIP download, grid text, 2 image texts',
  ]);

  const again = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Holiday',
    description: 'Beach days',
    allow_zip: 'on',
    grid_text: 'hide',
  });
  assert.equal(again.res.status, 303);
  assert.equal(events(galleryId).length, 3, 'saving with nothing changed records nothing');

  const mine = await app.get(session, PATHS.activity);
  for (const text of ['Gallery created', 'Images added', 'Gallery details changed']) {
    assert.match(mine.html, new RegExp(text), `${text} on My activity`);
  }
});

test('Move to Trash, restore, delete forever and Empty Trash are recorded in Activity through the routes', async () => {
  const session = await app.signedIn();
  const kinds = (id) =>
    activityLog(app.context, { galleryId: id })
      .map((row) => row.kind)
      .filter((kind) => kind !== 'galleryCreated' && kind !== 'imagesAdded');
  const post = async (path) => assert.equal((await app.post(session, path, {})).res.status, 303, path);

  const kept = await newGallery(session);
  await post(PATH_TO.gallery(kept, 'delete'));
  await post(PATH_TO.trashItem(kept, 'restore'));
  assert.deepEqual(kinds(kept), ['galleryTrashed', 'galleryRestored']);

  const gone = await newGallery(session);
  await post(PATH_TO.gallery(gone, 'delete'));
  await post(PATH_TO.trashItem(gone, 'purge'));
  assert.deepEqual(kinds(gone), ['galleryTrashed', 'galleryDeleted']);
  assert.equal(app.context.galleries.byIdIncludingTrashed(gone), null, 'deleted for good');

  const emptied = await newGallery(session);
  await post(PATH_TO.gallery(emptied, 'delete'));
  await post(PATHS.trashEmpty);
  assert.deepEqual(kinds(emptied), ['galleryTrashed']);
  const [empty] = activityLog(app.context, { personId: session.user.id, kinds: ['trashEmptied'] });
  assert.equal(empty.details, '1 gallery');

  const mine = await app.get(session, PATHS.activity);
  for (const text of ['Moved to Trash', 'Gallery restored', 'Gallery deleted', 'Trash emptied']) {
    assert.match(mine.html, new RegExp(text), `${text} on My activity`);
  }
});

test('Save gallery deletes the images marked with Delete, with their files, together with the other edits', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first, second, third] = imageIds(galleryId);
  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Trimmed',
    [`images[${first}][title]`]: 'Typed then deleted',
    [`images[${first}][remove]`]: 'on',
    [`images[${second}][caption]`]: 'Kept',
    [`images[${third}][remove]`]: 'on',
  });
  assert.equal(saved.res.status, 303);
  assert.match(saved.res.headers.get('location'), /notice=saved/);
  assert.deepEqual(imageIds(galleryId), [second], 'only the unmarked image is left');
  assert.equal(app.context.galleryImages.byId(second).caption, 'Kept');
  assert.equal(app.context.galleries.liveById(galleryId).title, 'Trimmed');
  assert.equal(app.context.galleryImages.byId(first), null);
  const media = await app.request(PATH_TO.media(first, 'thumb'), { cookie: session.cookie });
  assert.equal(media.status, 404, 'the deleted image is gone for good');

  const events = activityLog(app.context, { galleryId, kinds: ['imageRemoved', 'galleryDetailsChanged'] }).map(
    (row) => [row.kind, row.details],
  );
  assert.deepEqual(events, [
    ['galleryDetailsChanged', 'title, 1 image text'],
    ['imageRemoved', 'Image #1'],
    ['imageRemoved', 'Image #3'],
  ]);
});

test('a refused save deletes nothing and keeps the Delete marks on the page', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first] = imageIds(galleryId);
  const refused = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'x'.repeat(MAX_TITLE + 1),
    [`images[${first}][remove]`]: 'on',
  });
  assert.equal(refused.res.status, 400);
  assert.equal(imageIds(galleryId).length, 3, 'nothing deleted');
  assert.ok('checked' in attrsOf(refused.html, 'name', `images[${first}][remove]`), 'the mark is kept');
});

test('share theme on the edit view: Site default plus every theme as buttons; saved, refused when unknown, and recorded', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  const buttons = tagsWith(html, 'name', 'share_theme');
  assert.deepEqual(
    buttons.map((tag) => [tag.attrs.type, tag.attrs.value, 'checked' in tag.attrs]),
    [
      ['radio', 'default', true],
      ['radio', 'none', false],
      ['radio', 'frame', false],
      ['radio', 'dark-wall', false],
      ['radio', 'app-window', false],
      ['radio', 'polaroid', false],
      ['radio', 'glass', false],
      ['radio', 'paper-stack', false],
    ],
  );
  assert.ok(html.includes('Site default (None)'));
  assert.ok(
    buttons.every((tag) => !('form' in tag.attrs)),
    'inside the Details form itself, so Save gallery sends them',
  );

  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Themed',
    share_theme: 'polaroid',
  });
  assert.equal(saved.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).share_theme, 'polaroid');
  const [last] = app.context.activity.list({ galleryId, limit: 1 });
  assert.equal(last.details, 'title, theme');
  const shown = (await app.get(session, PATH_TO.gallery(galleryId))).html;
  assert.equal(tagsWith(shown, 'name', 'share_theme').find((tag) => 'checked' in tag.attrs).attrs.value, 'polaroid');

  const bad = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Themed', share_theme: 'neon' });
  assert.equal(bad.res.status, 400);
  assert.match(bad.html, /Choose a share theme/);
  assert.equal(app.context.galleries.liveById(galleryId).share_theme, 'polaroid', 'nothing saved');

  const back = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Themed', share_theme: 'default' });
  assert.equal(back.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).share_theme, null);
  await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Themed', share_theme: 'frame' });
  const kept = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Themed' });
  assert.equal(kept.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).share_theme, 'frame', 'a save without the field keeps it');
});

test('image view on the edit view: Site default plus the three views; saved, refused when unknown, recorded', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  assert.deepEqual(
    tagsWith(html, 'name', 'share_image_view').map((tag) => [tag.attrs.value, 'checked' in tag.attrs]),
    [
      ['default', true],
      ['lightbox', false],
      ['new-tab', false],
      ['page', false],
    ],
  );
  assert.ok(html.includes('Site default (Lightbox)'));
  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Viewed',
    share_image_view: 'page',
  });
  assert.equal(saved.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).image_view, 'page');
  assert.equal(app.context.activity.list({ galleryId, limit: 1 })[0].details, 'title, image view');
  const bad = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Viewed',
    share_image_view: 'popup',
  });
  assert.equal(bad.res.status, 400);
  assert.match(bad.html, /Choose an image view/);
  assert.equal(app.context.galleries.liveById(galleryId).image_view, 'page', 'nothing saved');
});

test('edit view shows placeholders "Title" and "Image #2" for blank fields', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  assert.match(html, /placeholder="Untitled gallery"/);
  assert.match(html, /placeholder="Title"/);
  assert.match(html, /placeholder="Image #1"/);
  assert.match(html, /placeholder="Image #2"/);
  assert.match(html, /placeholder="Image #3"/);
  assert.equal(
    attrsOf(html, 'data-reorder-list')['data-caption-template'],
    DEFAULT_CAPTION_TEMPLATE,
    'reorder.js gets the caption template from the page',
  );
});

test('saving gallery details and an image title/caption stores them and shows them', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const meta = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Holiday',
    description: 'Beach days',
    allow_zip: 'on',
  });
  assert.equal(meta.res.status, 303);
  const gallery = app.context.galleries.liveById(galleryId);
  assert.deepEqual([gallery.title, gallery.description, gallery.allow_zip], ['Holiday', 'Beach days', 1]);

  const [first] = imageIds(galleryId);
  const image = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Holiday',
    description: 'Beach days',
    allow_zip: 'on',
    [`images[${first}][title]`]: 'Sunset',
    [`images[${first}][caption]`]: '',
  });
  assert.equal(image.res.status, 303);
  const row = app.context.galleryImages.byId(first);
  assert.deepEqual([row.title, row.caption], ['Sunset', null]);

  const { html } = await app.get(session, image.res.headers.get('location'));
  assert.deepEqual(elementsByTag(html, 'h1').map(textOf), ['Holiday']);
  assert.equal(attrsOf(html, 'id', `title-${first}`).value, 'Sunset');
  assert.equal(textOf(elementByAttr(html, 'id', 'gallery-description')), 'Beach days');
  const allowZip = attrsOf(html, 'name', 'allow_zip');
  assert.equal(allowZip.value, 'on');
  assert.ok('checked' in allowZip);
});

test('the grid text choice: three buttons with Site default chosen, a saved choice checked, an unknown one refused', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  const radios = tagsWith(html, 'name', 'grid_text');
  assert.deepEqual(
    radios.map((tag) => [tag.name, tag.attrs.type, tag.attrs.value, 'checked' in tag.attrs]),
    [
      ['input', 'radio', 'default', true],
      ['input', 'radio', 'show', false],
      ['input', 'radio', 'hide', false],
    ],
    'three radio buttons, site default chosen',
  );
  assert.equal(
    textOf(elementsByTag(elementByAttr(html, 'data-choice-buttons', 'grid_text'), 'legend')[0]),
    'Titles and captions on the grid',
  );
  assert.ok(html.includes('Site default (Shown)'));
  const hide = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Holiday', grid_text: 'hide' });
  assert.equal(hide.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).grid_text, 0);
  const hidden = (await app.get(session, PATH_TO.gallery(galleryId))).html;
  const checked = tagsWith(hidden, 'name', 'grid_text').find((tag) => 'checked' in tag.attrs);
  assert.equal(checked.attrs.value, 'hide');
  const bad = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Holiday', grid_text: 'loud' });
  assert.equal(bad.res.status, 400);
  assert.ok(bad.html.includes('Choose how the gallery grid shows titles and captions.'));
  assert.equal(app.context.galleries.liveById(galleryId).grid_text, 0, 'nothing saved');
});

test('a Save without allow_zip turns the ZIP download off', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Holiday', allow_zip: 'on' });
  assert.equal(app.context.galleries.liveById(galleryId).allow_zip, 1);
  const off = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'Holiday', description: '' });
  assert.equal(off.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).allow_zip, 0);
});

test('a title over MAX_TITLE is refused with its limit named', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const tooLong = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'x'.repeat(MAX_TITLE + 1) });
  assert.equal(tooLong.res.status, 400);
  assert.ok(tooLong.html.includes(`Title can be at most ${MAX_TITLE} characters.`));
});

test('the gallery Save also saves the image titles and captions sent with it', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first, second] = imageIds(galleryId);
  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Holiday',
    [`images[${first}][title]`]: 'Pier',
    [`images[${second}][caption]`]: 'Late',
  });
  assert.equal(saved.res.status, 303);
  assert.equal(app.context.galleries.liveById(galleryId).title, 'Holiday');
  assert.equal(app.context.galleryImages.byId(first).title, 'Pier');
  assert.equal(app.context.galleryImages.byId(second).caption, 'Late');
});

test('a refused gallery Save shows the error and keeps what was typed', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first, second] = imageIds(galleryId);
  const refused = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), {
    title: 'Typed title',
    description: 'Typed description',
    [`images[${first}][title]`]: 'Typed image title',
    [`images[${second}][caption]`]: 'x'.repeat(MAX_CAPTION + 1),
  });
  assert.equal(refused.res.status, 400);
  assert.ok(refused.html.includes('Image #2: Caption can be at most 1000 characters.'));
  assert.equal(attrsOf(refused.html, 'id', 'gallery-title').value, 'Typed title');
  assert.equal(textOf(elementByAttr(refused.html, 'id', 'gallery-description')), 'Typed description');
  assert.equal(attrsOf(refused.html, 'id', `title-${first}`).value, 'Typed image title');
  assert.equal(app.context.galleries.liveById(galleryId).title, null, 'nothing saved');
  assert.equal(app.context.galleryImages.byId(first).title, null);
});

test('images have no save of their own: the edit view has the save bar, and the old address is gone', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first] = imageIds(galleryId);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  assert.equal(tagsWith(html, 'data-save-image').length, 0, 'no Save on the rows');
  const bar = attrsOf(html, 'data-save-bar', 'gallery-details');
  assert.ok(bar && 'hidden' in bar, 'the save bar starts hidden');
  const saves = tagsWith(html, 'form', 'gallery-details').filter((tag) => tag.name === 'button');
  assert.equal(saves.length, 2, 'the save bar and the fallback below the images submit the Details form');
  const noscripts = elementsByTag(html, 'noscript').filter((block) => block.includes('Save gallery'));
  assert.equal(noscripts.length, 2, 'without JavaScript, Details and the image list each show a Save gallery');
  const details = elementByAttr(html, 'id', 'gallery-details');
  assert.ok(
    !details.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').includes('Save gallery'),
    'with JavaScript, the bar is the only Save gallery',
  );
  const gone = await app.post(session, PATH_TO.galleryImage(galleryId, first), { title: 'Nope' });
  assert.equal(gone.res.status, 404);
  assert.equal(app.context.galleryImages.byId(first).title, null);
});

test('a signed-in gallery Save may be larger than the usual form limit; an anonymous one is refused', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first] = imageIds(galleryId);
  const fields = { title: 'Big' };
  for (let i = 0; i < 1200; i++) fields[`images[${900000 + i}][caption]`] = 'x'.repeat(100);
  fields[`images[${first}][title]`] = 'Still saved';
  const saved = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), fields);
  assert.equal(saved.res.status, 303);
  assert.equal(app.context.galleryImages.byId(first).title, 'Still saved');

  const anonymous = await app.request(PATH_TO.gallery(galleryId, 'meta'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  assert.equal(anonymous.status, 413, 'the usual limit applies before sign-in is known');
});

test('reorder POST with the current ids returns 204 and the new order renders', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const reversed = imageIds(galleryId).reverse();
  const res = await reorder(session, galleryId, reversed);
  assert.equal(res.status, 204);
  assert.deepEqual(imageIds(galleryId), reversed);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  assert.deepEqual(renderedIds(html), reversed);

  const strings = await reorder(session, galleryId, reversed.map(String).reverse());
  assert.equal(strings.status, 204, 'digit strings are coerced');

  for (const bad of [[1.5], 'nope', [true], null]) {
    const res400 = await reorder(session, galleryId, bad);
    assert.equal(res400.status, 400, JSON.stringify(bad));
  }
  const noCsrf = await app.request(PATH_TO.gallery(galleryId, 'reorder'), {
    method: 'POST',
    body: JSON.stringify({ ids: reversed }),
    cookie: session.cookie,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
  });
  assert.equal(noCsrf.status, 403);
});

test('reorder POST with stale ids returns 409 and the message', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const ids = imageIds(galleryId);
  const res = await reorder(session, galleryId, ids.slice(1));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'This gallery changed. Reload and try again.' });
  assert.deepEqual(imageIds(galleryId), ids);
});

test('remove image renumbers captions (old #3 shows as Image #2)', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [, second, third] = imageIds(galleryId);
  const res = await app.post(session, PATH_TO.galleryImage(galleryId, second, 'remove'));
  assert.equal(res.res.status, 303);
  assert.deepEqual(imageIds(galleryId).length, 2);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  const row = elementByAttr(html, 'data-image-id', String(third));
  assert.equal(attrsOf(row, 'data-default-caption').placeholder, 'Image #2');
  assert.doesNotMatch(html, /Image #3/);
  assert.match(html, /data-confirm-open/);
});

test('remove image still redirects when its files cannot be removed', async (t) => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const [first] = imageIds(galleryId);
  t.mock.method(app.context.mediaStore, 'removeImage', async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  });
  const res = await app.post(session, PATH_TO.galleryImage(galleryId, first, 'remove'));
  assert.equal(res.res.status, 303);
  assert.equal(imageIds(galleryId).includes(first), false);
});

test('moving a gallery to Trash hides its edit view', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg'));
  const res = await app.post(session, PATH_TO.gallery(galleryId, 'delete'));
  assert.equal(res.res.status, 303);
  assert.ok(app.context.galleries.byIdIncludingTrashed(galleryId).deleted_at);
  assert.equal((await app.get(session, PATH_TO.gallery(galleryId))).res.status, 404);
});

test('another user gets 404 on the edit view, every action and /media', async () => {
  const owner = await app.signedIn();
  const galleryId = await newGallery(owner);
  const [imageId] = imageIds(galleryId);
  const other = await app.signedIn();

  assert.equal((await app.get(other, PATH_TO.gallery(galleryId))).res.status, 404);
  for (const action of ['meta', 'delete']) {
    const { res } = await app.post(other, PATH_TO.gallery(galleryId, action), { title: 'Hacked' });
    assert.equal(res.status, 404, action);
  }
  for (const path of [PATH_TO.galleryImage(galleryId, imageId), PATH_TO.galleryImage(galleryId, imageId, 'remove')]) {
    const { res } = await app.post(other, path, { title: 'Hacked' });
    assert.equal(res.status, 404, path);
  }
  assert.equal((await reorder(other, galleryId, imageIds(galleryId))).status, 404);
  const added = await upload(other, PATH_TO.gallery(galleryId, 'upload'), jpegs('x.jpg'));
  assert.equal(added.status, 404);
  const zip = await upload(other, PATH_TO.gallery(galleryId, 'upload'), [
    await zipFile('x.zip', [{ name: 'x.jpg', data: nextPhoto() }]),
  ]);
  assert.equal(zip.status, 404);
  for (const size of ['thumb', 'web']) {
    assert.equal(await app.status(PATH_TO.media(imageId, size), { cookie: other.cookie }), 404, size);
  }

  const gallery = app.context.galleries.liveById(galleryId);
  assert.equal(gallery.title, null);
  assert.equal(gallery.deleted_at, null);
  assert.equal(imageIds(galleryId).length, 3);
  assert.equal(app.context.galleryImages.byId(imageId).title, null);
  assert.deepEqual(tmpFiles(), []);
});

test('admin can open and edit another user\'s gallery; owner then sees "Edited by an admin"', async () => {
  const owner = await app.signedIn();
  const galleryId = await newGallery(owner, jpegs('a.jpg', 'b.jpg'));
  assert.doesNotMatch((await app.get(owner, PATH_TO.gallery(galleryId))).html, /Edited by an admin/);
  assert.doesNotMatch((await app.get(owner, PATHS.galleries)).html, /Edited by an admin/);

  const admin = await app.signedIn({ role: 'admin' });
  assert.equal((await app.get(admin, PATH_TO.gallery(galleryId))).res.status, 200);
  const [first, second] = imageIds(galleryId);
  assert.equal((await app.post(admin, PATH_TO.gallery(galleryId, 'meta'), { title: 'Checked' })).res.status, 303);
  assert.equal((await reorder(admin, galleryId, [second, first])).status, 204);
  assert.equal((await app.post(admin, PATH_TO.galleryImage(galleryId, first, 'remove'))).res.status, 303);
  assert.equal(await app.status(PATH_TO.media(second, 'thumb'), { cookie: admin.cookie }), 200);

  const added = await upload(admin, PATH_TO.gallery(galleryId, 'upload'), [
    ...jpegs('z.jpg'),
    await zipFile('more.zip', [{ name: 'y.jpg', data: nextPhoto() }]),
  ]);
  assert.equal(added.status, 303);
  await app.context.ingestService.idle();
  assert.equal(imageIds(galleryId).length, 3);

  const { html } = await app.get(owner, PATH_TO.gallery(galleryId));
  assert.deepEqual(elementsByTag(html, 'h1').map(textOf), ['Checked']);
  assert.equal(textOf(elementByAttr(html, 'data-edited-by-admin')), 'Edited by an admin');

  const untouched = await newGallery(owner, jpegs('c.jpg'));
  const list = (await app.get(owner, PATHS.galleries)).html;
  const rowOf = (id) => {
    const rows = elementsByAttr(list, 'data-gallery-row').filter(
      (row) => tagsWith(row, 'href', PATH_TO.gallery(id)).length,
    );
    assert.equal(rows.length, 1, `one row links gallery ${id}`);
    return rows[0];
  };
  assert.equal(textOf(elementByAttr(rowOf(galleryId), 'data-edited-by-admin')), 'Edited by an admin');
  assert.doesNotMatch(rowOf(untouched), /Edited by an admin/);
  assert.equal(countAttr(rowOf(untouched), 'data-edited-by-admin'), 0);
});

test('skipped files are listed once on the edit view after the job finishes', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, [
    { name: 'good.jpg', data: nextPhoto() },
    { name: 'notes <b>.jpg', data: Buffer.from('not an image') },
  ]);
  assert.equal(imageIds(galleryId).length, 1);
  const first = await app.get(session, PATH_TO.gallery(galleryId));
  assert.match(first.html, /notes &lt;b&gt;\.jpg/);
  assert.match(decodeEntities(first.html), /Use a JPEG, PNG or WebP photo\./);
  const second = await app.get(session, PATH_TO.gallery(galleryId));
  assert.doesNotMatch(second.html, /notes &lt;b&gt;\.jpg/);
});

test('a HEAD request or a refused form post does not use up the skipped-files notice', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, [
    { name: 'good.jpg', data: nextPhoto() },
    { name: 'broken.jpg', data: Buffer.from('not an image') },
  ]);
  const head = await app.request(PATH_TO.gallery(galleryId), { method: 'HEAD', cookie: session.cookie });
  assert.equal(head.status, 200);
  const refusedMeta = await app.post(session, PATH_TO.gallery(galleryId, 'meta'), { title: 'x'.repeat(MAX_TITLE + 1) });
  assert.equal(refusedMeta.res.status, 400);
  const refusedUpload = await upload(session, PATH_TO.gallery(galleryId, 'upload'), []);
  assert.equal(refusedUpload.status, 422);
  await refusedUpload.arrayBuffer();
  const shown = await app.get(session, PATH_TO.gallery(galleryId));
  assert.match(shown.html, /broken\.jpg/, 'the first GET still shows the notice');
  const again = await app.get(session, PATH_TO.gallery(galleryId));
  assert.doesNotMatch(again.html, /broken\.jpg/, 'and only that GET uses it up');
});

test('adding images to an existing gallery appends them', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session, jpegs('a.jpg'));
  const res = await upload(session, PATH_TO.gallery(galleryId, 'upload'), [
    { name: 'b.png', data: await makePng({ width: 20, height: 20 }) },
  ]);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), new RegExp(`^${PATHS.ingestJobs}/\\d+$`));
  await app.context.ingestService.idle();
  assert.deepEqual(originalNames(galleryId), ['a.jpg', 'b.png']);
});

test('adding to an existing gallery works for the owner and an admin; the old routes are gone', async () => {
  const owner = await app.signedIn();
  const galleryId = await newGallery(owner, jpegs('a.jpg'));
  const own = await upload(owner, PATH_TO.gallery(galleryId, 'upload'), [
    await zipFile('z.zip', jpegs('b.jpg')),
    ...jpegs('c.jpg'),
  ]);
  assert.equal(own.status, 303);
  await app.context.ingestService.idle();
  assert.deepEqual(originalNames(galleryId), ['a.jpg', 'c.jpg', 'b.jpg']);
  const admin = await app.signedIn({ role: 'admin' });
  const byAdmin = await upload(admin, PATH_TO.gallery(galleryId, 'upload'), [await zipFile('y.zip', jpegs('d.jpg'))]);
  assert.equal(byAdmin.status, 303);
  await app.context.ingestService.idle();
  assert.equal(imageIds(galleryId).length, 4);

  for (const route of [
    `${PATHS.newGallery}/images`,
    `${PATHS.newGallery}/zip`,
    PATH_TO.gallery(galleryId, 'images'),
    PATH_TO.gallery(galleryId, 'zip'),
  ]) {
    const body = multipart([{ name: 'x.jpg', data: nextPhoto() }], { field: 'images' });
    const status = await app.status(route, { body, cookie: owner.cookie, headers: { 'x-csrf-token': owner.csrf } });
    assert.equal(status, 404, route);
  }
  assert.equal(imageIds(galleryId).length, 4);
  assert.deepEqual(tmpFiles(), []);
});

test('the gallery pages are signed-in only and a malformed id is 404', async () => {
  for (const pathname of [PATHS.newGallery, PATH_TO.gallery(1), PATH_TO.ingestJob(1)]) {
    await assertSignInRedirect(app, pathname);
  }
  const session = await app.signedIn();
  for (const bad of ['abc', '0', '1.5', '007']) {
    assert.equal((await app.get(session, PATH_TO.gallery(bad))).res.status, 404, bad);
    assert.equal((await app.get(session, PATH_TO.ingestJob(bad))).res.status, 404, bad);
    assert.equal((await app.post(session, PATH_TO.gallery(bad, 'meta'))).res.status, 404, bad);
    assert.equal((await app.post(session, PATH_TO.galleryImage(1, bad))).res.status, 404, bad);
  }
});

test('the edit view: Move to Trash carries no tooltip, and the gallery title leaks into no button', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  app.context.galleries.updateMeta(galleryId, { title: 'Lisbon tooltip', description: '', allowZip: false });
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  for (const tag of tagsWith(html, 'data-confirm-open')) {
    assert.notEqual(tag.attrs.title, 'Lisbon tooltip', 'no button takes the gallery title as its tooltip');
  }
  assert.ok(tagsWith(html, 'data-confirm-open').length >= 1);
});

test('every card of the edit view has a heading, so screen readers can move between them', async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const { html } = await app.get(session, PATH_TO.gallery(galleryId));
  const headings = elementsByTag(html, 'h2').map((h2) => textOf(h2).trim());
  for (const card of ['Details', 'Images', 'Share link', 'Images and ZIP files', 'Delete']) {
    assert.ok(headings.includes(card), `${card} is a heading`);
  }
});

test("the Delete card says the gallery goes to your Trash, or to the owner's when an admin edits it", async () => {
  const session = await app.signedIn();
  const galleryId = await newGallery(session);
  const admin = await app.signedIn({ role: 'admin' });
  const own = decodeEntities((await app.get(session, PATH_TO.gallery(galleryId))).html);
  const other = decodeEntities((await app.get(admin, PATH_TO.gallery(galleryId))).html);
  assert.match(own, /moves to your Trash/);
  assert.match(other, /moves to the owner's Trash/);
});
