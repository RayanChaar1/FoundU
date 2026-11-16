import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, photoUrl } from '../api';
import { formatDate } from '../format';

/* FR-5.5 to FR-5.7: the owner's possible matches, best first, each with a "Not mine" button. */
export default function MatchPanel({ post }) {
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/posts/${post.id}/matches`).then((d) => setMatches(d.matches)).catch(() => setMatches([]));
  }, [post.id]);

  if (!matches) return null;

  const dismiss = async (m) => {
    try {
      await api.post(`/matches/${m.id}/dismiss`);
      setMatches(matches.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="subpanel">
      <h2 className="section-title" style={{ marginTop: 0 }}>Possible matches</h2>
      {error && <div className="alert error">{error}</div>}
      {matches.length === 0 ? (
        <p className="hint">
          No {post.type === 'LOST' ? 'found' : 'lost'} item looks like this one yet.  Smart Match checks every new post
          {post.type === 'LOST' ? ' and notifies you of strong matches.' : '.'}
        </p>
      ) : (
        <ul className="match-list">
          {matches.map((m) => (
            <li key={m.id}>
              <Link to={`/posts/${m.postId}`} className="match-thumb" aria-hidden="true" tabIndex={-1}>
                {m.photoId ? <img src={photoUrl(m.photoId)} alt="" /> : <span>📦</span>}
              </Link>
              <div className="match-body">
                <Link to={`/posts/${m.postId}`} className="who">{m.title}</Link>
                <div className="sub">{m.building} · {formatDate(m.eventDatetime)}</div>
              </div>
              <span className={`score ${m.isMatch ? 'strong' : ''}`} title={m.isMatch ? 'Strong match' : 'Possible match'}>{m.score}%</span>
              <button type="button" className="btn secondary small" onClick={() => dismiss(m)} aria-label={`Not mine: ${m.title}`}>Not mine</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
