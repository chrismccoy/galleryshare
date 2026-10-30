

export function createRateLimitRepository(db) {
  const selectWindow = db.prepare('SELECT count, expires_at FROM rate_limit_windows WHERE key = ?');
  const openWindow = db.prepare(
    'INSERT INTO rate_limit_windows (key, count, expires_at) VALUES (?, 1, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET count = 1, expires_at = excluded.expires_at',
  );
  const bumpWindow = db.prepare('UPDATE rate_limit_windows SET count = count + 1 WHERE key = ? RETURNING count');
  const sweepExpired = db.prepare('DELETE FROM rate_limit_windows WHERE expires_at <= ?');
  const clearAll = db.prepare('DELETE FROM rate_limit_windows');
  const countRows = db.prepare('SELECT COUNT(*) AS n FROM rate_limit_windows');

  const countHit = db.transaction((key, nowMs, windowMs) => {
    const existing = selectWindow.get(key);
    if (!existing || existing.expires_at <= nowMs) {
      openWindow.run(key, nowMs + windowMs);
      return { count: 1, expiresAt: nowMs + windowMs };
    }
    return { count: bumpWindow.get(key).count, expiresAt: existing.expires_at };
  });

  return {
    hit(key, nowMs, windowMs) {
      return countHit.immediate(key, nowMs, windowMs);
    },

    sweep(nowMs) {
      return sweepExpired.run(nowMs).changes;
    },

    clear() {
      clearAll.run();
    },

    count() {
      return countRows.get().n;
    },
  };
}
