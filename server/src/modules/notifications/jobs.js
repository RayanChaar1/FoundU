const { sendPendingEmails } = require('./service');

// FR-8.2: every new notification is emailed within 2 minutes
module.exports = [{ name: 'emails', everyMs: 20 * 1000, run: sendPendingEmails }];
