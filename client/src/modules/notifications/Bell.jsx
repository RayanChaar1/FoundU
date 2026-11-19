import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../../api';
import { NotificationItem } from './shared';

const POLL_MS = 15000;

/* FR-8.3: the number of unread notifications, hidden when there are none; the dropdown lists the latest ones. */
export default function Bell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const box = useRef(null);
  const location = useLocation();

  const refresh = useCallback(() => api.get('/notifications/unread').then((d) => setUnread(d.unread)).catch(() => {}), []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => { refresh(); setOpen(false); }, [location.pathname, refresh]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = async () => {
    if (!open) {
      const d = await api.get('/notifications?limit=8');
      setItems(d.notifications);
      setUnread(d.unread);
    }
    setOpen(!open);
  };
  const markAll = async () => {
    const { unread: left } = await api.post('/notifications/read', {});
    setUnread(left);
    setItems(items.map((n) => ({ ...n, isRead: true })));
  };
  const onRead = (id, left) => {
    setUnread(left);
    setItems(items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  };

  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-button" onClick={toggle} aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="n-link" onClick={markAll}>Mark all as read</button>}
          </div>
          {items.length === 0 ? <p className="hint" style={{ padding: '0.8rem 1rem' }}>Nothing yet.  You will be told about matches, claims and messages here.</p> : (
            <ul className="n-list">
              {items.map((n) => <NotificationItem key={n.id} n={n} onRead={onRead} onDone={() => setOpen(false)} />)}
            </ul>
          )}
          <Link to="/notifications" className="bell-all">See all notifications</Link>
        </div>
      )}
    </div>
  );
}
