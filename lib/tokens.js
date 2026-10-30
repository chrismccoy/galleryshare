import { createHash, randomBytes, randomInt } from 'node:crypto';

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomBase62(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function hashToken(token) {
  return sha256Hex(String(token));
}
