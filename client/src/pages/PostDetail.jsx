import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, photoUrl } from '../api';
import { formatDate, STATUS_LABEL, timeAgo } from '../format';
import ClaimPanel from '../components/ClaimPanel';

/* FR-4.7, FR-4.8, FR-3.8: detail page with the public information of a post. */
export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);
  const [photo, setPhoto] = useState(0);
  const [notice, setNotice] = useState(null);

  const load = () => api.get(`/posts/${id}`).then((d) => setPost(d.post)).catch((e) => setError(e));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="card empty"><h3>{error.status === 404 ? 'This post does not exist' : error.message}</h3><Link to="/">Back to the feed</Link></div>;
  if (!post) return null;

  const close = async () => {
    if (!window.confirm('Close this post?  It will leave the feed.')) return;
    try {
      await api.post(`/posts/${id}/close`);
      setNotice({ kind: 'success', text: 'The post is closed.' });
      load();
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  };
  const remove = async () => {
    if (!window.confirm('Delete this post permanently?')) return;
    try {
      await api.del(`/posts/${id}`);
      navigate('/', { replace: true });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  };

  return (
    <>
      <p><Link to="/">← Back to the feed</Link></p>
      <div className="detail">
        <div className="gallery">
          <div className="main">
            {post.photoIds.length ? <img src={photoUrl(post.photoIds[photo])} alt={`Photo ${photo + 1} of ${post.title}`} /> : <span style={{ fontSize: '4rem', opacity: 0.4 }} aria-hidden="true">📦</span>}
          </div>
          {post.photoIds.length > 1 && (
            <div className="thumbs">
              {post.photoIds.map((pid, i) => (
                <button key={pid} type="button" aria-current={i === photo} aria-label={`Show photo ${i + 1}`} onClick={() => setPhoto(i)}>
                  <img src={photoUrl(pid)} alt="" />
                </button>
              ))}
            </div>
          )}
          {post.sensitive && !post.isOwner && (
            <p className="hint" style={{ marginTop: '0.6rem' }}>Photos of identity and bank cards are blurred to protect their owner.</p>
          )}
        </div>

        <div className="card panel">
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
            <span className={`badge ${post.type === 'LOST' ? 'lost' : 'found'}`}>{post.type === 'LOST' ? 'Lost' : 'Found'}</span>
            <span className="badge status">{STATUS_LABEL[post.status]}</span>
            {post.sensitive && <span className="badge sensitive">Sensitive</span>}
            {post.hidden && <span className="badge status">Hidden for review</span>}
          </div>
          <h1>{post.title}</h1>
          {notice && <div className={`alert ${notice.kind}`}>{notice.text}</div>}
          {post.description && <p style={{ whiteSpace: 'pre-wrap' }}>{post.description}</p>}
          <dl className="facts">
            <dt>Category</dt><dd>{post.category}</dd>
            <dt>Where</dt><dd>{post.building}, {post.campus} campus</dd>
            <dt>{post.type === 'LOST' ? 'Lost on' : 'Found on'}</dt><dd>{formatDate(post.eventDatetime, true)}</dd>
            <dt>Posted</dt><dd>{timeAgo(post.createdAt)} by {post.poster.displayName}{' '}
              {post.poster.badges.map((b) => <span key={b.code} className="badge award" style={{ marginLeft: 4 }}>🏅 {b.name}</span>)}
            </dd>
          </dl>

          {post.type === 'FOUND' && (
            post.dropoff ? (
              <div className="alert info">
                <strong>Held at {post.dropoff.name}</strong><br />
                Open {post.dropoff.openingHours} · {post.dropoff.contactNumber}
              </div>
            ) : (
              <div className="alert info">The finder is keeping this item.</div>
            )
          )}

          {post.isOwner && post.type === 'FOUND' && (
            <div className="alert warn">
              <strong>Your verification question:</strong> {post.verificationQuestion}<br />
              <strong>Expected answer (only you can see it):</strong> {post.verificationAnswer}
            </div>
          )}

          {post.isOwner && (
            <div className="actions">
              {post.status === 'OPEN' && <Link to={`/posts/${post.id}/edit`} className="btn secondary">Edit</Link>}
              {['OPEN', 'RETURNED'].includes(post.status) && <button type="button" className="btn secondary" onClick={close}>Close post</button>}
              <button type="button" className="btn danger" onClick={remove}>Delete</button>
            </div>
          )}

          <ClaimPanel key={`${post.id}-${post.status}`} post={post} />
        </div>
      </div>
    </>
  );
}
