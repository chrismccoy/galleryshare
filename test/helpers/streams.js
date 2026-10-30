import { PassThrough, Readable } from 'node:stream';

export function collectingResponse() {
  const res = new PassThrough();
  res.chunks = [];
  res.on('data', (chunk) => res.chunks.push(chunk));
  res.headersSent = false;
  return res;
}

export function failingStream(error) {
  return new Readable({
    read() {
      this.destroy(error);
    },
  });
}

export function pendingStream() {
  return new Readable({
    read() {},
  });
}

export function slowStream({ chunks = 500, size = 16 * 1024, delayMs = 2 } = {}) {
  let sent = 0;
  return new Readable({
    read() {
      setTimeout(() => this.push(++sent > chunks ? null : Buffer.alloc(size, 1)), delayMs);
    },
  });
}
