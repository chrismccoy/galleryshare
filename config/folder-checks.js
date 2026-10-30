import fs from 'node:fs';
import path from 'node:path';

function realPath(target) {
  const missing = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function tmpDirProblems({ tmpDir, mediaDir, databaseFile }) {
  if (!tmpDir) return [];
  const problems = [];
  const tmp = realPath(tmpDir);
  if (mediaDir) {
    const media = realPath(mediaDir);
    if (isInside(tmp, media) || isInside(media, tmp)) {
      problems.push(
        'TMP_UPLOAD_DIR must be a separate folder: not MEDIA_DIR, inside it, or a folder that contains it.',
      );
    }
  }
  if (databaseFile && isInside(tmp, realPath(databaseFile))) {
    problems.push('TMP_UPLOAD_DIR must not contain the database file (DATABASE_PATH).');
  }
  return problems;
}
