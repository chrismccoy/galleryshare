import fs from 'node:fs';
import {
  deleteImages,
  deleteToggle,
  dropZone,
  expect,
  GALLERY_PATH,
  galleryPath,
  imageRows,
  OVERRIDES,
  saveBar,
  saveDetails,
  savedNotice,
  setImageText,
  signIn,
  test,
  unique,
  UPLOAD_TIMEOUT,
  uploadImages,
  USERS,
} from './support/fixtures.js';
import { BYTES_PER_MB } from '../../lib/size.js';
import { jpegFile, sceneFiles, textFile, threeImages } from './support/images.js';
import { zipFile } from './support/zip.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

const ACCEPT = 'image/jpeg,image/png,image/webp,.zip,application/zip';

const colourOf = (locator) => locator.evaluate((el) => getComputedStyle(el).color);

const errorColour = (page) => colourOf(page.locator('[data-upload-error]'));

const names = (page) => imageRows(page).locator('[title^="Original file name"]').allTextContents();
const placeholders = (page) =>
  imageRows(page)
    .locator('[data-default-caption]')
    .evaluateAll((inputs) => inputs.map((input) => input.placeholder));
const positions = (page) => imageRows(page).locator('[data-position]').allTextContents();

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.galleries);
});

test('new gallery: the upload goes through the job page to the edit view, its rows in name order and saved', async ({
  page,
}) => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add gallery' }).first().click();
  await expect(page.getByRole('heading', { name: 'Add gallery', level: 1 })).toBeVisible();

  const jobPage = page.waitForResponse((response) =>
    new RegExp(`^${PATHS.ingestJobs}/\\d+$`).test(new URL(response.url()).pathname),
  );
  const id = await uploadImages(page, await threeImages('trip'), { from: null });
  expect((await jobPage).request().method()).toBe('GET');
  await expect(page).toHaveURL(new RegExp(`${galleryPath(id)}\\?notice=added$`));
  await expect(page.getByRole('heading', { name: 'Untitled gallery', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Images added and saved.' })).toBeVisible();
  await expect(page.locator('[data-save-bar]')).toBeHidden();

  await expect(imageRows(page)).toHaveCount(3);
  expect(await names(page)).toEqual(['trip-1.jpg', 'trip-2.png', 'trip-3.webp']);
  expect(await placeholders(page)).toEqual(['Image #1', 'Image #2', 'Image #3']);
  for (const img of await imageRows(page).locator('img').all()) {
    await expect(img).toHaveJSProperty('complete', true);
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  }
});

test('details and image texts are saved, and dragging a row reorders it and renumbers the captions', async ({
  page,
}) => {
  const id = await uploadImages(page, await threeImages('trip'));
  const title = unique('Trip');
  await saveDetails(page, { title, description: 'Three test colours.' });
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await setImageText(page, 0, { title: 'Red' });
  await setImageText(page, 1, { title: 'Blue' });
  await setImageText(page, 2, { title: 'Green', caption: 'The green one' });

  const third = imageRows(page).nth(2);
  const first = imageRows(page).nth(0);
  const saved = page.waitForResponse((response) => response.url().endsWith(`${galleryPath(id)}/reorder`));
  await third.locator('[data-drag-handle]').dragTo(first, { targetPosition: { x: 40, y: 4 } });
  expect((await saved).status()).toBe(204);
  await expect.poll(() => names(page)).toEqual(['trip-3.webp', 'trip-1.jpg', 'trip-2.png']);
  expect(await positions(page)).toEqual(['#1', '#2', '#3']);
  expect(await placeholders(page)).toEqual(['Image #1', 'Image #2', 'Image #3']);

  await page.reload();
  expect(await names(page)).toEqual(['trip-3.webp', 'trip-1.jpg', 'trip-2.png']);
  await expect(imageRows(page).nth(0).getByLabel('Title')).toHaveValue('Green');
  await expect(imageRows(page).nth(0).getByLabel('Caption')).toHaveValue('The green one');
  await expect(imageRows(page).nth(1).getByLabel('Title')).toHaveValue('Red');
});

test('Move image up stops at the top; removing an image renumbers; My galleries counts what is left', async ({
  page,
}) => {
  await uploadImages(page, await threeImages('trip'));
  const title = unique('Trip');
  await saveDetails(page, { title });
  await imageRows(page).nth(2).getByRole('button', { name: 'Move image up' }).click();
  await expect.poll(() => names(page)).toEqual(['trip-1.jpg', 'trip-3.webp', 'trip-2.png']);
  await imageRows(page).nth(1).getByRole('button', { name: 'Move image up' }).click();
  await expect.poll(() => names(page)).toEqual(['trip-3.webp', 'trip-1.jpg', 'trip-2.png']);
  await expect(imageRows(page).nth(0).getByRole('button', { name: 'Move image up' })).toBeDisabled();

  await deleteImages(page, [0]);
  await expect(imageRows(page)).toHaveCount(2);
  expect(await names(page)).toEqual(['trip-1.jpg', 'trip-2.png']);
  expect(await placeholders(page)).toEqual(['Image #1', 'Image #2']);
  expect(await positions(page)).toEqual(['#1', '#2']);

  await page.goto(PATHS.galleries);
  const row = page.locator('[data-gallery-row]').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-image-count]')).toHaveText('2');
});

test('add images to an existing gallery; a file that is not an image is listed by name and the rest are kept', async ({
  page,
}) => {
  const id = await uploadImages(page, [await jpegFile('first.jpg')]);
  await expect(imageRows(page)).toHaveCount(1);

  const zone = dropZone(page);
  await zone.choose([await jpegFile('second.jpg'), textFile('notes.jpg')]);
  await expect(zone.rows).toHaveCount(2);
  await expect(zone.summary).toBeVisible();
  await expect(zone.summary).toHaveText(/^2 images, /);
  await zone.upload.click();
  await expect(page).toHaveURL(new RegExp(`${galleryPath(id)}(\\?.*)?$`), { timeout: UPLOAD_TIMEOUT });
  await expect(imageRows(page)).toHaveCount(2);
  const skipped = page.locator('[data-skipped]');
  await expect(skipped).toContainText('1 file was not added');
  await expect(skipped).toContainText('notes.jpg');
  await skipped.getByRole('button', { name: 'Dismiss' }).click();
  await expect(skipped).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-skipped]')).toHaveCount(0);
});

test('the single drop zone: upload stays disabled with no selection, and shows the summary for a valid one', async ({
  page,
}) => {
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(zone.input).toHaveCount(1);
  await expect(zone.input).toHaveAttribute('accept', ACCEPT);
  await expect(zone.upload).toBeDisabled();
  await zone.choose(await threeImages('sum'));
  await expect(page.getByText(/^3 images, /)).toBeVisible();
  await expect(zone.summary).toHaveText(/^3 images, /);
  await expect(zone.upload).toBeEnabled();
});

test('images and a ZIP file in one upload create a gallery with all images in order', async ({ page }, testInfo) => {
  const photos = await zipFile(testInfo, 'photos.zip', [
    { name: 'trip/b.jpg', data: (await jpegFile('b.jpg')).buffer },
    { name: 'trip/a.jpg', data: (await jpegFile('a.jpg')).buffer },
    { name: '__MACOSX/trip/._a.jpg', data: 'resource fork' },
  ]);
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await zone.choose([photos, await jpegFile('loose10.jpg'), await jpegFile('loose2.jpg', { background: '#264653' })]);
  await expect(page.getByText(/^2 images and 1 ZIP file, /)).toBeVisible();
  const post = page.waitForRequest((request) => request.method() === 'POST');
  await zone.upload.click();
  expect(new URL((await post).url()).pathname).toBe(PATHS.newGalleryUpload);
  await expect(page).toHaveURL(GALLERY_PATH, { timeout: UPLOAD_TIMEOUT });
  await expect(imageRows(page)).toHaveCount(4);
  expect(await names(page)).toEqual(['loose2.jpg', 'loose10.jpg', 'a.jpg', 'b.jpg']);
});

test('two ZIP files in one upload create a gallery', async ({ page }, testInfo) => {
  await zipFile(testInfo, 'one.zip', [{ name: 'x/1.jpg', data: (await jpegFile('1.jpg')).buffer }]);
  await zipFile(testInfo, 'two.zip', [
    { name: 'y/2.jpg', data: (await jpegFile('2.jpg')).buffer },
    { name: 'y/3.jpg', data: (await jpegFile('3.jpg')).buffer },
  ]);
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await zone.choose([testInfo.outputPath('two.zip'), testInfo.outputPath('one.zip')]);
  await expect(page.getByText(/^2 ZIP files, /)).toBeVisible();
  await zone.upload.click();
  await expect(page).toHaveURL(GALLERY_PATH, { timeout: UPLOAD_TIMEOUT });
  await expect(imageRows(page)).toHaveCount(3);
  expect(await names(page)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
});

test('an unsupported file is refused inline and nothing is sent until it is removed', async ({ page }) => {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  const refusal = page.getByText('Only JPEG, PNG, WebP images or ZIP files can be uploaded');
  await zone.choose([await jpegFile('ok.jpg'), textFile('notes.txt')]);
  await expect(refusal).toBeVisible();
  await expect(zone.upload).toBeDisabled();
  await zone.upload.click({ force: true });
  await zone.remove('notes.txt');
  await expect(refusal).toBeHidden();
  await expect(zone.upload).toBeEnabled();
  expect(posts).toEqual([]);
});

test('a ZIP can be added to an existing gallery through the edit view zone', async ({ page }, testInfo) => {
  const id = await uploadImages(page, [await jpegFile('first.jpg')]);
  await zipFile(testInfo, 'more.zip', [{ name: 'more/z.jpg', data: (await jpegFile('z.jpg')).buffer }]);
  const zone = dropZone(page);
  await zone.choose(testInfo.outputPath('more.zip'));
  await zone.upload.click();
  await expect(page).toHaveURL(new RegExp(`${galleryPath(id)}(\\?.*)?$`), { timeout: UPLOAD_TIMEOUT });
  await expect(imageRows(page)).toHaveCount(2);
});

function writeToOutputDir(testInfo, files) {
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  return files.map((file) => {
    const target = testInfo.outputPath(file.name);
    fs.writeFileSync(target, file.buffer);
    return target;
  });
}

test('the file list: remove one of three, upload sends exactly the rest', async ({ page }) => {
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await zone.choose(await threeImages('pick'));
  await expect(zone.rows).toHaveCount(3);
  await expect(page.getByText(/^3 images, /)).toBeVisible();
  await expect(page.locator('[data-upload-list] img')).toHaveCount(3);

  await zone.remove('pick-2.png');
  await expect(zone.rows).toHaveCount(2);
  await expect(page.getByText(/^2 images, /)).toBeVisible();
  await expect(zone.status).toHaveText('pick-2.png removed, 2 images left');

  await zone.upload.click();
  await expect(page).toHaveURL(GALLERY_PATH, { timeout: UPLOAD_TIMEOUT });
  await expect(imageRows(page)).toHaveCount(2);
  expect((await names(page)).sort()).toEqual(['pick-1.jpg', 'pick-3.webp']);
});

test('the file list: picking twice accumulates and skips exact duplicates', async ({ page }, testInfo) => {
  const [a, b, c] = writeToOutputDir(testInfo, await threeImages('acc'));
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await zone.choose([a, b]);
  await expect(zone.rows).toHaveCount(2);
  await zone.choose([b, c]);
  await expect(zone.rows).toHaveCount(3);
  await expect(page.getByText(/^3 images, /)).toBeVisible();
  await expect(zone.input).toHaveJSProperty('files.length', 3);
});

for (const oversize of [
  {
    what: 'image',
    override: OVERRIDES.maxImage,
    field: 'Max image size (MB)',
    file: async () => {
      const big = await jpegFile('big.jpg');
      return { ...big, buffer: Buffer.concat([big.buffer, Buffer.alloc(1.5 * BYTES_PER_MB)]) };
    },
  },
  {
    what: 'ZIP',
    override: OVERRIDES.maxZip,
    field: 'Max ZIP upload (MB)',
    file: async () => ({ name: 'big.zip', mimeType: 'application/zip', buffer: Buffer.alloc(1.5 * BYTES_PER_MB) }),
  },
]) {
  test(`the file list: an oversize ${oversize.what} is flagged and blocks Upload until removed`, async ({
    page,
    withOverrides,
  }) => {
    await withOverrides([oversize.override], { fields: { [oversize.field]: 1 } });
    await page.goto(PATHS.newGallery);
    const zone = dropZone(page);
    const big = await oversize.file();
    await zone.choose([await jpegFile('small.jpg'), big]);
    await expect(zone.flagged).toHaveCount(1);
    await expect(zone.flagged).toContainText(big.name);
    await expect(zone.flagged).toContainText('over the 1 MB limit');
    await expect(zone.flagged).toHaveAttribute('data-invalid', 'true');
    const fine = zone.rows.filter({ hasText: 'small.jpg' });
    await expect(fine).not.toHaveAttribute('data-invalid');
    expect(await colourOf(zone.flagged), 'the flagged row is drawn differently').not.toBe(await colourOf(fine));
    expect(await colourOf(zone.flagged), 'the flagged row uses the error colour').toBe(await errorColour(page));
    await expect(zone.upload).toBeDisabled();
    await zone.remove(big.name);
    await expect(zone.flagged).toHaveCount(0);
    await expect(zone.upload).toBeEnabled();
  });
}

test('the file list: a total over the batch limit flags the summary and blocks Upload', async ({
  page,
  withOverrides,
}) => {
  await withOverrides([OVERRIDES.maxBatch], { fields: { 'Max upload batch (MB)': 1 } });
  await page.goto(PATHS.newGallery);
  const padded = async (name) => {
    const file = await jpegFile(name);
    return { ...file, buffer: Buffer.concat([file.buffer, Buffer.alloc(0.6 * BYTES_PER_MB)]) };
  };
  const zone = dropZone(page);
  await zone.choose([await padded('one.jpg'), await padded('two.jpg')]);
  await expect(zone.summary).toHaveText(/^2 images, 1\.2 MB — over the 1 MB upload limit$/);
  await expect(zone.summary).toHaveAttribute('data-invalid', 'true');
  const overColour = await colourOf(zone.summary);
  expect(overColour, 'the summary uses the error colour while over the limit').toBe(await errorColour(page));
  await expect(zone.flagged).toHaveCount(0);
  await expect(zone.upload).toBeDisabled();
  await zone.remove('two.jpg');
  await expect(zone.summary).toHaveText(/^1 image, 0\.6 MB$/);
  await expect(zone.summary).not.toHaveAttribute('data-invalid', 'true');
  expect(await colourOf(zone.summary), 'the summary is drawn differently while over the limit').not.toBe(overColour);
  await expect(zone.upload).toBeEnabled();
});

test('the file list: Clear all returns to the empty state', async ({ page }) => {
  await page.goto(PATHS.newGallery);
  const zone = dropZone(page);
  await zone.choose(await threeImages('clr'));
  await expect(zone.rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(zone.selection).toBeHidden();
  await expect(zone.rows).toHaveCount(0);
  await expect(zone.upload).toBeDisabled();
  await expect(zone.input).toHaveJSProperty('files.length', 0);
});

test('the save bar counts unsaved changes, discards them, saves them, and guards leaving the page', async ({
  page,
}) => {
  await uploadImages(page, [await jpegFile('one.jpg'), await jpegFile('two.jpg')]);
  await expect(imageRows(page)).toHaveCount(2);
  const bar = saveBar(page);
  await expect(bar).toBeHidden();
  await expect(imageRows(page).nth(0).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  await imageRows(page).nth(0).getByLabel('Title').fill('Alfama');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('1 unsaved change');
  await page.locator('#gallery-title').fill('Lisbon');
  await expect(bar).toContainText('2 unsaved changes');
  await imageRows(page).nth(0).getByLabel('Title').fill('');
  await expect(bar).toContainText('1 unsaved change');

  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('#gallery-title')).toHaveValue('');

  await imageRows(page).nth(1).getByLabel('Caption').fill('Tram 28');
  await page.locator('#gallery-title').fill('Lisbon');
  await bar.getByRole('button', { name: 'Save gallery' }).click();
  await expect(savedNotice(page)).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(page.locator('#gallery-title')).toHaveValue('Lisbon');
  await expect(imageRows(page).nth(1).getByLabel('Caption')).toHaveValue('Tram 28');

  await imageRows(page).nth(0).getByLabel('Title').fill('Unsaved');
  const dialog = new Promise((resolve) => page.once('dialog', resolve));
  await page.close({ runBeforeUnload: true });
  const shown = await dialog;
  expect(shown.type()).toBe('beforeunload');
  await shown.dismiss();
});

test('with unsaved changes, a link or another form opens the Leave dialog instead of the browser popup', async ({
  page,
}) => {
  await uploadImages(page, [await jpegFile('one.jpg')]);
  const editUrl = page.url();
  const native = [];
  page.on('dialog', (shown) => {
    native.push(shown.type());
    shown.dismiss();
  });
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  const activityLink = page.locator('[data-sidebar]').getByRole('link', { name: 'My activity' });

  await imageRows(page).nth(0).getByLabel('Title').fill('Unsaved');
  await activityLink.click();
  await expect(leave).toBeVisible();
  await expect(leave).toContainText('You have 1 unsaved change.');
  await expect(leave.getByRole('button', { name: 'Stay on this page' })).toBeFocused();
  await leave.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(leave).toBeHidden();
  expect(page.url()).toBe(editUrl);
  await expect(imageRows(page).nth(0).getByLabel('Title')).toHaveValue('Unsaved');

  await activityLink.click();
  await expect(leave).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(leave).toBeHidden();
  expect(page.url()).toBe(editUrl);

  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.locator('[data-confirm-panel]:visible').getByRole('button', { name: 'Yes' }).click();
  await expect(leave).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(leave).toBeHidden();
  expect(page.url()).toBe(editUrl);

  await activityLink.click();
  await leave.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).toHaveURL(new RegExp(`${PATHS.activity}$`));
  expect(native, 'the browser popup never showed').toEqual([]);

  await page.goto(editUrl);
  await expect(imageRows(page).nth(0).getByLabel('Title')).toHaveValue('');
  await activityLink.click();
  await expect(page).toHaveURL(new RegExp(`${PATHS.activity}$`));
  expect(native).toEqual([]);
});

test('Delete on an image waits for Save gallery: the save bar counts it, Undo and Discard bring it back', async ({
  page,
}) => {
  await uploadImages(page, [await jpegFile('1-keep.jpg'), await jpegFile('2-drop.jpg')]);
  await expect(imageRows(page)).toHaveCount(2);
  const bar = saveBar(page);
  const row = imageRows(page).nth(1);
  const toggle = deleteToggle(row);

  await toggle.click();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('1 unsaved change');
  await expect(toggle).toHaveText(/Undo/);
  await expect(row.getByText('Deleted when you save')).toBeVisible();
  await expect(row.locator('img')).toHaveCSS('opacity', '0.4');

  await toggle.click();
  await expect(bar).toBeHidden();
  await expect(toggle).toHaveText(/Delete/);
  await expect(row.getByText('Deleted when you save')).toBeHidden();

  await toggle.click();
  await imageRows(page).nth(0).getByLabel('Title').fill('Kept one');
  await expect(bar).toContainText('2 unsaved changes');
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(bar).toBeHidden();
  await expect(toggle).toHaveText(/Delete/);
  await expect(imageRows(page)).toHaveCount(2);

  await toggle.click();
  await bar.getByRole('button', { name: 'Save gallery', exact: true }).click();
  await expect(savedNotice(page)).toBeVisible();
  await expect(imageRows(page)).toHaveCount(1);
  expect(await names(page)).toEqual(['1-keep.jpg']);
});

test('a notice closes with its × and stays closed on that page', async ({ page }) => {
  await uploadImages(page, await sceneFiles(1, { first: 6, prefix: 'notice' }));
  await saveDetails(page, { title: unique('Notice') });
  const notice = savedNotice(page);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();
});

test('uploading a picture the gallery already has, even resized, skips it as "Already in this gallery."', async ({
  page,
}) => {
  const id = await uploadImages(page, await sceneFiles(2, { first: 7, prefix: 'dupe' }));
  await expect(imageRows(page)).toHaveCount(2);
  const [again] = await sceneFiles(1, { first: 7, prefix: 'dupe-again', width: 600 });
  const [fresh] = await sceneFiles(1, { first: 9, prefix: 'dupe-new' });
  await uploadImages(page, [again, fresh], { from: PATH_TO.gallery(id) });
  const skipped = page.locator('[data-skipped]');
  await expect(skipped).toBeVisible();
  await expect(skipped).toContainText(again.name);
  await expect(skipped).toContainText('Already in this gallery.');
  await expect(imageRows(page)).toHaveCount(3);
});
