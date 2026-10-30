import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

const KEY_BYTES = 32;

const IV_BYTES = 12;

const TAG_BYTES = 16;

export function parseKey(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const buf = Buffer.from(value, 'base64');
    if (buf.length === KEY_BYTES) return buf;
  }
  return null;
}

function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

export function encrypt(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('Invalid encryption key.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(stored, key) {
  try {
    if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES || !isEncrypted(stored)) return null;
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    if (raw.length < IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const ct = raw.subarray(IV_BYTES + TAG_BYTES);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
