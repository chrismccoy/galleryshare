import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  TOKEN_LENGTH,
  UNAVAILABLE_MESSAGE,
  SHARE_VIEWS_SHOWN,
  VIEW_KINDS,
  VIEW_RETENTION_DAYS,
  PAUSE_REASONS,
  isPreviewBot,
  isShareTokenShape,
  newNonce,
  pauseReason,
  shareToken,
} from '../../domain/share-links.js';
import { BASE62 } from '../../lib/tokens.js';
import { PATHS } from '../../config/urls.js';

test('newNonce: 32 random bytes as base64url, different each call', () => {
  const a = newNonce();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, newNonce());
});

test('shareToken is 7 base62 chars and stable for a nonce', () => {
  assert.match(shareToken('s', 'n'), /^[0-9A-Za-z]{7}$/);
  assert.equal(shareToken('s', 'n'), shareToken('s', 'n'));
  assert.equal(TOKEN_LENGTH, 7);
  assert.equal(BASE62, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
});

test('shareToken: the base62 digits of the HMAC, least significant first', () => {
  let n = BigInt('0x' + createHmac('sha256', 'secret').update('share:nonce').digest('hex'));
  let expected = '';
  for (let i = 0; i < 7; i++) {
    expected += BASE62[Number(n % 62n)];
    n /= 62n;
  }
  assert.equal(shareToken('secret', 'nonce'), expected);
});

test('shareToken: differs by secret and by nonce', () => {
  assert.notEqual(shareToken('secret', 'nonce'), shareToken('other', 'nonce'));
  assert.notEqual(shareToken('secret', 'nonce'), shareToken('secret', 'other'));
});

test('shareToken: many nonces stay 7 base62 chars and spread over the alphabet', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const token = shareToken('secret', `n${i}`);
    assert.ok(isShareTokenShape(token), token);
    for (const c of token) seen.add(c);
  }
  assert.ok(seen.size > 55, `only ${seen.size} distinct characters`);
});

test('isShareTokenShape: exactly 7 ASCII letters and digits', () => {
  for (const ok of ['abcDEF1', '0000000', 'zZzZzZ9']) assert.equal(isShareTokenShape(ok), true, ok);
  for (const bad of ['abcdef', 'abcdefgh', 'abc-def', 'abc_def', 'abcdéfg', ' abcdef', '', null, undefined, 1234567]) {
    assert.equal(isShareTokenShape(bad), false, String(bad));
  }
  assert.equal(isShareTokenShape('a'.repeat(TOKEN_LENGTH)), true, 'the shape follows TOKEN_LENGTH');
  assert.equal(isShareTokenShape('a'.repeat(TOKEN_LENGTH + 1)), false);
});

test('the share path, the unavailable copy and the view retention are fixed', () => {
  assert.equal(PATHS.share, '/s');
  assert.equal(UNAVAILABLE_MESSAGE, "This shared gallery isn't available.");
  assert.equal(VIEW_RETENTION_DAYS, 90);
});

test('the view kinds and the number of views shown are fixed', () => {
  assert.deepEqual(VIEW_KINDS, { page: 'page', zip: 'zip' });
  assert.ok(Object.isFrozen(VIEW_KINDS));
  assert.equal(SHARE_VIEWS_SHOWN, 100);
});

test('isPreviewBot: true for link-preview fetchers and crawlers', () => {
  for (const ua of [
    'Slackbot-LinkExpanding 1.0',
    'WhatsApp/2.23',
    'facebookexternalhit/1.1',
    'Twitterbot/1.0',
    'Discordbot/2.0',
    'TelegramBot',
    'LinkedInBot/1.0',
    'SkypeUriPreview',
    'Applebot/0.1',
    'Googlebot/2.1',
    'bingbot/2.0',
    'SomeCrawler',
    'link preview fetcher',
    'Some Spider 1.0',
  ]) {
    assert.equal(isPreviewBot(ua), true, ua);
  }
});

test('isPreviewBot: false for real browsers and missing agents', () => {
  for (const ua of [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    '',
    undefined,
  ]) {
    assert.equal(isPreviewBot(ua), false, String(ua));
  }
});

test('pauseReason: Trash comes first, then a disabled owner; a link with neither opens', () => {
  assert.equal(pauseReason({ deleted_at: '2026-01-01', owner_disabled: 1 }), PAUSE_REASONS.trash);
  assert.equal(pauseReason({ deleted_at: null, owner_disabled: 1 }), PAUSE_REASONS.ownerDisabled);
  assert.equal(pauseReason({ deleted_at: null, owner_disabled: 0 }), null);
});
