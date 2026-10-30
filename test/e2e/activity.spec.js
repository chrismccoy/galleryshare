import {
  ADMIN,
  OVERRIDES,
  USERS,
  expect,
  inviteUser,
  saveDetails,
  shareGallery,
  signIn,
  signInAdmin,
  test,
  unique,
  uploadImages,
} from './support/fixtures.js';
import { jpegFile, sceneFiles } from './support/images.js';
import { PATHS } from '../../config/urls.js';

test('sharing and visiting show on My activity and on the admin Activity', async ({ page, openPage }) => {
  await signIn(page, USERS.activity);
  await uploadImages(page, [await jpegFile('activity.jpg', { background: '#81b29a' })]);
  const title = unique('Activity');
  await saveDetails(page, { title });
  const url = await shareGallery(page);

  const visitor = await openPage();
  expect((await visitor.goto(url)).status()).toBe(200);

  await page.goto(PATHS.activity);
  await expect(page.getByRole('heading', { name: 'My activity', level: 1 })).toBeVisible();
  const mine = page.locator('table.data-table tbody tr');
  const shared = mine.filter({ hasText: 'Link shared' }).filter({ hasText: title });
  await expect(shared.first()).toContainText('You');
  const visited = mine.filter({ hasText: 'Gallery visited' }).filter({ hasText: title });
  await expect(visited.first()).toContainText('Visitor');
  await expect(page.getByRole('columnheader', { name: 'From' })).toHaveCount(0);
  await expect(page.getByText(/Newest first · kept \d+ days/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'My activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Activity( [\d,]+)?$/ })).toHaveCount(0);

  const admin = await openPage();
  await signInAdmin(admin);
  await admin.getByRole('link', { name: /^Activity( [\d,]+)?$/ }).click();
  await expect(admin.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  const rows = admin.locator('table.data-table tbody tr');
  await expect(rows.filter({ hasText: 'Link shared' }).filter({ hasText: title }).first()).toContainText(
    USERS.activity.name,
  );
  const visit = rows.filter({ hasText: 'Gallery visited' }).filter({ hasText: title }).first();
  await expect(visit).toContainText('Visitor');
  await expect(visit).toContainText(/\d+\.\d+\.\d+\.\d+|::1/);
  await expect(admin.getByRole('columnheader', { name: 'From' })).toBeVisible();
});

test('the dashboard and Overview show Recent activity; the sidebar counts galleries, users and invites', async ({
  page,
  openPage,
}) => {
  await signIn(page, USERS.activity);
  const badge = page.locator('[data-sidebar] [data-nav-count="galleries"]');
  const before = (await badge.count()) ? Number(await badge.textContent()) : 0;
  await uploadImages(page, await sceneFiles(2, { prefix: 'recent' }));
  await saveDetails(page, { title: unique('Recent') });
  await shareGallery(page);
  await page.goto(PATHS.dashboard);
  const card = page.locator('[data-widget="activity"]');
  await expect(card.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(card.getByRole('row').filter({ hasText: 'Link shared' }).first()).toBeVisible();
  await card.getByRole('link', { name: 'All activity' }).click();
  await expect(page).toHaveURL(PATHS.activity);
  await expect(badge).toHaveText(String(before + 1));
  await expect(page.locator('[data-sidebar] [data-nav-count="activity"]')).toBeVisible();

  const admin = await openPage();
  await signIn(admin, ADMIN);
  await admin.goto(PATHS.admin.overview);
  const adminCard = admin.locator('[data-widget="activity"]');
  await expect(adminCard.getByRole('columnheader', { name: 'From' })).toBeVisible();
  await expect(adminCard.getByRole('row')).not.toHaveCount(0);
  for (const key of ['users', 'allGalleries', 'allActivity', 'shares']) {
    await expect(admin.locator(`[data-sidebar] [data-nav-count="${key}"]`), key).toHaveText(/^\d+$/);
  }
});

test('Activity filters by area and by gallery, and the admin page also by person', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { page: member, account } = await inviteUser(page, openPage, { name: 'Filter Fay' });
  const kept = unique('Kept');
  const other = unique('Other');
  await uploadImages(member, [await jpegFile('kept.jpg')]);
  await saveDetails(member, { title: kept });
  await shareGallery(member);
  await uploadImages(member, [await jpegFile('other.jpg')]);
  await saveDetails(member, { title: other });

  await member.goto(PATHS.activity);
  const rows = member.locator('table.data-table tbody tr');
  await member.getByLabel('Area').selectOption({ label: 'Sharing' });
  await member.getByRole('button', { name: 'Filter' }).click();
  await expect(member).toHaveURL(/area=sharing/);
  await expect(rows.filter({ hasText: 'Link shared' }).filter({ hasText: kept })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Gallery created' })).toHaveCount(0, { message: 'other areas are hidden' });

  await member.getByLabel('Area').selectOption({ label: 'All areas' });
  await member.getByLabel('Gallery').selectOption({ label: other });
  await member.getByRole('button', { name: 'Filter' }).click();
  await expect(rows.filter({ hasText: other }).first()).toBeVisible();
  await expect(rows.filter({ hasText: kept })).toHaveCount(0, { message: 'only the chosen gallery' });

  await page.goto(PATHS.admin.activity);
  await page.getByLabel('Person').selectOption({ label: account.name });
  await page.getByRole('button', { name: 'Filter' }).click();
  const adminRows = page.locator('table.data-table tbody tr');
  await expect(adminRows.filter({ hasText: kept }).first()).toBeVisible();
  await expect(adminRows.filter({ hasText: 'Admin' }).filter({ hasText: 'Invite created' })).toHaveCount(0, {
    message: "another person's events are hidden",
  });
});

test('long lists page back: "Older galleries" on My galleries and "Older activity" on My activity', async ({
  page,
  openPage,
  withOverrides,
}) => {
  await withOverrides([OVERRIDES.itemsPerPage], { fields: { 'Items per page': 5 } });
  await signInAdmin(page);
  const { page: member } = await inviteUser(page, openPage, { name: 'Paging Pat' });
  const titles = [];
  for (let i = 0; i < 6; i++) {
    titles.push(unique(`Page${i}`));
    await uploadImages(member, [await jpegFile(`page-${i}.jpg`)]);
    await saveDetails(member, { title: titles[i] });
  }

  await member.goto(PATHS.galleries);
  await expect(member.locator('[data-gallery-row]')).toHaveCount(5);
  await expect(member.locator('[data-gallery-row]').filter({ hasText: titles[0] })).toHaveCount(0);
  await member.getByRole('link', { name: 'Older galleries' }).click();
  await expect(member).toHaveURL(/before_id=\d+/);
  await expect(member.locator('[data-gallery-row]')).toHaveCount(1);
  await expect(member.locator('[data-gallery-row]').filter({ hasText: titles[0] })).toHaveCount(1);
  await expect(member.getByRole('link', { name: 'Older galleries' })).toHaveCount(0);

  await member.goto(PATHS.activity);
  const rows = member.locator('table.data-table tbody tr');
  await expect(rows).toHaveCount(5);
  await member.getByRole('link', { name: 'Older activity' }).click();
  await expect(member).toHaveURL(/before_id=\d+/);
  await expect(rows.first()).toBeVisible();
});
