import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  throw new Error('DATABASE_URL environment variable is required to run migrations');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(__dirname, '../migrations/001_init.sql'),
  resolve(__dirname, '../sql/001_init.sql'),
];
const sqlPath = candidates.find(p => existsSync(p));
if (!sqlPath) {
  throw new Error('Migration file 001_init.sql not found in migrations/ or sql/');
}

const sql = await readFile(sqlPath, 'utf8');
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
  await pool.query(sql);
  console.log(`Migration applied successfully from ${sqlPath}`);
} finally {
  await pool.end();
}
