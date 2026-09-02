import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';

const { Pool } = pg;
export const db = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

export async function runMigrations() {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter(file => /^\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    if (sql.trim()) await db.query(sql);
  }
}

export async function dbHealth() {
  const result = await db.query('SELECT NOW() AS now');
  return result.rows[0].now;
}
