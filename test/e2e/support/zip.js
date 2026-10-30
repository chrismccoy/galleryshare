import fs from 'node:fs';
import yauzl from 'yauzl';
import { writeZip } from '../../helpers/zip.js';

export async function zipFile(testInfo, name, entries) {
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  const file = await writeZip(testInfo.outputPath(name), entries);
  return { name, mimeType: 'application/zip', buffer: fs.readFileSync(file) };
}

export function zipEntryNames(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const names = [];
      zip.on('entry', (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
      return undefined;
    });
  });
}
