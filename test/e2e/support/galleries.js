import { expect } from '@playwright/test';
import { PATHS } from '../../../config/urls.js';

export async function confirmRowAction(row, button, { question } = {}) {
  await row.getByRole('button', { name: button, exact: true }).click();
  if (question) await expect(row.getByText(question)).toBeVisible();
  await row.getByRole('button', { name: 'Yes' }).click();
}

export const GALLERY_PATH = new RegExp(`^https?://[^/]+${PATHS.galleries}/(\\d+)(\\?.*)?$`);
const JOB_PATH = new RegExp(`^${PATHS.ingestJobs}/\\d+$`);

export async function uploadImages(page, files, { from = PATHS.newGallery } = {}) {
  if (from) await page.goto(from);
  const zone = dropZone(page);
  await zone.choose(files);
  const jobPage = page.waitForResponse((response) => JOB_PATH.test(new URL(response.url()).pathname));
  await zone.upload.click();
  await jobPage;
  await expect(page).toHaveURL(GALLERY_PATH, { timeout: UPLOAD_TIMEOUT });
  return Number(GALLERY_PATH.exec(page.url())[1]);
}

export const UPLOAD_TIMEOUT = 30_000;

export function dropZone(page) {
  const input = page.locator('[data-upload-input]');
  const rows = page.locator('[data-upload-list] li');
  return {
    input,
    upload: page.getByRole('button', { name: 'Upload', exact: true }),
    summary: page.locator('[data-upload-chosen]'),
    selection: page.locator('[data-upload-selection]'),
    rows,
    flagged: page.locator('[data-upload-list] li[data-invalid]'),
    status: page.locator('[data-upload-status]'),
    choose: (files) => input.setInputFiles(files),
    remove: (name) => page.getByRole('button', { name: `Remove ${name}` }).click(),
  };
}

export const galleryPath = (id) => `${PATHS.galleries}/${id}`;

export const imageRows = (page) => page.locator('[data-reorder-list] > [data-image-id]');

export const savedNotice = (page) => page.getByRole('status').filter({ hasText: 'Gallery saved.' });

export async function setImageText(page, index, { title, caption }) {
  const row = imageRows(page).nth(index);
  if (title !== undefined) await row.getByLabel('Title').fill(title);
  if (caption !== undefined) await row.getByLabel('Caption').fill(caption);
  await saveBar(page).getByRole('button', { name: 'Save gallery' }).click();
  await expect(savedNotice(page)).toBeVisible();
}

export const deleteToggle = (row) => row.locator('label:has([data-remove-image])');

export async function deleteImages(page, indexes) {
  for (const index of indexes) await deleteToggle(imageRows(page).nth(index)).click();
  await saveBar(page).getByRole('button', { name: 'Save gallery', exact: true }).click();
  await expect(savedNotice(page)).toBeVisible();
}

export const saveBar = (page) => page.locator('[data-save-bar]');

export async function pickButton(scope, legend, label) {
  const group = scope.getByRole('group', { name: legend });
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await group
    .locator('label')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
    .click();
  await expect(group.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

export async function saveDetails(page, { title, description, allowZip, gridText, imageView, shareTheme } = {}) {
  const form = page.locator('form', { has: page.locator('#gallery-title') });
  if (title !== undefined) await form.locator('#gallery-title').fill(title);
  if (description !== undefined) await form.locator('#gallery-description').fill(description);
  if (allowZip !== undefined) {
    await form.getByRole('checkbox', { name: 'Allow ZIP download' }).setChecked(allowZip, { force: true });
  }
  if (imageView !== undefined) await pickButton(form, 'Image view', imageView);
  if (shareTheme !== undefined) await pickButton(form, 'Share theme', shareTheme);
  if (gridText !== undefined) {
    await form
      .getByRole('group', { name: 'Titles and captions on the grid' })
      .getByRole('radio', { name: gridText, exact: true })
      .check({ force: true });
  }
  await saveBar(page).getByRole('button', { name: 'Save gallery', exact: true }).click();
  await expect(savedNotice(page)).toBeVisible();
}

export async function shareGallery(page) {
  await page.locator('[data-share-panel]').getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Share link created.' })).toBeVisible();
  const url = await page.locator('[data-share-url]').inputValue();
  expect(url).toMatch(/\/s\/[0-9A-Za-z]{7}$/);
  return url;
}
