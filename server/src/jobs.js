/* Background jobs.  Every module folder may export a jobs.js: [{ name, everyMs, run }]. */
const fs = require('fs');
const path = require('path');

const MODULES = path.join(__dirname, 'modules');

function every(ms, name, job) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      console.error(`[job ${name}]`, err);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 2000);
  return setInterval(run, ms);
}

function startJobs() {
  for (const name of fs.readdirSync(MODULES).sort()) {
    const file = path.join(MODULES, name, 'jobs.js');
    if (!fs.existsSync(file)) continue;
    for (const job of require(file)) every(job.everyMs, `${name}/${job.name}`, job.run);
  }
}

module.exports = { startJobs };
