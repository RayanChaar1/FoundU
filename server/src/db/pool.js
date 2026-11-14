const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

/** Run a parameterized query (NFR-11.1: values are never concatenated into SQL). */
function query(text, params) {
  return pool.query(text, params);
}

/** Run fn(client) inside a transaction; commits on success, rolls back on any error. */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
