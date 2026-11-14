import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import PostForm from '../components/PostForm';

/* FR-10.2: the author edits the fields of an open post, except its type. */
export default function EditPost() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.get(`/posts/${id}`).then((d) => setPost(d.post)).catch(setError); }, [id]);
  if (!post) return error ? <div className="alert error">{error.message}</div> : null;
  if (!post.isOwner || post.status !== 'OPEN') return <div className="alert warn">Only the author can edit an open post. <Link to={`/posts/${id}`}>Back</Link></div>;

  const local = new Date(post.eventDatetime);
  const pad = (n) => String(n).padStart(2, '0');
  const initial = {
    title: post.title,
    categoryId: String(post.categoryId),
    campusId: String(post.campusId),
    locationId: String(post.locationId),
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    description: post.description,
    whereabouts: post.whereabouts || 'FINDER',
    dropoffId: post.dropoff ? String(post.dropoff.id) : '',
    verificationQuestion: post.verificationQuestion || '',
    verificationAnswer: '',
  };

  const submit = async (v) => {
    setBusy(true);
    setError(null);
    const body = {
      title: v.title, description: v.description, categoryId: Number(v.categoryId) || undefined,
      locationId: Number(v.locationId) || undefined, date: v.date, time: v.time,
    };
    if (post.type === 'FOUND') {
      body.whereabouts = v.whereabouts;
      body.dropoffId = v.whereabouts === 'DROPOFF' ? Number(v.dropoffId) || undefined : null;
      body.verificationQuestion = v.verificationQuestion;
      if (v.verificationAnswer) body.verificationAnswer = v.verificationAnswer;
    }
    try {
      await api.patch(`/posts/${id}`, body);
      navigate(`/posts/${id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card panel form-card">
      <p><Link to={`/posts/${id}`}>← Back to the post</Link></p>
      <h1>Edit {post.type === 'LOST' ? 'lost' : 'found'} post</h1>
      <PostForm type={post.type} initial={initial} onSubmit={submit} busy={busy} error={error} submitLabel="Save changes" />
    </div>
  );
}
