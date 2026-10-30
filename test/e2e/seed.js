import fs from 'node:fs';
import { openDatabase } from '../../db/database.js';
import { migrate } from '../../db/migrations.js';
import { createUsersRepository } from '../../db/users.repository.js';
import { hashPassword } from '../../lib/password.js';
import { USERS } from './support/accounts.js';
import { e2eDbPath, e2eDir, e2eMediaDir, e2eTmpDir } from './support/env.js';

export async function seed() {
  const dir = e2eDir();
  const dbPath = e2eDbPath(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(e2eMediaDir(dir), { recursive: true });
  fs.mkdirSync(e2eTmpDir(dir), { recursive: true });

  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const users = createUsersRepository(db);
    for (const u of Object.values(USERS)) {
      users.insert({
        email: u.email,
        displayName: u.name,
        passwordHash: await hashPassword(u.password),
        role: 'user',
      });
    }
  } finally {
    db.close();
  }
  console.log(`Seeded ${dbPath}`);
}
