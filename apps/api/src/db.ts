import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';

const { Pool } = pg;
export const db = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

export async function runMigrations() {
  const migration = path.join(process.cwd(), 'migrations', '001_init.sql');
  const sql = await fs.readFile(migration, 'utf8');
  await db.query(sql);
}

export async function dbHealth() {
  const result = await db.query('SELECT NOW() AS now');
  return result.rows[0].now;
}
