import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import PostForm from '../components/PostForm';

/* FR-2.1, FR-3.1: create a lost or found post. */
export default function NewPost() {
  const navigate = useNavigate();
  const [type, setType] = useState('LOST');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (v, photos) => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    const keys = ['title', 'categoryId', 'locationId', 'date', 'time', 'description'];
    if (type === 'FOUND') keys.push('whereabouts', 'verificationQuestion', 'verificationAnswer', ...(v.whereabouts === 'DROPOFF' ? ['dropoffId'] : []));
    for (const k of keys) form.append(k, v[k] ?? '');
    for (const p of photos) form.append('photos', p);
    try {
      const post = await api.post(`/posts/${type.toLowerCase()}`, form);
      navigate(`/posts/${post.id}`);
    } catch (e) {
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card panel form-card">
      <h1>Post an item</h1>
      <div className="segmented" role="group" aria-label="Type of post" style={{ margin: '0.5rem 0 1.25rem' }}>
        <button type="button" aria-pressed={type === 'LOST'} onClick={() => { setType('LOST'); setError(null); }}>I lost something</button>
        <button type="button" aria-pressed={type === 'FOUND'} onClick={() => { setType('FOUND'); setError(null); }}>I found something</button>
      </div>
      <PostForm key={type} type={type} onSubmit={submit} busy={busy} error={error}
        submitLabel={type === 'LOST' ? 'Publish lost post' : 'Publish found post'} />
    </div>
  );
}
