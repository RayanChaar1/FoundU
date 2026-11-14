/* File storage adapter (Figure 6, data access layer): stores photos compressed to at most 1 MB (FR-2.7, NFR-16.1)
   and keeps a blurred copy for sensitive posts (FR-17.2).  Files live in server/uploads/ under random names. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const config = require('../config');
const { randomToken } = require('./crypto');
const { badRequest } = require('./errors');

const MAX_BYTES = 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']; // FR-2.6

fs.mkdirSync(config.uploadDir, { recursive: true });

const isHeic = (buf) => ['ftypheic', 'ftypheix', 'ftypmif1', 'ftypheif', 'ftyphevc'].includes(buf.subarray(4, 12).toString());

/** Compresses an image to WebP of at most 1 MB, lowering quality, then resolution, until it fits. */
async function compress(input) {
  let width = 1600;
  let quality = 80;
  for (;;) {
    const out = await sharp(input).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality }).toBuffer();
    if (out.length <= MAX_BYTES || width <= 400) return out;
    if (quality > 50) quality -= 15;
    else width = Math.round(width * 0.75);
  }
}

/** Validates and stores one uploaded photo.  Returns { storagePath, blurredPath }. */
async function savePhoto(file, { blur }) {
  if (!ACCEPTED.includes(file.mimetype)) throw badRequest('Photos must be JPEG, PNG, WebP, or HEIC.');
  let input = file.buffer;
  if (isHeic(input)) input = Buffer.from(await heicConvert({ buffer: input, format: 'JPEG', quality: 0.9 }));
  let compressed;
  try {
    compressed = await compress(input);
  } catch {
    throw badRequest('This file is not a valid image.');
  }
  const name = randomToken(12);
  const storagePath = `${name}.webp`;
  fs.writeFileSync(path.join(config.uploadDir, storagePath), compressed);
  let blurredPath = null;
  if (blur) {
    blurredPath = `${name}-blur.webp`;
    fs.writeFileSync(path.join(config.uploadDir, blurredPath), await sharp(compressed).blur(40).webp({ quality: 60 }).toBuffer());
  }
  return { storagePath, blurredPath };
}

/** Creates the blurred copy of an existing photo (a post that becomes sensitive after an edit). */
async function blurExisting(storagePath) {
  const blurredPath = storagePath.replace(/\.webp$/, '-blur.webp');
  await sharp(path.join(config.uploadDir, storagePath)).blur(40).webp({ quality: 60 })
    .toFile(path.join(config.uploadDir, blurredPath));
  return blurredPath;
}

const filePath = (name) => path.join(config.uploadDir, path.basename(name));

function remove(...names) {
  for (const n of names) if (n) fs.rm(filePath(n), { force: true }, () => {});
}

module.exports = { savePhoto, blurExisting, filePath, remove, ACCEPTED };
