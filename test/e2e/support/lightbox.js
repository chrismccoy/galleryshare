import { expect } from '@playwright/test';

async function openFrom(page, link) {
  await link.focus();
  await link.press('Enter');
  await expect(page.locator('#lightbox')).toBeVisible();
  await expect(page.locator('#lb-close')).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
}

async function expectClosed(page, link) {
  await expect(page.locator('#lightbox')).toBeHidden();
  await expect(link).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
}

export async function expectLightboxBehaviour(page, { itemLabel }) {
  const cards = page.locator('figure[data-shot]');
  const count = await cards.count();
  expect(count, 'at least two cards').toBeGreaterThan(1);
  const link = cards.first().locator('a');
  const counter = page.locator('#lb-counter');

  await expect(page.locator('#lightbox')).toBeHidden();
  await openFrom(page, link);
  await expect(counter).toHaveText(`1 / ${count}`);
  await expect(page.locator('#lb-strip button')).toHaveCount(count);
  await expect(page.locator('#lb-strip button').first()).toHaveAttribute('aria-label', `${itemLabel} 1`);
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText(`2 / ${count}`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText(`${count} / ${count}`, { message: 'ArrowLeft wraps to the last image' });
  await page.keyboard.press('Escape');
  await expectClosed(page, link);

  await openFrom(page, link);
  const inside = () => page.evaluate(() => document.getElementById('lightbox').contains(document.activeElement));
  for (let i = 0; i < count + 8; i++) {
    await page.keyboard.press('Tab');
    expect(await inside(), `focus stays in the lightbox after ${i + 1} Tab presses`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await inside(), 'Shift+Tab stays in the lightbox').toBe(true);
  await page.keyboard.press('Escape');
  await expectClosed(page, link);

  await openFrom(page, link);
  await page.locator('#lb-close').click();
  await expectClosed(page, link);

  await openFrom(page, link);
  await page.locator('#lightbox').click({ position: { x: 5, y: 5 } });
  await expectClosed(page, link);
}
