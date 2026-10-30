import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathMatcher } from '../../lib/path-match.js';

test('pathMatcher: `:name` stands for one non-empty segment and the whole path must match', () => {
  const matches = pathMatcher(['/dashboard/galleries/new/upload', '/dashboard/galleries/:id/upload']);
  assert.equal(matches('/dashboard/galleries/new/upload'), true);
  assert.equal(matches('/dashboard/galleries/12/upload'), true);
  assert.equal(matches('/dashboard/galleries//upload'), false, 'an empty segment');
  assert.equal(matches('/dashboard/galleries/1/2/upload'), false, 'two segments');
  assert.equal(matches('/dashboard/galleries/12/upload/x'), false, 'a longer path');
  assert.equal(matches('/x/dashboard/galleries/12/upload'), false, 'a prefix');
});

test('pathMatcher matches literal parts as text, and nothing at all without patterns', () => {
  assert.equal(pathMatcher(['/a.b'])('/a.b'), true);
  assert.equal(pathMatcher(['/a.b'])('/axb'), false, 'a dot is not a wildcard');
  assert.equal(pathMatcher([])('/'), false);
  assert.equal(pathMatcher([])(''), false);
});
