/* FoundU QR tags (FR-12): a user registers a belonging, prints its QR sticker, and a finder who scans it sends the
   owner an anonymous message.  The public side never reveals who the owner is (FR-12.6).  Nothing works while the
   owner's organization has QR tags turned off (FR-18.7). */
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const config = require('../../config');
const { query, transaction } = require('../../db/pool');
const { randomToken } = require('../../lib/crypto');
const storage = require('../../lib/storage');
const { notify } = require('../notifications/service');
const { badRequest, forbidden, notFound, HttpError } = require('../../lib/errors');

const TOKEN_BYTES = 16; // 128 bits, 22 base64url characters (FR-12.2)
const MESSAGES_PER_HOUR = 5; // per tag and device (FR-12.9)

const tagUrl = (token) => `${config.clientUrl}/t/${token}`;

const OWN = `
  SELECT t.tag_id AS id, t.tag_code AS token, t.item_label AS label, t.category_id AS "categoryId", c.name AS category,
         t.photo_path IS NOT NULL AS "hasPhoto", t.is_active AS active, t.created_at AS "createdAt",
         (SELECT count(*)::int FROM qr_messages m WHERE m.tag_id = t.tag_id) AS messages,
         (SELECT max(m.created_at) FROM qr_messages m WHERE m.tag_id = t.tag_id) AS "lastMessageAt"
    FROM qr_tags t LEFT JOIN categories c ON c.category_id = t.category_id`;

/** FR-18.7: refuses everything while the organization has QR tags turned off. */
function requireEnabled(user) {
  if (!user.qr_enabled) throw notFound('QR tags are turned off for your organization.');
}

/** The owner's tag, or 404 if it does not exist, 403 if it is someone else's (TC-FR-12.10-D). */
async function ownTag(user, id) {
  const { rows: [t] } = await query('SELECT tag_id, owner_id, photo_path, item_label, tag_code, is_active FROM qr_tags WHERE tag_id = $1', [id]);
  if (!t) throw notFound('This tag does not exist.');
  if (t.owner_id !== user.user_id) throw forbidden('Only the owner can manage this tag.');
  return t;
}

// ---------------------------------------------------------------------------------- the owner's side

async function list(user) {
  requireEnabled(user);
  const { rows } = await query(`${OWN} WHERE t.owner_id = $1 ORDER BY t.created_at DESC, t.tag_id DESC`, [user.user_id]);
  return rows.map((t) => ({ ...t, url: tagUrl(t.token) }));
}

/** FR-12.1, FR-12.2: registers a belonging and gives it a new random token. */
async function create(user, { label, categoryId }, photo) {
  requireEnabled(user);
  if (categoryId) {
    const { rowCount } = await query('SELECT 1 FROM categories WHERE category_id = $1 AND organization_id = $2',
      [categoryId, user.organization_id]);
    if (!rowCount) throw badRequest('Choose a category of your organization.', { fields: { categoryId: 'Choose a category of your organization.' } });
  }
  const photoPath = photo ? (await storage.savePhoto(photo, { blur: false })).storagePath : null;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { rows: [t] } = await query(
          `INSERT INTO qr_tags (owner_id, tag_code, item_label, category_id, photo_path) VALUES ($1, $2, $3, $4, $5)
           RETURNING tag_id`,
          [user.user_id, randomToken(TOKEN_BYTES), label, categoryId || null, photoPath],
        );
        const { rows: [tag] } = await query(`${OWN} WHERE t.tag_id = $1`, [t.tag_id]);
        return { ...tag, url: tagUrl(tag.token) };
      } catch (err) {
        if (err.code !== '23505' || attempt >= 2) throw err; // a collision of 128 random bits: try another token
      }
    }
  } catch (err) {
    if (photoPath) storage.remove(photoPath);
    throw err;
  }
}

/** FR-12.10, FR-12.11 */
async function setActive(user, id, active) {
  requireEnabled(user);
  await ownTag(user, id);
  await query('UPDATE qr_tags SET is_active = $2 WHERE tag_id = $1', [id, active]);
  const { rows: [tag] } = await query(`${OWN} WHERE t.tag_id = $1`, [id]);
  return { ...tag, url: tagUrl(tag.token) };
}

/** Deleting a tag also deletes its messages; a printed sticker then shows "Tag not found". */
async function remove(user, id) {
  requireEnabled(user);
  const t = await ownTag(user, id);
  await query('DELETE FROM qr_tags WHERE tag_id = $1', [id]);
  if (t.photo_path) storage.remove(t.photo_path);
}

async function messages(user, id) {
  requireEnabled(user);
  await ownTag(user, id);
  const { rows } = await query(
    `SELECT qr_message_id AS id, body, contact, created_at AS "createdAt" FROM qr_messages
      WHERE tag_id = $1 ORDER BY created_at DESC, qr_message_id DESC`,
    [id],
  );
  return rows;
}

async function photoPath(user, id) {
  requireEnabled(user);
  const t = await ownTag(user, id);
  if (!t.photo_path) throw notFound('This belonging has no photo.');
  return storage.filePath(t.photo_path);
}

async function qrSvg(user, id) {
  requireEnabled(user);
  const t = await ownTag(user, id);
  return QRCode.toString(tagUrl(t.tag_code), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}

/**
 * FR-12.3: an A4 sheet of stickers, 3 across and 4 down, each with its QR code, label and a short instruction.
 * Only the signed-in user's own tags; `ids` limits the sheet to some of them.  Returns a PDF buffer.
 */
async function stickerSheet(user, ids) {
  requireEnabled(user);
  const { rows } = await query(
    `SELECT tag_id, tag_code, item_label FROM qr_tags
      WHERE owner_id = $1 AND is_active AND ($2::int[] IS NULL OR tag_id = ANY ($2))
      ORDER BY created_at, tag_id`,
    [user.user_id, ids?.length ? ids : null],
  );
  if (!rows.length) throw badRequest('You have no active tag to print.');

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'FoundU QR stickers', Author: 'FoundU' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const MM = 72 / 25.4;
  const cols = 3;
  const perPage = 12;
  const cellW = 60 * MM;
  const cellH = 66 * MM;
  const left = (doc.page.width - cols * cellW) / 2;
  const top = (doc.page.height - 4 * cellH) / 2;
  const qrSize = 40 * MM;

  for (let i = 0; i < rows.length; i += 1) {
    if (i && i % perPage === 0) doc.addPage();
    const n = i % perPage;
    const x = left + (n % cols) * cellW;
    const y = top + Math.floor(n / cols) * cellH;
    doc.save().lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#b8c0cc')
      .roundedRect(x + 3 * MM, y + 3 * MM, cellW - 6 * MM, cellH - 6 * MM, 4 * MM).stroke().restore();
    const png = await QRCode.toBuffer(tagUrl(rows[i].tag_code), { errorCorrectionLevel: 'M', margin: 0, width: 600 });
    doc.image(png, x + (cellW - qrSize) / 2, y + 7 * MM, { width: qrSize, height: qrSize });
    doc.fillColor('#14213d').font('Helvetica-Bold').fontSize(10)
      .text(rows[i].item_label, x + 5 * MM, y + 50 * MM, { width: cellW - 10 * MM, align: 'center', height: 12, ellipsis: true });
    doc.fillColor('#5b6577').font('Helvetica').fontSize(7.5)
      .text('Found me? Scan to contact my owner through FoundU.', x + 5 * MM, y + 56 * MM, { width: cellW - 10 * MM, align: 'center' });
  }
  doc.end();
  return done;
}

// ------------------------------------------------------------------------------------ the finder's side

/** The tag behind a token, with the organization's switch.  Unknown tokens and switched-off organizations give the
    same 404, so a guessed token reveals nothing (TC-FR-12.2-D). */
async function byToken(token) {
  const { rows: [t] } = await query(
    `SELECT t.tag_id, t.owner_id, t.item_label, t.is_active, o.qr_enabled
       FROM qr_tags t JOIN users u ON u.user_id = t.owner_id JOIN organizations o USING (organization_id)
      WHERE t.tag_code = $1 AND u.status = 'ACTIVE'`,
    [token],
  );
  if (!t || !t.qr_enabled) throw notFound('Tag not found.');
  return t;
}

/** FR-12.4 to FR-12.6: only the label and whether the tag accepts messages.  No owner, category, photo or date. */
async function publicTag(token) {
  const t = await byToken(token);
  return { label: t.item_label, active: t.is_active };
}

/** A device is identified by a salted hash of its address and browser, so no address is ever stored. */
const deviceHash = (ip, userAgent) => crypto.createHash('sha256')
  .update(`${config.jwtSecret}|${ip}|${userAgent || ''}`).digest('hex');

/** FR-12.7 to FR-12.9: stores the message, notifies the owner in the application and by email (the notification
    sweep of FR-8 sends the email from FoundU's own address, so the finder's address never appears). */
async function sendMessage(token, { message, contact }, device) {
  const t = await byToken(token);
  if (!t.is_active) throw new HttpError(409, 'This tag is not active, so it cannot receive messages.');
  await transaction(async (db) => {
    await db.query('SELECT 1 FROM qr_tags WHERE tag_id = $1 FOR UPDATE', [t.tag_id]); // counts one message at a time
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM qr_messages
        WHERE tag_id = $1 AND device_hash = $2 AND created_at > now() - interval '1 hour'`,
      [t.tag_id, device],
    );
    if (n >= MESSAGES_PER_HOUR) throw new HttpError(429, 'You have sent 5 messages about this item in the last hour.  Try again later.');
    await db.query('INSERT INTO qr_messages (tag_id, body, contact, device_hash) VALUES ($1, $2, $3, $4)',
      [t.tag_id, message, contact || null, device]);
    const text = `Someone found your ${t.item_label}: "${message}"${contact ? `  Contact: ${contact}` : ''}`;
    await notify(t.owner_id, 'QR_MESSAGE', text.length > 500 ? `${text.slice(0, 497)}...` : text,
      { link: `/tags?tag=${t.tag_id}`, db });
  });
  return { sent: true };
}

module.exports = {
  TOKEN_BYTES, MESSAGES_PER_HOUR, tagUrl, list, create, setActive, remove, messages, photoPath, qrSvg, stickerSheet,
  publicTag, sendMessage, deviceHash,
};
