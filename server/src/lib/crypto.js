const crypto = require('crypto');
const argon2 = require('argon2');
const config = require('../config');

const key = Buffer.from(config.dataKey, 'hex');
if (key.length !== 32) throw new Error('DATA_KEY must be 64 hexadecimal characters (32 bytes)');

/** AES-256-GCM encryption for values that must be read back, such as verification answers (NFR-10.1). */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(token) {
  const [iv, tag, data] = token.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Salted, slow hash for codes that are only compared, never read back (NFR-10.2). */
const hash = (value) => argon2.hash(String(value), { type: argon2.argon2id });
const verifyHash = (digest, value) => argon2.verify(digest, String(value));

/** Uniformly random string of `digits` decimal digits (one-time codes, handover codes). */
function randomDigits(digits) {
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** URL-safe random token with `bytes` bytes of entropy (QR tags use 16 bytes = 128 bits, FR-12.2). */
const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { encrypt, decrypt, hash, verifyHash, randomDigits, randomToken };
