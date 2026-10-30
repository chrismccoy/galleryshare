import { expect } from '@playwright/test';

export async function expectNoSidewaysScroll(page) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scrollWidth, 'no sideways page scroll').toBeLessThanOrEqual(width);
}

export async function expectInsideWidth(page, locator, what, { slack = 0 } = {}) {
  const width = page.viewportSize().width;
  const box = await locator.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} right edge`).toBeLessThanOrEqual(width + slack);
}
