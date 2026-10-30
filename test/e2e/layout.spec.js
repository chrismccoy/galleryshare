import { expect, signInAdmin, test } from './support/fixtures.js';
import { PATHS } from '../../config/urls.js';

test('the sidebar column spans a long page and its nav stays in view while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 680 });
  await signInAdmin(page);
  await page.goto(PATHS.admin.settings);
  const sidebar = page.locator('[data-sidebar]');
  const panel = sidebar.locator(':scope > div');
  await expect(sidebar).toBeVisible();

  const layout = await page.evaluate(() => {
    const aside = document.querySelector('[data-sidebar]');
    const inner = aside.firstElementChild;
    return {
      asidePosition: getComputedStyle(aside).position,
      panelPosition: getComputedStyle(inner).position,
      asideHeight: aside.getBoundingClientRect().height,
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      asideRight: aside.getBoundingClientRect().right,
      mainLeft: document.querySelector('main').getBoundingClientRect().left,
    };
  });
  expect(['static', 'relative']).toContain(layout.asidePosition);
  expect(layout.panelPosition).toBe('sticky');
  expect(layout.pageHeight).toBeGreaterThan(layout.viewportHeight * 2);
  expect(layout.asideHeight).toBeGreaterThanOrEqual(layout.pageHeight - 1);
  expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.asideRight - 1);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = await panel.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeLessThan(5);
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeInViewport();
});
