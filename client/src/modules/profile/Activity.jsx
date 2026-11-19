import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, photoUrl } from '../../api';
import { useAuth } from '../../auth';
import { claimLabel, STATUS_LABEL, timeAgo } from '../../format';

/* FR-10.1: the user's posts, claims and conversations with their statuses; FR-1.11 email preference. */
export default function Activity() {
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => { api.get('/me/activity').then(setData).catch(() => setData({ posts: [], claims: [], conversations: [] })); }, []);
  if (!data) return null;

  const toggle = async (key, value) => {
    await api.patch('/me/preferences', { [key]: value });
    await refresh();
    setSaved('Preferences saved.');
  };

  return (
    <>
      <div className="page-head">
        <h1>My activity</h1>
        <Link to={`/users/${user.id}`} className="btn secondary small">View my public profile</Link>
      </div>
      <div className="activity-grid">
        <section className="card panel">
          <h2 className="section-title" style={{ marginTop: 0 }}>My posts ({data.posts.length})</h2>
          {data.posts.length === 0 ? <p className="hint">You have not posted anything yet.  <Link to="/posts/new">Post an item</Link></p> : (
            <ul className="activity-list">
              {data.posts.map((p) => (
                <li key={p.id}>
                  <Link to={`/posts/${p.id}`}>
                    <span className="a-thumb" aria-hidden="true">{p.photoId ? <img src={photoUrl(p.photoId)} alt="" /> : '📦'}</span>
                    <span className="a-body">
                      <span className="a-title">{p.title}</span>
                      <span className="sub">{p.type === 'LOST' ? 'Lost' : 'Found'} · {p.building} · {timeAgo(p.createdAt)}</span>
                    </span>
                    {p.pendingClaims > 0 && <span className="badge found">{p.pendingClaims} to review</span>}
                    <span className="badge status">{STATUS_LABEL[p.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="activity-side">
          <section className="card panel">
            <h2 className="section-title" style={{ marginTop: 0 }}>My claims ({data.claims.length})</h2>
            {data.claims.length === 0 ? <p className="hint">No claims yet.</p> : (
              <ul className="activity-list compact">
                {data.claims.map((c) => (
                  <li key={c.id}>
                    <Link to={`/claims/${c.id}`}>
                      <span className="a-body"><span className="a-title">{c.postTitle}</span><span className="sub">{timeAgo(c.createdAt)}</span></span>
                      <span className="badge status">{claimLabel({ status: c.status, cancelReason: c.cancelled })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card panel">
            <h2 className="section-title" style={{ marginTop: 0 }}>Conversations ({data.conversations.length})</h2>
            {data.conversations.length === 0 ? <p className="hint">A conversation opens when a claim is approved.</p> : (
              <ul className="activity-list compact">
                {data.conversations.map((c) => (
                  <li key={c.id}>
                    <Link to={`/claims/${c.id}`}>
                      <span className="a-body"><span className="a-title">{c.otherName}</span><span className="sub">{c.postTitle}</span></span>
                      <span className={`badge ${c.open ? 'found' : 'status'}`}>{c.open ? 'Open' : 'Read-only'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card panel">
            <h2 className="section-title" style={{ marginTop: 0 }}>Preferences</h2>
            {saved && <div className="alert success" role="status">{saved}</div>}
            <label className="toggle">
              <input type="checkbox" checked={user.emailNotifications} onChange={(e) => toggle('emailNotifications', e.target.checked)} />
              <span>Also send my notifications by email</span>
            </label>
            {user.karmaEnabled && (
              <label className="toggle">
                <input type="checkbox" checked={user.hideFromLeaderboard} onChange={(e) => toggle('hideFromLeaderboard', e.target.checked)} />
                <span>Hide me from the karma leaderboard</span>
              </label>
            )}
            <p className="hint" style={{ margin: '0.6rem 0 0' }}>Correct, download or delete your data on <Link to="/my-data">My data</Link>.</p>
          </section>
        </div>
      </div>
    </>
  );
}
