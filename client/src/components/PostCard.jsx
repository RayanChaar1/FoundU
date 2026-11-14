import { Link } from 'react-router';
import { photoUrl } from '../api';
import { formatDate } from '../format';

/** Feed entry with the fields of FR-4.2: type, title, category, building, date, first photo. */
export default function PostCard({ post }) {
  return (
    <Link to={`/posts/${post.id}`} className="card post-card">
      <div className="thumb">
        {post.photoId ? <img src={photoUrl(post.photoId)} alt="" loading="lazy" /> : <span className="placeholder" aria-hidden="true">📦</span>}
      </div>
      <div className="body">
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span className={`badge ${post.type === 'LOST' ? 'lost' : 'found'}`}>{post.type === 'LOST' ? 'Lost' : 'Found'}</span>
          {post.sensitive && <span className="badge sensitive">Sensitive</span>}
        </div>
        <span className="title">{post.title}</span>
        <span className="meta">{post.category} · {post.building}</span>
        <span className="meta">{formatDate(post.eventDatetime)}</span>
      </div>
    </Link>
  );
}
