import { hasSignature } from '../image-types.js';
import { unreadableError } from './unreadable.js';

const VP8X_EXIF = 0x08;

const VP8X_XMP = 0x04;

const RIFF_SIZE_OFFSET = 4;

const RIFF_SIZE_BYTES = 4;

const RIFF_HEADER_BYTES = 12;

const CHUNK_HEADER_BYTES = 8;

const MIN_RIFF_BYTES = RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES;

export function stripWebp(buf) {
  if (!hasSignature(buf, 'webp')) throw unreadableError();
  const riffEnd = RIFF_SIZE_OFFSET + RIFF_SIZE_BYTES + buf.readUInt32LE(RIFF_SIZE_OFFSET);
  if (riffEnd > buf.length || riffEnd < MIN_RIFF_BYTES) throw unreadableError(); 
  const parts = [];
  let pos = RIFF_HEADER_BYTES;
  while (pos < riffEnd) {
    if (pos + CHUNK_HEADER_BYTES > riffEnd) throw unreadableError();
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const dataEnd = pos + CHUNK_HEADER_BYTES + size;
    if (dataEnd > riffEnd) throw unreadableError();
    const end = Math.min(dataEnd + (size & 1), riffEnd); 
    if (id === 'VP8X') {
      if (size < 1) throw unreadableError();
      const chunk = Buffer.from(buf.subarray(pos, end));
      chunk[CHUNK_HEADER_BYTES] &= ~(VP8X_EXIF | VP8X_XMP); 
      parts.push(chunk);
    } else if (id !== 'EXIF' && id !== 'XMP ') {
      parts.push(buf.subarray(pos, end));
    }
    pos = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  head.writeUInt32LE(4 + body.length, RIFF_SIZE_OFFSET);
  return Buffer.concat([head, body]);
}
