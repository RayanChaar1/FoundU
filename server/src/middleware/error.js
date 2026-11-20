const { ZodError } = require('zod');
const { HttpError } = require('../lib/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    // FR-2.5: report every invalid field so the client can highlight it
    const fields = {};
    for (const issue of err.issues) fields[issue.path.join('.')] = issue.message;
    return res.status(400).json({ error: 'Some fields are missing or invalid.', fields });
  }
  if (err instanceof HttpError) {
    const { fields, ...details } = err.details || {};
    return res.status(err.status).json({
      error: err.message,
      ...(fields ? { fields } : {}),
      ...(Object.keys(details).length ? { details } : {}),
    });
  }
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The file is too large (at most 10 MB).' });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'This already exists.' }); // unique violation
  if (err.code === '23514' || err.code === '22001') return res.status(400).json({ error: 'Invalid value.' });
  // A NUL character (\u0000) in any text: PostgreSQL refuses it, so the user is told instead of a server error (found by the OWASP ZAP scan)
  if (err.code === '22021') return res.status(400).json({ error: 'Text cannot contain a null character.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.  Please try again.' }); // no internal details (NFR-11)
}

module.exports = { errorHandler };
