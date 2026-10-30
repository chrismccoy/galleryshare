import fs from 'node:fs';
import path from 'node:path';
import { SCREENSHOTS_DIR } from '../../../config/root.js';
import {
  ADMIN,
  USERS,
  adminUserPath,
  createInvite,
  deleteImages,
  deleteToggle,
  dropZone,
  expect,
  imageRows,
  saveBar,
  saveDetails,
  setImageText,
  shareGallery,
  signIn,
  test,
  unique,
  uploadImages,
} from '../support/fixtures.js';
import { textFile } from '../support/images.js';
import { zipFile } from '../support/zip.js';
import { CAPTIONS } from '../../../scripts/shared/screenshot-captions.js';
import { SHARE_THEMES } from '../../../domain/share-themes.js';
import { demoUploadFiles } from '../../../scripts/shared/demo-images.js';
import { PATHS, PATH_TO } from '../../../config/urls.js';

const OUT_ROOT = SCREENSHOTS_DIR;

const PLACES = ['Alfama', 'Tram 28', 'Miradouro', 'Belém', 'Cais do Sodré', 'LX Factory', 'Graça', 'Tagus'];

const scenes = (count, { prefix = 'IMG', ...size } = {}) =>
  demoUploadFiles(count, { ...size, name: cameraNames(prefix) });

function cameraNames(prefix) {
  return (index, format) => `${prefix}_${String(index + 1).padStart(4, '0')}.${format}`;
}

test('screenshot every page', async ({ page, openPage }, testInfo) => {
  const finalDir = path.join(OUT_ROOT, testInfo.project.name);
  const dir = testInfo.outputPath('shots');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const manifest = [];
  async function shot(target, name, path_, { fullPage = true } = {}) {
    if (path_) await target.goto(path_);
    await target.waitForLoadState('load');
    await expect(target.getByRole('heading').first()).toBeVisible();
    await target.evaluate(() => document.fonts.ready.then(() => undefined));
    await target.evaluate(() =>
      Promise.all(
        Array.from(document.images).map((img) => {
          img.loading = 'eager';
          if (img.complete) return undefined;
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }),
      ),
    );
    const caption = CAPTIONS[name];
    if (!caption) throw new Error(`no caption for screenshot "${name}" in scripts/shared/screenshot-captions.js`);
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${name}.jpg`;
    await target.screenshot({ path: path.join(dir, file), fullPage, type: 'jpeg', quality: 82, scale: 'css' });
    manifest.push({ file, ...caption });
  }

  let inviteUrl;
  let resetUrl;
  let visitor;
  let user;
  let lisbon;
  let lisbonUrl;

  await test.step('sign-in, invite and reset screens', async () => {
    await shot(page, 'login', PATHS.login);

    await signIn(page, ADMIN);
    inviteUrl = await createInvite(page, { label: `For Sam ${unique('s')}` });
    await shot(page, 'admin-invite-created');

    await page.goto(await adminUserPath(page, USERS.plain.email));
    await page.getByRole('button', { name: 'Generate reset link' }).click();
    resetUrl = await page.getByLabel('One-time link').inputValue();
    await shot(page, 'admin-reset-link-created');

    visitor = await openPage();
    await shot(visitor, 'invite-register', new URL(inviteUrl).pathname);
    await shot(visitor, 'reset-password', new URL(resetUrl).pathname);

    user = await openPage();
    await signIn(user, USERS.shots);
    await shot(user, 'not-found', '/no-such-page');
  });

  await test.step('a large upload, its job page and the new gallery', async () => {
    await shot(user, 'new-gallery', PATHS.newGallery);
    const batch = await scenes(16, { width: 2400, height: 1600 });
    const dayZip = await zipFile(
      testInfo,
      'Lisbon-day-4.zip',
      batch.slice(14).map((file) => ({ name: `day-4/${file.name}`, data: file.buffer })),
    );
    const zone = dropZone(user);
    await zone.choose([...batch.slice(0, 14), dayZip]);
    await expect(user.getByText(/^14 images and 1 ZIP file, /)).toBeVisible();
    await shot(user, 'new-gallery-chosen');
    await zone.upload.click();
    await expect(user).toHaveURL(/\/dashboard\/galleries\/jobs\/\d+$/);
    await shot(user, 'job-page');
    await expect(user).toHaveURL(/\/dashboard\/galleries\/\d+\?notice=added$/, { timeout: 60_000 });
    lisbon = new URL(user.url()).pathname;
  });

  await test.step('the edit view, the shared page and its lightbox', async () => {
    await saveDetails(user, {
      title: 'Lisbon in October',
      description: 'Four days of hills, trams and long evenings by the river.',
      allowZip: true,
    });
    for (const [i, place] of PLACES.slice(0, 6).entries()) {
      await setImageText(user, i, { title: place, caption: i % 2 ? undefined : `Day ${Math.floor(i / 2) + 1}` });
    }
    lisbonUrl = await shareGallery(user);
    await user.goto(lisbon);
    await shot(user, 'gallery-edit');

    await shot(visitor, 'share-multi', new URL(lisbonUrl).pathname);
    await visitor.locator('figure[data-shot] a').nth(2).click();
    await expect(visitor.locator('#lightbox')).toBeVisible();
    await expect(visitor.locator('#lb-image')).toHaveJSProperty('complete', true);
    await shot(visitor, 'share-lightbox', null, { fullPage: false });
    await visitor.keyboard.press('Escape');
    expect((await visitor.request.get(`${new URL(lisbonUrl).pathname}/zip`)).status()).toBe(200);
  });

  await test.step('the shared gallery in every theme, and an image page', async () => {
    for (const { key, label } of SHARE_THEMES.filter((theme) => theme.key !== 'none')) {
      await user.goto(lisbon);
      await saveDetails(user, { shareTheme: label });
      await shot(visitor, `share-theme-${key}`, new URL(lisbonUrl).pathname);
    }
    await user.goto(lisbon);
    await saveDetails(user, { shareTheme: 'Frame', imageView: 'Image page' });
    await visitor.goto(new URL(lisbonUrl).pathname);
    await visitor.locator('figure[data-shot] a').nth(1).click();
    await expect(visitor.locator('[data-image-counter]')).toBeVisible();
    await shot(visitor, 'share-image-page');
    await user.goto(lisbon);
    await saveDetails(user, { shareTheme: 'Site default (None)', imageView: 'Site default (Lightbox)' });
  });

  await test.step('unsaved changes: the save bar, a Delete mark and the leave dialog', async () => {
    await user.goto(lisbon);
    await user.locator('#gallery-description').fill('Four days of hills, trams and long evenings by the Tagus.');
    await deleteToggle(imageRows(user).nth(3)).click();
    await expect(saveBar(user)).toContainText('2 unsaved changes');
    await imageRows(user).nth(3).scrollIntoViewIfNeeded();
    await shot(user, 'gallery-edit-unsaved', null, { fullPage: false });
    await user.locator('a:visible', { hasText: 'Add gallery' }).first().click();
    await expect(user.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    await shot(user, 'gallery-leave-dialog', null, { fullPage: false });
    await user.getByRole('button', { name: 'Stay on this page' }).click();
    await saveBar(user).getByRole('button', { name: 'Discard' }).click();
    await expect(saveBar(user)).toBeHidden();
  });

  await test.step('a single-image share, a skipped upload and a trashed gallery', async () => {
    await uploadImages(user, await scenes(1, { first: 3, prefix: 'DSC' }));
    await saveDetails(user, { title: 'Harbour at dusk' });
    await setImageText(user, 0, { title: 'Last ferry', caption: 'Cacilhas, just before nine.' });
    const singleUrl = await shareGallery(user);
    await shot(visitor, 'share-single', new URL(singleUrl).pathname);
    await shot(visitor, 'share-unavailable', PATH_TO.share('0000000'));

    const garden = await uploadImages(user, await scenes(3, { first: 4, prefix: 'garden' }));
    await saveDetails(user, { title: 'Garden in June' });
    await uploadImages(
      user,
      [...(await scenes(1, { first: 7, prefix: 'garden-late' })), textFile('garden-notes.jpg')],
      {
        from: PATH_TO.gallery(garden),
      },
    );
    await expect(user.locator('[data-skipped]')).toBeVisible();
    await shot(user, 'gallery-edit-skipped');

    await uploadImages(user, await scenes(2, { first: 6, prefix: 'old' }));
    await saveDetails(user, { title: 'Old test shots' });
    await user
      .locator('[data-confirm]')
      .filter({ hasText: 'Move to Trash' })
      .getByRole('button', { name: 'Move to Trash' })
      .click();
    await user.getByRole('button', { name: 'Yes' }).click();
    await expect(user).toHaveURL(/notice=trashed/);
  });

  await test.step('the signed-in user pages', async () => {
    await shot(user, 'dashboard', PATHS.dashboard);
    await shot(user, 'my-activity', PATHS.activity);
    await shot(user, 'my-galleries', PATHS.galleries);
    await shot(user, 'trash', PATHS.trash);
    await shot(user, 'account', PATHS.account);
  });

  await test.step('the admin lists and user pages', async () => {
    await shot(page, 'admin-overview', PATHS.admin.overview);
    await shot(page, 'admin-activity', PATHS.admin.activity);
    await shot(page, 'admin-users', PATHS.admin.users);
    const userPath = await adminUserPath(page, USERS.shots.email);
    await shot(page, 'admin-user-detail', userPath);
    await shot(page, 'admin-user-delete-confirm', `${userPath}/delete`);
    await shot(page, 'admin-user-env-admin', await adminUserPath(page, ADMIN.email));
    await shot(page, 'admin-invites', PATHS.admin.invites);
    await shot(page, 'admin-galleries', PATHS.admin.galleries);
  });

  await test.step('an admin edits a gallery of the user', async () => {
    await page.goto(PATHS.admin.galleries);
    await page
      .locator('[data-gallery-row]')
      .filter({ hasText: 'Garden in June' })
      .first()
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(imageRows(page).first()).toBeVisible();
    await deleteImages(page, [0]);
    await user.goto(new URL(page.url()).pathname);
    await expect(user.locator('[data-edited-by-admin]')).toBeVisible();
    await shot(user, 'admin-gallery-edit');
  });

  await test.step('the admin shares, settings and account pages', async () => {
    await shot(page, 'admin-shares', PATHS.admin.shares);
    await page
      .locator('[data-share-row]')
      .filter({ hasText: 'Lisbon in October' })
      .first()
      .getByRole('link', { name: 'Details' })
      .click();
    await shot(page, 'admin-share-detail');
    await shot(page, 'admin-settings', PATHS.admin.settings);
    await shot(page, 'admin-account', PATHS.account);
  });

  expect(n).toBe(Object.keys(CAPTIONS).length);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({ project: testInfo.project.name, capturedAt: new Date().toISOString(), shots: manifest }, null, 2)}\n`,
  );
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.cpSync(dir, finalDir, { recursive: true });
});
