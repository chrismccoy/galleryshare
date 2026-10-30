import {
  USERS,
  confirmRowAction,
  expect,
  saveDetails,
  signIn,
  test,
  unique,
  uploadImages,
} from './support/fixtures.js';
import { jpegFile } from './support/images.js';
import { PATHS } from '../../config/urls.js';

const badge = (page) => page.locator('[data-sidebar] [data-nav-count="trash"]');
const galleryRow = (page, title) => page.locator('[data-gallery-row]').filter({ hasText: title });
const trashRow = (page, title) => page.locator('[data-trash-row]').filter({ hasText: title });

async function newGallery(page, title) {
  await uploadImages(page, [await jpegFile(`${title}.jpg`)]);
  await saveDetails(page, { title });
}

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.trash);
});

test('Delete moves a gallery to Trash; its notice opens the Trash; Restore puts it back', async ({ page }) => {
  const first = unique('First');
  await newGallery(page, first);
  const galleryUrl = new URL(page.url()).pathname;
  await page.goto(PATHS.galleries);
  await expect(badge(page)).toHaveCount(0);
  await confirmRowAction(galleryRow(page, first), 'Delete', { question: 'Move to Trash?' });

  await expect(page).toHaveURL(/\/dashboard\/galleries\?notice=trashed$/);
  await expect(page.getByRole('status')).toContainText('Moved to Trash.');
  await expect(galleryRow(page, first)).toHaveCount(0);
  await expect(badge(page)).toHaveText('1');
  expect((await page.request.get(galleryUrl)).status()).toBe(404);

  await page.getByRole('status').getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL(/\/dashboard\/trash$/);
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
  await expect(page.locator('[data-sidebar] a[aria-current="page"]')).toContainText('Trash');
  const row = trashRow(page, first);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Deleted forever on \d{4}-\d{2}-\d{2}/);
  await expect(row.locator('img')).toHaveJSProperty('complete', true);

  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page).toHaveURL(/\/dashboard\/trash\?notice=restored$/);
  await expect(page.getByRole('status')).toHaveText('Gallery restored.');
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty trash' })).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to My galleries' }).click();
  await expect(galleryRow(page, first)).toHaveCount(1);
});

test('Move to Trash from the edit view; Delete forever asks first, No keeps the gallery, Yes deletes it', async ({
  page,
}) => {
  const title = unique('Edit view');
  await newGallery(page, title);
  const galleryUrl = new URL(page.url()).pathname;
  const row = trashRow(page, title);
  await confirmRowAction(page.locator('[data-confirm]').filter({ hasText: 'Move to Trash' }), 'Move to Trash', {
    question: 'Move this gallery to Trash?',
  });
  await expect(page).toHaveURL(/\/dashboard\/galleries\?notice=trashed$/);
  expect((await page.request.get(galleryUrl)).status()).toBe(404);
  await expect(badge(page)).toHaveText('1');

  await page.goto(PATHS.trash);
  await row.getByRole('button', { name: 'Delete forever' }).click();
  await expect(row.getByText('Delete forever?')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Restore' })).toBeHidden();
  await row.getByRole('button', { name: 'No' }).click();
  await expect(row.getByText('Delete forever?')).toBeHidden();
  await expect(row.getByRole('button', { name: 'Restore' })).toBeVisible();

  await confirmRowAction(row, 'Delete forever');
  await expect(page).toHaveURL(/\/dashboard\/trash\?notice=purged$/);
  await expect(page.getByRole('status')).toHaveText('Gallery deleted forever.');
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
});

test('Empty trash asks first; No keeps every gallery, Yes deletes them all', async ({ page }) => {
  const second = unique('Second');
  const third = unique('Third');
  await newGallery(page, second);
  await newGallery(page, third);
  await page.goto(PATHS.galleries);
  for (const title of [second, third]) {
    await confirmRowAction(galleryRow(page, title), 'Delete');
    await expect(page).toHaveURL(/notice=trashed$/);
  }
  await expect(badge(page)).toHaveText('2');
  await page.goto(PATHS.trash);
  await expect(page.locator('[data-trash-row]')).toHaveCount(2);

  const head = page.locator('[data-page-head]');
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText("Empty trash? This can't be undone.")).toBeVisible();
  await head.getByRole('button', { name: 'No' }).click();
  await expect(page.getByText("Empty trash? This can't be undone.")).toBeHidden();
  await expect(page.locator('[data-trash-row]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Empty trash' }).click();
  await head.getByRole('button', { name: 'Yes' }).click();
  await expect(page).toHaveURL(/\/dashboard\/trash\?notice=emptied$/);
  await expect(page.getByRole('status')).toHaveText('Trash emptied.');
  await expect(page.locator('[data-trash-row]')).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
});
