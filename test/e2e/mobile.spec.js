import {
  USERS,
  confirmRowAction,
  deleteImages,
  deleteToggle,
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
} from './support/fixtures.js';
import { jpegFile, pngFile, webpFile } from './support/images.js';
import { expectInsideWidth, expectNoSidewaysScroll } from './support/layout.js';
import { PATHS } from '../../config/urls.js';
import { SHARE_THEMES } from '../../domain/share-themes.js';

test('edit view, share grid, lightbox and single image on a mobile device', async ({ page, openPage }) => {
  await signIn(page, USERS.mobile);
  await uploadImages(page, [
    await jpegFile('1-wide.jpg', { width: 640, height: 360, background: '#ef476f' }),
    await pngFile('2-square.png', { background: '#ffd166' }),
    await webpFile('3-tall.webp', { width: 300, height: 500, background: '#06d6a0' }),
  ]);
  const title = unique('Mobile gallery');
  await saveDetails(page, { title });
  await setImageText(page, 0, { title: 'Wide', caption: 'A wide one' });

  await expect(imageRows(page)).toHaveCount(3);
  await expectNoSidewaysScroll(page);
  const row = imageRows(page).nth(1);
  for (const name of ['Move image up', 'Move image down']) {
    const button = row.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await expectInsideWidth(page, button, name, { slack: 0.5 });
  }
  await expect(deleteToggle(row)).toBeVisible();
  await expectInsideWidth(page, deleteToggle(row), 'Delete', { slack: 0.5 });
  await expectInsideWidth(page, row.getByLabel('Title'), 'title field', { slack: 0.5 });
  await row.getByRole('button', { name: 'Move image up' }).tap();
  await expect
    .poll(() => imageRows(page).locator('[title^="Original file name"]').allTextContents())
    .toEqual(['2-square.png', '1-wide.jpg', '3-tall.webp']);

  const url = await shareGallery(page);
  await expectInsideWidth(page, page.locator('[data-share-url]'), 'share link field', { slack: 0.5 });
  await expectNoSidewaysScroll(page);

  const visitor = await openPage();
  expect(visitor.viewportSize(), 'an extra page gets the project device size').toEqual(page.viewportSize());
  expect(await visitor.evaluate(() => navigator.maxTouchPoints), 'and its touch support').toBeGreaterThan(0);
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  const cards = visitor.locator('[data-share-grid] figure[data-shot]');
  await expect(cards).toHaveCount(3);
  await expectNoSidewaysScroll(visitor);
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(b.y, 'cards stack in one column').toBeGreaterThan(a.y + a.height - 1);
  await expectInsideWidth(visitor, cards.nth(0), 'first card', { slack: 0.5 });

  await cards.nth(1).locator('a').tap();
  const lightbox = visitor.locator('#lightbox');
  await expect(lightbox).toBeVisible();
  await expect(visitor.locator('#lb-counter')).toHaveText('2 / 3');
  await expect(visitor.locator('#lb-caption')).toHaveText('A wide one');
  for (const id of ['#lb-prev', '#lb-next', '#lb-close', '#lb-save', '#lb-image']) {
    await expect(visitor.locator(id)).toBeVisible();
    await expectInsideWidth(visitor, visitor.locator(id), id, { slack: 0.5 });
  }
  await visitor.locator('#lb-next').tap();
  await expect(visitor.locator('#lb-counter')).toHaveText('3 / 3');
  await visitor.locator('#lb-close').tap();
  await expect(lightbox).toBeHidden();

  await deleteImages(page, [2]);
  await expect(imageRows(page)).toHaveCount(2);
  await deleteToggle(imageRows(page).nth(0)).tap();
  await saveBar(page).getByRole('button', { name: 'Save gallery', exact: true }).tap();
  await expect(imageRows(page)).toHaveCount(1);
  await visitor.reload();
  const single = visitor.locator('[data-share-single]');
  await expect(single).toBeVisible();
  await expect(single).toContainText('Wide');
  await expect(single.locator('img')).toHaveJSProperty('complete', true);
  await expectInsideWidth(visitor, single.locator('img'), 'single image', { slack: 0.5 });
  await expectNoSidewaysScroll(visitor);
});

test('the Trash fits the screen: both row buttons are visible without sideways scrolling', async ({ page }) => {
  await signIn(page, USERS.mobile);
  const title = unique('Mobile trash');
  await uploadImages(page, [await jpegFile(`${title}.jpg`)]);
  await saveDetails(page, { title });
  await page.goto(PATHS.galleries);
  await confirmRowAction(page.locator('[data-gallery-row]').filter({ hasText: title }), 'Delete');
  await expect(page).toHaveURL(/notice=trashed$/);

  await page.goto(PATHS.trash);
  const first = page.locator('[data-trash-row]').first();
  await expect(first).toContainText(/Deleted forever on \d{4}-\d{2}-\d{2}/);
  for (const name of ['Restore', 'Delete forever']) {
    const button = first.getByRole('button', { name });
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport({ ratio: 1 });
    await expectInsideWidth(page, button, name);
  }
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Empty trash' }).click();
  await page.locator('[data-page-head]').getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
});

test('on a phone, every share theme and its image page fit the screen without sideways scrolling', async ({
  page,
  openPage,
}) => {
  await signIn(page, USERS.mobile);
  await uploadImages(page, [
    await jpegFile('m-theme-1.jpg', { width: 900, height: 600, background: '#e07a5f' }),
    await pngFile('m-theme-2.png', { background: '#3d405b' }),
  ]);
  await saveDetails(page, { title: unique('Mobile themes'), description: 'A description that wraps on a phone.' });
  const url = await shareGallery(page);
  const edit = page.url();
  const visitor = await openPage();
  for (const { key, label } of SHARE_THEMES) {
    await page.goto(edit);
    await saveDetails(page, { shareTheme: label, imageView: 'Image page' });
    await visitor.goto(url);
    await expect(visitor.locator(`[data-share-theme="${key}"]`), key).toBeVisible();
    await expectNoSidewaysScroll(visitor);
    await visitor.locator('figure[data-shot] a').first().tap();
    await expect(visitor.locator('[data-image-counter]'), key).toHaveText('Photo 1 of 2');
    await expectNoSidewaysScroll(visitor);
    await expectInsideWidth(visitor, visitor.getByRole('link', { name: 'Next' }), `${key} Next`, { slack: 0.5 });
  }
});
