/* TS-FR-2 Lost Item Posting, TS-FR-3 Found Item Posting, TS-FR-10 (editing, history, deletion). */
const fs = require('fs');
const path = require('path');
const { app, request, signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, jpeg, today } = require('./fixtures');
const config = require('../src/config');

let R;
let sara;
let omar;
let lea;

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu'].map(signIn));
});
afterAll(async () => {
  await require('../src/lib/events').settle(); // let Smart Match finish before closing the pool
  await pool.end();
});

const lost = (agent, fields, files = []) => {
  const req = agent.post('/api/posts/lost');
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  for (const [i, f] of files.entries()) req.attach('photos', f, `photo${i}.jpg`);
  return req;
};
const found = (agent, fields, files = []) => {
  const req = agent.post('/api/posts/found');
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  for (const [i, f] of files.entries()) req.attach('photos', f, `photo${i}.jpg`);
  return req;
};
/** Yesterday, so the fixed time of day is never in the future, whatever time the tests run. */
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const lostPhone = () => ({ title: 'Black iPhone 14', categoryId: R.phone, locationId: R.nicol, date: yesterday(), time: '10:30',
  description: 'Black iPhone 14 with a blue case, lost near the main entrance.' });
const foundPhone = () => ({ ...lostPhone(), title: 'Black phone found', whereabouts: 'FINDER',
  verificationQuestion: 'What is on the lock screen?', verificationAnswer: 'A dog' });

describe('TS-FR-2 Lost Item Posting', () => {
  test('TC-FR-2.1-V / TC-FR-2.8-V: registered user publishes a lost post with the status Open', async () => {
    const res = await lost(sara, lostPhone()).expect(201);
    expect(res.body.status).toBe('OPEN');
  });

  test('TC-FR-2.1-D: anonymous visitor cannot create a lost post', async () => {
    await lost(request(app), lostPhone()).expect(401);
  });

  test('TC-FR-2.2-V: title of 80 and description of 1,000 characters accepted', async () => {
    await lost(sara, { ...lostPhone(), title: 'T'.repeat(80), description: 'D'.repeat(1000) }).expect(201);
  });

  test('TC-FR-2.2-D: title of 81 and description of 1,001 characters refused', async () => {
    const res = await lost(sara, { ...lostPhone(), title: 'T'.repeat(81), description: 'D'.repeat(1001) }).expect(400);
    expect(res.body.fields).toMatchObject({ title: expect.any(String), description: expect.any(String) });
  });

  test('TC-FR-2.3-V: five photos accepted', async () => {
    const img = await jpeg();
    const res = await lost(sara, lostPhone(), [img, img, img, img, img]).expect(201);
    expect((await query('SELECT count(*)::int AS n FROM photos WHERE post_id = $1', [res.body.id])).rows[0].n).toBe(5);
  });

  test('TC-FR-2.3-D: sixth photo refused', async () => {
    const img = await jpeg();
    const res = await lost(sara, lostPhone(), [img, img, img, img, img, img]).expect(400);
    expect(res.body.error).toBe('At most 5 photos.');
  });

  test('TC-FR-2.4-D / TC-FR-2.5-V: every missing mandatory field is reported', async () => {
    const res = await lost(sara, { description: 'Nothing else' }).expect(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['categoryId', 'date', 'locationId', 'title']);
  });

  test('TC-FR-2.6-D: unsupported format refused', async () => {
    const res = await sara.post('/api/posts/lost').field('title', 'Pdf').field('categoryId', R.phone)
      .field('locationId', R.nicol).field('date', today())
      .attach('photos', Buffer.from('%PDF-1.4 test'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
    expect(res.body.error).toMatch(/JPEG, PNG, WebP, or HEIC/);
  });

  test('TC-FR-2.6-D: photo over 10 MB refused', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 100 * 1024, 0xff);
    await lost(sara, lostPhone(), [big]).expect(413);
  });

  test('TC-FR-2.7-V / NFR-16.1: stored photos are compressed to at most 1 MB', async () => {
    const res = await lost(sara, lostPhone(), [await jpeg(3000, 2200, true)]).expect(201);
    const { storage_path: file } = (await query('SELECT storage_path FROM photos WHERE post_id = $1', [res.body.id])).rows[0];
    expect(fs.statSync(path.join(config.uploadDir, file)).size).toBeLessThanOrEqual(1024 * 1024);
  });

  test('TC-FR-2.10-V: owner closes a lost post', async () => {
    const { body } = await lost(sara, lostPhone()).expect(201);
    const res = await sara.post(`/api/posts/${body.id}/close`).expect(200);
    expect(res.body.status).toBe('CLOSED');
  });

  test('TC-FR-2.10-D: another user cannot close it', async () => {
    const { body } = await lost(sara, lostPhone()).expect(201);
    await lea.post(`/api/posts/${body.id}/close`).expect(403);
  });

  test('future date refused', async () => {
    const res = await lost(sara, { ...lostPhone(), date: '2999-01-01' }).expect(400);
    expect(res.body.fields.date).toMatch(/future/);
  });
});

describe('TS-FR-3 Found Item Posting', () => {
  test('TC-FR-3.1-V / TC-FR-3.9-V: found post published as Open', async () => {
    const res = await found(omar, foundPhone()).expect(201);
    expect(res.body.status).toBe('OPEN');
  });

  test('TC-FR-3.4-D: found post without a verification question refused', async () => {
    const { verificationQuestion, verificationAnswer, ...rest } = foundPhone();
    const res = await found(omar, rest).expect(400);
    expect(res.body.fields).toMatchObject({ verificationQuestion: expect.any(String), verificationAnswer: expect.any(String) });
  });

  test('TC-FR-3.5-V / TC-FR-3.5-D: the expected answer is never shown to other users, and stored encrypted', async () => {
    const { body } = await found(omar, foundPhone()).expect(201);
    const other = await lea.get(`/api/posts/${body.id}`).expect(200);
    expect(JSON.stringify(other.body)).not.toMatch(/A dog/);
    const own = await omar.get(`/api/posts/${body.id}`).expect(200);
    expect(own.body.post.verificationAnswer).toBe('A dog');
    const row = (await query('SELECT verification_answer_enc FROM posts WHERE post_id = $1', [body.id])).rows[0];
    expect(row.verification_answer_enc).not.toMatch(/dog/i);
  });

  test('TC-FR-3.7-V / TC-FR-3.8-V: drop-off point with its opening hours shown on the post', async () => {
    const { body } = await found(omar, { ...foundPhone(), whereabouts: 'DROPOFF', dropoffId: R.securityOffice }).expect(201);
    const res = await lea.get(`/api/posts/${body.id}`).expect(200);
    expect(res.body.post.dropoff).toMatchObject({ name: 'Security Office, Nicol Hall', openingHours: '08:00 to 17:00' });
  });

  test('TC-FR-3.7-D: drop-off without a point from the official list refused', async () => {
    await found(omar, { ...foundPhone(), whereabouts: 'DROPOFF' }).expect(400);
    const res = await found(omar, { ...foundPhone(), whereabouts: 'DROPOFF', dropoffId: 9999 }).expect(400);
    expect(res.body.fields.dropoffId).toMatch(/official list/);
  });
});

describe('TS-FR-10 editing, history, deletion', () => {
  test('TC-FR-10.2-V / TC-FR-10.3-V: owner edits an open post; the change is kept in the history', async () => {
    const { body } = await lost(sara, lostPhone()).expect(201);
    await sara.patch(`/api/posts/${body.id}`).send({ title: 'Black iPhone 14 Pro' }).expect(200);
    const hist = await sara.get(`/api/posts/${body.id}/history`).expect(200);
    expect(hist.body.history[0].changes.title).toEqual({ from: 'Black iPhone 14', to: 'Black iPhone 14 Pro' });
  });

  test('TC-FR-10.2-D: the type cannot be changed, and others cannot edit', async () => {
    const { body } = await lost(sara, lostPhone()).expect(201);
    await sara.patch(`/api/posts/${body.id}`).send({ type: 'FOUND' }).expect(400);
    await lea.patch(`/api/posts/${body.id}`).send({ title: 'Mine now' }).expect(403);
  });

  test('TC-FR-10.4-V: owner deletes a post without an approved claim', async () => {
    const { body } = await lost(sara, lostPhone()).expect(201);
    await sara.delete(`/api/posts/${body.id}`).expect(204);
    await sara.get(`/api/posts/${body.id}`).expect(404);
  });
});
