/* TS-FR-11 Interactive campus map. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');

let R;
let sara;
let omar;
const uid = {};
const loc = {};
let acmeCampus;
let acmePhone;

async function publish(agent, type, { title = 'Black iPhone', building = 'Nicol Hall', categoryId = R.phone } = {}) {
  const req = agent.post(`/api/posts/${type}`);
  const fields = { title, categoryId, locationId: loc[building], date: today() };
  if (type === 'found') Object.assign(fields, { whereabouts: 'FINDER', verificationQuestion: 'Colour?', verificationAnswer: 'Black' });
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
}
const map = async (campusId, q = '') => (await sara.get(`/api/campuses/${campusId}/map${q}`).expect(200)).body;
const marker = (body, building) => body.buildings.find((b) => b.name === building);

/** Lost posts inserted directly, `daysAgo` days in the past (FR-11.6 needs dates older than a post can be created with). */
async function lostAgo(building, n, daysAgo) {
  const { rows } = await query(
    `INSERT INTO posts (organization_id, owner_id, type, title, category_id, location_id, event_datetime)
     SELECT $1, $2, 'LOST', 'Hotspot test', $3, $4, now() - make_interval(days => $5) FROM generate_series(1, $6)
     RETURNING post_id`,
    [R.lau, uid.sara, R.phone, loc[building], daysAgo, n],
  );
  return rows.map((r) => r.post_id);
}
const hotspotCounts = async () => {
  const { hotspots } = (await sara.get(`/api/campuses/${R.beirut}/hotspots`).expect(200)).body;
  return Object.fromEntries(hotspots.map((h) => [h.name, h.count]));
};

beforeAll(async () => {
  R = await ref();
  [sara, omar] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu'].map(signIn));
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
  for (const r of (await query('SELECT location_id, building FROM locations')).rows) loc[r.building] = r.location_id;
  acmeCampus = (await query(`SELECT campus_id FROM campuses WHERE name = 'Head Office'`)).rows[0].campus_id;
  acmePhone = (await query(
    `SELECT category_id FROM categories c JOIN organizations o USING (organization_id) WHERE o.name = 'Acme Corp' AND c.name = 'Phone'`,
  )).rows[0].category_id;
});
beforeEach(async () => {
  await events.settle();
  await query(`UPDATE posts SET status = 'CLOSED' WHERE status = 'OPEN'`); // every test starts without open posts
});
afterAll(async () => {
  await events.settle();
  await pool.end();
});

describe('TS-FR-11 Interactive campus map', () => {
  test('TC-FR-11.1-V campus maps displayed and switched', async () => {
    const beirut = await map(R.beirut);
    const byblos = await map(R.byblos);
    expect(beirut.campus).toMatchObject({ name: 'Beirut', latitude: 33.8929, longitude: 35.4776 });
    expect(byblos.campus).toMatchObject({ name: 'Byblos', latitude: 34.1155, longitude: 35.6745 });
    const { buildings } = (await sara.get('/api/reference').expect(200)).body;
    const onBeirut = buildings.filter((b) => b.campusId === R.beirut);
    expect(onBeirut.every((b) => b.latitude && b.longitude)).toBe(true);
    expect(onBeirut.map((b) => b.name)).toEqual(expect.arrayContaining([
      'Adnan Kassar School of Business', 'Orme-Gray Hall', 'Shannon Hall', 'Safadi Fine Arts Building', 'Lower Gate',
    ]));
    expect(buildings.filter((b) => b.campusId === R.byblos).map((b) => b.name)).toEqual(expect.arrayContaining([
      'Zakhem Hall', 'Tohme-Rizk Hall', 'Gilbert and Rose-Marie Chagoury Health Sciences Center', 'Main Gate',
    ]));
  });

  test('TC-FR-11.1-D campus of another organization not available', async () => {
    await sara.get(`/api/campuses/${acmeCampus}/map`).expect(404);
    await sara.get(`/api/campuses/${acmeCampus}/hotspots`).expect(404);
  });

  test('TC-FR-11.2-V markers for buildings with open posts', async () => {
    await publish(sara, 'lost');
    await publish(omar, 'found');
    expect(marker(await map(R.beirut), 'Nicol Hall')).toMatchObject({ count: 2, lost: 1, found: 1 });
  });

  test('TC-FR-11.2-D no marker without open posts', async () => {
    const a = await publish(sara, 'lost');
    const b = await publish(omar, 'found');
    expect(marker(await map(R.beirut), 'Irwin Hall')).toBeUndefined();
    await sara.post(`/api/posts/${a}/close`).expect(200);
    await omar.post(`/api/posts/${b}/close`).expect(200);
    expect(marker(await map(R.beirut), 'Nicol Hall')).toBeUndefined();
  });

  test('TC-FR-11.3-V building chosen on the map', async () => {
    const id = await publish(sara, 'lost', { building: 'Riyad Nassar Library' });
    const { post } = (await sara.get(`/api/posts/${id}`).expect(200)).body;
    expect(post.building).toBe('Riyad Nassar Library');
  });

  test('TC-FR-11.3-D point outside any building refused', async () => {
    const res = await sara.post('/api/posts/lost')
      .send({ title: 'Black iPhone', categoryId: R.phone, locationId: '', date: today() }).expect(400);
    expect(res.body.fields.locationId).toBe('Choose a building.');
    const other = await sara.post('/api/posts/lost')
      .send({ title: 'Black iPhone', categoryId: R.phone, locationId: loc['Main Building'], date: today() }).expect(400);
    expect(other.body.fields.locationId).toBe('Choose a building.');
  });

  test('TC-FR-11.4-V type filter shows matching posts', async () => {
    await publish(sara, 'lost');
    const foundId = await publish(omar, 'found');
    const nicol = marker(await map(R.beirut, '?type=FOUND'), 'Nicol Hall');
    expect(nicol.count).toBe(1);
    expect(nicol.posts).toEqual([expect.objectContaining({ id: foundId, type: 'FOUND' })]);
  });

  test('TC-FR-11.4-D filter with no matches shows no markers', async () => {
    await publish(sara, 'lost');
    expect((await map(R.byblos, '?type=LOST')).buildings).toEqual([]);
    await sara.get(`/api/campuses/${R.beirut}/map?type=LOSTISH`).expect(400);
  });

  test('TC-FR-11.5-V category filter shows matching posts', async () => {
    await publish(sara, 'lost', { title: 'Black iPhone', categoryId: R.phone });
    const wallet = await publish(omar, 'found', { title: 'Brown wallet', categoryId: R.wallet });
    const nicol = marker(await map(R.beirut, `?categoryId=${R.wallet}`), 'Nicol Hall');
    expect(nicol.posts.map((p) => p.id)).toEqual([wallet]);
  });

  test('TC-FR-11.5-D unknown category refused', async () => {
    await sara.get(`/api/campuses/${R.beirut}/map?categoryId=xyz`).expect(400);
    await sara.get(`/api/campuses/${R.beirut}/map?categoryId=${acmePhone}`).expect(400);
  });

  test('TC-FR-11.6-V hotspots of the last 90 days', async () => {
    const before = await hotspotCounts();
    const ids = [...await lostAgo('Nicol Hall', 12, 10), ...await lostAgo('Irwin Hall', 3, 30)];
    try {
      const after = await hotspotCounts();
      expect((after['Nicol Hall'] || 0) - (before['Nicol Hall'] || 0)).toBe(12);
      expect((after['Irwin Hall'] || 0) - (before['Irwin Hall'] || 0)).toBe(3);
      const { hotspots } = (await sara.get(`/api/campuses/${R.beirut}/hotspots`).expect(200)).body;
      expect(hotspots.findIndex((h) => h.name === 'Nicol Hall')).toBeLessThan(hotspots.findIndex((h) => h.name === 'Irwin Hall'));
    } finally {
      await query('DELETE FROM posts WHERE post_id = ANY ($1)', [ids]);
    }
  });

  test('TC-FR-11.6-D posts older than 90 days excluded', async () => {
    const before = await hotspotCounts();
    const ids = await lostAgo('Sage Hall', 20, 120);
    try {
      expect((await hotspotCounts())['Sage Hall'] || 0).toBe(before['Sage Hall'] || 0);
    } finally {
      await query('DELETE FROM posts WHERE post_id = ANY ($1)', [ids]);
    }
  });
});
