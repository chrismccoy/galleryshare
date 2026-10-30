const UNIQUE_PREFIX = 'UNIQUE constraint failed: ';

export function isUniqueViolation(error, column) {
  if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  const message = String(error.message ?? '');
  if (!message.startsWith(UNIQUE_PREFIX)) return false;
  return message.slice(UNIQUE_PREFIX.length).split(', ').includes(column);
}

export function retryOnCollision(attempts, column, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (!isUniqueViolation(error, column) || attempt >= attempts) throw error;
    }
  }
}
