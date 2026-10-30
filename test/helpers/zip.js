import fs from 'node:fs';
import { ZipArchive } from 'archiver';
import { promisify } from 'node:util';
import { buffer as streamBuffer } from 'node:stream/consumers';
import yauzl from 'yauzl';

const fromBuffer = promisify(yauzl.fromBuffer);

const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const LOCAL_NAME_LENGTH = 26;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_UNCOMPRESSED_SIZE = 24;
const CENTRAL_LOCAL_OFFSET = 42;
const CENTRAL_HEADER_SIZE = 46;
const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;

export async function writeZip(file, entries, { store = false } = {}) {
  const archive = new ZipArchive(store ? { store: true } : { zlib: { level: 6 } });
  const output = fs.createWriteStream(file);
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    output.on('error', reject);
  });
  archive.pipe(output);
  for (const entry of entries) {
    if (entry.name.endsWith('/')) archive.append(null, { name: entry.name, type: 'directory' });
    else archive.append(entry.data, { name: entry.name });
  }
  await archive.finalize();
  await done;
  return file;
}

export function writeEmptyEntriesZip(file, names) {
  if (names.length > 0xffff) throw new Error('writeEmptyEntriesZip: at most 65535 entries');
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(LOCAL_HEADER_SIZE);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(10, 4); 
    local.writeUInt16LE(0x0800, 6); 
    local.writeUInt16LE(nameBytes.length, LOCAL_NAME_LENGTH);
    const central = Buffer.alloc(CENTRAL_HEADER_SIZE);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); 
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(nameBytes.length, CENTRAL_NAME_LENGTH);
    central.writeUInt32LE(offset, CENTRAL_LOCAL_OFFSET);
    locals.push(local, nameBytes);
    centrals.push(central, nameBytes);
    offset += LOCAL_HEADER_SIZE + nameBytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(END_SIZE);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, directory, end]));
  return file;
}

export function forgeDeclaredSize(file, entryName, declaredSize) {
  const buf = fs.readFileSync(file);
  for (let at = 0; at <= buf.length - CENTRAL_HEADER_SIZE; at++) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIGNATURE) continue;
    const nameLength = buf.readUInt16LE(at + CENTRAL_NAME_LENGTH);
    const name = buf.toString('utf8', at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength);
    if (name !== entryName) continue;
    buf.writeUInt32LE(declaredSize, at + CENTRAL_UNCOMPRESSED_SIZE);
    fs.writeFileSync(file, buf);
    return;
  }
  throw new Error(`entry ${entryName} not found in ${file}`);
}

export async function entriesOf(buffer) {
  const zip = await fromBuffer(buffer, { lazyEntries: true });
  const out = [];
  try {
    for (;;) {
      const entry = await nextEntry(zip);
      if (!entry) return out;
      const data = await streamBuffer(await openReadStream(zip, entry));
      out.push({ name: entry.fileName, method: entry.compressionMethod, date: entry.getLastModDate(), data });
    }
  } finally {
    zip.close();
  }
}

function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const off = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    const onEntry = (entry) => {
      off();
      resolve(entry);
    };
    const onEnd = () => {
      off();
      resolve(null);
    };
    const onError = (error) => {
      off();
      reject(error);
    };
    zip.on('entry', onEntry);
    zip.on('end', onEnd);
    zip.on('error', onError);
    zip.readEntry();
  });
}

function openReadStream(zip, entry) {
  return promisify(zip.openReadStream.bind(zip))(entry);
}
