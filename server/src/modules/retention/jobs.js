const { anonymizeExpired } = require('./service');

// FR-17.5: daily; a closed post is anonymized at most one day after its retention period ends
module.exports = [{ name: 'anonymize-expired', everyMs: 24 * 60 * 60 * 1000, run: () => anonymizeExpired() }];
