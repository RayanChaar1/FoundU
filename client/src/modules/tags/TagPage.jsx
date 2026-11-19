import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';

const MAX = 500;

/* FR-12.4 to FR-12.7: the page a finder reaches by scanning a sticker.  It shows the item's label and a contact
   form, and nothing about the owner.  It works without an account. */
export default function TagPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [tag, setTag] = useState(undefined); // undefined while loading, null when not found
  const [form, setForm] = useState({ message: '', contact: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { api.get(`/tags/${encodeURIComponent(token)}`).then(setTag).catch(() => setTag(null)); }, [token]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api.post(`/tags/${encodeURIComponent(token)}/messages`, form);
      setSent(true);
    } catch (err) {
      setError(err.message);
      setErrors(err.fields);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (tag === undefined) body = <p className="hint">Loading…</p>;
  else if (tag === null) {
    body = (
      <>
        <h1>Tag not found</h1>
        <p>This QR code does not belong to an item on FoundU, or the sticker is damaged.  If you found an item, you can
          hand it to your campus security office.</p>
      </>
    );
  } else if (!tag.active) {
    body = (
      <>
        <p className="hint">You scanned the FoundU tag of</p>
        <h1>{tag.label}</h1>
        <div className="alert info">Its owner has turned this tag off, so it does not take messages.  If you found
          this item, you can hand it to your campus security office.</div>
      </>
    );
  } else if (sent) {
    body = (
      <>
        <h1>Thank you!</h1>
        <div className="alert success" role="status">Your message was sent to the owner of {tag.label}.</div>
        <p className="hint">They receive it in FoundU and by email.  They see only what you wrote.</p>
        <button type="button" className="btn secondary" onClick={() => { setSent(false); setForm({ message: '', contact: '' }); }}>Send another message</button>
      </>
    );
  } else {
    body = (
      <form onSubmit={send} noValidate>
        <p className="hint">You found</p>
        <h1>{tag.label}</h1>
        <p className="hint">Send a message to its owner.  They never see who you are unless you tell them.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <Field id="tag-message" label="Message" error={errors.message}>
          <textarea id="tag-message" maxLength={MAX} value={form.message} autoFocus
            placeholder="I found it in Nicol Hall, room 302.  I left it at the security office."
            onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <div className="counter">{form.message.length} / {MAX}</div>
        </Field>
        <Field id="tag-contact" label="How to reach you" hint="(optional: phone, email, or where the item is now)" error={errors.contact}>
          <input id="tag-contact" maxLength={200} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        </Field>
        <button className="btn block" disabled={busy || !form.message.trim()}>{busy ? 'Sending…' : 'Send to the owner'}</button>
      </form>
    );
  }

  return (
    <div className={`tag-public${user ? ' in-layout' : ''}`}>
      <div className="card">
        {!user && <div className="brand"><img src="/icon.png" alt="" width={28} height={28} /> FoundU</div>}
        {body}
        {!user && <p className="hint" style={{ marginTop: '1.5rem' }}>FoundU is the lost and found of your campus.  <Link to="/signin">Sign in</Link></p>}
      </div>
    </div>
  );
}
