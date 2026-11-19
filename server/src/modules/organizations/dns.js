/* FR-18.2: reads the TXT records of a domain.  Outside production, a domain listed in server/dev-dns.json is answered
   from that file instead, so the activation can be shown on a laptop without owning a real domain:
     { "cedarbank.com": ["foundu-verify=..."] } */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const DEV_FILE = path.resolve(__dirname, '..', '..', '..', 'dev-dns.json');

function devRecords(domain) {
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const records = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'))[domain];
    return Array.isArray(records) ? records.map(String) : null;
  } catch {
    return null; // no file, or not valid JSON
  }
}

/** The TXT records of `domain`, each as one string; [] when there is none or the domain does not exist. */
async function txtRecords(domain) {
  const dev = devRecords(domain);
  if (dev) return dev;
  try {
    return (await dns.resolveTxt(domain)).map((chunks) => chunks.join(''));
  } catch (err) {
    if (['ENODATA', 'ENOTFOUND', 'ENOTIMP', 'ESERVFAIL', 'EREFUSED', 'ETIMEOUT'].includes(err.code)) return [];
    throw err;
  }
}

module.exports = { txtRecords, DEV_FILE };
