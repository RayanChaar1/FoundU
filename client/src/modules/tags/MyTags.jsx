import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { formatDate } from '../../format';
import Field from '../../components/Field';
import { ConfirmButton, Notice, run } from '../admin/shared';

/* FR-12.1 to FR-12.3, FR-12.10, FR-12.11: the owner registers belongings, prints their stickers, reads the
   finders' messages, and turns tags off and on. */
export default function MyTags() {
  const [tags, setTags] = useState(null);
  const [notice, setNotice] = useState(null);
  const [params] = useSearchParams();
  const selected = Number(params.get('tag')) || null; // from a notification link

  const load = useCallback(async () => {
    try {
      setTags((await api.get('/tags')).tags);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = tags?.filter((t) => t.active) || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My tags</h1>
          <p>Stick a FoundU QR tag on your belongings.  Whoever finds one can scan it and message you, without ever seeing who you are.</p>
        </div>
        <div className="tag-head-actions">
          <a className={`btn${active.length ? '' : ' disabled'}`} href="/api/tags/sheet" target="_blank" rel="noreferrer"
            aria-disabled={!active.length} onClick={(e) => { if (!active.length) e.preventDefault(); }}>
            Print stickers{active.length ? ` (${active.length})` : ''}
          </a>
        </div>
      </div>
      <Notice notice={notice} />
      <NewTag onCreated={(t) => { setNotice({ kind: 'success', text: `${t.label} is registered.  Print its sticker and stick it on.` }); load(); }} />
      {tags && !tags.length && <div className="card panel empty">No belonging registered yet.</div>}
      <div className="tag-list">
        {tags?.map((t) => <TagCard key={t.id} tag={t} selected={t.id === selected} onChanged={load} setNotice={setNotice} />)}
      </div>
    </>
  );
}

function NewTag({ onCreated }) {
  const { reference } = useAuth();
  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const file = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = new FormData();
    body.append('label', label);
    body.append('categoryId', categoryId);
    if (photo) body.append('photo', photo);
    let created;
    const errs = await run(setNotice, async () => { created = await api.post('/tags', body); });
    setErrors(errs);
    setBusy(false);
    if (created) {
      setLabel('');
      setCategoryId('');
      setPhoto(null);
      if (file.current) file.current.value = '';
      setNotice(null);
      onCreated(created);
    }
  };

  return (
    <form className="card panel admin-section" onSubmit={submit} noValidate>
      <h2>Register a belonging</h2>
      <Notice notice={notice} />
      <div className="row3">
        <Field id="tag-label" label="Label" hint="(shown to the finder)" error={errors.label}>
          <input id="tag-label" maxLength={80} value={label} placeholder="Black laptop" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field id="tag-category" label="Category" hint="(optional)" error={errors.categoryId}>
          <select id="tag-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {reference?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="tag-photo" label="Photo" hint="(optional, only you see it)" error={errors.photo}>
          <input id="tag-photo" ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => setPhoto(e.target.files[0] || null)} />
        </Field>
      </div>
      <div className="actions">
        <button className="btn" disabled={busy}>{busy ? 'Registering…' : 'Register and create its tag'}</button>
      </div>
    </form>
  );
}

function TagCard({ tag, selected, onChanged, setNotice }) {
  const [messages, setMessages] = useState(null);
  const [open, setOpen] = useState(selected);
  const card = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.get(`/tags/${tag.id}/messages`).then((r) => setMessages(r.messages)).catch(() => setMessages([]));
  }, [open, tag.id, tag.messages]);
  useEffect(() => { if (selected) card.current?.scrollIntoView({ block: 'center' }); }, [selected]);

  const toggle = () => run(setNotice, async () => {
    await api.post(`/tags/${tag.id}/${tag.active ? 'deactivate' : 'activate'}`);
    onChanged();
  }, tag.active ? `The tag of ${tag.label} is off.  Scanning it shows no contact form.` : `The tag of ${tag.label} is on again.`);
  const remove = () => run(setNotice, async () => { await api.del(`/tags/${tag.id}`); onChanged(); }, `${tag.label} deleted.`);

  return (
    <section ref={card} className={`card tag-card${tag.active ? '' : ' inactive'}${selected ? ' selected' : ''}`}>
      <img className="tag-qr" src={`/api/tags/${tag.id}/qr.svg`} alt={`QR code of ${tag.label}`} />
      <div>
        {tag.hasPhoto && <img className="tag-photo" src={`/api/tags/${tag.id}/photo`} alt="" />}
        <h2>
          {tag.label}
          <span className={`badge ${tag.active ? 'status' : 'sensitive'}`}>{tag.active ? 'Active' : 'Inactive'}</span>
        </h2>
        <p className="meta">
          {tag.category ? `${tag.category} · ` : ''}Registered on {formatDate(tag.createdAt)}
          {' · '}{tag.messages ? `${tag.messages} message${tag.messages > 1 ? 's' : ''}` : 'No message'}
        </p>
        <div className="actions">
          {tag.active && <a className="btn secondary small" href={`/api/tags/sheet?ids=${tag.id}`} target="_blank" rel="noreferrer">Print its sticker</a>}
          <button type="button" className="btn secondary small" onClick={toggle}>{tag.active ? 'Deactivate' : 'Reactivate'}</button>
          {tag.messages > 0 && <button type="button" className="btn secondary small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide messages' : 'Read messages'}</button>}
          <ConfirmButton label="Delete" confirm="Confirm delete" onConfirm={remove} />
        </div>
        {open && messages && (
          <ul className="tag-messages">
            {messages.map((m) => (
              <li key={m.id}>
                <time dateTime={m.createdAt}>{formatDate(m.createdAt, true)}</time>
                {m.body}
                {m.contact && <div className="contact">Contact: {m.contact}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
