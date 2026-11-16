export function timeAgo(date) {
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** With `withTime`, the time is left out when it is midnight, which means no time was given. */
export const formatDate = (date, withTime = false) =>
  new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime && (new Date(date).getHours() || new Date(date).getMinutes()) ? { hour: '2-digit', minute: '2-digit' } : {}),
  });

export const STATUS_LABEL = { OPEN: 'Open', CLAIMED: 'Claimed', RETURNED: 'Returned', CLOSED: 'Closed', REMOVED: 'Removed' };

export const CLAIM_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', COMPLETED: 'Returned' };
export const claimLabel = (c) => (c.status === 'WITHDRAWN' && c.cancelReason ? 'Handover cancelled' : CLAIM_LABEL[c.status]);
