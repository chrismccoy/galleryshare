import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BUSY_TIMEOUT_MS = 5000;

export function openDatabase(file) {
  if (file && file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}



export function createTransactionRunner(db) {
  let pending = null;

  const runAll = (callbacks) => {
    for (const callback of callbacks) {
      try {
        callback();
      } catch {
      }
    }
  };

  const run = (work) => {
    if (pending) {
      const mark = pending.length;
      try {
        return db.transaction(work)();
      } catch (error) {
        pending.length = mark;
        throw error;
      }
    }
    pending = [];
    let result;
    try {
      result = db.transaction(work)();
    } catch (error) {
      pending = null;
      throw error;
    }
    const committed = pending;
    pending = null;
    runAll(committed);
    return result;
  };

  run.afterCommit = (callback) => {
    if (pending) pending.push(callback);
    else runAll([callback]);
  };
  return run;
}
