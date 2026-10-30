import {
  USERS,
  confirmRowAction,
  deleteImages,
  expect,
  imageRows,
  saveDetails,
  setImageText,
  shareGallery,
  signIn,
  signInAdmin,
  test,
  unique,
  uploadImages,
} from './support/fixtures.js';
import { jpegFile, pngFile } from './support/images.js';
import { zipEntryNames } from './support/zip.js';
import { expectLightboxBehaviour } from './support/lightbox.js';
import { UNAVAILABLE_MESSAGE } from '../../domain/share-links.js';
import { PATHS } from '../../config/urls.js';

const ZIP_ENTRY = /^[0-9A-Za-z]{10}-\d{3}\.(jpg|png|webp)$/;
const SAVE_NAME = /^[0-9A-Za-z]{10}\.webp$/;

async function expectUnavailable(openPage, url) {
  const visitor = await openPage();
  const response = await visitor.goto(url);
  expect(response.status()).toBe(404);
  await expect(visitor.getByRole('heading', { name: UNAVAILABLE_MESSAGE })).toBeVisible();
  return visitor;
}

async function sharedPair(page, openPage) {
  await signIn(page, USERS.share);
  await uploadImages(page, [
    await jpegFile('a-secret-holiday.jpg', { background: '#e07a5f' }),
    await pngFile('b-private-file.png', { background: '#3d405b' }),
  ]);
  const title = unique('Shared');
  await saveDetails(page, { title, description: 'Two colours for the share test.' });
  await setImageText(page, 0, { title: 'Coral', caption: 'A warm one' });
  const url = await shareGallery(page);
  const visitor = await openPage();
  await visitor.goto(url);
  const cards = visitor.locator('[data-share-grid] figure[data-shot]');
  await expect(cards).toHaveCount(2);
  const downloads = await cards.evaluateAll((figures) => figures.map((f) => f.dataset.download));
  return { title, url, visitor, cards, downloads };
}

test('a shared gallery shows titles and captions, never file names or the owner; the lightbox saves the public name', async ({
  page,
  openPage,
}) => {
  const { title, url, visitor, cards, downloads } = await sharedPair(page, openPage);
  await expect(page.locator('[data-share-panel]')).toContainText('Anyone with this link can see this gallery.');
  const response = await visitor.goto(url);
  expect(response.status()).toBe(200);
  expect(response.headers()['x-robots-tag']).toContain('noindex');
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(visitor.getByText('Two colours for the share test.')).toBeVisible();
  await expect(cards.nth(0)).toContainText('Coral');
  await expect(cards.nth(0)).toContainText('A warm one');
  await expect(cards.nth(1)).not.toContainText('Title');
  await expect(cards.nth(1)).toContainText('Image #2');
  await expect(visitor.locator('[data-share-zip]')).toHaveCount(0);
  const html = await visitor.content();
  for (const secret of ['a-secret-holiday', 'b-private-file', USERS.share.email, USERS.share.name]) {
    expect(html).not.toContain(secret);
  }

  await expectLightboxBehaviour(visitor, { itemLabel: 'Image' });
  const lightbox = visitor.locator('#lightbox');
  await cards.nth(0).locator('a').click();
  await expect(lightbox).toBeVisible();
  await expect(visitor.locator('#lb-counter')).toHaveText('1 / 2');
  await expect(visitor.locator('#lb-title')).toHaveText('Coral');
  await expect(visitor.locator('#lb-caption')).toHaveText('A warm one');
  await expect(visitor.locator('#lb-image')).toHaveJSProperty('complete', true);
  await visitor.keyboard.press('ArrowRight');
  await expect(visitor.locator('#lb-counter')).toHaveText('2 / 2');
  await expect(visitor.locator('#lb-caption')).toHaveText('Image #2');
  const save = visitor.locator('#lb-save');
  const saveName = await save.getAttribute('download');
  expect(saveName).toMatch(SAVE_NAME);
  expect(saveName).toBe(downloads[1]);
  const saved = visitor.waitForEvent('download');
  await save.click();
  expect((await saved).suggestedFilename()).toBe(saveName);
  await visitor.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
});

test("the gallery's grid text choice hides and shows the captions under the thumbnails", async ({ page, openPage }) => {
  const { visitor, cards } = await sharedPair(page, openPage);
  await saveDetails(page, { gridText: 'Hide' });
  await visitor.reload();
  await expect(cards).toHaveCount(2);
  await expect(visitor.locator('[data-share-grid] figcaption')).toHaveCount(0);
  await saveDetails(page, { gridText: 'Show' });
  await visitor.reload();
  await expect(visitor.locator('[data-share-grid] figcaption')).toHaveCount(2);
});

test('Download ZIP, once allowed, holds the originals named by public name and position', async ({
  page,
  openPage,
}) => {
  const { visitor, downloads } = await sharedPair(page, openPage);
  await saveDetails(page, { allowZip: true });
  await visitor.reload();
  const zipButton = visitor.getByRole('link', { name: 'Download ZIP' });
  await expect(zipButton).toBeVisible();
  const zipDownload = visitor.waitForEvent('download');
  await zipButton.click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const entries = await zipEntryNames(await zip.path());
  expect(entries).toHaveLength(2);
  for (const name of entries) expect(name).toMatch(ZIP_ENTRY);
  expect(entries[0]).toBe(`${downloads[0].replace(/\.webp$/, '')}-001.jpg`);
  expect(entries[1]).toBe(`${downloads[1].replace(/\.webp$/, '')}-002.png`);
});

test('with one image left the single-image layout opens the large .webp; Revoke makes the link unavailable', async ({
  page,
  openPage,
}) => {
  const { url, visitor, downloads } = await sharedPair(page, openPage);
  await deleteImages(page, [1]);
  await expect(imageRows(page)).toHaveCount(1);
  await visitor.reload();
  await expect(visitor.locator('[data-share-grid]')).toHaveCount(0);
  const single = visitor.locator('[data-share-single]');
  await expect(single).toBeVisible();
  await expect(single).toContainText('Coral');
  await expect(single.locator('img')).toHaveJSProperty('complete', true);
  const tab = visitor.context().waitForEvent('page');
  await single.locator('a').click();
  const opened = await tab;
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/\/s\/[0-9A-Za-z]{7}\/i\/[0-9A-Za-z]{10}\.webp$/);
  await opened.close();

  await confirmRowAction(page.locator('[data-share-panel]'), 'Revoke', {
    question: 'Revoke this link? It stops working at once.',
  });
  await expect(page.getByRole('status').filter({ hasText: 'Share link revoked.' })).toBeVisible();
  await expect(page.locator('[data-share-url]')).toHaveCount(0);
  await expectUnavailable(openPage, url);
  const media = await visitor.request.get(`${new URL(url).pathname}/i/${downloads[0].replace(/\.webp$/, '')}/web`);
  expect(media.status()).toBe(404);
});

test('turning public sharing off pauses links; an admin revokes one from Shared links', async ({
  page,
  openPage,
  withOverrides,
}) => {
  await signIn(page, USERS.share);
  await uploadImages(page, [await jpegFile('a.jpg'), await jpegFile('b.jpg', { background: '#264653' })]);
  const title = unique('Paused');
  await saveDetails(page, { title });
  const url = await shareGallery(page);

  const admin = await withOverrides(undefined, { toggles: { 'Public share links': false } });
  await expectUnavailable(openPage, url);
  await page.reload();
  await expect(page.locator('[data-share-panel]')).toContainText('Revoke');
  await withOverrides(undefined, { toggles: { 'Public share links': true } });
  const back = await openPage();
  expect((await back.goto(url)).status()).toBe(200);

  await admin.goto(PATHS.admin.shares);
  const row = admin.locator('[data-share-row]').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(USERS.share.name);
  await confirmRowAction(row, 'Revoke', { question: 'Revoke this link?' });
  await expect(admin.getByRole('status')).toContainText('Share link revoked.');
  await expect(admin.locator('[data-share-row]').filter({ hasText: title })).toHaveCount(0);
  await expectUnavailable(openPage, url);
});

test('Copy image link in the lightbox copies the full .webp address of the image shown', async ({ page, openPage }) => {
  await signIn(page, USERS.share);
  await uploadImages(page, [
    await jpegFile('copy-1.jpg', { background: '#e07a5f' }),
    await pngFile('copy-2.png', { background: '#3d405b' }),
  ]);
  const url = await shareGallery(page);
  const visitor = await openPage();
  await visitor.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await visitor.goto(url);
  const cards = visitor.locator('[data-share-grid] figure[data-shot]');
  const secondHref = await cards.nth(1).locator('a').getAttribute('href');
  const secondThumb = await cards.nth(1).getAttribute('data-thumb');
  expect(secondHref).toMatch(/\/i\/[0-9A-Za-z]{10}\.webp$/);
  expect(secondThumb).toMatch(/\/i\/[0-9A-Za-z]{10}-thumb\.webp$/);

  await cards.nth(0).locator('a').click();
  await visitor.keyboard.press('ArrowRight');
  await expect(visitor.locator('#lb-counter')).toHaveText('2 / 2');
  const copy = visitor.locator('#lb-copy');
  await copy.click();
  await expect(copy).toContainText('Copied');
  const copied = await visitor.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(new URL(secondHref, url).href);
  const image = await visitor.request.get(copied);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/webp');
});

test('Image page view: a thumbnail opens its own page; arrows and Previous/Next move; the ends are disabled', async ({
  page,
  openPage,
}) => {
  await signIn(page, USERS.share);
  await uploadImages(page, [
    await jpegFile('page-1.jpg', { background: '#e07a5f' }),
    await pngFile('page-2.png', { background: '#3d405b' }),
    await jpegFile('page-3.jpg', { background: '#81b29a' }),
  ]);
  const title = unique('Paged');
  await saveDetails(page, { title, imageView: 'Image page' });
  const url = await shareGallery(page);

  const visitor = await openPage();
  await visitor.goto(url);
  await expect(visitor.locator('#lightbox')).toHaveCount(0);
  await visitor.locator('[data-share-grid] figure[data-shot] a').first().click();
  await expect(visitor).toHaveURL(/\/s\/[0-9A-Za-z]{7}\/i\/[0-9A-Za-z]{10}$/);
  const count = visitor.locator('[data-image-counter]');
  await expect(count).toHaveText('Photo 1 of 3');
  await expect(visitor.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();

  await visitor.keyboard.press('ArrowRight');
  await expect(count).toHaveText('Photo 2 of 3');
  await visitor.getByRole('link', { name: 'Next' }).click();
  await expect(count).toHaveText('Photo 3 of 3');
  await expect(visitor.getByRole('button', { name: 'Next' })).toBeDisabled();
  await visitor.keyboard.press('ArrowRight');
  await expect(count).toHaveText('Photo 3 of 3', { timeout: 1000 });
  await visitor.keyboard.press('ArrowLeft');
  await expect(count).toHaveText('Photo 2 of 3');
  await expect(visitor.locator('[data-image-page] img')).toHaveJSProperty('complete', true);
  await visitor.getByRole('link', { name: 'Back to gallery' }).click();
  await expect(visitor).toHaveURL(url);
});

test("the share panel's Copy puts the gallery's link on the clipboard", async ({ page }) => {
  await signIn(page, USERS.share);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await uploadImages(page, [await jpegFile('copy-share.jpg')]);
  await saveDetails(page, { title: unique('Copy share') });
  const url = await shareGallery(page);
  const panel = page.locator('[data-share-panel]');
  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test("a shared link's admin page lists its page views and ZIP downloads, newest first", async ({ page, openPage }) => {
  await signIn(page, USERS.share);
  await uploadImages(page, [await jpegFile('views.jpg')]);
  const title = unique('Views');
  await saveDetails(page, { title, allowZip: true });
  const url = await shareGallery(page);
  const visitor = await openPage();
  expect((await visitor.goto(url)).status()).toBe(200);
  const zip = visitor.waitForEvent('download');
  await visitor.getByRole('link', { name: 'Download ZIP' }).click();
  await zip;

  const admin = await openPage();
  await signInAdmin(admin);
  await admin.goto(PATHS.admin.shares);
  const row = admin.locator('[data-share-row]').filter({ hasText: title });
  await expect(row).toContainText(USERS.share.name);
  await row.getByRole('link', { name: 'Details' }).click();
  await expect(admin.getByRole('heading', { name: 'Last 100 views' })).toBeVisible();
  const views = admin.locator('[data-view-row]');
  await expect(views).toHaveCount(2, { message: 'the visit and the download; the owner opening it is not counted' });
  await expect(views.nth(0)).toContainText('ZIP');
  await expect(views.nth(1)).toContainText('Page');
  await expect(admin.getByRole('link', { name: 'Edit gallery' })).toBeVisible();
});
