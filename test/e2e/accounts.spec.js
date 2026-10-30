import {
  adminUserPath,
  createInvite,
  expect,
  fillLogin,
  inviteUser,
  signIn,
  signInAdmin,
  signOut,
  test,
  unique,
} from './support/fixtures.js';
import { PATHS } from '../../config/urls.js';

test('an invited person registers and lands signed in on an empty dashboard', async ({ page, openPage }) => {
  await signInAdmin(page);
  const label = unique('invite');
  const { page: guest, account } = await inviteUser(page, openPage, { label, name: 'Invited Ivy' });

  await expect(guest.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(guest.locator('[data-widget="galleries"]')).toBeVisible();
  await guest.goto(PATHS.account);
  await expect(guest.getByText(`Signed in as ${account.email}`)).toBeVisible();

  await page.goto(PATHS.admin.invites);
  await expect(page.getByRole('row').filter({ hasText: label })).toContainText('used');

  await page.goto(PATHS.admin.users);
  await expect(page.getByRole('row').filter({ hasText: account.email })).toContainText('Invited Ivy');
});

test('a used invite link is refused', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { url } = await inviteUser(page, openPage);
  const stranger = await openPage();
  await stranger.goto(url);
  await expect(stranger.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  await expect(stranger.getByText('Ask the admin for a new invite link.')).toBeVisible();
});

test('a reset link lets the user set a new password and sign in with it', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { page: guest, account } = await inviteUser(page, openPage, { name: 'Reset Rita' });
  await signOut(guest);

  const userPath = await adminUserPath(page, account.email);
  await page.goto(userPath);
  await page.getByRole('button', { name: 'Generate reset link' }).click();
  const url = await page.getByLabel('One-time link').inputValue();
  expect(url).toMatch(/\/reset\/[A-Za-z0-9_-]+$/);

  const newPassword = 'a brand new password';
  const visitor = await openPage();
  await visitor.goto(url);
  await visitor.getByLabel('New password').fill(newPassword);
  await visitor.getByRole('button', { name: 'Set password' }).click();
  await expect(visitor).toHaveURL(/\/login\?notice=reset$/);
  await expect(visitor.getByRole('status')).toHaveText('Password updated. Sign in with your new password.');

  await fillLogin(visitor, account);
  await expect(visitor.getByRole('alert')).toHaveText('Incorrect email or password.');

  await signIn(visitor, { email: account.email, password: newPassword });
  await visitor.goto(PATHS.account);
  await expect(visitor.getByText(`Signed in as ${account.email}`)).toBeVisible();

  const again = await openPage();
  await again.goto(url);
  await expect(again.getByRole('button', { name: 'Set password' })).toHaveCount(0);
  await expect(again.getByText('Ask the admin for a new reset link.')).toBeVisible();
});

test('after leaving Invites and coming back, Copy puts a pending invite link on the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signInAdmin(page);
  const label = unique('copy');
  const link = await createInvite(page, { label });

  await page.goto(PATHS.dashboard);
  await page.goto(PATHS.admin.invites);
  await expect(page.getByLabel('One-time link')).toHaveCount(0);
  const row = page.locator('tbody tr').filter({ hasText: label });
  await row.getByRole('button', { name: 'Copy' }).click();
  await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expect(row.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 4000 });

  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: label }).getByRole('button', { name: 'Copy' })).toHaveCount(
    0,
  );
});

test('an admin disables an account, which signs it out and refuses sign-in, then enables it again', async ({
  page,
  openPage,
}) => {
  await signInAdmin(page);
  const { page: guest, account } = await inviteUser(page, openPage, { name: 'Disabled Dana' });
  await page.goto(await adminUserPath(page, account.email));
  await page.getByRole('button', { name: 'Disable account' }).click();
  await expect(page.getByRole('status')).toHaveText('Account disabled.');
  await expect(page.getByRole('button', { name: 'Enable account' })).toBeVisible();

  await guest.goto(PATHS.dashboard);
  await expect(guest).toHaveURL((url) => url.pathname === PATHS.login, { message: 'the open session ended' });
  await fillLogin(guest, account);
  await expect(guest.getByRole('alert')).toHaveText('Incorrect email or password.');

  await page.getByRole('button', { name: 'Enable account' }).click();
  await expect(page.getByRole('status')).toHaveText('Account enabled.');
  await signIn(guest, account);
  await expect(guest.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
});

test('an admin changes a role, then deletes the user after the confirmation page', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { page: guest, account } = await inviteUser(page, openPage, { name: 'Role Robin' });
  const userPath = await adminUserPath(page, account.email);
  await page.goto(userPath);
  await page.getByLabel('Role').selectOption('admin');
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByRole('status')).toHaveText('Role updated.');
  await guest.goto(PATHS.admin.users);
  await expect(guest.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();

  await page.getByRole('link', { name: 'Delete user' }).click();
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL((url) => url.pathname === userPath, { message: 'Cancel keeps the user' });
  await page.getByRole('link', { name: 'Delete user' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page).toHaveURL(/\/admin\/users\?notice=deleted$/);
  await expect(page.getByRole('status')).toHaveText('User deleted.');
  await expect(page.getByRole('row').filter({ hasText: account.email })).toHaveCount(0);
  await guest.goto(PATHS.dashboard);
  await expect(guest).toHaveURL((url) => url.pathname === PATHS.login, { message: 'the deleted user is signed out' });
});

test('an unused invite can be revoked, and its link then says so', async ({ page, openPage }) => {
  await signInAdmin(page);
  const label = unique('revoke');
  const url = await createInvite(page, { label });
  await page.goto(PATHS.admin.invites);
  const row = page.getByRole('row').filter({ hasText: label });
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('status')).toHaveText('Invite revoked.');
  await expect(page.getByRole('row').filter({ hasText: label })).toContainText('revoked');
  const stranger = await openPage();
  await stranger.goto(url);
  await expect(stranger.getByText('This invite link has been revoked.')).toBeVisible();
  await expect(stranger.getByRole('button', { name: 'Create account' })).toHaveCount(0);
});

test('changing your password on the account page signs out your other devices', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { page: guest, account } = await inviteUser(page, openPage, { name: 'Two Devices' });
  const other = await openPage();
  await signIn(other, account);
  const newPassword = 'another long password';
  await guest.goto(PATHS.account);
  await guest.getByLabel('Current password').fill(account.password);
  await guest.getByLabel('New password').fill(newPassword);
  await guest.getByRole('button', { name: 'Change password' }).click();
  await expect(guest.getByRole('status')).toHaveText('Password changed.');
  await guest.goto(PATHS.dashboard);
  await expect(guest.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({ timeout: 5000 });

  await other.goto(PATHS.dashboard);
  await expect(other).toHaveURL((url) => url.pathname === PATHS.login, { message: 'the other device is signed out' });
  await fillLogin(other, account);
  await expect(other.getByRole('alert')).toHaveText('Incorrect email or password.');
  await signIn(other, { email: account.email, password: newPassword });
});
