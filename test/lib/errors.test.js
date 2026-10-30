import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  ValidationError,
  InvalidCredentialsError,
  NotFoundError,
  LimitExceededError,
  UnreadableImageError,
  UploadTooLargeError,
  GENERIC_ERROR_MESSAGE,
  isServerError,
  toPublicError,
} from '../../lib/errors.js';

test('toPublicError never leaks unknown messages', () => {
  const r = toPublicError(new Error('secret sk-abc'));
  assert.deepEqual(r, { status: 500, message: GENERIC_ERROR_MESSAGE });
  assert.ok(!r.message.includes('sk-abc'));
  assert.deepEqual(toPublicError(null), { status: 500, message: GENERIC_ERROR_MESSAGE });
  assert.deepEqual(toPublicError(null, 'custom'), { status: 500, message: 'custom' });
});

test('typed errors map to public status and copy', () => {
  const cases = [
    [new InvalidCredentialsError('internal'), 401, 'Incorrect email or password.'],
    [new NotFoundError(), 404, 'Not found.'],
    [new ValidationError('This invite link has already been used.'), 400, 'This invite link has already been used.'],
    [new AppError('x'), 500, GENERIC_ERROR_MESSAGE],
  ];
  for (const [err, status, message] of cases) {
    assert.deepEqual(toPublicError(err), { status, message });
  }
});

test('isServerError is true from 500 up, false for refusals', () => {
  for (const status of [500, 502, 503]) assert.equal(isServerError(status), true, String(status));
  for (const status of [200, 400, 404, 413, 429, 499]) assert.equal(isServerError(status), false, String(status));
});

test('the ValidationError subclasses get their status through the constructor and keep the public message', () => {
  for (const [ErrorClass, status] of [
    [UnreadableImageError, 415],
    [UploadTooLargeError, 413],
    [LimitExceededError, 413],
  ]) {
    const error = new ErrorClass('Too big.', { publicStatus: 999 });
    assert.ok(error instanceof ValidationError, ErrorClass.name);
    assert.deepEqual(toPublicError(error), { status, message: 'Too big.' }, ErrorClass.name);
  }
});

test('an error code is set through the constructor option, and absent when not given', () => {
  const tagged = new LimitExceededError('Too many.', { code: 'zip-too-many-images' });
  assert.equal(tagged.code, 'zip-too-many-images');
  assert.equal(new AppError('x', { code: 'reason' }).code, 'reason');
  assert.equal('code' in new ValidationError('plain'), false);
});
