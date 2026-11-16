const request = require('supertest');
const { createApp } = require('../src/app');
const { sent } = require('../src/lib/mailer');
const { query } = require('../src/db/pool');

const app = createApp();

/** Last one-time code emailed to `email`. */
function lastCode(email) {
  const mail = [...sent].reverse().find((m) => m.to === email && /sign-in code/.test(m.subject));
  return mail && mail.text.match(/\b(\d{6})\b/)[1];
}

/** Signs in through the one-time code flow and returns an agent that keeps the session cookie. */
async function signIn(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/start').send({ email }).expect(200);
  const res = await agent.post('/api/auth/verify').send({ email, code: lastCode(email) }).expect(200);
  if (!res.body.signedIn) throw new Error(`${email} has no profile`);
  // Test files sign the same users in many times; the 5-codes-per-10-minutes limit (FR-1) is tested on its own
  await query('DELETE FROM otp_codes WHERE lower(email) = lower($1)', [email]);
  return agent;
}

module.exports = { app, request, lastCode, signIn };
