import { mock } from 'node:test';


export function fakeClock(start = '2026-01-01T00:00:00.000Z') {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    tick: (delta) => new Date((ms += delta)),
    set: (when) => new Date((ms = new Date(when).getTime())),
  };
}

export function later(from = new Date()) {
  return new Date(from.getTime() + 60_000);
}

export function earlier(from = new Date()) {
  return new Date(from.getTime() - 60_000);
}

export function mockIntervals(t) {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
}
