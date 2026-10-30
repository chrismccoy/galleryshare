import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, capturedOn } from '../../scripts/build-screenshot-gallery.js';
import { BRAND } from '../../config/brand.js';
import { MOBILE_DEVICE } from '../../scripts/shared/screenshot-projects.js';
import { tempDir } from '../helpers/temp.js';

function writeManifest(dir, project, manifest, mtime) {
  const file = path.join(dir, project, 'manifest.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest));
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

test('capturedOn uses the newest capturedAt and falls back to the file date without one', (t) => {
  const dir = tempDir(t, 'galleryshare-gallery-');
  writeManifest(
    dir,
    'desktop',
    { project: 'desktop', capturedAt: '2026-03-04T10:00:00.000Z', shots: [] },
    new Date('2026-09-09T00:00:00Z'),
  );
  assert.equal(capturedOn(dir), '2026-03-04', 'capturedAt wins over the file date');

  writeManifest(dir, 'mobile', { project: 'mobile', shots: [] }, new Date('2026-05-06T12:00:00Z'));
  assert.equal(capturedOn(dir), '2026-05-06', 'a manifest without capturedAt counts with its file date');

  writeManifest(dir, 'mobile', { project: 'mobile', capturedAt: '2026-03-05T08:00:00.000Z', shots: [] });
  assert.equal(capturedOn(dir), '2026-03-05');
});

test('build writes the gallery page from the manifests with the shared card, lightbox and script', (t) => {
  const dir = tempDir(t, 'galleryshare-gallery-');
  writeManifest(dir, 'desktop', {
    capturedAt: '2026-03-04T10:00:00.000Z',
    shots: [
      { file: '01-login.jpg', title: 'Sign in', text: 'The <form> & more', section: 'public' },
      { file: '02-admin.jpg', title: 'Admin', text: 'Overview', section: 'admin' },
      { file: '03-orphan.jpg', title: 'No section', text: 'Left out', section: 'nowhere' },
    ],
  });
  writeManifest(dir, 'mobile', {
    capturedAt: '2026-03-01T10:00:00.000Z',
    shots: [{ file: '01-login.jpg', title: 'Sign in', text: 'Small' }],
  });

  assert.equal(build({ dir }), 3, 'two desktop shots in known sections plus one mobile shot');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal(html.match(/<figure [^>]*data-shot/g).length, 3);
  assert.ok(html.includes('href="desktop/01-login.jpg"') && html.includes('href="mobile/01-login.jpg"'));
  assert.ok(html.includes('data-download="01-login.jpg"'), 'Save keeps the file name');
  assert.ok(html.includes('aspect-[16/10]') && html.includes('aspect-[9/16]'));
  assert.ok(html.includes('The &lt;form&gt; &amp; more'), 'captions are escaped');
  assert.ok(!html.includes('03-orphan.jpg'), 'a shot outside the known sections is left out');
  assert.ok(html.includes(`(${MOBILE_DEVICE})`));
  assert.ok(html.includes('Captured 2026-03-04.'));

  assert.match(html, /<div id="lightbox" hidden [^>]*data-item-label="Screenshot" data-thumb-top>/);
  assert.ok(html.includes('<script src="../js/lightbox.js"></script>'), 'the one lightbox script');
  assert.ok(html.includes('href="../favicon.svg"'), 'favicon relative to public/');
  assert.ok(html.includes('href="../vendor/fontawesome/css/all.min.css"'), 'icons from the app copy');
  assert.ok(html.includes(`<i class="${BRAND.icon}"`), 'the brand icon');
  assert.ok(!html.includes('<svg'), 'no inline icon copies');
  assert.equal(fs.existsSync(path.join(dir, 'gallery.js')), false, 'no script copy');
});

test('build refuses a folder without manifests', (t) => {
  const dir = tempDir(t, 'galleryshare-gallery-');
  assert.throws(() => build({ dir }), /npm run screenshots/);
  assert.equal(fs.existsSync(path.join(dir, 'index.html')), false);
});
