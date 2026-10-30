import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { attrsOf, classesOf, elementByAttr, startApp, startTags, tagsWith } from '../helpers/http.js';

let app;
let user;
before(async () => {
  app = await startApp();
  user = await app.signedIn();
});
after(() => app.close());

const count = (html, pattern) => (html.match(pattern) ?? []).length;

const scriptSrcs = (html) =>
  tagsWith(html, 'src')
    .filter((tag) => tag.name === 'script')
    .map((tag) => tag.attrs.src);

function assertWholeDocument(html, label) {
  assert.equal(count(html, /<!doctype html>/gi), 1, `${label}: doctype`);
  for (const tag of ['html', 'body', 'main']) {
    assert.equal(count(html, new RegExp(`<${tag}[\\s>]`, 'g')), 1, `${label}: <${tag}>`);
    assert.equal(count(html, new RegExp(`</${tag}>`, 'g')), 1, `${label}: </${tag}>`);
  }
  assert.ok(html.trimEnd().endsWith('</html>'), `${label}: ends the document`);
}

test('shell and public pages are each one whole document', async () => {
  for (const path of ['/dashboard', '/account', '/nope']) {
    const { html } = await app.get(user, path);
    assertWholeDocument(html, path);
  }
  for (const path of ['/login', '/invite/bogus', '/reset/bogus']) {
    const res = await app.request(path);
    assertWholeDocument(await res.text(), path);
  }
});

test('the shell loads the partial-owned scripts once, in order', async () => {
  const { html } = await app.get(user, '/dashboard');
  assert.deepEqual(scriptSrcs(html), ['/js/inline-confirm.js', '/js/copy-link.js', '/js/dismiss.js']);
});

test('the public layout: centred pages sit in .pub-centre with no scripts and no brand footer', async () => {
  const login = await (await app.request('/login')).text();
  const main = elementByAttr(login, 'data-public-main');
  assert.equal(attrsOf(main, 'data-public-main').tag, 'main');
  const [, firstChild] = startTags(main);
  assert.equal(firstChild.name, 'div');
  assert.deepEqual(classesOf(firstChild.attrs), ['pub-centre'], 'the page sits in .pub-centre');
  assert.match(main.slice(main.indexOf('>') + 1, firstChild.start), /^\s*$/, '.pub-centre is the first thing in main');
  assert.doesNotMatch(login, /class="pub-foot"/, 'no brand footer');
  assert.deepEqual(scriptSrcs(login), []);
});
