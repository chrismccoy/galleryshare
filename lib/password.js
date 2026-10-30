import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 16;

const KEY_BYTES = 64;

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

const LEGACY_OPTIONS = { N: 16384, r: 8, p: 1 };

const MAX_OPTIONS = { N: 2 ** 17, r: 32, p: 16 };

const SCRYPT_BYTES_PER_NR = 128;

const MAX_SCRYPT_MEMORY = 128 * 1024 * 1024;

const MAXMEM_FACTOR = 2;

const MAXMEM_HEADROOM_BYTES = 1024 * 1024;

const withMemory = (options) => ({
  ...options,
  maxmem: MAXMEM_FACTOR * SCRYPT_BYTES_PER_NR * options.N * options.r + MAXMEM_HEADROOM_BYTES,
});

function parseHash(stored) {
  const hex = /^[0-9a-f]+$/;
  const current = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(stored);
  if (current) {
    const options = { N: Number(current[1]), r: Number(current[2]), p: Number(current[3]) };
    const powerOfTwo = options.N > 1 && (options.N & (options.N - 1)) === 0;
    if (!powerOfTwo || options.N > MAX_OPTIONS.N || options.r < 1 || options.r > MAX_OPTIONS.r) return null;
    if (options.p < 1 || options.p > MAX_OPTIONS.p) return null;
    if (SCRYPT_BYTES_PER_NR * options.N * options.r > MAX_SCRYPT_MEMORY) return null;
    return { options, salt: Buffer.from(current[4], 'hex'), key: Buffer.from(current[5], 'hex') };
  }
  const [saltHex, keyHex, extra] = stored.split(':');
  if (extra !== undefined || !saltHex || !keyHex || !hex.test(saltHex) || !hex.test(keyHex)) return null;
  return { options: LEGACY_OPTIONS, salt: Buffer.from(saltHex, 'hex'), key: Buffer.from(keyHex, 'hex') };
}

export async function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(plain, salt, KEY_BYTES, withMemory(SCRYPT_OPTIONS));
  const { N, r, p } = SCRYPT_OPTIONS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length !== KEY_BYTES) return false;
  const candidate = await scryptAsync(plain, parsed.salt, KEY_BYTES, withMemory(parsed.options));
  return timingSafeEqual(parsed.key, candidate);
}
