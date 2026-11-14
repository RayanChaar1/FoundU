/* Mail adapter (Figure 6, data access layer).  With SMTP settings it sends through Nodemailer (NFR-25.2);
   without them, as in development and tests, it writes each email to server/outbox/ so codes can be read. */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const config = require('../config');

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: config.smtp.port !== 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

const sent = []; // last emails, kept in memory for tests

async function sendMail({ to, subject, text }) {
  const mail = { from: config.smtp.from, to, subject, text };
  sent.push({ ...mail, at: new Date() });
  if (sent.length > 50) sent.shift();
  if (transport) return transport.sendMail(mail);
  if (config.isTest) return null;
  fs.mkdirSync(config.outboxDir, { recursive: true });
  const file = path.join(config.outboxDir, `${Date.now()}-${to.replace(/[^\w.@-]/g, '_')}.txt`);
  fs.writeFileSync(file, `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  console.log(`[mail] ${subject} -> ${to} (saved to outbox/)`);
  return null;
}

module.exports = { sendMail, sent };
