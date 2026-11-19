// Shared by the performance scripts: sessions for the 200 perf users and percentile helpers
const config = require('../src/config');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const BASE = process.env.BASE || 'http://localhost:4100';
async function sessions() {
  const db = new Client({ connectionString: config.databaseUrl });
  await db.connect();
  const { rows } = await db.query(`SELECT user_id FROM users WHERE email LIKE 'perf%@lau.edu' ORDER BY user_id`);
  const meta = (await db.query(`SELECT c.campus_id FROM campuses c JOIN organizations o USING (organization_id) WHERE o.name = 'Lebanese American University' AND c.name = 'Beirut'`)).rows[0];
  const posts = (await db.query(`SELECT p.post_id FROM posts p JOIN locations l USING (location_id) WHERE p.status = 'OPEN' AND l.campus_id = $1`, [meta.campus_id])).rows.map((r) => r.post_id);
  await db.end();
  const cookies = rows.map((r) => `foundu_session=${jwt.sign({ sub: r.user_id }, config.jwtSecret, { expiresIn: '2h' })}`);
  return { cookies, beirut: meta.campus_id, posts };
}
async function timed(path, cookie) {
  const t = performance.now();
  try {
    const res = await fetch(BASE + path, { headers: { cookie } });
    await res.arrayBuffer();
    return { ms: performance.now() - t, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t, status: 0 };
  }
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };
const stats = (xs) => ({ n: xs.length, p50: +pct(xs, 50).toFixed(1), p95: +pct(xs, 95).toFixed(1), p99: +pct(xs, 99).toFixed(1), max: +Math.max(...xs).toFixed(1) });
module.exports = { sessions, timed, stats, BASE };
