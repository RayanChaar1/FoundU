// NFR-3: time of the Smart Match job for 50 posts published one after another, with 10,000 open posts on the campus
const { query, pool } = require('../src/db/pool');
const { runFor } = require('../src/modules/matching/service');
const { stats } = require('./common');
(async () => {
  const n = Number(process.argv[2] || 50);
  const category = process.argv[3]; // optional: put every test post in this category (worst case)
  const { rows: [m] } = await query(`SELECT o.organization_id AS org, c.campus_id FROM organizations o JOIN campuses c USING (organization_id) WHERE o.name = 'Lebanese American University' AND c.name = 'Beirut'`);
  const cats = (await query('SELECT category_id FROM categories WHERE organization_id = $1', [m.org])).rows.map((r) => r.category_id);
  const locs = (await query('SELECT location_id FROM locations WHERE campus_id = $1', [m.campus_id])).rows.map((r) => r.location_id);
  const owner = (await query(`SELECT user_id FROM users WHERE email = 'perf1@lau.edu'`)).rows[0].user_id;
  const open = (await query(`SELECT count(*)::int AS n FROM posts p JOIN locations l USING (location_id) WHERE p.status = 'OPEN' AND l.campus_id = $1`, [m.campus_id])).rows[0].n;
  const times = [];
  let compared = 0;
  for (let i = 0; i < n; i += 1) {
    const { rows: [p] } = await query(
      `INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime)
       VALUES ($1, $2, 'LOST', $3, 'Lost it near the entrance, black with a sticker.', $4, $5, now()) RETURNING post_id`,
      [m.org, owner, `Black wallet test ${i}`, category ? Number(category) : cats[i % cats.length], locs[i % locs.length]]);
    const t = performance.now();
    const out = await runFor(p.post_id);
    times.push(performance.now() - t);
    compared += Array.isArray(out) ? out.length : (out?.compared ?? 0);
  }
  console.log(JSON.stringify({ openOnCampus: open, posts: n, comparedPerPost: Math.round(compared / n), jobMs: stats(times) }, null, 1));
  await pool.end();
})();
