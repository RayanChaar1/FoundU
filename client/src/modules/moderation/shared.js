/* Labels shared by the moderation pages (FR-15.2, FR-15.5). */
export const REASONS = [
  ['SPAM', 'Spam'],
  ['FRAUD', 'Fraud'],
  ['INAPPROPRIATE', 'Inappropriate content'],
  ['PERSONAL_DATA', 'Exposed personal data'],
  ['OTHER', 'Other'],
];
export const reasonLabel = (code) => Object.fromEntries(REASONS)[code] || code;

export const ACTIONS = [
  ['DISMISS', 'Dismiss'],
  ['HIDE', 'Hide'],
  ['REMOVE', 'Remove'],
  ['WARN', 'Warn the author'],
];
export const actionLabel = (code) => Object.fromEntries(ACTIONS)[code] || code;

export const AUDIT_LABEL = {
  REPORT_DISMISSED: 'Report dismissed',
  POST_HIDDEN: 'Post hidden',
  POST_AUTO_HIDDEN: 'Post hidden after three reports',
  POST_REMOVED: 'Post removed',
  MESSAGE_REMOVED: 'Message removed',
  USER_WARNED: 'Author warned',
};
