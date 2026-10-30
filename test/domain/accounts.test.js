import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENV_ADMIN_DELETE_MESSAGE,
  ENV_ADMIN_MESSAGE,
  OWN_ACCOUNT,
  accountActions,
  assertNotEnvAdmin,
  isEnvAdmin,
} from '../../domain/accounts.js';
import { ValidationError } from '../../lib/errors.js';
import { isPublicError } from '../helpers/assertions.js';

test('isEnvAdmin matches only a configured email exactly', () => {
  assert.equal(isEnvAdmin('owner@example.com', { email: 'owner@example.com' }), true);
  assert.equal(isEnvAdmin('owner@example.com', { email: 'other@example.com' }), false);
  assert.equal(isEnvAdmin(null, { email: 'owner@example.com' }), false);
  assert.equal(isEnvAdmin('owner@example.com', null), false);
});

test('assertNotEnvAdmin refuses the env admin with ENV_ADMIN_MESSAGE and allows anyone else', () => {
  assert.throws(
    () => assertNotEnvAdmin('owner@example.com', { email: 'owner@example.com' }),
    isPublicError(ValidationError, ENV_ADMIN_MESSAGE),
  );
  assert.doesNotThrow(() => assertNotEnvAdmin('owner@example.com', { email: 'other@example.com' }));
  assert.doesNotThrow(() => assertNotEnvAdmin(null, { email: 'owner@example.com' }));
});

test('the own-account refusals and the env admin messages live in one module', () => {
  assert.deepEqual(Object.keys(OWN_ACCOUNT), ['disable', 'role', 'remove']);
  assert.ok(Object.isFrozen(OWN_ACCOUNT));
  assert.equal(ENV_ADMIN_DELETE_MESSAGE, "Managed in .env. This admin can't be deleted here.");
});

test('accountActions: the env admin gets none; your own account only the reset link (and Enable when disabled)', () => {
  const none = {
    canResetLink: false,
    canEnable: false,
    canDisable: false,
    canDelete: false,
    canChangeRole: false,
    ownAccountNote: false,
  };
  for (const isSelf of [true, false]) {
    for (const disabled of [true, false]) {
      assert.deepEqual(accountActions({ disabled, isSelf, managedByEnv: true }), none);
    }
  }
  assert.deepEqual(accountActions({ disabled: false, isSelf: true, managedByEnv: false }), {
    ...none,
    canResetLink: true,
    ownAccountNote: true,
  });
  assert.deepEqual(accountActions({ disabled: true, isSelf: true, managedByEnv: false }), {
    ...none,
    canResetLink: true,
    canEnable: true,
    ownAccountNote: true,
  });
  assert.deepEqual(accountActions({ disabled: false, isSelf: false, managedByEnv: false }), {
    ...none,
    canResetLink: true,
    canDisable: true,
    canDelete: true,
    canChangeRole: true,
  });
  assert.deepEqual(accountActions({ disabled: true, isSelf: false, managedByEnv: false }), {
    ...none,
    canResetLink: true,
    canEnable: true,
    canDelete: true,
    canChangeRole: true,
  });
});
