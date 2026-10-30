import { NOOP_LOGGER } from '../../lib/logger.js';

export function recordingLogger() {
  const info = [];
  const warn = [];
  const error = [];
  const logger = {
    ...NOOP_LOGGER,
    info: (message, fields) => info.push([message, fields]),
    warn: (message, fields) => warn.push([message, fields]),
    error: (message, fields) => error.push([message, fields]),
  };
  return { logger, info, warn, error };
}
