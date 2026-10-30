export const INGEST_STATUS = Object.freeze({ pending: 'pending', running: 'running', done: 'done', failed: 'failed' });



export const MAX_SKIPPED_LISTED = 100;

export function skippedCounts(skipped) {
  let total = 0;
  let atUpload = 0;
  for (const item of skipped) {
    total += item.more ?? 1;
    if (item.atUpload) atUpload += 1;
  }
  return { total, atUpload };
}
