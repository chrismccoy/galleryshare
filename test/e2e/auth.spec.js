import { ADMIN, USERS, expect, fillLogin, signIn, signInAdmin, signOut, test } from './support/fixtures.js';
import { PATHS } from '../../config/urls.js';

test.describe('sign in', () => {
  test('the .env admin signs in and sees the admin area', async ({ page }) => {
    await page.goto(PATHS.login);
    await expect(page.getByRole('heading', { name: 'GalleryShare' })).toBeVisible();
    await fillLogin(page, ADMIN);

    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(PATHS.admin.overview);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' }).first();
    for (const name of ['Overview', 'Users', 'Invites', 'Galleries', 'Shared links', 'Activity', 'Settings']) {
      await expect(nav.getByRole('link', { name: new RegExp(`^${name}\\b`) })).toBeAttached();
    }
  });

  test('a wrong password shows the generic error and stays on the login page', async ({ page }) => {
    await page.goto(PATHS.login);
    await fillLogin(page, { email: ADMIN.email, password: 'not the right password' });

    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Email')).toHaveValue(ADMIN.email);
  });

  test('an anonymous visitor is sent to the login page and returned afterwards', async ({ page }) => {
    await page.goto(PATHS.galleries);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fgalleries$/);
    await fillLogin(page, USERS.plain);
    await expect(page).toHaveURL(/\/dashboard\/galleries$/);
  });
});

test.describe('sign out', () => {
  test('logging out ends the session', async ({ page }) => {
    await signInAdmin(page);
    await signOut(page);
    await page.goto(PATHS.dashboard);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test('logging out from My galleries ends the session', async ({ page }) => {
    await signIn(page, USERS.plain);
    await page.goto(PATHS.galleries);
    await signOut(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test('a non-admin gets the ordinary 404 on /admin pages', async ({ page }) => {
  await signIn(page, USERS.plain);
  for (const path of [
    PATHS.admin.overview,
    PATHS.admin.users,
    PATHS.admin.galleries,
    PATHS.admin.shares,
    PATHS.admin.settings,
  ]) {
    const response = await page.goto(path);
    expect(response.status(), path).toBe(404);
    await expect(page.getByText('Page not found.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  }
  await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Users' })).toHaveCount(
    0,
  );
});
