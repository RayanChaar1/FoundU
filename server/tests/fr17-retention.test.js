/* TC-FR-17.5 Retention of personal data (FR-16.8 sets the period, 12 months by default). */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { pool, query } = require('../src/db/pool');
const { ref } = require('./fixtures');
const { anonymizeExpired, REMOVED } = require('../src/modules/retention/service');

let R;
let omar;
let sara;
const ids = [];

const post = async (id) => (await query('SELECT * FROM posts WHERE post_id = $1', [id])).rows[0];

/** A found post with a photo, an edit, a contact, and a claim with a message, closed on `closedAt`. */
async function closedPost(closedAt, status = 'CLOSED') {
  const { rows: [p] } = await query(
    `INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime,
                        status, closed_at, created_at, whereabouts, verification_question, verification_answer_enc)
     VALUES ($1, $2, 'FOUND', 'Wallet of Omar Haddad', 'Brown wallet with a photo of my family', $3, $4,
             '2025-09-20', $5, $6, '2025-09-20', 'FINDER', 'Initials inside?', 'enc') RETURNING post_id`,
    [R.lau, omar, R.wallet, R.nicol, status, closedAt],
  );
  const id = p.post_id;
  ids.push(id);
  const file = `retention-test-${id}.webp`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, file), 'x');
  await query('INSERT INTO photos (post_id, storage_path, position) VALUES ($1, $2, 1)', [id, file]);
  await query(`INSERT INTO post_history (post_id, editor_id, changes) VALUES ($1, $2, '{"title":{"from":"Old title"}}')`, [id, omar]);
  await query(`INSERT INTO post_contacts (post_id, sender_id, body) VALUES ($1, $2, 'I think it is mine, call me')`, [id, sara]);
  const { rows: [c] } = await query(
    `INSERT INTO claims (post_id, claimant_id, answer_text, status, rejection_reason)
     VALUES ($1, $2, 'S.K.', 'REJECTED', 'Wrong initials') RETURNING claim_id`, [id, sara]);
  await query(`INSERT INTO messages (claim_id, sender_id, body) VALUES ($1, $2, 'My number is 70 123 456')`, [c.claim_id, sara]);
  return { id, file, claimId: c.claim_id };
}

beforeAll(async () => {
  R = await ref();
  const uid = async (e) => (await query('SELECT user_id FROM users WHERE email = $1', [e])).rows[0].user_id;
  omar = await uid('omar.h@lau.edu');
  sara = await uid('sara.k@lau.edu');
});

afterAll(async () => {
  await query('DELETE FROM posts WHERE post_id = ANY($1)', [ids]);
  await pool.end();
});

describe('TS-FR-17 Privacy of sensitive items', () => {
  test('TC-FR-17.5-V personal data removed after 12 months', async () => {
    const { id, file, claimId } = await closedPost('2025-10-01T12:00:00');
    expect(await anonymizeExpired(new Date('2026-10-02T12:00:00'))).toContain(id);

    const p = await post(id);
    expect(p).toMatchObject({ owner_id: null, title: 'Found item', description: '', verification_answer_enc: '' });
    expect(p.anonymized_at).toEqual(new Date('2026-10-02T12:00:00'));
    // statistics kept
    expect(p).toMatchObject({ type: 'FOUND', status: 'CLOSED', category_id: R.wallet, location_id: R.nicol });
    expect(p.closed_at).toEqual(new Date('2025-10-01T12:00:00'));

    expect((await query('SELECT 1 FROM photos WHERE post_id = $1', [id])).rowCount).toBe(0);
    expect(fs.existsSync(path.join(config.uploadDir, file))).toBe(false);
    expect((await query('SELECT 1 FROM post_history WHERE post_id = $1', [id])).rowCount).toBe(0);
    expect((await query('SELECT sender_id, body FROM post_contacts WHERE post_id = $1', [id])).rows).toEqual([{ sender_id: null, body: REMOVED }]);
    expect((await query('SELECT claimant_id, answer_text, rejection_reason, status FROM claims WHERE claim_id = $1', [claimId])).rows)
      .toEqual([{ claimant_id: null, answer_text: REMOVED, rejection_reason: REMOVED, status: 'REJECTED' }]);
    expect((await query('SELECT sender_id, body FROM messages WHERE claim_id = $1', [claimId])).rows).toEqual([{ sender_id: null, body: REMOVED }]);

    expect(await anonymizeExpired(new Date('2026-10-03T12:00:00'))).not.toContain(id); // only once
  });

  test('TC-FR-17.5-D data kept before 12 months; open posts untouched', async () => {
    const { id } = await closedPost('2025-10-01T12:00:00');
    expect(await anonymizeExpired(new Date('2026-09-30T12:00:00'))).not.toContain(id);
    expect(await post(id)).toMatchObject({ owner_id: omar, title: 'Wallet of Omar Haddad', anonymized_at: null });

    const open = (await closedPost(null, 'OPEN')).id;
    expect(await anonymizeExpired(new Date('2027-01-01T12:00:00'))).not.toContain(open);
    expect(await post(open)).toMatchObject({ owner_id: omar, title: 'Wallet of Omar Haddad', anonymized_at: null });

    // the organization's own period (FR-16.8): with 24 months, the same post is still kept after 12
    await query('UPDATE organizations SET retention_months = 24 WHERE organization_id = $1', [R.lau]);
    try {
      expect(await anonymizeExpired(new Date('2026-10-02T12:00:00'))).not.toContain(id);
    } finally {
      await query('UPDATE organizations SET retention_months = 12 WHERE organization_id = $1', [R.lau]);
    }
  });
});
