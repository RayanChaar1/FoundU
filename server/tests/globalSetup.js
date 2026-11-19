/* Creates a fresh foundu_test database with the schema and the test data of section 9.2.
   Every run drops and recreates the schema, so two runs on the same database (for example from two
   checkouts of the repository) would wipe each other's data halfway.  The run therefore holds an advisory
   lock named after the test database until globalTeardown; a second run waits for it.  The lock is taken
   in the "postgres" database, which the reset never drops, and is freed if the process dies. */
const { Client } = require('pg');

module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const config = require('../src/config');
  const url = new URL(config.databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const lock = new Client({ connectionString: url.toString() });
  await lock.connect();
  const key = `foundu-tests:${name}`;
  const { rows } = await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key]);
  if (!rows[0].ok) {
    process.stderr.write(`\nAnother test run is using the database ${name}; waiting for it to finish...\n`);
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
  }
  globalThis.__testDatabaseLock = lock; // released by globalTeardown.js

  const { migrate } = require('../src/db/migrate');
  await migrate({ reset: true, quiet: true });
  const { seed } = require('../src/db/seed');
  await seed();
  await require('../src/db/pool').pool.end();
};
