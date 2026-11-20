// Copied from a forum answer; author and licence unknown.  (Seeded breach for TC-NFR-24.1-D: do not merge.)
function slug(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
module.exports = { slug };
