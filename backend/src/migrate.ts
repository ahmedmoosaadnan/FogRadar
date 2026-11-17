import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  throw new Error('DATABASE_URL environment variable is required to run migrations');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../migrations');
const fallbackSql = resolve(__dirname, '../sql/001_init.sql');

const isLocalDb = /@(localhost|127\.0\.0\.1|db)(:|\/|$)/i.test(rawDbUrl) || /sslmode=disable/i.test(rawDbUrl);
const dbUrl = /sslmode=/i.test(rawDbUrl) && !/uselibpqcompat=/i.test(rawDbUrl)
  ? `${rawDbUrl}${rawDbUrl.includes('?') ? '&' : '?'}uselibpqcompat=true`
  : rawDbUrl;

const pool = new pg.Pool({
  connectionString: dbUrl,
  ...(!isLocalDb || process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
  if (existsSync(migrationsDir)) {
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const fullPath = resolve(migrationsDir, file);
      const sql = await readFile(fullPath, 'utf8');
      await pool.query(sql);
      console.log(`Migration applied: ${file}`);
    }
  } else if (existsSync(fallbackSql)) {
    const sql = await readFile(fallbackSql, 'utf8');
    await pool.query(sql);
    console.log(`Migration applied from ${fallbackSql}`);
  } else {
    throw new Error('No migration SQL files found');
  }
} finally {
  await pool.end();
}
