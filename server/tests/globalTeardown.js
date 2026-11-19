/* Frees the test database for the next run (see globalSetup.js). */
module.exports = async () => {
  await globalThis.__testDatabaseLock?.end();
};
