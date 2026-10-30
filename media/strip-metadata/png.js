import { PNG_SIGNATURE } from '../image-types.js';
import { unreadableError } from './unreadable.js';

const CHUNK_OVERHEAD = 12;

const MAX_CHUNK_LENGTH = 0x7fffffff;

const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'iCCP', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'pHYs', 'acTL', 'fcTL', 'fdAT',
]); 

export function stripPng(buf) {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    throw unreadableError();
  const parts = [PNG_SIGNATURE];
  let pos = PNG_SIGNATURE.length;
  while (pos + CHUNK_OVERHEAD <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const end = pos + CHUNK_OVERHEAD + length;
    if (length > MAX_CHUNK_LENGTH || end > buf.length) throw unreadableError();
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (pos === PNG_SIGNATURE.length && type !== 'IHDR') throw unreadableError();
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(pos, end));
    if (type === 'IEND') return Buffer.concat(parts); 
    pos = end;
  }
  throw unreadableError(); 
}
