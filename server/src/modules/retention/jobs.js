const { anonymizeExpired, purgeAuditLog, purgeShortLived } = require('./service');

const DAY = 24 * 60 * 60 * 1000;

module.exports = [
  // FR-17.5: daily; a closed post is anonymized at most one day after its retention period ends
  { name: 'anonymize-expired', everyMs: DAY, run: () => anonymizeExpired() },
  // NFR-12.3: daily; an audit entry is deleted at most one day after it turns one year old
  { name: 'purge-audit-log', everyMs: DAY, run: () => purgeAuditLog() },
  // Table 58: daily; notifications older than six months and sign-in codes expired for a day are deleted
  { name: 'purge-short-lived', everyMs: DAY, run: () => purgeShortLived() },
];
