/* TS-FR-12 FoundU QR tags. */
const { signIn, app, request } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { pool, query } = require('../src/db/pool');
const { ref, jpeg } = require('./fixtures');
const { sendPendingEmails } = require('../src/modules/notifications/service');
const { TOKEN_BYTES } = require('../src/modules/tags/service');

let R;
let sara;
let lea;
let saraId;
let laptop; // Sara's laptop tag
let keys;

const finder = (agent = 'Finder phone') => ({ 'User-Agent': agent });
const scan = (token, ua) => request(app).get(`/api/tags/${token}`).set(finder(ua));
const write = (token, body, ua) => request(app).post(`/api/tags/${token}/messages`).set(finder(ua)).send(body);

beforeAll(async () => {
  R = await ref();
  [sara, lea] = await Promise.all(['sara.k@lau.edu', 'lea.n@lau.edu'].map(signIn));
  saraId = (await query(`SELECT user_id FROM users WHERE email = 'sara.k@lau.edu'`)).rows[0].user_id;
});

afterAll(async () => {
  await query(`DELETE FROM qr_tags WHERE owner_id IN (SELECT user_id FROM users WHERE email IN ('sara.k@lau.edu', 'lea.n@lau.edu'))`);
  await query(`DELETE FROM notifications WHERE type = 'QR_MESSAGE'`);
  await query('UPDATE organizations SET qr_enabled = true WHERE organization_id = $1', [R.lau]);
  await pool.end();
});

describe('TS-FR-12 FoundU QR tags', () => {
  test('TC-FR-12.1-V belonging registered with or without a photo', async () => {
    const withPhoto = await sara.post('/api/tags').field('label', "Sara's laptop").field('categoryId', String(R.phone))
      .attach('photo', await jpeg(), 'laptop.jpg').expect(201);
    expect(withPhoto.body).toMatchObject({ label: "Sara's laptop", hasPhoto: true, active: true, messages: 0 });
    laptop = withPhoto.body;
    keys = (await sara.post('/api/tags').field('label', 'Keys').expect(201)).body;
    expect(keys).toMatchObject({ label: 'Keys', hasPhoto: false, categoryId: null });
    const mine = (await sara.get('/api/tags').expect(200)).body.tags;
    expect(mine.map((t) => t.label)).toEqual(['Keys', "Sara's laptop"]);
    await sara.get(`/api/tags/${laptop.id}/photo`).expect(200).expect('Content-Type', /webp/);
  });

  test('TC-FR-12.1-D belonging without a label refused', async () => {
    const res = await sara.post('/api/tags').field('label', '   ').expect(400);
    expect(res.body.fields.label).toBe('Enter a label, for example "Black laptop".');
    await request(app).post('/api/tags').send({ label: 'Bag' }).expect(401);
    await sara.post('/api/tags').field('label', 'Bag').field('categoryId', '999999').expect(400);
  });

  test('TC-FR-12.2-V unique tags of at least 128 random bits', async () => {
    expect(TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    // 1,000 belongings registered by a script, with the application's own generator
    const { randomToken } = require('../src/lib/crypto');
    const values = Array.from({ length: 1000 }, () => randomToken(TOKEN_BYTES));
    await query(`INSERT INTO qr_tags (owner_id, tag_code, item_label) SELECT $1, unnest($2::text[]), 'Bulk'`, [saraId, values]);
    const created = [];
    for (let i = 0; i < 20; i += 1) created.push((await sara.post('/api/tags').field('label', `Script ${i}`).expect(201)).body.token);
    const { rows } = await query('SELECT tag_code FROM qr_tags WHERE owner_id = $1', [saraId]);
    const codes = rows.map((r) => r.tag_code);
    expect(new Set(codes).size).toBe(codes.length); // all different
    for (const t of created) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/); // 22 base64url characters = 128 bits
    await query(`DELETE FROM qr_tags WHERE owner_id = $1 AND (item_label LIKE 'Bulk%' OR item_label LIKE 'Script %')`, [saraId]);
  });

  test('TC-FR-12.2-D guessed or sequential tokens do not resolve', async () => {
    const { randomToken } = require('../src/lib/crypto');
    const guesses = [
      ...Array.from({ length: 980 }, () => randomToken(TOKEN_BYTES)),
      ...Array.from({ length: 10 }, (_, i) => String(i).padStart(22, '0')),
      ...Array.from({ length: 10 }, (_, i) => `${laptop.token.slice(0, 21)}${'ABCDEFGHIJ'[i]}`).filter((t) => t !== laptop.token),
    ];
    const statuses = await Promise.all(guesses.map((g) => scan(g).then((r) => r.status)));
    expect(statuses.every((s) => s === 404)).toBe(true);
    await scan('1').expect(404); // a tag id is not a token
  });

  test('TC-FR-12.3-V printable PDF sticker sheet', async () => {
    const res = await sara.get('/api/tags/sheet').responseType('blob').expect(200).expect('Content-Type', 'application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(2000);
    await sara.get(`/api/tags/sheet?ids=${keys.id}`).expect(200);
    const svg = await sara.get(`/api/tags/${laptop.id}/qr.svg`).expect(200).expect('Content-Type', /svg/);
    expect(svg.text || svg.body.toString()).toContain('<svg');
  }, 20000); // the first PDF loads the fonts of PDFKit, which is slow under Jest only

  test('TC-FR-12.3-D sheet only for the owner\'s own belongings', async () => {
    await lea.get(`/api/tags/sheet?user=${saraId}`).expect(403);
    await lea.get('/api/tags/sheet').expect(400); // Lea has no tag; Sara's are never included
    await lea.get(`/api/tags/sheet?ids=${laptop.id}`).expect(400);
    await lea.get(`/api/tags/${laptop.id}/qr.svg`).expect(403);
    await lea.get(`/api/tags/${laptop.id}/photo`).expect(403);
  });

  test('TC-FR-12.4-V scan opens the public page without sign-in', async () => {
    const res = await scan(laptop.token).expect(200);
    expect(res.body).toEqual({ label: "Sara's laptop", active: true });
    expect(laptop.url).toMatch(new RegExp(`/t/${laptop.token}$`));
  });

  test('TC-FR-12.4-D damaged or unknown tag handled', async () => {
    const res = await scan('invalidtoken').expect(404);
    expect(res.body.error).toBe('Tag not found.');
  });

  test('TC-FR-12.5-V label and contact form shown', async () => {
    expect((await scan(laptop.token).expect(200)).body.label).toBe("Sara's laptop");
  });

  test('TC-FR-12.5-D no other item data shown', async () => {
    const { body } = await scan(laptop.token).expect(200);
    expect(Object.keys(body).sort()).toEqual(['active', 'label']); // no category, photo or date
  });

  test('TC-FR-12.6-V owner stays anonymous on the page', async () => {
    const res = await scan(laptop.token).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Sara Khoury|Sara K\.|sara\.k/);
  });

  test('TC-FR-12.6-D no identity leaked through the API', async () => {
    const res = await scan(laptop.token).expect(200);
    const raw = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(Object.keys(res.body).sort()).toEqual(['active', 'label']); // no name, email, or identifier
    expect(raw).not.toMatch(/Khoury|Sara K\.|sara\.k@/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('TC-FR-12.7-V message up to 500 characters forwarded', async () => {
    await write(laptop.token, { message: 'Found in Nicol Hall, room 302', contact: '70 000 000' }, 'Phone A').expect(201);
    const msgs = (await sara.get(`/api/tags/${laptop.id}/messages`).expect(200)).body.messages;
    expect(msgs[0]).toMatchObject({ body: 'Found in Nicol Hall, room 302', contact: '70 000 000' });
    const { rows } = await query(`SELECT content, link FROM notifications WHERE user_id = $1 AND type = 'QR_MESSAGE' ORDER BY notification_id DESC LIMIT 1`, [saraId]);
    expect(rows[0].content).toBe('Someone found your Sara\'s laptop: "Found in Nicol Hall, room 302"  Contact: 70 000 000');
    expect(rows[0].link).toBe(`/tags?tag=${laptop.id}`);
    await write(laptop.token, { message: 'x'.repeat(500) }, 'Phone B').expect(201); // exactly 500
  });

  test('TC-FR-12.7-D over-long or empty message refused', async () => {
    const long = await write(laptop.token, { message: 'x'.repeat(501) }, 'Phone C').expect(400);
    expect(long.body.fields.message).toBe('At most 500 characters.');
    const empty = await write(laptop.token, { message: '  ' }, 'Phone C').expect(400);
    expect(empty.body.fields.message).toBe('Write a message to the owner.');
  });

  test('TC-FR-12.8-V email copy sent to the owner', async () => {
    await sendPendingEmails();
    const mail = sent.filter((m) => m.to === 'sara.k@lau.edu').find((m) => m.text.includes('Found in Nicol Hall, room 302'));
    expect(mail).toBeDefined();
  });

  test('TC-FR-12.8-D finder\'s address not revealed', async () => {
    const mail = sent.filter((m) => m.to === 'sara.k@lau.edu').find((m) => m.text.includes('Found in Nicol Hall, room 302'));
    expect(mail.from).toMatch(/foundu/i);
    const { rows } = await query('SELECT device_hash FROM qr_messages ORDER BY qr_message_id DESC LIMIT 1');
    expect(rows[0].device_hash).toMatch(/^[0-9a-f]{64}$/); // a salted hash, never the address itself
    expect(mail.text).not.toMatch(/127\.0\.0\.1|::1|Phone A/);
  });

  test('TC-FR-12.9-V five messages per hour accepted', async () => {
    for (let i = 1; i <= 5; i += 1) await write(keys.token, { message: `Message ${i}` }, 'Phone D').expect(201);
  });

  test('TC-FR-12.9-D sixth message refused', async () => {
    const res = await write(keys.token, { message: 'Message 6' }, 'Phone D').expect(429);
    expect(res.body.error).toMatch(/Try again later\.$/);
    await write(keys.token, { message: 'From another phone' }, 'Phone E').expect(201); // another device
  });

  test('TC-FR-12.10-V owner deactivates the tag', async () => {
    expect((await sara.post(`/api/tags/${laptop.id}/deactivate`).expect(200)).body.active).toBe(false);
    expect((await scan(laptop.token).expect(200)).body).toEqual({ label: "Sara's laptop", active: false });
  });

  test('TC-FR-12.10-D others cannot deactivate; inactive tag takes no message', async () => {
    await lea.post(`/api/tags/${keys.id}/deactivate`).expect(403);
    const res = await write(laptop.token, { message: 'Hello' }, 'Phone F').expect(409);
    expect(res.body.error).toBe('This tag is not active, so it cannot receive messages.');
  });

  test('TC-FR-12.11-V owner reactivates the tag', async () => {
    expect((await sara.post(`/api/tags/${laptop.id}/activate`).expect(200)).body.active).toBe(true);
    expect((await scan(laptop.token).expect(200)).body.active).toBe(true);
    await write(laptop.token, { message: 'Hello again' }, 'Phone F').expect(201);
  });

  test('TC-FR-12.11-D others cannot reactivate', async () => {
    await sara.post(`/api/tags/${keys.id}/deactivate`).expect(200);
    await lea.post(`/api/tags/${keys.id}/activate`).expect(403);
    expect((await scan(keys.token).expect(200)).body.active).toBe(false);
  });

  test('FR-18.7 QR tags turned off for the organization', async () => {
    await query('UPDATE organizations SET qr_enabled = false WHERE organization_id = $1', [R.lau]);
    try {
      await scan(laptop.token).expect(404); // tag unavailable while off
      await write(laptop.token, { message: 'Hello' }, 'Phone G').expect(404);
      await sara.get('/api/tags').expect(404);
    } finally {
      await query('UPDATE organizations SET qr_enabled = true WHERE organization_id = $1', [R.lau]);
    }
    await scan(laptop.token).expect(200); // works again when on
  });
});
