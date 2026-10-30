import { Writable } from 'node:stream';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { systemNow, toIso } from './time.js';

const SECRET_KEY = /token|password|cookie|csrf|secret/i;

const REDACTED = '[redacted]';

const DEFAULT_RETENTION_DAYS = 30;

const LEVEL_COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[32m', debug: '\x1b[90m' };

export const LOG_LEVELS = Object.freeze(['error', 'warn', 'info', 'debug']);

const RESET = '\x1b[0m';

const LEVEL_WIDTH = 5;

function encode(line) {
  const redact = (key, value) => (key && SECRET_KEY.test(key) ? REDACTED : value);
  try {
    return JSON.stringify(line, redact);
  } catch {
    const seen = new WeakSet();
    return JSON.stringify(line, (key, value) => {
      const kept = redact(key, value);
      if (typeof kept === 'bigint') return String(kept);
      if (kept === null || typeof kept !== 'object') return kept;
      if (seen.has(kept)) return '[Circular]';
      seen.add(kept);
      return kept;
    });
  }
}

const oneLine = (value) =>
  String(value)
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '');

function showValue(value) {
  if (value !== null && typeof value === 'object') return oneLine(encode(value));
  return oneLine(typeof value === 'bigint' ? String(value) : value);
}

function consoleLine({ time, level, message, fields }, color) {
  const stamp = time.slice(0, 19).replace('T', ' ');
  const word = level.toUpperCase();
  const shown = color && LEVEL_COLORS[level] ? `${LEVEL_COLORS[level]}${word}${RESET}` : word;
  const text = oneLine(message);
  const padded = `${shown}${' '.repeat(Math.max(0, LEVEL_WIDTH - word.length))}`;
  const parts = [stamp, padded, `${text.charAt(0).toUpperCase()}${text.slice(1)}`];
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (key === 'summary') parts.push(oneLine(value));
    else parts.push(`${key}=${SECRET_KEY.test(key) ? REDACTED : showValue(value)}`);
  }
  return parts.join('  ');
}

function consoleTransport(target, levels, color, level) {
  const stream = new Writable({
    write(chunk, encoding, done) {
      target.write(chunk.toString());
      done();
    },
  });
  return new winston.transports.Stream({
    stream,
    level,
    eol: '\n',
    format: winston.format.combine(
      winston.format((info) => (levels.includes(info.level) ? info : false))(),
      winston.format((info) => {
        info[Symbol.for('message')] = consoleLine(info, color);
        return info;
      })(),
    ),
  });
}


export const errorFields = (error) => ({
  error: error?.message,
  ...(error?.code !== undefined && { code: error.code }),
});

export const NOOP_LOGGER = Object.freeze({
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
});

const FLUSH_TIMEOUT_MS = 1000;

export function createLogger({
  out = process.stdout,
  err = process.stderr,
  now = systemNow,
  dir = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  level = 'info',
  color = false,
} = {}) {
  const consoleLevel = LOG_LEVELS.includes(level) ? level : 'info';
  const transports = [
    consoleTransport(out, ['info', 'debug'], color, consoleLevel),
    consoleTransport(err, ['warn', 'error'], color, consoleLevel),
  ];
  const engine = winston.createLogger({ level: 'debug', levels: winston.config.npm.levels, transports });
  let warned = false;
  let fileTransport = null;

  const folderFailed = (cause) => {
    if (warned) return;
    warned = true;
    engine.log({
      level: 'warn',
      message: 'cannot write to the log folder; logging to the console only',
      time: toIso(now()),
      fields: { dir, error: cause?.message },
    });
  };

  engine.on('error', folderFailed);
  if (dir) {
    try {
      const file = new DailyRotateFile({
        dirname: dir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        utc: true,
        level: 'info',
        maxFiles: `${retentionDays}d`,
        format: winston.format((info) => {
          info[Symbol.for('message')] = encode({
            ...info.fields,
            time: info.time,
            level: info.level,
            message: info.message,
          });
          return info;
        })(),
      });
      file.on('error', folderFailed);
      file.logStream?.on('error', (error) => {
        folderFailed(error);
        engine.remove(file);
        fileTransport = null;
      });
      engine.add(file);
      fileTransport = file;
    } catch (error) {
      folderFailed(error);
    }
  }

  const log = (eventLevel, message, fields) => engine.log({ level: eventLevel, message, time: toIso(now()), fields });
  return {
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    flush: (timeoutMs = FLUSH_TIMEOUT_MS) =>
      new Promise((resolve) => {
        const file = fileTransport;
        const stream = file?.logStream;
        if (!stream) return resolve();
        fileTransport = null;
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        setImmediate(() => {
          engine.remove(file);
          try {
            stream.end(done);
          } catch {
            done();
          }
        });
      }),
  };
}
