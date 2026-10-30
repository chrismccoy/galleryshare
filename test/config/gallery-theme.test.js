import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GALLERY_THEME } from '../../config/gallery-theme.js';
import { BRAND_PALETTE } from '../../config/brand.js';
import fs from 'node:fs';
import { SHARE_THEMES } from '../../domain/share-themes.js';
import appConfig, { SHARE_THEME_CLASSES } from '../../tailwind.config.js';
import screenshotsConfig from '../../tailwind.screenshots.config.js';

test('both Tailwind configs extend the one gallery theme', () => {
  assert.equal(GALLERY_THEME.colors.brand, BRAND_PALETTE);
  for (const [name, config] of Object.entries({ app: appConfig, screenshots: screenshotsConfig })) {
    const { extend } = config.theme;
    for (const [color, value] of Object.entries(GALLERY_THEME.colors)) {
      assert.equal(extend.colors[color], value, `${name}: colour ${color}`);
    }
    assert.deepEqual(extend.borderRadius, GALLERY_THEME.borderRadius, `${name}: radius`);
    assert.deepEqual(extend.boxShadow, GALLERY_THEME.boxShadow, `${name}: shadows`);
  }
});

test('both Tailwind configs scan the one lightbox script and partials, relative to the config file', () => {
  assert.ok(appConfig.content.files.includes('./public/js/**/*.js'));
  assert.ok(appConfig.content.files.includes('./views/**/*.ejs'));
  assert.ok(screenshotsConfig.content.files.includes('./public/js/lightbox.js'));
  assert.equal(appConfig.content.relative, true);
  assert.equal(screenshotsConfig.content.relative, true);
});

test('every share theme class is safelisted, and every theme the stylesheet styles is a known theme', () => {
  assert.deepEqual(
    SHARE_THEME_CLASSES,
    SHARE_THEMES.map((theme) => `share-theme-${theme.key}`),
  );
  for (const name of SHARE_THEME_CLASSES) assert.ok(appConfig.safelist.includes(name), name);
  const css = fs.readFileSync(new URL('../../src/share-themes.css', import.meta.url), 'utf8');
  const styled = new Set([...css.matchAll(/\.share-theme-([a-z-]+)/g)].map(([, key]) => `share-theme-${key}`));
  for (const name of styled)
    assert.ok(SHARE_THEME_CLASSES.includes(name), `${name} is a theme in domain/share-themes.js`);
  for (const key of ['frame', 'dark-wall', 'polaroid', 'glass', 'paper-stack']) {
    assert.ok(styled.has(`share-theme-${key}`), `${key} has styles`);
  }
});
