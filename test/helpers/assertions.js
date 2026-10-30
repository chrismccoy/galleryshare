import assert from 'node:assert/strict';
import { PATH_TO } from '../../config/urls.js';

export function isPublicError(ErrorClass, message, status) {
  return (error) =>
    error instanceof ErrorClass &&
    error.message === message &&
    error.publicMessage === message &&
    (status === undefined || error.publicStatus === status);
}

export function assertNotFoundPage({ res, html }, label) {
  assert.equal(res.status, 404, label);
  assert.match(html, /Page not found\./, label);
  assert.doesNotMatch(html, /Something went wrong/, label);
}

export async function assertSignInRedirect(app, path) {
  const res = await app.request(path);
  await res.arrayBuffer();
  assert.equal(res.status, 303, path);
  assert.equal(res.headers.get('location'), PATH_TO.login(path), path);
}
