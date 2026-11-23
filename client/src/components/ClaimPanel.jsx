import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { claimLabel, timeAgo } from '../format';
import Field from './Field';

/* Claims on the post page: "This is mine" (FR-6.1, FR-6.2), the finder's list of claims (FR-6.5),
   and "I may have found this" on lost posts (FR-6.13). */
export default function ClaimPanel({ post }) {
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ answer: '', description: '', message: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (post.type === 'FOUND') api.get(`/posts/${post.id}/claims`).then((d) => setClaims(d.claims)).catch(() => {});
    if (post.type === 'LOST' && post.isOwner) api.get(`/posts/${post.id}/contacts`).then((d) => setContacts(d.contacts)).catch(() => {});
  }, [post.id, post.type, post.isOwner]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (post.type === 'FOUND') {
        const { claim } = await api.post(`/posts/${post.id}/claims`, { answer: form.answer, description: form.description });
        navigate(`/claims/${claim.id}`);
      } else {
        await api.post(`/posts/${post.id}/contact`, { message: form.message });
        setNotice({ kind: 'success', text: 'Your message was sent to the owner.' });
        setOpen(false);
        setForm({ ...form, message: '' });
      }
    } catch (err) {
      if (Object.keys(err.fields).length) setErrors(err.fields);
      else setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  // The finder (or a security officer for held items) sees every claim on the post
  if (post.type === 'FOUND' && claims.some((c) => c.isReviewer)) {
    return (
      <div className="subpanel">
        <h2 className="section-title" style={{ marginTop: 0 }}>Claims ({claims.length})</h2>
        {claims.length === 0 ? <p className="hint">No claims yet.  You will be notified when someone claims this item.</p> : <ClaimList claims={claims} />}
      </div>
    );
  }
  // FR-6.3: the poster cannot claim their own post; say why and what to do instead (TC-NFR-6.2-D)
  if (post.type === 'FOUND' && post.isOwner) {
    return (
      <div className="subpanel">
        <div className="alert info" role="status">
          You posted this item, so you cannot claim it.  When someone claims it, you are notified and review the claim
          here.  If it has already gone back to its owner, choose <strong>Close post</strong>.
        </div>
        <p className="hint">No claims yet.</p>
      </div>
    );
  }

  if (post.type === 'LOST' && post.isOwner) {
    return (
      <div className="subpanel">
        <h2 className="section-title" style={{ marginTop: 0 }}>"I may have found this" messages</h2>
        <p className="hint">You posted this item.  Anyone who may have found it writes to you here, and you are notified.</p>
        {contacts.length === 0 ? <p className="hint">No messages yet.</p> : (
          <ul className="claim-list">
            {contacts.map((c) => (
              <li key={c.id} className="card panel" style={{ padding: '0.75rem 1rem' }}>
                <div className="who">{c.senderName || 'Former user'} <span className="sub">· {timeAgo(c.createdAt)}</span></div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const mine = claims.find((c) => c.isClaimant && ['PENDING', 'APPROVED', 'COMPLETED'].includes(c.status));
  return (
    <div className="subpanel">
      {notice && <div className={`alert ${notice.kind}`}>{notice.text}</div>}
      {mine ? (
        <div className="alert info">
          Your claim is <strong>{claimLabel(mine).toLowerCase()}</strong>.{' '}
          <Link to={`/claims/${mine.id}`}>Open your claim</Link>
        </div>
      ) : post.status === 'OPEN' && !open ? (
        <button type="button" className="btn green" onClick={() => setOpen(true)}>
          {post.type === 'FOUND' ? 'This is mine' : 'I may have found this'}
        </button>
      ) : null}

      {open && !mine && (
        <form onSubmit={submit} noValidate>
          {post.type === 'FOUND' ? (
            <>
              <Field id="answer" label={post.verificationQuestion} error={errors.answer}>
                <input id="answer" value={form.answer} onChange={set('answer')} maxLength={500} autoFocus aria-invalid={!!errors.answer} />
              </Field>
              <Field id="claim-description" label="Describe the item" hint="(optional)" error={errors.description}>
                <textarea id="claim-description" value={form.description} onChange={set('description')} maxLength={1000}
                  placeholder="Marks, contents, or anything only the owner would know" />
              </Field>
            </>
          ) : (
            <Field id="message" label="Message to the owner" error={errors.message}>
              <textarea id="message" value={form.message} onChange={set('message')} maxLength={1000} autoFocus
                placeholder="Where you found it and how to get it back" aria-invalid={!!errors.message} />
            </Field>
          )}
          <div className="actions">
            <button type="submit" className="btn" disabled={busy}>{post.type === 'FOUND' ? 'Submit claim' : 'Send message'}</button>
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ClaimList({ claims, showPost = false }) {
  return (
    <ul className="claim-list">
      {claims.map((c) => (
        <li key={c.id}>
          <Link to={`/claims/${c.id}`}>
            <span>
              <span className="who">{showPost ? c.postTitle : c.claimantName || 'Former user'}</span>
              <span className="sub"> · {showPost && !c.isClaimant ? `by ${c.claimantName || 'Former user'} · ` : ''}{timeAgo(c.createdAt)}</span>
            </span>
            <span className="badge status">{claimLabel(c)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
