import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NOOP_LOGGER, createLogger, errorFields } from '../../lib/logger.js';
import { tempDir } from '../helpers/temp.js';

const FIXED = () => new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

function capture() {
  const lines = [];
  return {
    lines,
    write: (t) => lines.push(t),
  };
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

function readLog(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(dir, files[0]), 'utf8');
}

test('console lines read "2026-01-02 03:04:05  INFO   Server started  port=3066"', () => {
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false });
  logger.info('server started', { port: 3066 });
  assert.deepEqual(out.lines, ['2026-01-02 03:04:05  INFO   Server started  port=3066\n']);
});

test('a summary field is printed as is instead of key=value', () => {
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false });
  logger.info('activity', { summary: 'Ann added 3 images', id: 7 });
  assert.equal(out.lines[0], '2026-01-02 03:04:05  INFO   Activity  Ann added 3 images  id=7\n');
});

test('warn and error go to err; info to out', () => {
  const out = capture();
  const err = capture();
  const logger = createLogger({ out, err, now: FIXED, color: false });
  logger.info('hello', { n: 1 });
  logger.warn('careful');
  logger.error('broken');
  assert.equal(out.lines.length, 1);
  assert.match(out.lines[0], /INFO {3}Hello {2}n=1/);
  assert.match(err.lines[0], /WARN {3}Careful/);
  assert.match(err.lines[1], /ERROR {2}Broken/);
});

test('colour codes only when color is true', () => {
  const on = capture();
  const off = capture();
  createLogger({ out: on, err: capture(), now: FIXED, color: true }).info('x');
  createLogger({ out: off, err: capture(), now: FIXED, color: false }).info('x');
  assert.ok(on.lines[0].includes('\x1b['));
  assert.ok(!off.lines[0].includes('\x1b['));
});

test('fields named like secrets are redacted on console and file', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false, dir });
  logger.info('login', { token: 'abc', password: 'p', sessionCookie: 'c', csrfToken: 'x', secretKey: 'k' });
  await logger.flush();
  const file = readLog(dir);
  for (const text of [out.lines[0], file]) {
    assert.equal(text.match(/\[redacted\]/g).length, 5);
    for (const secret of ['abc', 'sessionCookie=c', '"p"', '"x"', '"k"']) assert.ok(!text.includes(secret), secret);
  }
  assert.ok(!out.lines[0].includes('=abc'));
  assert.deepEqual(JSON.parse(file).token, '[redacted]');
});

test('files are JSON lines in dir/app-YYYY-MM-DD.log', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const logger = createLogger({ out: capture(), err: capture(), now: FIXED, color: false, dir, retentionDays: 5 });
  logger.info('server started', { port: 3066 });
  await logger.flush();
  const line = JSON.parse(readLog(dir).trim());
  assert.deepEqual(line, { time: '2026-01-02T03:04:05.000Z', level: 'info', message: 'server started', port: 3066 });
});

test('an unwritable dir still logs to the console and warns once', async (t) => {
  const base = tempDir(t, 'gs-log-');
  const blocker = path.join(base, 'file');
  fs.writeFileSync(blocker, 'x');
  const out = capture();
  const err = capture();
  let logger;
  assert.doesNotThrow(() => {
    logger = createLogger({ out, err, now: FIXED, color: false, dir: path.join(blocker, 'logs') });
    logger.info('still here');
  });
  await settle();
  logger.info('and again');
  await settle();
  assert.equal(out.lines.length, 2);
  assert.match(out.lines[0], /Still here/);
  const warns = err.lines.filter((l) => /WARN/.test(l) && /log folder/i.test(l));
  assert.equal(warns.length, 1);
});

async function assertSurvivesFileFailure(dir) {
  const out = capture();
  const err = capture();
  let logger;
  assert.doesNotThrow(() => {
    logger = createLogger({ out, err, now: FIXED, color: false, dir });
    logger.info('first');
  });
  await settle(500);
  logger.info('second');
  await settle(500);
  logger.info('third');
  await settle(300);
  assert.equal(out.lines.length, 3, 'every line still reaches the console');
  const warns = err.lines.filter((l) => /WARN/.test(l) && /log folder/i.test(l));
  assert.equal(warns.length, 1, 'one warning only');
}

test(
  'a read-only log folder does not crash the process and warns once',
  { skip: process.getuid?.() === 0 ? 'root ignores file permissions' : false },
  async (t) => {
    const dir = tempDir(t, 'gs-log-');
    fs.chmodSync(dir, 0o500);
    t.after(() => fs.existsSync(dir) && fs.chmodSync(dir, 0o700));
    await assertSurvivesFileFailure(dir);
  },
);

test(
  'a write error on the day file (/dev/full) does not crash the process and warns once',
  { skip: process.platform === 'linux' && fs.existsSync('/dev/full') ? false : 'needs /dev/full (Linux)' },
  async (t) => {
    const dir = tempDir(t, 'gs-log-');
    const day = (offset) => new Date(Date.now() + offset).toISOString().slice(0, 10);
    for (const name of new Set([day(0), day(-60_000), day(60_000)])) {
      fs.symlinkSync('/dev/full', path.join(dir, `app-${name}.log`));
    }
    await assertSurvivesFileFailure(dir);
  },
);

test('control characters (an ESC sequence) are removed from console text', () => {
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false });
  logger.info('hi\x1b[31mred', { who: 'a\x1b[2Jb\x07\x7f', summary: 'x\x1b]0;t\x07y' });
  assert.equal(out.lines.length, 1);
  assert.doesNotMatch(out.lines[0], /[\x00-\x09\x0b-\x1f\x7f]/);
  assert.match(out.lines[0], /who=a\[2Jb/);
});

test('fields cannot overwrite time, level or message in the JSON file', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const logger = createLogger({ out: capture(), err: capture(), now: FIXED, color: false, dir });
  logger.info('real', { time: 'fake', level: 'debug', message: 'fake', extra: 1 });
  await logger.flush();
  const line = JSON.parse(readLog(dir).trim());
  assert.deepEqual(line, { time: '2026-01-02T03:04:05.000Z', level: 'info', message: 'real', extra: 1 });
});

test('the day file is named by the UTC date', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const today = () => `app-${new Date().toISOString().slice(0, 10)}.log`;
  const before = today();
  const logger = createLogger({ out: capture(), err: capture(), now: FIXED, color: false, dir });
  logger.info('x');
  await logger.flush();
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
  assert.equal(names.length, 1);
  assert.ok([before, today()].includes(names[0]), names[0]);
});

test('newlines in a message or field are shown as spaces on the console', () => {
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false });
  logger.info('two\nlines', { agent: 'a\r\nb', summary: 'x\ny' });
  assert.equal(out.lines[0].match(/\n/g).length, 1);
  assert.ok(!out.lines[0].includes('\r'));
  assert.match(out.lines[0], /Two lines/);
  assert.match(out.lines[0], /agent=a b/);
});

test('the logger never throws on fields JSON cannot encode: BigInt becomes text, a cycle a marker', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false, dir });
  const loop = { name: 'loop' };
  loop.self = loop;
  assert.doesNotThrow(() => logger.info('odd fields', { big: 10n, loop }));
  assert.match(out.lines[0], /Odd fields/);
  await logger.flush();
  const line = JSON.parse(readLog(dir).trim());
  assert.equal(line.big, '10');
  assert.deepEqual(line.loop, { name: 'loop', self: '[Circular]' });
});

test('level filters console output', () => {
  const out = capture();
  const err = capture();
  const logger = createLogger({ out, err, now: FIXED, color: false, level: 'warn' });
  logger.info('quiet');
  logger.warn('loud');
  assert.equal(out.lines.length, 0);
  assert.equal(err.lines.length, 1);
});

test('level is the console level only: the file still takes info', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false, dir, level: 'warn' });
  logger.info('quiet one');
  await logger.flush();
  assert.equal(out.lines.length, 0);
  assert.equal(JSON.parse(readLog(dir).trim()).message, 'quiet one');
});

test('an unknown level acts as info instead of silencing the logger', () => {
  const err = capture();
  createLogger({ out: capture(), err, now: FIXED, color: false, level: 'verbosee' }).error('still shown');
  assert.equal(err.lines.length, 1);
});

test('NOOP_LOGGER has the logging methods and flush, drops every event and cannot be changed', async () => {
  for (const level of ['info', 'warn', 'error']) assert.equal(NOOP_LOGGER[level]('ignored', { n: 1 }), undefined);
  assert.equal(await NOOP_LOGGER.flush(), undefined);
  assert.ok(Object.isFrozen(NOOP_LOGGER));
});

test('flush writes every queued line to the file at once, the last one included', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const logger = createLogger({ out: capture(), err: capture(), now: FIXED, color: false, dir });
  for (let i = 0; i < 500; i++) logger.info('line', { i });
  logger.error('shutdown timed out', { timeoutMs: 10000 });
  await logger.flush();
  const lines = readLog(dir).trim().split('\n');
  assert.equal(lines.length, 501);
  assert.equal(JSON.parse(lines.at(-1)).message, 'shutdown timed out');
});

test('after flush the console still logs, and a second flush resolves at once', async (t) => {
  const dir = tempDir(t, 'gs-log-');
  const out = capture();
  const logger = createLogger({ out, err: capture(), now: FIXED, color: false, dir });
  logger.info('before');
  await logger.flush();
  logger.info('after');
  await logger.flush();
  await settle(50);
  assert.match(out.lines.join(''), /INFO   After/);
  assert.match(readLog(dir), /"message":"before"/);
  assert.doesNotMatch(readLog(dir), /"message":"after"/, 'the file is closed');
});

test('flush of a console-only logger resolves at once', async () => {
  const logger = createLogger({ out: capture(), err: capture(), now: FIXED, color: false });
  assert.equal(await logger.flush(), undefined);
});

test('errorFields gives the message, and the code only when the error has one', () => {
  assert.deepEqual(errorFields(new Error('db broke')), { error: 'db broke' });
  assert.deepEqual(errorFields(Object.assign(new Error('gone'), { code: 'ENOENT' })), {
    error: 'gone',
    code: 'ENOENT',
  });
  assert.deepEqual(errorFields(undefined), { error: undefined });
});
