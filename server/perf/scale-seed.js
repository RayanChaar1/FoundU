// NFR-14.1: grows the performance database to <orgs> organizations of 10,000 users each (LAU counts as the first),
// each with a campus, ten buildings, the default categories, and 2,500 posts (1,000 of them open).
// Run after perf:seed:  npm run perf:scale-seed --workspace server -- 20   (then -- 21 for the 21st organization)
const { query, pool } = require('../src/db/pool');
const { encrypt } = require('../src/lib/crypto');

const USERS = 10000;
const POSTS = 2500;
const BUILDINGS = ['Main Building', 'Library', 'Cafeteria', 'Gymnasium', 'Science Hall', 'Engineering Hall', 'Student Center',
  'Business School', 'Arts Building', 'Main Gate'];

(async () => {
  const target = Number(process.argv[2] || 20);
  const { rows: [db] } = await query('SELECT current_database() AS name');
  if (!db.name.includes('perf')) throw new Error(`Refused: ${db.name} is not a performance database (its name must contain "perf").`);
  const lau = (await query(`SELECT organization_id FROM organizations WHERE name = 'Lebanese American University'`)).rows[0].organization_id;
  const beirut = (await query(`SELECT campus_id FROM campuses WHERE organization_id = $1 AND name = 'Beirut'`, [lau])).rows[0].campus_id;
  // LAU: up to 10,000 users (perf:seed made 200)
  await query(`INSERT INTO users (organization_id, email, full_name, display_name, campus_id)
               SELECT $1, 'scale' || i || '@lau.edu', 'Scale User ' || i, 'Scale ' || i, $2
                 FROM generate_series(1, $3 - (SELECT count(*) FROM users WHERE organization_id = $1)) i`, [lau, beirut, USERS]);
  const answer = encrypt('Blue');
  const have = (await query(`SELECT count(*)::int AS n FROM organizations WHERE name LIKE 'Scale Org %'`)).rows[0].n;
  for (let k = have + 2; k <= target; k += 1) {
    const t = Date.now();
    const domain = `org${k}.test`;
    const { rows: [o] } = await query(
      `INSERT INTO organizations (name, type, email_domains, status, contact_name, contact_email)
       VALUES ($1, 'COMPANY', ARRAY[$2], 'ACTIVE', 'Scale Contact', $3) RETURNING organization_id`,
      [`Scale Org ${k}`, domain, `contact@${domain}`]);
    const org = o.organization_id;
    const { rows: [c] } = await query(`INSERT INTO campuses (organization_id, name, latitude, longitude) VALUES ($1, 'Main', 33.89, 35.48) RETURNING campus_id`, [org]);
    await query(`INSERT INTO locations (organization_id, campus_id, building, latitude, longitude)
                 SELECT $1, $2, b, 33.89 + i * 0.0003, 35.48 + i * 0.0003 FROM unnest($3::text[]) WITH ORDINALITY AS t(b, i)`, [org, c.campus_id, BUILDINGS]);
    await query(`INSERT INTO categories (organization_id, name, is_sensitive_default)
                 SELECT $1, name, is_sensitive_default FROM categories WHERE organization_id = $2`, [org, lau]);
    await query(`INSERT INTO users (organization_id, email, full_name, display_name, campus_id)
                 SELECT $1, 'user' || i || '@' || $2, 'Scale User ' || i, 'User ' || i, $3 FROM generate_series(1, $4) i`, [org, domain, c.campus_id, USERS]);
    await query(
      `WITH u AS (SELECT array_agg(user_id) AS ids FROM (SELECT user_id FROM users WHERE organization_id = $1 LIMIT 500) x),
            cat AS (SELECT array_agg(category_id) AS ids FROM categories WHERE organization_id = $1),
            loc AS (SELECT array_agg(location_id) AS ids FROM locations WHERE organization_id = $1),
            w AS (SELECT ARRAY['black','white','blue','red','green','grey','silver','brown'] AS colour,
                         ARRAY['phone','wallet','water bottle','backpack','umbrella','laptop','AirPods','keys','jacket','charger'] AS item),
            g AS (SELECT i, random() AS r1, random() AS r2, random() AS r3 FROM generate_series(1, $2) i)
       INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime, status,
                          whereabouts, verification_question, verification_answer_enc, created_at)
       SELECT $1, u.ids[1 + (g.r1 * 499)::int], t.type,
              initcap(w.colour[1 + (g.r2 * 7)::int]) || ' ' || w.item[1 + (g.r3 * 9)::int], 'Found or lost on campus.',
              cat.ids[1 + (g.r3 * (array_length(cat.ids, 1) - 1))::int], loc.ids[1 + (g.r1 * 9)::int],
              now() - make_interval(days => (g.r1 * 300)::int),
              CASE WHEN g.i <= 1000 THEN 'OPEN' ELSE (ARRAY['CLOSED','RETURNED'])[1 + (g.r2 * 1)::int] END,
              CASE WHEN t.type = 'FOUND' THEN 'FINDER' END, CASE WHEN t.type = 'FOUND' THEN 'What colour is it?' END,
              CASE WHEN t.type = 'FOUND' THEN $3 END, now() - make_interval(days => (g.r1 * 300)::int)
         FROM g, w, u, cat, loc, LATERAL (SELECT CASE WHEN g.r2 < 0.5 THEN 'LOST' ELSE 'FOUND' END AS type) t`,
      [org, POSTS, answer]);
    console.log(`organization ${k} (${domain}): ${USERS} users, ${POSTS} posts in ${Date.now() - t} ms`);
  }
  await query('ANALYZE');
  const { rows } = await query(`SELECT count(*)::int AS organizations, (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM posts) AS posts
                                  FROM organizations WHERE status = 'ACTIVE'`);
  console.table(rows);
  await pool.end();
})().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
