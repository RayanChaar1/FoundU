/* Privacy notice (NFR-22.1, NFR-23.1): the data FoundU keeps, why and for how long, the user's rights, and the rules
   of use.  Public, so it can be read before signing in. */
const express = require('express');
const { ITEMS, RIGHTS, RULES } = require('./inventory');

const router = express.Router();

router.get('/privacy', (req, res) => {
  res.json({
    items: ITEMS.map(({ data, personal, purpose, kept }) => ({ data, personal, purpose, kept })),
    rights: RIGHTS,
    rules: RULES,
  });
});

module.exports = router;
