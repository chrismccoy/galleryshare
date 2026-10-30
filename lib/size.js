export const BYTES_PER_KB = 1024;

export const BYTES_PER_MB = 1024 * BYTES_PER_KB;

export const BYTES_PER_GB = 1024 * BYTES_PER_MB;

export const toMb = (bytes) => Math.round(bytes / BYTES_PER_MB);
