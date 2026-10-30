import {
  OVERRIDES,
  USERS,
  dropZone,
  expect,
  imageRows,
  setImageText,
  signIn,
  test,
  uploadImages,
} from './support/fixtures.js';
import { jpegFile, threeImages } from './support/images.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

const toggle = (page, title) => page.getByRole('checkbox', { name: title });
const switchLabel = (page, title) => page.locator('label').filter({ has: toggle(page, title) });
const PER_GALLERY = OVERRIDES.perGallery;

test('an override switch and its value are saved and shown as in effect', async ({ withOverrides }) => {
  const page = await withOverrides([]);
  const status = page.locator('[data-widget="status"]');
  await expect(status.locator('[data-limit="maxImagesPerGallery"]')).toHaveText('500 (.env)');
  await expect(status.locator('[data-items-per-page]')).toHaveText('25 (.env)');

  await switchLabel(page, PER_GALLERY).click();
  await expect(toggle(page, PER_GALLERY)).toBeChecked();
  await page.getByLabel('Max images per gallery', { exact: true }).fill('40');
  await switchLabel(page, OVERRIDES.itemsPerPage).click();
  await page.getByLabel('Items per page', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save settings' }).click();

  await expect(page).toHaveURL((url) => url.pathname === PATHS.admin.settings && url.search === '?notice=saved');
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await page.reload();
  await expect(toggle(page, PER_GALLERY)).toBeChecked();
  await expect(toggle(page, OVERRIDES.maxImage)).not.toBeChecked();
  await expect(status.locator('[data-limit="maxImagesPerGallery"]')).toHaveText('40 (Settings)');
  await expect(status.locator('[data-items-per-page]')).toHaveText('10 (Settings)');

  await switchLabel(page, PER_GALLERY).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(toggle(page, PER_GALLERY)).not.toBeChecked();
  await expect(status.locator('[data-limit="maxImagesPerGallery"]')).toHaveText('500 (.env)');
  await expect(page.getByLabel('Max images per gallery', { exact: true })).toHaveValue('40');
});

test('Settings: the pinned save bar counts changes, Discard resets them, and leaving asks first', async ({
  withOverrides,
}) => {
  const page = await withOverrides([]);
  const bar = page.locator('[data-save-bar]');
  await expect(bar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeHidden();

  const perPage = page.getByLabel('Items per page', { exact: true });
  const saved = await perPage.inputValue();
  await switchLabel(page, OVERRIDES.itemsPerPage).click();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('1 unsaved change');
  await perPage.fill('12');
  await expect(bar).toContainText('2 unsaved changes');
  await perPage.fill(saved);
  await expect(bar).toContainText('1 unsaved change');

  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(bar).toBeHidden();
  await expect(toggle(page, OVERRIDES.itemsPerPage)).not.toBeChecked();

  await switchLabel(page, OVERRIDES.itemsPerPage).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' }).first().click();
  const dialog = page.locator('[data-leave-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You have 1 unsaved change.');
  await dialog.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(page).toHaveURL((url) => url.pathname === PATHS.admin.settings);
  await expect(toggle(page, OVERRIDES.itemsPerPage)).toBeChecked();

  await perPage.fill('12');
  await bar.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-widget="status"] [data-items-per-page]')).toHaveText('12 (Settings)');
});

test('a lowered limit refuses new uploads by name but the existing gallery stays editable', async ({
  page,
  withOverrides,
}) => {
  await signIn(page, USERS.settings);
  const id = await uploadImages(page, await threeImages('limit'));
  await expect(imageRows(page)).toHaveCount(3);

  await withOverrides([PER_GALLERY], { fields: { 'Max images per gallery': 2 } });

  await page.goto(PATHS.newGallery);
  await expect(page.getByText('2 images per gallery')).toBeVisible();
  const zone = dropZone(page);
  await zone.choose(await threeImages('over'));
  await zone.upload.click();
  await expect(page.getByRole('alert')).toContainText(
    'This upload has more than 2 files; at most 2 files can be uploaded at once.',
  );

  await page.goto(PATH_TO.gallery(id));
  await expect(imageRows(page)).toHaveCount(3);
  await setImageText(page, 1, { title: 'Still editable' });
  await zone.choose([await jpegFile('one-more.jpg')]);
  await zone.upload.click();
  await expect(page.getByRole('alert')).toContainText('This gallery has 3 images and can hold 2; this upload adds 1.');
  await expect(imageRows(page)).toHaveCount(3);
});
