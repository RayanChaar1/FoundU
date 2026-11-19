import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { timeAgo } from '../../format';

/* FR-7.1: one conversation per approved claim. */
export default function Conversations() {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get('/conversations').then((d) => setItems(d.conversations)).catch(() => setItems([])); }, []);
  if (!items) return null;
  return (
    <>
      <div className="page-head">
        <h1>Messages</h1>
        <p>A private conversation opens when a claim is approved.</p>
      </div>
      {items.length === 0 ? (
        <div className="card empty"><h3>No conversations yet</h3><p className="hint">Claim an item or approve a claim to start one.</p></div>
      ) : (
        <ul className="conversation-list">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/conversations/${c.id}`} className="card">
                <span className="avatar" aria-hidden="true">{c.otherName.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                <span className="conv-body">
                  <span className="conv-title">{c.otherName} <span className="sub">· {c.postTitle}</span></span>
                  <span className="conv-last">{c.lastMessage || 'No messages yet'}</span>
                </span>
                <span className="conv-meta">
                  {c.lastAt && <span className="sub">{timeAgo(c.lastAt)}</span>}
                  {c.unread > 0 && <span className="unread" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                  {c.readOnly && <span className="badge status">Read-only</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
