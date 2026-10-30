import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseUrl, createLinks, inviteUrl, resetUrl, shareUrl } from '../../routes/view/links.js';
import { PATHS } from '../../config/urls.js';

const req = {
  protocol: 'http',
  get: (name) => (name === 'host' ? 'app.test:3000' : undefined),
};

test('baseUrl prefers PUBLIC_URL and falls back to the request origin', () => {
  assert.equal(baseUrl('https://galleryshare.example', req), 'https://galleryshare.example');
  assert.equal(baseUrl(null, req), 'http://app.test:3000');
});

test('share, invite and reset URLs use the page prefixes from config/urls.js', () => {
  const publicUrl = 'https://galleryshare.example';
  assert.equal(shareUrl(publicUrl, req, 'tok'), `https://galleryshare.example${PATHS.share}/tok`);
  assert.equal(inviteUrl(publicUrl, req, 'tok'), `https://galleryshare.example${PATHS.invite}/tok`);
  assert.equal(resetUrl(null, req, 'tok'), `http://app.test:3000${PATHS.reset}/tok`);
  assert.equal(shareUrl(null, req, 'abc'), 'http://app.test:3000/s/abc');
});

test('createLinks binds the builders to the configured public URL, or the request origin without one', () => {
  const configured = createLinks('https://galleryshare.example');
  assert.equal(configured.share(req, 'tok'), shareUrl('https://galleryshare.example', req, 'tok'));
  assert.equal(configured.invite(req, 'tok'), inviteUrl('https://galleryshare.example', req, 'tok'));
  assert.equal(configured.reset(req, 'tok'), resetUrl('https://galleryshare.example', req, 'tok'));
  assert.equal(createLinks(undefined).share(req, 'abc'), 'http://app.test:3000/s/abc');
  assert.ok(Object.isFrozen(configured));
});
