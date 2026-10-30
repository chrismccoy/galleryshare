import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { humanize, APP_LOCALS, HOME_LINK } from '../../routes/view/app-locals.js';
import { BRAND } from '../../config/brand.js';
import { MIN_PASSWORD_LENGTH } from '../../domain/limits.js';
import { inviteTokenFrom, startApp } from '../helpers/http.js';
import { pct } from '../../lib/format.js';
import { isAdmin } from '../../domain/roles.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('humanize turns underscores into spaces; nothing becomes empty', () => {
  assert.equal(humanize('pale_yellow'), 'pale yellow');
  assert.equal(humanize(null), '');
});

test('the percentage formatter and the admin check are app locals, not per-render', () => {
  assert.equal(APP_LOCALS.pct, pct);
  assert.equal(APP_LOCALS.isAdminUser, isAdmin);
});

test('backLink sends signed-in people to the dashboard and everyone else to sign in', () => {
  assert.deepEqual(APP_LOCALS.backLink({ id: 1, role: 'user' }), { href: '/dashboard', label: 'Back to dashboard' });
  assert.deepEqual(APP_LOCALS.backLink(undefined), { href: '/login', label: 'Back to sign in' });
  assert.deepEqual(APP_LOCALS.backLink(null), { href: '/login', label: 'Back to sign in' });
});

test('homeLink points public pages at the front page, named after the app', () => {
  assert.equal(APP_LOCALS.homeLink, HOME_LINK);
  assert.deepEqual(HOME_LINK, { href: '/', label: `Go to ${BRAND.name}` });
});

test('invite and reset forms use the real password minimum', async () => {
  const s = await app.signedIn({ role: 'admin' });
  const token = inviteTokenFrom((await app.post(s, '/admin/invites', { role: 'user' })).html);
  const { html: page } = await app.anonymous(`/invite/${token}`);
  assert.match(page, new RegExp(`minlength="${MIN_PASSWORD_LENGTH}"`));
  assert.match(page, new RegExp(`At least ${MIN_PASSWORD_LENGTH} characters`));
});
