import fs from 'node:fs/promises';

export function removeTempFile(path, logger) {
  return fs.rm(path, { force: true }).catch((error) => logger.warn('temp file not removed', { error: error?.code }));
}

export async function removeTempFiles(paths, logger) {
  await Promise.all(paths.map((path) => removeTempFile(path, logger)));
}
