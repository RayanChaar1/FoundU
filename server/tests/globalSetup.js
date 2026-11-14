/* Creates a fresh foundu_test database with the schema and the test data of section 9.2. */
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const { migrate } = require('../src/db/migrate');
  await migrate({ reset: true, quiet: true });
  const { seed } = require('../src/db/seed');
  await seed();
  await require('../src/db/pool').pool.end();
};
