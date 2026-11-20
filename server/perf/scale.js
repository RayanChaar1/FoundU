// NFR-14: the NFR-1 browsing load spread over every organization of 10,000 users, optionally while posts are published.
//   node perf/scale.js <users> <seconds> [posts]
// Each virtual user belongs to one organization and browses its feed, searches, posts and map.  With [posts], that many
// lost posts are published through the API at an even rate over the run, each copying an open found post of the
// poster's organization, so every one has a match; at the end the script checks that each got its Smart Match result.
const config = require('../src/config');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { timed, stats, BASE } = require('./common');

const USERS = Number(process.argv[2] || 200);
const SECONDS = Number(process.argv[3] || 60);
const POSTS = Number(process.argv[4] || 0);
const WORDS = ['wallet', 'black phone', 'keys', 'blue bottle', 'laptop', 'airpods', 'umbrella', 'jacket', 'charger'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = new Client({ connectionString: config.databaseUrl });
  await db.connect();
  // organizations with 10,000 users, and per organization: 20 users, its campus, open posts, open found posts
  const orgs = (await db.query(`SELECT organization_id AS id FROM users GROUP BY 1 HAVING count(*) >= 10000 ORDER BY 1`)).rows;
  for (const o of orgs) {
    const users = (await db.query(`SELECT user_id, session_epoch FROM users WHERE organization_id = $1 ORDER BY user_id DESC LIMIT 20`, [o.id])).rows;
    o.cookies = users.map((u) => `foundu_session=${jwt.sign({ sub: u.user_id, v: u.session_epoch }, config.jwtSecret, { expiresIn: '2h' })}`);
    o.campus = (await db.query(`SELECT campus_id FROM campuses WHERE organization_id = $1 ORDER BY campus_id LIMIT 1`, [o.id])).rows[0].campus_id;
    o.posts = (await db.query(`SELECT post_id FROM posts WHERE organization_id = $1 AND status = 'OPEN' LIMIT 2000`, [o.id])).rows.map((r) => r.post_id);
    o.found = (await db.query(`SELECT title, category_id, location_id FROM posts WHERE organization_id = $1 AND status = 'OPEN' AND type = 'FOUND' LIMIT 200`, [o.id])).rows;
  }
  const byPage = { feed: [], search: [], detail: [], map: [], header: [], publish: [] };
  const failed = {};
  let errors = 0;
  let total = 0;
  const end = Date.now() + SECONDS * 1000;
  const user = async (i) => {
    const o = orgs[i % orgs.length];
    const cookie = o.cookies[Math.floor(i / orgs.length) % o.cookies.length];
    await sleep(Math.random() * 2000);
    while (Date.now() < end) {
      const r = Math.random();
      const [page, path] = r < 0.3 ? ['feed', `/api/posts?page=${1 + Math.floor(Math.random() * 5)}`]
        : r < 0.55 ? ['search', `/api/posts?q=${encodeURIComponent(WORDS[Math.floor(Math.random() * WORDS.length)])}`]
          : r < 0.8 ? ['detail', `/api/posts/${o.posts[Math.floor(Math.random() * o.posts.length)]}`]
            : r < 0.9 ? ['map', `/api/campuses/${o.campus}/map`]
              : ['header', '/api/notifications/unread'];
      const res = await timed(path, cookie);
      total += 1;
      if (res.status !== 200) { errors += 1; failed[`${res.status} ${page}`] = (failed[`${res.status} ${page}`] || 0) + 1; }
      byPage[page].push(res.ms);
      await sleep(1000 + Math.random() * 1000);
    }
  };
  const published = [];
  const publisher = async () => {
    if (!POSTS) return;
    const gap = (SECONDS * 1000) / POSTS;
    const start = Date.now();
    for (let n = 0; n < POSTS; n += 1) {
      await sleep(Math.max(0, start + n * gap - Date.now()));
      const o = orgs[n % orgs.length];
      const f = o.found[n % o.found.length];
      const form = new FormData();
      for (const [k, v] of Object.entries({ title: f.title, categoryId: f.category_id, locationId: f.location_id,
        date: new Date().toISOString().slice(0, 10), description: 'Scale test post.' })) form.append(k, String(v));
      const t = performance.now();
      const res = await fetch(`${BASE}/api/posts/lost`, { method: 'POST', body: form, headers: { cookie: o.cookies[n % o.cookies.length] } })
        .then(async (x) => ({ status: x.status, body: await x.json() })).catch(() => ({ status: 0 }));
      byPage.publish.push(performance.now() - t);
      total += 1;
      if (res.status !== 201) { errors += 1; failed[`${res.status} publish`] = (failed[`${res.status} publish`] || 0) + 1; } else published.push(res.body.id);
    }
  };
  await Promise.all([...Array.from({ length: USERS }, (_, i) => user(i)), publisher()]);
  let matched = null;
  if (POSTS) {
    await sleep(5000); // let the last Smart Match jobs finish
    matched = (await db.query(`SELECT count(DISTINCT lost_post_id)::int AS n FROM matches WHERE lost_post_id = ANY ($1)`, [published])).rows[0].n;
  }
  await db.end();
  const browse = [byPage.feed, byPage.search, byPage.detail, byPage.map, byPage.header].flat();
  const out = { organizations: orgs.length, users: USERS, seconds: SECONDS, requests: total, errorRate: +((100 * errors) / total).toFixed(2), failed,
    browsing: stats(browse), ...(POSTS ? { postsPublished: published.length, postsWithMatch: matched, publish: stats(byPage.publish) } : {}) };
  for (const k of ['feed', 'search', 'detail', 'map', 'header']) out[k] = stats(byPage[k]);
  console.log(JSON.stringify(out, null, 1));
})();
