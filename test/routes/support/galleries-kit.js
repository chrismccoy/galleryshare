import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import { allAttrValues } from '../../helpers/html.js';
import { writeZip } from '../../helpers/zip.js';
import { jobIdFrom, postFiles, tmpFiles as filesIn, uploadGallery } from '../../helpers/uploads.js';
import { rowCount } from '../../helpers/db.js';
import { PATH_TO } from '../../../config/urls.js';

export const NO_USABLE = /The upload has no JPEG, PNG or WebP images\./;

export function galleryKit(state) {
  const galleryCount = () => rowCount(state().app.context.db, 'galleries');
  const tmpFiles = () => filesIn(state().app.context.config.tmpDir);

  function assertNothingStored(before) {
    assert.equal(galleryCount(), before);
    assert.deepEqual(tmpFiles(), []);
  }

  const upload = (session, route, files) => postFiles(state().app, session, route, files);

  let photoTurn = 0;
  const nextPhoto = () => {
    const { photos } = state();
    return photos[photoTurn++ % photos.length];
  };

  const jpegs = (...names) => names.map((name) => ({ name, data: nextPhoto() }));

  async function zipFile(name, entries) {
    const dir = fs.mkdtempSync(path.join(state().app.root, 'zip-'));
    const file = await writeZip(path.join(dir, 'upload.zip'), entries);
    return { name, data: fs.readFileSync(file) };
  }

  const jobOf = (res) => state().app.context.ingestJobs.byId(jobIdFrom(res));

  async function newGallery(session, files = jpegs('a.jpg', 'b.jpg', 'c.jpg')) {
    return (await uploadGallery(state().app, session, files)).galleryId;
  }

  const imageIds = (galleryId) =>
    state()
      .app.context.galleryImages.forGallery(galleryId)
      .map((img) => img.id);

  const originalNames = (galleryId) =>
    state()
      .app.context.galleryImages.forGallery(galleryId)
      .map((img) => img.original_name);

  function reorder(session, galleryId, ids) {
    return state().app.request(PATH_TO.gallery(galleryId, 'reorder'), {
      method: 'POST',
      body: JSON.stringify({ ids }),
      cookie: session.cookie,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': session.csrf },
    });
  }

  const renderedIds = (html) => allAttrValues(html, 'data-image-id').map(Number);

  const spyEntryReads = (t) => t.mock.method(yauzl.ZipFile.prototype, 'openReadStream');

  return {
    galleryCount,
    tmpFiles,
    assertNothingStored,
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
    spyEntryReads,
  };
}
