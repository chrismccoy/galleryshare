import {
  expect,
  OVERRIDES,
  saveDetails,
  shareGallery,
  signIn,
  test,
  unique,
  uploadImages,
  USERS,
} from './support/fixtures.js';
import { sceneFiles as scenes } from './support/images.js';
import { SHARE_THEMES } from '../../domain/share-themes.js';

async function sharedGallery(page, { count = 3, details = {} } = {}) {
  await uploadImages(page, await scenes(count));
  await saveDetails(page, { title: unique('Looks'), description: 'Seen through each theme.', ...details });
  return shareGallery(page);
}

function readable(text, face) {
  const parse = (css) => (css.match(/[\d.]+/g) ?? []).map(Number);
  const [fr, fg, fb, fa = 1] = parse(face);
  if (fa < 0.5) return true;
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a1, a2] = [luminance(parse(text).slice(0, 3)), luminance([fr, fg, fb])].sort((x, y) => y - x);
  return (a1 + 0.05) / (a2 + 0.05) >= 3;
}

test('every share theme wraps the gallery, an image page and a single image; App window puts the title in its bar', async ({
  page,
  openPage,
}) => {
  await signIn(page, USERS.looks);
  const url = await sharedGallery(page, { count: 3 });
  const edit = page.url();
  const title = await page.locator('#gallery-title').inputValue();
  const visitor = await openPage();

  for (const { key, label } of SHARE_THEMES) {
    await page.goto(edit);
    await saveDetails(page, { shareTheme: label, imageView: 'Image page' });
    await visitor.goto(url);
    const shell = visitor.locator(`[data-share-theme="${key}"]`);
    await expect(shell, key).toBeVisible();
    await expect(shell.locator('figure[data-shot]'), key).toHaveCount(3);
    await expect(visitor.getByRole('heading', { level: 1 }), key).toHaveText(title);
    if (key === 'none') await expect(visitor.locator('[data-share-count]')).toHaveCount(0);
    else await expect(shell.locator('[data-share-count]'), key).toHaveText('3 photos');
    const radius = await shell.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    if (key === 'none') expect(radius, key).toBe('0px');
    else expect(Number.parseFloat(radius), `${key} has its rounded panel`).toBeGreaterThan(0);

    await page.goto(url);
    const { text, face } = await page
      .locator('[data-public-header]')
      .getByRole('link', { name: 'Dashboard' })
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { text: style.color, face: style.backgroundColor };
      });
    expect(readable(text, face), `${key}: Dashboard text ${text} on ${face}`).toBe(true);

    await shell.locator('figure[data-shot] a').nth(1).click();
    const pageShell = visitor.locator(`[data-share-theme="${key}"]`);
    await expect(pageShell.locator('[data-image-page]'), `${key} image page`).toBeVisible();
    await expect(pageShell.locator('[data-image-counter]')).toHaveText('Photo 2 of 3');
    await expect(pageShell.locator('[data-image-page] img')).toHaveJSProperty('complete', true);
  }

  await page.goto(edit);
  await saveDetails(page, { shareTheme: 'App window', imageView: 'Lightbox' });
  await visitor.goto(url);
  const bar = visitor.locator('.share-window-bar');
  await expect(bar.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(visitor.locator('.share-window-body [data-share-description]')).toHaveText('Seen through each theme.');

  await uploadImages(page, await scenes(1, { first: 5, prefix: 'single' }));
  await saveDetails(page, { title: unique('Single look'), shareTheme: 'Polaroid' });
  const single = await shareGallery(page);
  await visitor.goto(single);
  const singleShell = visitor.locator('[data-share-theme="polaroid"]');
  await expect(singleShell.locator('[data-share-single]')).toBeVisible();
  await expect(singleShell.locator('[data-share-count]')).toHaveText('1 photo');
});

test('New tab view: a thumbnail opens the large .webp alone in a new tab; no lightbox is loaded', async ({
  page,
  openPage,
}) => {
  await signIn(page, USERS.looks);
  const url = await sharedGallery(page, { count: 2, details: { imageView: 'New tab' } });
  const visitor = await openPage();
  await visitor.goto(url);
  await expect(visitor.locator('#lightbox')).toHaveCount(0);
  const card = visitor.locator('figure[data-shot] a').first();
  await expect(card).toHaveAttribute('target', '_blank');
  const [tab] = await Promise.all([visitor.context().waitForEvent('page'), card.click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/\/s\/[0-9A-Za-z]{7}\/i\/[0-9A-Za-z]{10}\.webp$/);
  await tab.close();
});

test("the admin's site theme, image view and grid text apply to galleries that follow the site", async ({
  page,
  openPage,
  withOverrides,
}) => {
  await signIn(page, USERS.looks);
  const url = await sharedGallery(page, { count: 2 });
  const visitor = await openPage();
  await visitor.goto(url);
  await expect(visitor.locator('[data-share-theme="none"]')).toBeVisible();
  await expect(visitor.locator('#lightbox')).toHaveCount(1);
  await expect(visitor.locator('figure[data-shot] figcaption')).toHaveCount(2);

  const admin = await withOverrides([OVERRIDES.shareTheme, OVERRIDES.imageView, OVERRIDES.gridText], {
    toggles: { 'Titles and captions on the gallery grid': false },
    choices: { 'Share theme': 'Glass', 'Image view': 'Image page' },
  });
  await expect(admin.locator('[data-share-theme]')).toHaveText('Glass (Settings)');
  await expect(admin.locator('[data-share-image-view]')).toHaveText('Image page (Settings)');
  await visitor.goto(url);
  await expect(visitor.locator('[data-share-theme="glass"]')).toBeVisible();
  await expect(visitor.locator('#lightbox')).toHaveCount(0);
  await expect(visitor.locator('figure[data-shot] figcaption')).toHaveCount(0);
  await expect(visitor.locator('figure[data-shot] a').first()).toHaveAttribute('href', /\/i\/[0-9A-Za-z]{10}$/);

  await saveDetails(page, { shareTheme: 'Frame', imageView: 'Lightbox' });
  await visitor.goto(url);
  await expect(visitor.locator('[data-share-theme="frame"]')).toBeVisible();
  await expect(visitor.locator('#lightbox')).toHaveCount(1);
});

test('Copy image link on a single-image gallery copies the full .webp address', async ({ page, openPage }) => {
  await signIn(page, USERS.looks);
  const url = await sharedGallery(page, { count: 1 });
  const visitor = await openPage();
  await visitor.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await visitor.goto(url);
  const button = visitor.locator('[data-share-copy-image]');
  await expect(button).toHaveText(/Copy image link/);
  await button.click();
  await expect(button).toContainText('Copied');
  const copied = await visitor.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^http:\/\/[^/]+\/s\/[0-9A-Za-z]{7}\/i\/[0-9A-Za-z]{10}\.webp$/);
  const image = await visitor.request.get(copied);
  expect(image.headers()['content-type']).toBe('image/webp');
});
