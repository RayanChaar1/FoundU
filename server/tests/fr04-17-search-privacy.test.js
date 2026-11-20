/* TS-FR-4 Search and Browsing, TS-FR-17 Privacy of Sensitive Items, FR-18.4 isolation. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, jpeg, today } = require('./fixtures');

let R;
let sara;
let omar;
let lea;
let john;
let karim;
const ids = {};

const post = (agent, kind, fields, files = []) => {
  const req = agent.post(`/api/posts/${kind}`);
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  for (const [i, f] of files.entries()) req.attach('photos', f, `p${i}.jpg`);
  return req.expect(201).then((r) => r.body.id);
};

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea, john, karim] = await Promise.all(
    ['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'john@acme.com', 'k.saad@lau.edu'].map(signIn),
  );
  await query(`UPDATE posts SET status = 'CLOSED'`); // start the feed from a clean slate
  const finder = { whereabouts: 'FINDER', verificationQuestion: 'Colour of the strap?', verificationAnswer: 'Red' };
  ids.umbrella = await post(sara, 'lost', { title: 'Green umbrella', categoryId: R.phone, locationId: R.library, date: today() });
  ids.wallet = await post(omar, 'found', { title: 'Brown leather wallet', categoryId: R.wallet, locationId: R.nicol,
    date: today(), description: 'Found on a bench', ...finder });
  ids.byblos = await post(omar, 'found', { title: 'Wallet in Bassil Hall', categoryId: R.wallet, locationId: R.bassil,
    date: today(), ...finder });
  ids.idCard = await post(omar, 'found', { title: 'Student ID card', categoryId: R.idCard, locationId: R.nicol, date: today(),
    description: 'ID number 20231234 5678 on the back', ...finder }, [await jpeg()]);
});
afterAll(async () => {
  await require('../src/lib/events').settle(); // let Smart Match finish before closing the pool
  await pool.end();
});

const titles = (res) => res.body.items.map((i) => i.title);

describe('TS-FR-4 Search and Browsing', () => {
  test('TC-FR-4.1-V / TC-FR-4.2-V: feed of open posts, newest first, with the fields of FR-4.2', async () => {
    const res = await lea.get('/api/posts').expect(200);
    expect(titles(res).slice(0, 4)).toEqual(['Student ID card', 'Wallet in Bassil Hall', 'Brown leather wallet', 'Green umbrella']);
    expect(res.body.items[0]).toMatchObject({ type: 'FOUND', category: 'ID card', building: 'Nicol Hall', photoId: expect.any(Number) });
  });

  test('TC-FR-4.1-D: closed posts are not in the feed', async () => {
    await sara.post(`/api/posts/${ids.umbrella}/close`).expect(200);
    expect(titles(await lea.get('/api/posts'))).not.toContain('Green umbrella');
  });

  test('TC-FR-4.3-V: keyword search over title and description', async () => {
    expect(titles(await lea.get('/api/posts?q=leather'))).toEqual(['Brown leather wallet']);
    expect(titles(await lea.get('/api/posts?q=bench'))).toEqual(['Brown leather wallet']);
  });

  test('TC-FR-4.3-D: keyword without results returns an empty list; injection is treated as text', async () => {
    expect((await lea.get('/api/posts?q=zebra').expect(200)).body.items).toEqual([]);
    expect((await lea.get(`/api/posts?q=${encodeURIComponent("' OR '1'='1")}`).expect(200)).body.items).toEqual([]);
  });

  test('TC-FR-4.4-V / TC-FR-4.5-V / TC-FR-4.6-V: filters combined with each other and with keywords', async () => {
    expect(titles(await lea.get(`/api/posts?type=FOUND&categoryId=${R.wallet}&campusId=${R.byblos}`))).toEqual(['Wallet in Bassil Hall']);
    expect(titles(await lea.get(`/api/posts?q=wallet&campusId=${R.beirut}`))).toEqual(['Brown leather wallet']);
  });

  test('TC-FR-4.4-D: contradictory filters give no result', async () => {
    expect((await lea.get(`/api/posts?campusId=${R.byblos}&locationId=${R.nicol}`)).body.items).toEqual([]);
  });

  test('TC-FR-4.4-D: a date range that ends before it starts is refused', async () => {
    const res = await lea.get('/api/posts?from=2026-10-07&to=2026-10-01').expect(400);
    expect(res.body.fields).toEqual({ to: 'The end date is before the start date.' });
    await lea.get('/api/posts?from=2026-10-01&to=2026-10-01').expect(200); // one day is a valid range
  });

  test('TC-FR-4.7-V / TC-FR-4.8-V: detail page with public information', async () => {
    const res = await lea.get(`/api/posts/${ids.wallet}`).expect(200);
    // Omar's badges depend on the returns of the other test files, so they are compared with the database
    const { rows: badges } = await query(
      `SELECT b.code, b.name FROM user_badges ub JOIN badges b USING (badge_id) JOIN users u USING (user_id)
        WHERE u.email = 'omar.h@lau.edu' ORDER BY ub.awarded_at`,
    );
    expect(res.body.post).toMatchObject({ title: 'Brown leather wallet', building: 'Nicol Hall', campus: 'Beirut',
      poster: { displayName: 'Omar H.', badges } });
  });

  test('TC-FR-4.9-V: results come in pages of 20', async () => {
    const ps = [];
    for (let i = 0; i < 21; i += 1) ps.push(post(sara, 'lost', { title: `Pen ${i}`, categoryId: R.phone, locationId: R.nicol, date: today() }));
    await Promise.all(ps);
    const p1 = await lea.get('/api/posts?q=pen').expect(200);
    const p2 = await lea.get('/api/posts?q=pen&page=2').expect(200);
    expect([p1.body.items.length, p2.body.items.length, p1.body.total]).toEqual([20, 1, 21]);
  });
});

describe('TS-FR-17 Privacy of Sensitive Items', () => {
  test('TC-FR-17.1-V: a post in a sensitive category is marked sensitive', async () => {
    expect((await lea.get(`/api/posts/${ids.idCard}`)).body.post.sensitive).toBe(true);
  });

  test('TC-FR-17.3-V / TC-FR-17.4-D: digit sequences of eight or more are masked before publication', async () => {
    const res = await lea.get(`/api/posts/${ids.idCard}`).expect(200);
    expect(res.body.post.description).not.toMatch(/20231234|5678/);
    expect(res.body.post.description).toMatch(/•+78/);
  });

  test('TC-FR-17.2-V / TC-FR-17.2-D: photos blurred for others, clear for the poster and staff', async () => {
    const { photoIds } = (await omar.get(`/api/posts/${ids.idCard}`)).body.post;
    const [mine, theirs, staff] = await Promise.all([omar, lea, karim].map((a) => a.get(`/api/photos/${photoIds[0]}`).expect(200)));
    expect(theirs.body.equals(mine.body)).toBe(false);
    expect(staff.body.equals(mine.body)).toBe(true);
  });
});

describe('FR-18.4 isolation between organizations', () => {
  test('TC-FR-18.4-D: a user of another organization cannot see LAU posts or photos', async () => {
    expect((await john.get('/api/posts').expect(200)).body.items).toEqual([]);
    await john.get(`/api/posts/${ids.wallet}`).expect(404);
    const { photoIds } = (await omar.get(`/api/posts/${ids.idCard}`)).body.post;
    await john.get(`/api/photos/${photoIds[0]}`).expect(404);
  });
});
