import { NOOP_LOGGER } from '../../lib/logger.js';

export function sendWebp(res, { open, cacheControl, missing, logger = NOOP_LOGGER, label, meta = {} }) {
  const stream = open();
  stream.on('error', (error) => {
    if (error?.code !== 'ENOENT') logger.warn(label, { ...meta, error: error?.code });
    if (res.headersSent) return res.destroy();
    res.removeHeader('Content-Type');
    res.removeHeader('Cache-Control');
    return missing();
  });
  stream.on('open', () => res.set({ 'Content-Type': 'image/webp', 'Cache-Control': cacheControl }));
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}
