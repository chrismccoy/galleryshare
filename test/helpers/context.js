import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../config/index.js';
import { createAppContext, createRepositories } from '../../app/context.js';
import { hashPassword } from '../../lib/password.js';
import { freshDb } from './db.js';
import { tempDir } from './temp.js';
import { TEST_PASSWORD, silentLogger } from './constants.js';

const TEST_TMP_DIR = path.join(os.tmpdir(), `galleryshare-test-${process.pid}`);
process.once('exit', () => fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true }));

export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret',
    TMP_UPLOAD_DIR: TEST_TMP_DIR,
    ...env,
  });
}


export function buildContext({ env = {}, logger = silentLogger, db = freshDb(), now, secret } = {}) {
  const config = testConfig(env);
  const repositories = createRepositories(db, { now });
  const app = createAppContext({ config, db, logger, now, secret, repositories });
  const context = { ...repositories, ...app };
  Object.defineProperty(context, 'app', { value: app, enumerable: false });
  return { db, config, context };
}

export function mediaContext(t, { prefix = 'gs-media-', env = {}, ...options } = {}) {
  const root = tempDir(t, prefix);
  const media = path.join(root, 'media');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp);
  return { root, media, tmp, ...buildContext({ ...options, env: { MEDIA_DIR: media, TMP_UPLOAD_DIR: tmp, ...env } }) };
}

export async function insertUser(context, { email, password = TEST_PASSWORD, role = 'user', displayName } = {}) {
  const address = email ?? `user-${randomUUID().slice(0, 8)}@example.com`;
  const id = context.users.insert({
    email: address,
    displayName: displayName ?? address.split('@')[0],
    passwordHash: await hashPassword(password),
    role,
  });
  return context.users.byId(id);
}
