import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers/http.js';
import { BRAND_PALETTE } from '../../config/brand.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('GET / without a session redirects to /login', async () => {
  const res = await app.request('/');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login'); 
});

test('GET / with a session redirects to /dashboard', async () => {
  const { cookie } = await app.signedIn();
  const res = await app.request('/', { cookie });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/dashboard');
});

test('GET /dashboard renders the shell with the empty galleries state', async () => {
  const { cookie } = await app.signedIn();
  const html = await (await app.request('/dashboard', { cookie })).text();
  assert.match(html, /Add gallery/);
  assert.match(html, /No galleries yet/);
});

test('the favicon: /favicon.svg is served, /favicon.ico does not 404, and pages link the icon', async () => {
  const svg = await app.request('/favicon.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.ok((await svg.text()).includes(`fill="${BRAND_PALETTE[600]}"`), 'the favicon mirrors brand-600');
  const ico = await app.request('/favicon.ico');
  assert.equal(ico.status, 204);
  const login = (await app.anonymous('/login')).html;
  assert.match(login, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/);
  const s = await app.signedIn();
  const dash = (await app.get(s, '/dashboard')).html;
  assert.match(dash, /<link rel="icon" href="\/favicon\.svg"/);
});

test('the brand mark is the images icon on public and signed-in pages', async () => {
  const login = await (await app.request('/login')).text();
  assert.match(login, /fa-solid fa-images/);
  const { cookie } = await app.signedIn();
  const dashboard = await (await app.request('/dashboard', { cookie })).text();
  assert.match(dashboard, /fa-solid fa-images/);
});
