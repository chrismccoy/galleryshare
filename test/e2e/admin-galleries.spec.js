import {
  adminUserPath,
  confirmRowAction,
  expect,
  inviteUser,
  saveDetails,
  signInAdmin,
  test,
  unique,
  uploadImages,
} from './support/fixtures.js';
import { jpegFile } from './support/images.js';
import { PATHS, PATH_TO } from '../../config/urls.js';

async function galleryOf(page, title) {
  const id = await uploadImages(page, [await jpegFile(`${title}.jpg`)]);
  await saveDetails(page, { title });
  return id;
}

test("Admin → Galleries narrows to one owner, and an admin's Move to Trash lands in the owner's Trash", async ({
  page,
  openPage,
}) => {
  await signInAdmin(page);
  const { page: owner, account } = await inviteUser(page, openPage, { name: 'Gallery Owner' });
  const { page: other } = await inviteUser(page, openPage, { name: 'Someone Else' });
  const mine = unique('Mine');
  const theirs = unique('Theirs');
  await galleryOf(owner, mine);
  await galleryOf(other, theirs);

  const ownerId = (await adminUserPath(page, account.email)).split('/').pop();
  await page.goto(PATHS.admin.galleries);
  await page.getByLabel('User ID').fill(ownerId);
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?user=${ownerId}$`));
  const rows = page.locator('[data-gallery-row]');
  await expect(rows.filter({ hasText: mine })).toHaveCount(1);
  await expect(rows.filter({ hasText: theirs })).toHaveCount(0);
  await expect(rows.first()).toContainText('Gallery Owner');

  await confirmRowAction(rows.filter({ hasText: mine }), 'Move to Trash', { question: 'Move to Trash?' });
  await expect(page.getByRole('status')).toContainText('Moved to Trash.');
  await expect(page.locator('[data-gallery-row]').filter({ hasText: mine })).toHaveCount(0);
  await owner.goto(PATHS.trash);
  await expect(owner.locator('[data-trash-row]').filter({ hasText: mine })).toHaveCount(1);
});

test('an admin edits a member\'s gallery; the owner then sees "Edited by an admin"', async ({ page, openPage }) => {
  await signInAdmin(page);
  const { page: owner } = await inviteUser(page, openPage, { name: 'Edited Owner' });
  const title = unique('Edited');
  const id = await galleryOf(owner, title);
  await owner.goto(PATHS.galleries);
  const row = owner.locator('[data-gallery-row]').filter({ hasText: title });
  await expect(row.locator('[data-edited-by-admin]')).toHaveCount(0, { message: 'not before an admin edits it' });

  await page.goto(PATH_TO.gallery(id));
  await saveDetails(page, { description: 'Fixed by the admin.' });

  await owner.reload();
  await expect(row.locator('[data-edited-by-admin]')).toHaveText(/Edited by an admin/);
  await owner.goto(PATH_TO.gallery(id));
  await expect(owner.locator('[data-edited-by-admin]')).toBeVisible();
  await expect(owner.getByLabel('Description (optional)')).toHaveValue('Fixed by the admin.');
});
