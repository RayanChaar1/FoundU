/* Applies the SQL files of migrations/ in order, once each.  --reset drops and recreates the schema first. */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../config');

async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  await admin.end();
}

async function migrate({ reset = false, quiet = false } = {}) {
  await ensureDatabase();
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    if (reset) await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount) continue;
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      if (!quiet) console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => console.log('migrations up to date'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrate };
