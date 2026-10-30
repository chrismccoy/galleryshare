import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_SHARE_THEME,
  GALLERY_SHARE_THEME_CHOICES,
  SHARE_THEMES,
  isShareTheme,
  shareThemeChoice,
  shareThemeFor,
  shareThemeFromChoice,
  shareThemeLabel,
  shareThemePartial,
} from '../../domain/share-themes.js';

test('the themes are None, Frame, Dark wall, App window, Polaroid, Glass and Paper stack, frozen', () => {
  assert.deepEqual(
    SHARE_THEMES.map((theme) => [theme.key, theme.label]),
    [
      ['none', 'None'],
      ['frame', 'Frame'],
      ['dark-wall', 'Dark wall'],
      ['app-window', 'App window'],
      ['polaroid', 'Polaroid'],
      ['glass', 'Glass'],
      ['paper-stack', 'Paper stack'],
    ],
  );
  assert.ok(Object.isFrozen(SHARE_THEMES) && SHARE_THEMES.every(Object.isFrozen));
  assert.equal(DEFAULT_SHARE_THEME, 'none');
});

test('every theme has its partial (its own or the shared panel) and its styles', () => {
  const css = fs.readFileSync(new URL('../../src/share-themes.css', import.meta.url), 'utf8');
  for (const { key } of SHARE_THEMES) {
    const partial = shareThemePartial(key);
    assert.ok(
      fs.existsSync(new URL(`../../views/partials/share-themes/${partial}.ejs`, import.meta.url)),
      `${key}: ${partial}.ejs`,
    );
    if (key !== 'none') assert.ok(css.includes(`.share-theme-${key}`), `.share-theme-${key} styles`);
  }
  assert.equal(shareThemePartial('none'), 'none');
  assert.equal(shareThemePartial('app-window'), 'app-window');
  for (const key of ['frame', 'dark-wall', 'polaroid', 'glass', 'paper-stack'])
    assert.equal(shareThemePartial(key), 'panel', key);
});

test('isShareTheme and shareThemeLabel know only the listed keys', () => {
  assert.equal(isShareTheme('glass'), true);
  assert.equal(isShareTheme('Glass'), false);
  assert.equal(isShareTheme('neon'), false);
  assert.equal(isShareTheme(null), false);
  assert.equal(shareThemeLabel('app-window'), 'App window');
  assert.equal(shareThemeLabel('neon'), 'neon');
});

test("a gallery's theme choice: 'default' follows the site, a key picks that theme, anything else is unknown", () => {
  assert.deepEqual(GALLERY_SHARE_THEME_CHOICES, ['default', ...SHARE_THEMES.map((theme) => theme.key)]);
  assert.equal(shareThemeFromChoice('default'), null);
  assert.equal(shareThemeFromChoice('polaroid'), 'polaroid');
  assert.equal(shareThemeFromChoice('neon'), undefined);
  assert.equal(shareThemeFromChoice(undefined), undefined);
  assert.equal(shareThemeChoice({ share_theme: null }), 'default');
  assert.equal(shareThemeChoice({ share_theme: 'frame' }), 'frame');
  assert.equal(shareThemeChoice({ share_theme: 'gone' }), 'default', 'a removed theme shows as Site default');
});

test("shareThemeFor: the gallery's own theme wins; otherwise the site theme; never an unknown key", () => {
  assert.equal(shareThemeFor({ share_theme: 'glass' }, 'frame'), 'glass');
  assert.equal(shareThemeFor({ share_theme: null }, 'frame'), 'frame');
  assert.equal(shareThemeFor({ share_theme: 'gone' }, 'frame'), 'frame');
  assert.equal(shareThemeFor({ share_theme: null }, 'gone'), 'none');
});
