import { unreadableError } from './unreadable.js';

const SOI = 0xd8;

const EOI = 0xd9;

const SOS = 0xda;

const TEM = 0x01;

const RST0 = 0xd0;

const RST7 = 0xd7;

const APP0 = 0xe0;

const APP1 = 0xe1;

const APP2 = 0xe2;

const APP14 = 0xee;

const SEGMENT_HEADER_BYTES = 4;

const TIFF_MAGIC = 42;

const IFD_ENTRY_BYTES = 12;

const IFD_COUNT_BYTES = 2;

const ORIENTATION_TAG = 0x0112;

const TIFF_SHORT = 3;

const UPRIGHT = 1;

const MAX_ORIENTATION = 8;

const JFIF_ID = Buffer.from('JFIF\0', 'latin1');

const EXIF_ID = Buffer.from('Exif\0\0', 'latin1');

const ICC_ID = Buffer.from('ICC_PROFILE\0', 'latin1');

const ADOBE_ID = Buffer.from('Adobe', 'latin1');

function isStandalone(marker) {
  return marker === TEM || isRestart(marker) || marker === SOI || marker === EOI;
}

function isRestart(marker) {
  return marker >= RST0 && marker <= RST7;
}

function isImageSegment(marker) {
  if (marker >= 0xc0 && marker <= 0xcf) return marker !== 0xc8; 
  return marker >= 0xdb && marker <= 0xdf; 
}

function startsWith(buf, start, end, id) {
  return end - start >= id.length && buf.compare(id, 0, id.length, start, start + id.length) === 0;
}

function keepJpegSegment(marker, buf, dataStart, dataEnd) {
  if (isImageSegment(marker)) return true;
  if (marker === APP0) return startsWith(buf, dataStart, dataEnd, JFIF_ID);
  if (marker === APP2) return startsWith(buf, dataStart, dataEnd, ICC_ID);
  if (marker === APP14) return startsWith(buf, dataStart, dataEnd, ADOBE_ID);
  return false; 
}

function scanEnd(buf, pos) {
  for (let i = pos; i < buf.length - 1; i++) {
    if (buf[i] !== 0xff) continue;
    const next = buf[i + 1];
    if (next === 0x00 || isRestart(next)) {
      i++;
      continue;
    }
    return i; 
  }
  throw unreadableError(); 
}

function walkJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) throw unreadableError();
  const spans = [];
  let pos = 2;
  let sawScan = false;
  for (;;) {
    if (pos >= buf.length || buf[pos] !== 0xff) throw unreadableError();
    while (pos < buf.length && buf[pos] === 0xff) pos++; 
    if (pos >= buf.length) throw unreadableError();
    const marker = buf[pos];
    const start = pos - 1;
    pos++;
    if (marker === 0x00 || marker === SOI) throw unreadableError();
    if (marker === EOI) {
      if (!sawScan) throw unreadableError();
      spans.push({ marker, start, end: pos });
      return spans;
    }
    if (isStandalone(marker)) continue; 
    if (pos + 2 > buf.length) throw unreadableError();
    const length = buf.readUInt16BE(pos);
    if (length < 2 || pos + length > buf.length) throw unreadableError();
    let end = pos + length;
    if (marker === SOS) {
      end = scanEnd(buf, end);
      sawScan = true;
    }
    spans.push({ marker, start, end });
    pos = end;
  }
}

function tiffOrientation(tiff) {
  if (tiff.length < 8) return UPRIGHT;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return UPRIGHT;
  const le = order === 'II';

  const u16 = (offset) => (le ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));

  const u32 = (offset) => (le ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  if (u16(2) !== TIFF_MAGIC) return UPRIGHT;
  const ifd = u32(4);
  if (ifd + IFD_COUNT_BYTES > tiff.length) return UPRIGHT;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + IFD_COUNT_BYTES + i * IFD_ENTRY_BYTES;
    if (entry + IFD_ENTRY_BYTES > tiff.length) return UPRIGHT;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    if (u16(entry + 2) !== TIFF_SHORT || u32(entry + 4) < 1) return UPRIGHT;
    const value = u16(entry + 8);
    return value >= UPRIGHT && value <= MAX_ORIENTATION ? value : UPRIGHT;
  }
  return UPRIGHT;
}

function orientationFromSpans(buf, spans) {
  for (const { marker, start, end } of spans) {
    if (marker === SOS) break;
    const dataStart = start + SEGMENT_HEADER_BYTES;
    if (marker === APP1 && startsWith(buf, dataStart, end, EXIF_ID)) {
      return tiffOrientation(buf.subarray(dataStart + EXIF_ID.length, end));
    }
  }
  return UPRIGHT;
}

export function readOrientation(buf) {
  return orientationFromSpans(buf, walkJpeg(buf));
}

function minimalExifApp1(orientation) {
  return Buffer.from([
    0xff, APP1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 
    0x00, 0x01, 
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 
  ]); 
}

export function stripJpeg(buf) {
  const spans = walkJpeg(buf);
  const orientation = orientationFromSpans(buf, spans);
  const parts = [Buffer.from([0xff, SOI])];
  let jfifKept = false;
  for (const { marker, start, end } of spans) {
    if (marker === EOI || marker === SOS || keepJpegSegment(marker, buf, start + SEGMENT_HEADER_BYTES, end)) {
      if (parts.length === 1 && marker === APP0) jfifKept = true;
      parts.push(buf.subarray(start, end));
    }
  }
  if (orientation !== UPRIGHT) {
    parts.splice(jfifKept ? 2 : 1, 0, minimalExifApp1(orientation));
  }
  return Buffer.concat(parts);
}
