import { useNavigate } from 'react-router';
import { api } from '../../api';
import { timeAgo } from '../../format';

export const ICONS = {
  MATCH: '🔎', CLAIM_RECEIVED: '📥', CLAIM_APPROVED: '✅', CLAIM_REJECTED: '✖️', MESSAGE: '💬', HANDOVER: '🤝',
  BADGE: '🏅', MODERATION: '🛡️', CONTACT: '📣', QR_MESSAGE: '🏷️', CODE_BLOCKED: '⛔', HANDOVER_CANCELLED: '↩️',
};

/** One notification; opening it marks it read (FR-8.4) and follows its link. */
export function NotificationItem({ n, onRead, onDone }) {
  const navigate = useNavigate();
  const open = async () => {
    if (!n.isRead) {
      const { unread } = await api.patch(`/notifications/${n.id}`, { isRead: true });
      onRead(n.id, unread);
    }
    onDone?.();
    if (n.link) navigate(n.link);
  };
  return (
    <li className={n.isRead ? 'read' : 'unread-item'}>
      <button type="button" onClick={open}>
        <span className="n-icon" aria-hidden="true">{ICONS[n.type] || '🔔'}</span>
        <span className="n-text">
          <span>{n.content}</span>
          <span className="n-time">{timeAgo(n.createdAt)}</span>
        </span>
        {!n.isRead && <span className="dot" aria-label="Unread" />}
      </button>
    </li>
  );
}
