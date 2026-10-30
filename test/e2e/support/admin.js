import { expect } from '@playwright/test';
import { PATHS } from '../../../config/urls.js';
import { unique } from './names.js';
import { pickButton } from './galleries.js';
import { OVERRIDE_SWITCHES, SETTING_KEYS } from '../../../domain/settings.js';
import { TUNABLES } from '../../../domain/limits.js';

export async function inviteUser(adminPage, openPage, { label = unique('invite'), name = 'Invited Person' } = {}) {
  const url = await createInvite(adminPage, { label });

  const account = { name, email: `${unique('user')}@e2e.test`, password: 'invited user password' };
  const page = await openPage();
  await page.goto(url);
  await page.getByLabel('Your name').fill(account.name);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { page, account, url, label };
}

export async function createInvite(adminPage, { role = 'user', label } = {}) {
  await adminPage.goto(PATHS.admin.invites);
  await adminPage.getByLabel('Role').selectOption(role);
  if (label !== undefined) await adminPage.getByLabel('Label (optional)').fill(label);
  await adminPage.getByRole('button', { name: 'Create invite' }).click();
  const url = await adminPage.getByLabel('One-time link').inputValue();
  expect(url).toMatch(new RegExp(`${PATHS.invite}/[A-Za-z0-9_-]+$`));
  return url;
}

export async function adminUserPath(adminPage, email) {
  await adminPage.goto(PATHS.admin.users);
  const row = adminPage.getByRole('row').filter({ hasText: email });
  const href = await row.getByRole('link', { name: 'Manage' }).getAttribute('href');
  expect(href).toMatch(new RegExp(`^${PATHS.admin.users}/\\d+$`));
  return href;
}

const switchTitle = (name) => OVERRIDE_SWITCHES.find((item) => item.name === name).title;

export const OVERRIDES = Object.freeze({
  maxImage: switchTitle(TUNABLES.maxImageMb.overrideKey),
  maxZip: switchTitle(TUNABLES.maxZipUploadMb.overrideKey),
  maxBatch: switchTitle(TUNABLES.maxUploadBatchMb.overrideKey),
  perGallery: switchTitle(TUNABLES.maxImagesPerGallery.overrideKey),
  itemsPerPage: switchTitle(SETTING_KEYS.overrideItemsPerPage),
  gridText: switchTitle(SETTING_KEYS.overrideShareGridText),
  shareTheme: switchTitle(SETTING_KEYS.overrideShareTheme),
  imageView: switchTitle(SETTING_KEYS.overrideShareImageView),
});

export const DEFAULT_SETTINGS = Object.freeze({ overridesOn: [], toggles: { 'Public share links': true } });

export async function saveAdminSettings(adminPage, { overridesOn, toggles = {}, fields = {}, choices = {} } = {}) {
  await adminPage.goto(PATHS.admin.settings);
  if (overridesOn) {
    const boxes = adminPage.locator('input[type="checkbox"][name^="override_"]');
    const count = await boxes.count();
    for (let i = 0; i < count; i += 1) {
      const box = boxes.nth(i);
      const title = await box.getAttribute('aria-label');
      await box.setChecked(overridesOn.includes(title), { force: true });
    }
  }
  for (const [title, state] of Object.entries(toggles)) {
    await adminPage.getByRole('checkbox', { name: title }).setChecked(state, { force: true });
  }
  for (const [label, value] of Object.entries(fields)) {
    await adminPage.getByLabel(label, { exact: true }).fill(String(value));
  }
  for (const [legend, label] of Object.entries(choices)) await pickButton(adminPage.locator('form'), legend, label);
  if (await adminPage.locator('[data-save-bar]').isHidden()) return;
  await adminPage.getByRole('button', { name: 'Save settings' }).click();
  await expect(adminPage.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
}
