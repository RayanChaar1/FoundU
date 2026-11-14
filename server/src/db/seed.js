/* Test data of section 9.2 (Table 27): LAU with its two campuses, Acme Corp as a second organization,
   the test accounts, categories, drop-off points, and badges.  No real personal data is used. */
const { pool, transaction } = require('./pool');

const LAU_BUILDINGS = {
  Beirut: [
    ['Nicol Hall', 33.89278, 35.47791], ['Riyad Nassar Library', 33.89322, 35.47853],
    ['Irwin Hall', 33.89246, 35.47712], ['Sage Hall', 33.89301, 35.47680],
    ['Business Building', 33.89355, 35.47746], ['Cafeteria', 33.89211, 35.47826],
  ],
  Byblos: [
    ['Bassil Hall', 34.11585, 35.67431], ['Joseph G. Jabbra Library', 34.11632, 35.67505],
    ['Frem Civic Center', 34.11541, 35.67377], ['Engineering Building', 34.11690, 35.67450],
  ],
};
const CAMPUS_CENTER = { Beirut: [33.8929, 35.4778], Byblos: [34.1161, 35.6744] };
const CATEGORIES = [
  ['Phone', false], ['Laptop', false], ['Wallet', false], ['Keys', false], ['Bag', false], ['Clothing', false],
  ['Water bottle', false], ['Umbrella', false], ['Electronics', false], ['Books and notes', false],
  ['ID card', true], ['Bank card', true], ['Passport', true], ['Official document', true], ['Other', false],
];
const BADGES = [
  ['FIRST_FIND', 'First Find', null], ['HELPING_HAND', 'Helping Hand', 50],
  ['CAMPUS_HERO', 'Campus Hero', 100], ['CAMPUS_GUARDIAN', 'Campus Guardian', 250],
];

async function seed() {
  await transaction(async (db) => {
    await db.query(`TRUNCATE organizations, users, badges, otp_codes RESTART IDENTITY CASCADE`);
    for (const [code, name, threshold] of BADGES) {
      await db.query('INSERT INTO badges (code, name, karma_threshold) VALUES ($1, $2, $3)', [code, name, threshold]);
    }

    const orgId = async (name, type, domains, contact, contactEmail) =>
      (await db.query(
        `INSERT INTO organizations (name, type, email_domains, status, contact_name, contact_email)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5) RETURNING organization_id`,
        [name, type, domains, contact, contactEmail],
      )).rows[0].organization_id;

    const lau = await orgId('Lebanese American University', 'UNIVERSITY', ['lau.edu', 'lau.edu.lb'],
      'Maya Azar', 'maya.azar@lau.edu');
    const acme = await orgId('Acme Corp', 'COMPANY', ['acme.com'], 'John Doe', 'john@acme.com');
    const foundu = await orgId('FoundU', 'COMPANY', ['foundu.app'], 'Platform Admin', 'pa@foundu.app');

    const campus = {};
    const building = {};
    for (const [name, [lat, lng]] of Object.entries(CAMPUS_CENTER)) {
      campus[name] = (await db.query(
        'INSERT INTO campuses (organization_id, name, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING campus_id',
        [lau, name, lat, lng],
      )).rows[0].campus_id;
      for (const [b, blat, blng] of LAU_BUILDINGS[name]) {
        building[b] = (await db.query(
          `INSERT INTO locations (organization_id, campus_id, building, latitude, longitude)
           VALUES ($1, $2, $3, $4, $5) RETURNING location_id`,
          [lau, campus[name], b, blat, blng],
        )).rows[0].location_id;
      }
    }
    const acmeCampus = (await db.query(
      `INSERT INTO campuses (organization_id, name, latitude, longitude) VALUES ($1, 'Head Office', 33.8886, 35.4955)
       RETURNING campus_id`, [acme],
    )).rows[0].campus_id;
    await db.query(
      `INSERT INTO locations (organization_id, campus_id, building, latitude, longitude)
       VALUES ($1, $2, 'Main Building', 33.8886, 35.4955)`, [acme, acmeCampus],
    );

    for (const [name, sensitive] of CATEGORIES) {
      for (const org of [lau, acme]) {
        await db.query('INSERT INTO categories (organization_id, name, is_sensitive_default) VALUES ($1, $2, $3)',
          [org, name, sensitive]);
      }
    }

    await db.query(
      `INSERT INTO dropoff_points (organization_id, location_id, name, opening_hours, contact_number) VALUES
       ($1, $2, 'Security Office, Nicol Hall', '08:00 to 17:00', '01-786456 ext. 1111'),
       ($1, $3, 'Library Desk, Riyad Nassar Library', '08:00 to 22:00', '01-786456 ext. 1222'),
       ($1, $4, 'Security Office, Bassil Hall', '08:00 to 17:00', '09-547254 ext. 2111')`,
      [lau, building['Nicol Hall'], building['Riyad Nassar Library'], building['Bassil Hall']],
    );

    const users = [
      [lau, 'sara.k@lau.edu', 'Sara Khoury', 'USER', 'Beirut'],
      [lau, 'omar.h@lau.edu', 'Omar Haddad', 'USER', 'Beirut'],
      [lau, 'lea.n@lau.edu', 'Lea Nassar', 'USER', 'Beirut'],
      [lau, 'k.saad@lau.edu', 'Karim Saad', 'SECURITY', 'Beirut'],
      [lau, 'maya.azar@lau.edu', 'Maya Azar', 'ORG_ADMIN', 'Beirut'],
      [acme, 'john@acme.com', 'John Doe', 'USER', null],
      [foundu, 'pa@foundu.app', 'Platform Admin', 'PLATFORM_ADMIN', null],
    ];
    for (const [org, email, name, role, campusName] of users) {
      const display = `${name.split(' ')[0]} ${name.split(' ')[1][0]}.`;
      const campusId = campusName ? campus[campusName] : org === acme ? acmeCampus : null;
      await db.query(
        `INSERT INTO users (organization_id, email, full_name, display_name, role, campus_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [org, email, name, display, role, campusId],
      );
    }
  });
}

if (require.main === module) {
  seed()
    .then(() => console.log('seed data loaded'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seed };
