import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_SITE, createKeyedChoice, siteDefaultChoices } from '../../domain/gallery-choice.js';
import { SHARE_THEME_CHOICE } from '../../domain/share-themes.js';
import { IMAGE_VIEW_CHOICE } from '../../domain/image-views.js';

const CASES = [
  {
    name: 'share theme',
    choice: SHARE_THEME_CHOICE,
    column: 'share_theme',
    key: 'glass',
    site: 'frame',
    fallback: 'none',
  },
  {
    name: 'image view',
    choice: IMAGE_VIEW_CHOICE,
    column: 'image_view',
    key: 'page',
    site: 'new-tab',
    fallback: 'lightbox',
  },
];

for (const { name, choice, column, key, site, fallback } of CASES) {
  test(`${name}: validation, the form's choices and what a gallery uses`, () => {
    assert.equal(choice.defaultKey, fallback);
    assert.equal(choice.is(key), true);
    assert.equal(choice.is('nope'), false);
    assert.equal(choice.is(FOLLOW_SITE), false, "'default' is a choice, not a key");
    assert.deepEqual(choice.galleryChoices, [FOLLOW_SITE, ...choice.options.map((o) => o.key)]);
    assert.ok(Object.isFrozen(choice) && Object.isFrozen(choice.galleryChoices));

    assert.equal(choice.fromChoice(FOLLOW_SITE), null);
    assert.equal(choice.fromChoice(key), key);
    assert.equal(choice.fromChoice('nope'), undefined);
    assert.equal(choice.fromChoice(undefined), undefined);

    assert.equal(choice.choiceOf({ [column]: key }), key);
    assert.equal(choice.choiceOf({ [column]: null }), FOLLOW_SITE);
    assert.equal(choice.choiceOf({ [column]: 'stale' }), FOLLOW_SITE, 'an unknown stored key follows the site');

    assert.equal(choice.resolve({ [column]: key }, site), key, 'the gallery wins');
    assert.equal(choice.resolve({ [column]: null }, site), site, 'else the site');
    assert.equal(choice.resolve({ [column]: null }, 'stale'), fallback, 'else the default');

    assert.equal(choice.stored(key), key);
    assert.equal(choice.stored(undefined), fallback);

    const buttons = choice.buttons(site);
    assert.deepEqual(buttons[0], { value: FOLLOW_SITE, label: `Site default (${choice.label(site)})` });
    assert.deepEqual(
      buttons.slice(1),
      choice.options.map((o) => ({ value: o.key, label: o.label })),
    );
    assert.equal(choice.label('unknown'), 'unknown');
  });
}

test('createKeyedChoice works for any list; siteDefaultChoices puts Site default first', () => {
  const sizes = createKeyedChoice({
    options: [
      { key: 's', label: 'Small' },
      { key: 'l', label: 'Large' },
    ],
    defaultKey: 's',
    column: 'size',
    message: 'Pick a size.',
  });
  assert.equal(sizes.resolve({ size: 'l' }, 's'), 'l');
  assert.equal(sizes.message, 'Pick a size.');
  assert.deepEqual(siteDefaultChoices('Shown', [{ key: 'show', label: 'Show' }]), [
    { value: 'default', label: 'Site default (Shown)' },
    { value: 'show', label: 'Show' },
  ]);
});
