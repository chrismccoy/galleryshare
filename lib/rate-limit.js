import { MS_PER_SECOND, systemNow } from './time.js';

const SWEEP_INTERVAL_MS = 60 * MS_PER_SECOND;



export function createRateLimiter({ repository, windowMs, max, now = systemNow }) {
  let lastSweep = now().getTime();

  function check(key) {
    const currentTime = now().getTime();

    if (currentTime - lastSweep >= SWEEP_INTERVAL_MS) {
      repository.sweep(currentTime);
      lastSweep = currentTime;
    }

    const { count, expiresAt } = repository.hit(key, currentTime, windowMs);
    const resetInSeconds = Math.max(1, Math.ceil((expiresAt - currentTime) / MS_PER_SECOND));

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetInSeconds,
      firstRefusal: count === max + 1,
    };
  }

  return { check };
}
