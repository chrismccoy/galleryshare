import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountStatus } from '../../routes/pages/admin/users.js';

test('accountStatus: a red Disabled pill for a disabled account, else a green Active one', () => {
  assert.deepEqual(accountStatus(1), { text: 'Disabled', tone: 'red' });
  assert.deepEqual(accountStatus(true), { text: 'Disabled', tone: 'red' });
  assert.deepEqual(accountStatus(0), { text: 'Active', tone: 'green' });
  assert.deepEqual(accountStatus(false), { text: 'Active', tone: 'green' });
});
