/* Shared test data: reference ids of the seed and generated images. */
const sharp = require('sharp');
const { query } = require('../src/db/pool');

async function ref() {
  const one = async (sql, params) => (await query(sql, params)).rows[0];
  const lau = (await one(`SELECT organization_id FROM organizations WHERE name = 'Lebanese American University'`)).organization_id;
  const cat = async (name) => (await one('SELECT category_id FROM categories WHERE organization_id = $1 AND name = $2', [lau, name])).category_id;
  const bld = async (name) => (await one('SELECT location_id FROM locations WHERE building = $1', [name])).location_id;
  const campus = async (name) => (await one('SELECT campus_id FROM campuses WHERE organization_id = $1 AND name = $2', [lau, name])).campus_id;
  const dropoff = async (name) => (await one('SELECT dropoff_id FROM dropoff_points WHERE name = $1', [name])).dropoff_id;
  return {
    lau,
    phone: await cat('Phone'),
    wallet: await cat('Wallet'),
    idCard: await cat('ID card'),
    nicol: await bld('Nicol Hall'),
    library: await bld('Riyad Nassar Library'),
    bassil: await bld('Bassil Hall'),
    beirut: await campus('Beirut'),
    byblos: await campus('Byblos'),
    securityOffice: await dropoff('Security Office, Nicol Hall'),
  };
}

/** A JPEG of the given size in pixels; `noise` makes it hard to compress. */
async function jpeg(width = 800, height = 600, noise = false) {
  if (noise) {
    const raw = require('crypto').randomBytes(width * height * 3);
    return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  }
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } } }).jpeg().toBuffer();
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { ref, jpeg, today };
