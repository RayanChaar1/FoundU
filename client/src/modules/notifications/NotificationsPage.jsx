import { useEffect, useState } from 'react';
import { api } from '../../api';
import { NotificationItem } from './shared';

/* FR-8.3, FR-8.4: every recent notification, with "Mark all as read". */
export default function NotificationsPage() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/notifications?limit=100').then(setData).catch(() => setData({ notifications: [], unread: 0 })); }, []);
  if (!data) return null;

  const markAll = async () => {
    const { unread } = await api.post('/notifications/read', {});
    setData({ unread, notifications: data.notifications.map((n) => ({ ...n, isRead: true })) });
  };
  const onRead = (id, unread) => setData({ unread, notifications: data.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)) });

  return (
    <>
      <div className="page-head">
        <h1>Notifications</h1>
        {data.unread > 0 && <button type="button" className="btn secondary small" onClick={markAll}>Mark all as read</button>}
      </div>
      {data.notifications.length === 0 ? (
        <div className="card empty"><h3>No notifications yet</h3><p className="hint">You will be told about matches, claims, messages and handovers here.</p></div>
      ) : (
        <ul className="n-list card" style={{ maxWidth: 760 }}>
          {data.notifications.map((n) => <NotificationItem key={n.id} n={n} onRead={onRead} />)}
        </ul>
      )}
    </>
  );
}
