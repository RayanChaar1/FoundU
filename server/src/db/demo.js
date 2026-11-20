/* Demonstration data for the Phase IV presentation: believable posts, a returned item with its messages and
   karma, a sensitive ID card, items held at the drop-off desk, a QR tag and a report to moderate.  Everything goes
   through the real services, so Smart Match, notifications, karma and photo blurring happen as in use.
   Photos are read from server/demo/photos/ (see the README there); a missing photo leaves the post without one.
   Run after `npm run db:reset`:  npm run db:demo */
const fs = require('fs');
const path = require('path');
const { createApp } = require('../app');
const { query, pool } = require('./pool');
const { settle } = require('../lib/events');
const { decrypt } = require('../lib/crypto');
const posts = require('../modules/posts/service');
const claims = require('../modules/claims/service');
const messaging = require('../modules/messaging/service');
const tags = require('../modules/tags/service');
const moderation = require('../modules/moderation/service');

const PHOTOS = path.join(__dirname, '../../demo/photos');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };
const missing = [];

function photo(name) {
  const file = fs.existsSync(PHOTOS) && fs.readdirSync(PHOTOS).find((f) => path.parse(f).name === name && TYPES[path.extname(f).toLowerCase()]);
  if (!file) { missing.push(name); return []; }
  const buffer = fs.readFileSync(path.join(PHOTOS, file));
  return [{ buffer, mimetype: TYPES[path.extname(file).toLowerCase()], originalname: file, size: buffer.length }];
}

async function user(email) {
  const { rows } = await query(
    `SELECT u.*, o.karma_enabled, o.qr_enabled FROM users u JOIN organizations o USING (organization_id) WHERE u.email = $1`, [email]);
  if (!rows[0]) throw new Error(`${email} is missing: run npm run db:reset first.`);
  return rows[0];
}
const ref = async (sql, params) => (await query(sql, params)).rows[0];
const daysAgo = (n, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
};

(async () => {
  const { rows: [{ name: dbName }] } = await query('SELECT current_database() AS name');
  if (dbName.includes('test') || dbName.includes('perf')) throw new Error(`Refused: ${dbName} is a test database.`);
  const { rows: [{ n }] } = await query('SELECT count(*)::int AS n FROM posts');
  if (n) throw new Error('The database already has posts: run npm run db:reset first.');
  createApp(); // loads every module, so their event listeners (Smart Match, karma, notifications) are registered

  const [sara, omar, lea, karim] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'k.saad@lau.edu'].map(user));
  const lau = sara.organization_id;
  const cat = async (name) => (await ref('SELECT category_id FROM categories WHERE organization_id = $1 AND name = $2', [lau, name])).category_id;
  const at = async (building, campus) => (await ref(
    `SELECT l.location_id FROM locations l JOIN campuses c USING (campus_id)
      WHERE l.organization_id = $1 AND l.building = $2 AND c.name = $3`, [lau, building, campus])).location_id;
  const desk = async (name) => (await ref('SELECT dropoff_id FROM dropoff_points WHERE organization_id = $1 AND name = $2', [lau, name])).dropoff_id;
  const lost = (who, fields, pics = []) => posts.create(who, 'LOST', fields, pics);
  const found = (who, fields, pics = []) => posts.create(who, 'FOUND', fields, pics);
  const backdate = (post, when) => query('UPDATE posts SET event_datetime = $2::timestamptz, created_at = $2::timestamptz + interval \'40 minutes\', updated_at = $2::timestamptz + interval \'40 minutes\' WHERE post_id = $1', [post.post_id, when]);

  const { rows: [{ t0 }] } = await query('SELECT now() AS t0');

  // 1. A finished return: Lea lost her umbrella, Omar found it, they talked, and the handover was confirmed (FR-6, FR-7, FR-9, FR-13)
  const umbrellaLost = await lost(lea, { title: 'Grey folding umbrella', categoryId: await cat('Umbrella'), locationId: await at('Sage Hall', 'Beirut'),
    description: 'Grey folding umbrella with a wooden handle, left on a bench outside room 301.', eventDatetime: daysAgo(6, 13) });
  const umbrella = await found(omar, { title: 'Grey umbrella with a wooden handle', categoryId: await cat('Umbrella'),
    locationId: await at('Sage Hall', 'Beirut'), description: 'Found on the bench outside Sage 301 after the 2 pm class.',
    eventDatetime: daysAgo(6, 15), whereabouts: 'FINDER', verificationQuestion: 'What is written on the strap?', verificationAnswer: 'Paris' }, photo('umbrella'));
  await backdate(umbrellaLost, daysAgo(6, 13)); await backdate(umbrella, daysAgo(6, 15));
  const umbrellaClaim = await claims.submit(lea, umbrella.post_id, { answer: 'Paris', description: 'It has a small Eiffel Tower print on the strap.' });
  await claims.approve(omar, umbrellaClaim.claim_id);
  await messaging.send(lea, umbrellaClaim.claim_id, 'Thank you so much!  Can we meet at the Nicol Hall entrance tomorrow at 11?');
  await messaging.send(omar, umbrellaClaim.claim_id, 'Sure, see you at 11.  I will be wearing a blue jacket.');
  await messaging.send(lea, umbrellaClaim.claim_id, 'Perfect, I will bring my code.');
  const { rows: [{ handover_code_enc: enc }] } = await query('SELECT handover_code_enc FROM claims WHERE claim_id = $1', [umbrellaClaim.claim_id]);
  await claims.confirmHandover(omar, umbrellaClaim.claim_id, decrypt(enc));
  await posts.close(lea, umbrellaLost.post_id);
  await settle();
  // The return happened five days ago: move everything it wrote (claim, messages, karma, badge, notifications) back.
  const shifts = [['claims', 'created_at'], ['claims', 'decided_at'], ['messages', 'sent_at'], ['matches', 'created_at'],
    ['notifications', 'created_at'], ['karma_events', 'created_at'], ['user_badges', 'awarded_at'], ['audit_log', 'created_at'],
    ['posts', 'returned_at'], ['posts', 'closed_at'], ['posts', 'updated_at']];
  for (const [table, col] of shifts) await query(`UPDATE ${table} SET ${col} = ${col} - interval '5 days' WHERE ${col} >= $1`, [t0]);

  // 2. The live demonstration: Omar found AirPods; Sara will post her lost AirPods during the presentation (FR-5)
  const airpods = await found(omar, { title: 'White AirPods Pro in a black case', categoryId: await cat('Electronics'),
    locationId: await at('Riyad Nassar Library', 'Beirut'), description: 'Found on a desk on the second floor of the library, near the windows.',
    eventDatetime: daysAgo(0, 9, 30), whereabouts: 'FINDER', verificationQuestion: 'What initials are engraved on the case?', verificationAnswer: 'SK' }, photo('airpods'));
  await backdate(airpods, daysAgo(0, 9, 30));

  // 3. A sensitive item: its photo is blurred for everyone but the poster, staff and the approved claimant (FR-17)
  const card = await found(omar, { title: 'LAU student ID card', categoryId: await cat('ID card'), locationId: await at('Cafeteria', 'Beirut'),
    description: 'Student ID card found under a table in the cafeteria.  ID 202312345.', eventDatetime: daysAgo(1, 12, 15),
    whereabouts: 'DROPOFF', dropoffId: await desk('Security Office, Nicol Hall'), verificationQuestion: 'What is the first name on the card?',
    verificationAnswer: 'Nour' }, photo('idcard'));
  await backdate(card, daysAgo(1, 12, 15));

  // 4. Items handed to the drop-off desks (FR-14)
  const wallet = await found(lea, { title: 'Brown leather wallet', categoryId: await cat('Wallet'), locationId: await at('Irwin Hall', 'Beirut'),
    description: 'Brown leather wallet with a few cards inside, found in the Irwin Hall auditorium.', eventDatetime: daysAgo(2, 16),
    whereabouts: 'DROPOFF', dropoffId: await desk('Security Office, Nicol Hall'), verificationQuestion: 'Which bank card is inside?',
    verificationAnswer: 'Bank Audi' }, photo('wallet'));
  const charger = await found(karim, { title: 'MacBook charger, 67 W', categoryId: await cat('Electronics'), locationId: await at('Adnan Kassar School of Business', 'Beirut'),
    description: 'White USB-C MacBook charger left plugged in a classroom on the third floor.', eventDatetime: daysAgo(3, 18),
    whereabouts: 'DROPOFF', dropoffId: await desk('Security Office, Nicol Hall'), verificationQuestion: 'What sticker is on the charger?',
    verificationAnswer: 'A cat' }, photo('charger'));
  await backdate(wallet, daysAgo(2, 16)); await backdate(charger, daysAgo(3, 18));

  // 5. Open posts on both campuses for the feed, the search and the map (FR-4, FR-11)
  const more = [
    [lost, sara, { title: 'Blue Hydro Flask water bottle', categoryId: await cat('Water bottle'), locationId: await at('Gymnasium', 'Beirut'),
      description: 'Dark blue 32 oz bottle with stickers of Lebanon and a climbing club.', eventDatetime: daysAgo(1, 19) }, 'bottle', daysAgo(1, 19)],
    [lost, lea, { title: 'Car keys with a red keychain', categoryId: await cat('Keys'), locationId: await at('Zakhem Hall', 'Byblos'),
      description: 'Kia car key and two house keys on a red leather keychain.', eventDatetime: daysAgo(2, 8, 45) }, 'keys', daysAgo(2, 8, 45)],
    [found, omar, { title: 'Black backpack with a laptop sleeve', categoryId: await cat('Bag'), locationId: await at('Joseph G. Jabbra Library', 'Byblos'),
      description: 'Black backpack left near the printers; it holds notebooks and a calculator.', eventDatetime: daysAgo(4, 17),
      whereabouts: 'DROPOFF', dropoffId: await desk('Security Office, Bassil Hall'), verificationQuestion: 'Which calculator model is inside?',
      verificationAnswer: 'Casio fx-991' }, 'backpack', daysAgo(4, 17)],
    [found, sara, { title: 'Engineering notebook, green cover', categoryId: await cat('Books and notes'), locationId: await at('Shannon Hall', 'Beirut'),
      description: 'Green spiral notebook with circuit analysis notes.', eventDatetime: daysAgo(5, 11), whereabouts: 'FINDER',
      verificationQuestion: 'Which course name is on the first page?', verificationAnswer: 'ELE 301' }, 'notebook', daysAgo(5, 11)],
  ];
  for (const [fn, who, fields, pic, when] of more) await backdate(await fn(who, fields, photo(pic)), when);

  // 6. A QR tag on Sara's laptop (FR-12) and a report waiting for moderation (FR-15)
  await tags.create(sara, { label: 'Silver MacBook Air', categoryId: await cat('Laptop') }, photo('laptop')[0]);
  const spam = await found(lea, { title: 'Selling cheap textbooks, DM me', categoryId: await cat('Other'), locationId: await at('Cafeteria', 'Beirut'),
    description: 'Not a found item: textbooks for sale, contact me on Instagram.', eventDatetime: daysAgo(0, 8), whereabouts: 'FINDER',
    verificationQuestion: 'Which book?', verificationAnswer: 'Any' });
  await moderation.report(sara, { postId: spam.post_id, reason: 'SPAM', details: 'This is an advertisement, not a found item.' });

  await settle();
  const counts = await ref(`SELECT (SELECT count(*) FROM posts)::int AS posts, (SELECT count(*) FROM photos)::int AS photos,
    (SELECT count(*) FROM claims)::int AS claims, (SELECT count(*) FROM notifications)::int AS notifications`);
  console.log('Demonstration data loaded:', counts);
  if (missing.length) console.log(`Without photo (add them to server/demo/photos/): ${missing.join(', ')}`);
  await pool.end();
})().catch(async (err) => {
  console.error(err.message);
  await pool.end();
  process.exit(1);
});
