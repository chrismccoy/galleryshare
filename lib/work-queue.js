
export function createWorkQueue({ concurrency = 1, run, onError = () => {} }) {
  const entries = new Map();
  let active = 0;
  let idleWaiters = [];

  function notifyIdleWaiters() {
    if (entries.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function runEntry(key, entry) {
    try {
      await run(key, entry.payload);
    } catch (error) {
      onError(error, key);
    } finally {
      entries.delete(key);
      active -= 1;
      notifyIdleWaiters();
      setImmediate(startPending);
    }
  }

  function startPending() {
    for (const [key, entry] of entries) {
      if (active >= concurrency) return;
      if (entry.started) continue;
      entry.started = true;
      active += 1;
      runEntry(key, entry);
    }
  }

  return {
    add(key, payload) {
      if (entries.has(key)) throw new Error(`work queue: job ${String(key)} is already queued`);
      entries.set(key, { payload, started: false });
      setImmediate(startPending);
    },
    idle() {
      if (entries.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    size: () => entries.size,
  };
}
