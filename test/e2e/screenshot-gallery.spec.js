import { expect, test } from './support/fixtures.js';
import { expectLightboxBehaviour } from './support/lightbox.js';
import { SCREENSHOTS_PATH } from '../../config/root.js';

test('the screenshot gallery lightbox behaves like the shared gallery one', async ({ page }) => {
  const response = await page.goto(`${SCREENSHOTS_PATH}/`);
  expect(response.status()).toBe(200);
  await expect(page.locator('figure[data-shot]').first()).toBeVisible();
  await expect(page.locator('header i[aria-hidden="true"]').first()).toBeVisible();
  await expectLightboxBehaviour(page, { itemLabel: 'Screenshot' });
});
