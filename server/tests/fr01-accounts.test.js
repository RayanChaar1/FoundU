/* TS-FR-1 User Account and Authentication (Phase III, 9.4.1). */
const { app, request, lastCode, signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');

afterAll(() => pool.end());

describe('TS-FR-1', () => {
  test('TC-FR-1.1-V: member of a registered organization signs in', async () => {
    const agent = await signIn('sara.k@lau.edu');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe('sara.k@lau.edu');
  });

  test('TC-FR-1.1-D: account of an unregistered organization refused', async () => {
    const res = await request(app).post('/api/auth/start').send({ email: 'user@gmail.com' }).expect(403);
    expect(res.body.error).toBe('Your organization is not registered on FoundU.');
  });

  test('TC-FR-1.3-V: six-digit code sent to the organization address', async () => {
    await request(app).post('/api/auth/start').send({ email: 'john@acme.com' }).expect(200);
    expect(lastCode('john@acme.com')).toMatch(/^\d{6}$/);
  });

  test('TC-FR-1.3-D: wrong code refused', async () => {
    await request(app).post('/api/auth/start').send({ email: 'omar.h@lau.edu' }).expect(200);
    const code = lastCode('omar.h@lau.edu');
    const wrong = code === '000000' ? '111111' : '000000';
    await request(app).post('/api/auth/verify').send({ email: 'omar.h@lau.edu', code: wrong }).expect(401);
  });

  test('TC-FR-1.4-D: code older than 10 minutes refused', async () => {
    await request(app).post('/api/auth/start').send({ email: 'lea.n@lau.edu' }).expect(200);
    const code = lastCode('lea.n@lau.edu');
    await query(`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE email = 'lea.n@lau.edu'`);
    const res = await request(app).post('/api/auth/verify').send({ email: 'lea.n@lau.edu', code }).expect(401);
    expect(res.body.error).toMatch(/expired/);
  });

  test('TC-FR-1.5-D: look-alike and unregistered subdomains refused', async () => {
    await request(app).post('/api/auth/start').send({ email: 'omar.h@lau-edu.com' }).expect(403);
    await request(app).post('/api/auth/start').send({ email: 'omar.h@mail.lau.edu' }).expect(403);
  });

  test('TC-FR-1.6-V / TC-FR-1.7-V: first sign-in creates a Registered User profile', async () => {
    const agent = request.agent(app);
    const email = 'new.student@lau.edu';
    await agent.post('/api/auth/start').send({ email }).expect(200);
    const verify = await agent.post('/api/auth/verify').send({ email, code: lastCode(email) }).expect(200);
    expect(verify.body.needsProfile).toBe(true);
    const beirut = verify.body.campuses.find((c) => c.name === 'Beirut');
    await agent.post('/api/auth/profile').send({ fullName: 'New Student', campusId: beirut.campus_id }).expect(201);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ fullName: 'New Student', role: 'USER', campusId: beirut.campus_id });
  });

  test('TC-FR-1.6-D: profile without a name refused', async () => {
    const agent = request.agent(app);
    const email = 'second.student@lau.edu';
    await agent.post('/api/auth/start').send({ email }).expect(200);
    const verify = await agent.post('/api/auth/verify').send({ email, code: lastCode(email) }).expect(200);
    const res = await agent.post('/api/auth/profile').send({ fullName: '', campusId: verify.body.campuses[0].campus_id });
    expect(res.status).toBe(400);
    expect(res.body.fields.fullName).toBeDefined();
  });

  test('TC-FR-1.8-V: sign-out ends the session', async () => {
    const agent = await signIn('sara.k@lau.edu');
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  test('TC-FR-1.9-D: tampered session token refused', async () => {
    await request(app).get('/api/auth/me').set('Cookie', 'foundu_session=invalidtoken').expect(401);
  });

  test('TC-FR-1.11-V: email notifications can be switched off', async () => {
    const agent = await signIn('omar.h@lau.edu');
    const res = await agent.patch('/api/me/preferences').send({ emailNotifications: false }).expect(200);
    expect(res.body.email_notifications).toBe(false);
  });
});
