/* Background jobs: notification emails every 20 seconds (FR-8.2) and closing returned posts (FR-9.11). */
const { sendPendingEmails } = require('./modules/notifications/service');
const { closeReturnedPosts } = require('./modules/claims/service');

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
  every(20 * 1000, 'emails', sendPendingEmails);
  every(60 * 60 * 1000, 'close-returned', () => closeReturnedPosts()); // hourly, so a post closes within the 7th day
}

module.exports = { startJobs };
