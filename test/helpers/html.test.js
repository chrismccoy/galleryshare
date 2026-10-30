import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  allAttrValues,
  attrsOf,
  classesOf,
  csrfFromHtml,
  elementByAttr,
  elementsByAttr,
  elementsByTag,
  navCount,
  olderHref,
  stripCsrfMeta,
  tagsWith,
  textOf,
} from './html.js';
import { fakeClock } from './clock.js';
import { tempDir } from './temp.js';
import { isPublicError } from './assertions.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';

const PAGE = `
<!-- <div data-hook="in-comment"></div> -->
<form action="/up" data-upload-form data-max-image-mb="7" method='post'>
  <input data-upload-input type="file" name="files" multiple accept="image/jpeg,.zip" />
  <div data-tile="a" class="card  p-4"><div><p>Alpha</p></div><p class="kpi-value">7</p></div>
  <div data-tile="b"><p class="kpi-value">8</p></div>
  <img src="/x.png" alt="It&#39;s &amp; that">
</form>`;

test('attrsOf reads every attribute of the first tag carrying a hook, in any order and quoting', () => {
  const form = attrsOf(PAGE, 'data-upload-form');
  assert.deepEqual(form, {
    tag: 'form',
    action: '/up',
    'data-upload-form': '',
    'data-max-image-mb': '7',
    method: 'post',
  });
  const input = attrsOf(PAGE, 'data-upload-input');
  assert.equal(input.tag, 'input');
  assert.equal(input.multiple, '');
  assert.equal(input.accept, 'image/jpeg,.zip');
  assert.equal(attrsOf(PAGE, 'alt').alt, "It's & that", 'values are entity-decoded');
  assert.equal(attrsOf(PAGE, 'data-missing'), null);
  assert.equal(attrsOf(PAGE, 'data-hook'), null, 'tags inside comments are ignored');
  assert.equal(attrsOf(PAGE, 'data-tile', 'b')['data-tile'], 'b');
  assert.equal(attrsOf(PAGE, 'data-tile', 'c'), null, 'a value must match exactly');
});

test('tagsWith and allAttrValues list matches in document order', () => {
  assert.deepEqual(
    tagsWith(PAGE, 'data-tile').map((tag) => tag.name),
    ['div', 'div'],
  );
  assert.deepEqual(allAttrValues(PAGE, 'data-tile'), ['a', 'b']);
  assert.deepEqual(allAttrValues(PAGE, 'class'), ['card  p-4', 'kpi-value', 'kpi-value']);
  assert.deepEqual(classesOf(attrsOf(PAGE, 'data-tile', 'a')), ['card', 'p-4']);
  assert.deepEqual(classesOf(null), []);
});

test('elementByAttr cuts one element up to its own end tag, nested tags included', () => {
  const a = elementByAttr(PAGE, 'data-tile', 'a');
  assert.equal(a, '<div data-tile="a" class="card  p-4"><div><p>Alpha</p></div><p class="kpi-value">7</p></div>');
  assert.equal(textOf(a), 'Alpha7', 'tags add no spaces');
  assert.doesNotMatch(a, />8</, 'never runs into the next element');
  assert.equal(
    elementByAttr(PAGE, 'data-upload-input'),
    '<input data-upload-input type="file" name="files" multiple accept="image/jpeg,.zip" />',
    'a void element is just its tag',
  );
  assert.deepEqual(elementsByAttr(PAGE, 'data-tile').map(textOf), ['Alpha7', '8']);
  assert.equal(elementsByTag(PAGE, 'form').length, 1);
  assert.equal(elementByAttr(PAGE, 'data-missing'), null);
  assert.throws(() => elementByAttr('<div data-x><p>open', 'data-x'), /never closed/);
});

test('textOf drops tags, decodes entities and collapses whitespace', () => {
  assert.equal(textOf('<p>\n  Tom &amp; <b>Jerry</b>&#39;s\n</p>'), "Tom & Jerry's");
  assert.equal(textOf('<li><span>a.jpg</span>: bad</li>'), 'a.jpg: bad');
});

test('fakeClock gives fresh dates and moves only when told', () => {
  const clock = fakeClock('2026-10-28T10:00:00.000Z');
  const first = clock.now();
  first.setFullYear(2000);
  assert.equal(clock.now().toISOString(), '2026-10-28T10:00:00.000Z', 'callers cannot change the clock');
  assert.equal(clock.tick(60_000).toISOString(), '2026-10-28T10:01:00.000Z');
  assert.equal(clock.now().toISOString(), '2026-10-28T10:01:00.000Z');
  assert.equal(clock.set('2026-10-29T08:00:00.000Z').toISOString(), '2026-10-29T08:00:00.000Z');
  assert.equal(clock.now().toISOString(), '2026-10-29T08:00:00.000Z');
});

test('tempDir makes a folder and removes it when the test ends', async (t) => {
  let dir;
  await t.test('inner', (inner) => {
    dir = tempDir(inner, 'gs-helper-');
    fs.writeFileSync(`${dir}/x.txt`, 'x');
    assert.ok(fs.existsSync(dir));
  });
  assert.equal(fs.existsSync(dir), false);
});

test('isPublicError accepts only the exact class, message, public message and status', () => {
  assert.equal(isPublicError(ValidationError, 'No.')(new ValidationError('No.')), true);
  assert.equal(isPublicError(ValidationError, 'No.', 400)(new ValidationError('No.')), true);
  assert.equal(isPublicError(ValidationError, 'No.', 409)(new ValidationError('No.')), false);
  assert.equal(isPublicError(ValidationError, 'No')(new ValidationError('No.')), false);
  assert.equal(isPublicError(ValidationError, 'No.')(new Error('No.')), false);
  assert.equal(isPublicError(ConflictError, 'No.')(new ValidationError('No.')), false);
  assert.equal(isPublicError(NotFoundError, 'x')(new NotFoundError('x')), false, 'its public message is "Not found."');
});

test('the value readers do not depend on attribute order or on the pager label', () => {
  assert.equal(csrfFromHtml('<input value="tok" type="hidden" name="_csrf">'), 'tok');
  assert.equal(navCount('<span class="badge" data-nav-count="galleries"> 3 </span>', 'galleries'), '3');
  assert.equal(navCount('<span data-nav-count="users">1</span>', 'galleries'), null);
  const pager = (label) => `<nav aria-label="Pages"><a class="btn" href="/x?before_id=4&amp;q=1">${label}</a></nav>`;
  for (const label of ['Older galleries', 'Older activity', 'Older links']) {
    assert.equal(olderHref(pager(label)), '/x?before_id=4&q=1', label);
  }
  assert.equal(olderHref('<p>The last page.</p>'), null);
  assert.equal(stripCsrfMeta('<meta content="t" name="csrf-token"><p>x</p>'), '<p>x</p>');
});
