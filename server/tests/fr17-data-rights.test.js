/* TC-FR-17.6, TC-FR-17.7 and TC-NFR-22.2: users download, correct and delete their own personal data. */
const { app, request, lastCode, signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');

let R;
let omar;
let omarId;

/** A new LAU user who completed their profile; returns the agent and the user id. */
async function newUser(email, fullName) {
  const agent = request.agent(app);
  await agent.post('/api/auth/start').send({ email }).expect(200);
  const verify = await agent.post('/api/auth/verify').send({ email, code: lastCode(email) }).expect(200);
  const beirut = verify.body.campuses.find((c) => c.name === 'Beirut');
  await agent.post('/api/auth/profile').send({ fullName, campusId: beirut.campus_id }).expect(201);
  await query('DELETE FROM otp_codes WHERE lower(email) = lower($1)', [email]);
  const me = await agent.get('/api/auth/me').expect(200);
  return { agent, id: me.body.user.id };
}
const post = async (agent, type, title, extra = {}) => {
  const req = agent.post(`/api/posts/${type}`);
  const fields = { title, categoryId: R.wallet, locationId: R.nicol, date: today(), ...extra };
  if (type === 'found') Object.assign(fields, { whereabouts: 'FINDER', verificationQuestion: 'What is inside?', verificationAnswer: 'A red library card', ...extra });
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
};
const claim = async (agent, postId) =>
  (await agent.post(`/api/posts/${postId}/claims`).send({ answer: 'Red library card', description: 'Brown leather, from my brother' }).expect(201)).body.claim.id;

beforeAll(async () => {
  R = await ref();
  omar = await signIn('omar.h@lau.edu');
  omarId = (await omar.get('/api/auth/me')).body.user.id;
});

afterAll(() => pool.end());

describe('FR-17.6 download my data', () => {
  test('TC-FR-17.6-V: the file holds the profile, posts, claims and messages of the user', async () => {
    const { agent: nour } = await newUser('nour.export@lau.edu', 'Nour Haddad');
    const mine = await post(nour, 'lost', 'Grey umbrella with a wooden handle');
    const found = await post(omar, 'found', 'Brown wallet');
    const claimId = await claim(nour, found);
    await omar.post(`/api/claims/${claimId}/approve`).expect(200);
    await nour.post(`/api/conversations/${claimId}/messages`).send({ body: 'I can pass by at noon.' }).expect(201);
    await omar.post(`/api/conversations/${claimId}/messages`).send({ body: 'Omar answers at 12:05.' }).expect(201);

    const res = await nour.get('/api/me/data').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="foundu-my-data.json"/);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const data = JSON.parse(res.text);
    expect(data.profile).toMatchObject({ email: 'nour.export@lau.edu', fullName: 'Nour Haddad', campus: 'Beirut' });
    expect(data.posts.map((p) => p.id)).toContain(mine);
    expect(data.claims[0]).toMatchObject({ answer: 'Red library card', description: 'Brown leather, from my brother', status: 'APPROVED' });
    expect(data.messages.map((m) => m.body)).toEqual(['I can pass by at noon.']);
    expect(data.notifications.length).toBeGreaterThan(0);
  });

  test('TC-FR-17.6-D: no other user\'s data in the file, and no way to ask for another user\'s file', async () => {
    const { agent: nour } = await newUser('nour.private@lau.edu', 'Nour Private');
    const found = await post(omar, 'found', 'Black backpack', { verificationAnswer: 'Omar secret answer' });
    const claimId = await claim(nour, found);
    await omar.post(`/api/claims/${claimId}/approve`).expect(200);
    await omar.post(`/api/conversations/${claimId}/messages`).send({ body: 'Only Omar wrote this.' }).expect(201);
    const text = (await nour.get('/api/me/data').expect(200)).text;
    for (const other of ['omar.h@lau.edu', 'Omar Haddad', 'Only Omar wrote this.', 'Omar secret answer']) expect(text).not.toContain(other);

    await request(app).get('/api/me/data').expect(401);
    await nour.get(`/api/users/${omarId}/data`).expect(404); // there is no route that names another user
    const forged = JSON.parse((await nour.get(`/api/me/data?user=${omarId}&userId=${omarId}`).expect(200)).text);
    expect(forged.profile.email).toBe('nour.private@lau.edu');
  });
});

describe('FR-17.7 delete my data', () => {
  test('TC-FR-17.7-V: deletion removes the profile and personal data at once; posts stay only anonymized', async () => {
    const { agent: rami, id } = await newUser('rami.delete@lau.edu', 'Rami Khalil');
    const lostId = await post(rami, 'lost', 'Rami blue water bottle', { description: 'With my name, Rami Khalil, on it' });
    const closedId = await post(rami, 'lost', 'Rami calculator');
    await rami.post(`/api/posts/${closedId}/close`).send({}).expect(200);
    const found = await post(omar, 'found', 'Silver ring');
    const pending = await claim(rami, found);
    const theirs = await post(omar, 'lost', 'Laptop charger');
    const waiting = await (async () => {
      const { agent: lina } = await newUser('lina.waiting@lau.edu', 'Lina Waiting');
      return { lina, foundOfRami: await post(rami, 'found', 'Rami found keys') };
    })();
    const linaClaim = await claim(waiting.lina, waiting.foundOfRami);
    await rami.post(`/api/posts/${theirs}/contact`).send({ message: 'Rami here, it may be mine.' }).expect(201);

    const res = await rami.delete('/api/me').send({ confirm: 'DELETE' }).expect(200);
    expect(res.body).toEqual({ deleted: true });
    await rami.get('/api/auth/me').expect(401); // signed out

    const { rows: [u] } = await query('SELECT email, full_name, display_name, status, campus_id FROM users WHERE user_id = $1', [id]);
    expect(u).toEqual({ email: `deleted-${id}@deleted.invalid`, full_name: 'Deleted user', display_name: 'Deleted user', status: 'DELETED', campus_id: null });
    const { rows: posts } = await query('SELECT post_id, owner_id, title, description, status FROM posts WHERE post_id = ANY($1) ORDER BY post_id', [[lostId, closedId, waiting.foundOfRami]]);
    for (const p of posts) expect(p).toMatchObject({ owner_id: null, description: '', status: 'CLOSED' });
    expect(posts.map((p) => p.title)).toEqual(['Lost item', 'Lost item', 'Found item']);
    const { rows: [c] } = await query('SELECT claimant_id, answer_text, description, status FROM claims WHERE claim_id = $1', [pending]);
    expect(c).toEqual({ claimant_id: null, answer_text: 'Deleted at the request of its author.', description: null, status: 'WITHDRAWN' });
    // Lina's claim on Rami's post is closed and she is told why
    const { rows: [lc] } = await query('SELECT status FROM claims WHERE claim_id = $1', [linaClaim]);
    expect(lc.status).toBe('REJECTED');
    const note = await waiting.lina.get('/api/notifications').expect(200);
    expect(JSON.stringify(note.body)).toMatch(/its owner deleted their data/);

    // Signing in again with the same address starts a brand-new account
    await request(app).post('/api/auth/start').send({ email: 'rami.delete@lau.edu' }).expect(200);
    const again = await request(app).post('/api/auth/verify').send({ email: 'rami.delete@lau.edu', code: lastCode('rami.delete@lau.edu') }).expect(200);
    expect(again.body.needsProfile).toBe(true);
  });

  test('TC-FR-17.7-D: deletion needs confirmation, waits for open handovers, and cannot target another user', async () => {
    const { agent: sami, id } = await newUser('sami.handover@lau.edu', 'Sami Handover');
    const res = await sami.delete('/api/me').send({});
    expect(res.status).toBe(400);
    expect(res.body.fields.confirm).toBe('Type DELETE to confirm.');

    const found = await post(omar, 'found', 'Blue scarf');
    const claimId = await claim(sami, found);
    await omar.post(`/api/claims/${claimId}/approve`).expect(200);
    const busy = await sami.delete('/api/me').send({ confirm: 'DELETE' }).expect(409);
    expect(busy.body.error).toBe('Finish or cancel your handovers first: "Blue scarf".');
    expect((await query('SELECT status FROM users WHERE user_id = $1', [id])).rows[0].status).toBe('ACTIVE');

    await sami.delete(`/api/users/${omarId}`).send({ confirm: 'DELETE' }).expect(404); // no route deletes another user
    await request(app).delete('/api/me').send({ confirm: 'DELETE' }).expect(401);
    await omar.get('/api/auth/me').expect(200);
  });
});

describe('NFR-22.2 GDPR rights', () => {
  test('TC-NFR-22.2-V: access, rectification and portability', async () => {
    const { agent: maha } = await newUser('maha.gdpr@lau.edu', 'Maha Gdpr');
    const byblos = (await query(`SELECT campus_id FROM campuses WHERE organization_id = $1 AND name = 'Byblos'`, [R.lau])).rows[0].campus_id;
    const fixed = await maha.patch('/api/me/profile').send({ fullName: 'Maha Saleh', displayName: 'Maha S.', campusId: byblos }).expect(200);
    expect(fixed.body.user).toEqual({ fullName: 'Maha Saleh', displayName: 'Maha S.', campusId: byblos });
    expect((await maha.get('/api/auth/me')).body.user).toMatchObject({ fullName: 'Maha Saleh', displayName: 'Maha S.', campusId: byblos });
    const file = JSON.parse((await maha.get('/api/me/data').expect(200)).text); // machine-readable (JSON)
    expect(file.profile).toMatchObject({ fullName: 'Maha Saleh', displayName: 'Maha S.', campus: 'Byblos' });

    const acmeCampus = (await query(`SELECT c.campus_id FROM campuses c JOIN organizations o USING (organization_id) WHERE o.name LIKE 'Acme%' LIMIT 1`)).rows[0].campus_id;
    const wrong = await maha.patch('/api/me/profile').send({ campusId: acmeCampus }).expect(400);
    expect(wrong.body.fields.campusId).toBe('Choose a campus of your organization.');
    expect((await maha.patch('/api/me/profile').send({ displayName: 'M' }).expect(400)).body.fields.displayName).toBeDefined();
  });

  test('TC-NFR-22.2-D: after erasure, no table holds the user\'s email or name', async () => {
    const { agent: tala, id } = await newUser('tala.erase@lau.edu', 'Tala Erasure');
    await post(tala, 'lost', 'Tala Erasure student card');
    await tala.delete('/api/me').send({ confirm: 'DELETE' }).expect(200);
    const { rows: columns } = await query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')`);
    const found = [];
    for (const { table_name: t, column_name: c } of columns) {
      const { rowCount } = await query(`SELECT 1 FROM "${t}" WHERE "${c}" ILIKE ANY ($1) LIMIT 1`, [['%tala.erase%', '%Tala Erasure%']]);
      if (rowCount) found.push(`${t}.${c}`);
    }
    expect(found).toEqual([]);
    expect((await query('SELECT status FROM users WHERE user_id = $1', [id])).rows[0].status).toBe('DELETED');
  });
});
