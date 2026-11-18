// Fills the database of DATABASE_URL with the performance data of seed.sql (NFR-1 to NFR-3).
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/db/pool');
const { encrypt } = require('../src/lib/crypto');

(async () => {
  // Never on a real database: its name must contain "perf", e.g. DATABASE_URL=postgres://postgres@localhost:5432/foundu_perf
  const { rows: [db] } = await query('SELECT current_database() AS name');
  if (!db.name.includes('perf')) throw new Error(`Refused: ${db.name} is not a performance database (its name must contain "perf").`);
  const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'perf%@lau.edu'`);
  if (rows[0].n) throw new Error('This database already has the performance data.');
  const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8').replace('__ANSWER__', encrypt('Blue'));
  const results = await query(sql);
  for (const r of results.slice(-2)) console.table(r.rows);
  await pool.end();
})();
