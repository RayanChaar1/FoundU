import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, query } from '../../api';
import { useAuth } from '../../auth';
import { formatDate, STATUS_LABEL, CLAIM_LABEL } from '../../format';
import Field from '../../components/Field';
import { ROLE_LABEL, ORG_ROLES, Notice, run } from './shared';

const REPORT_REASON = { SPAM: 'Spam', FRAUD: 'Fraud', INAPPROPRIATE: 'Inappropriate content', PERSONAL_DATA: 'Exposed personal data', OTHER: 'Other' };
const ACCOUNT_ACTION = { ROLE_CHANGED: 'Role changed', USER_SUSPENDED: 'Suspended', USER_REINSTATED: 'Reinstated', USER_WARNED: 'Warned' };

/* FR-16.1 to FR-16.5: search the users of the organization, see a user's activity, change the role, suspend, reinstate. */
export default function Users() {
  const [text, setText] = useState('');
  const [users, setUsers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);

  const search = useCallback(async (q = '') => {
    try {
      setUsers((await api.get(`/users${query({ q })}`)).users);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }, []);
  useEffect(() => { search(); }, [search]);

  return (
    <div className="admin-split">
      <section className="card panel">
        <form className="inline-form" role="search" onSubmit={(e) => { e.preventDefault(); search(text); }}>
          <div className="field">
            <label htmlFor="user-q" className="sr-only">Name or email</label>
            <input id="user-q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or email" />
          </div>
          <button className="btn">Search</button>
        </form>
        <Notice notice={notice} />
        {users && (
          <div className="table-scroll"><table className="admin-table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={selected === u.id ? 'selected' : undefined}>
                  <td>
                    <button type="button" className="linklike" onClick={() => setSelected(u.id)}>{u.fullName}</button>
                    <div className="hint">{u.email}</div>
                  </td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td><span className={`badge ${u.status === 'SUSPENDED' ? 'sensitive' : 'status'}`}>{u.status === 'SUSPENDED' ? 'Suspended' : 'Active'}</span>
                    {u.flagged && <> <span className="badge sensitive" title="Three claims rejected within 30 days (FR-6.14)">Flagged for review</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {users && !users.length && <p className="empty">No user matches “{text}”.</p>}
      </section>
      {selected
        ? <UserDetail key={selected} id={selected} onChanged={() => search(text)} />
        : <section className="card panel empty">Choose a user to see their activity.</section>}
    </div>
  );
}

function UserDetail({ id, onChanged }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const d = await api.get(`/users/${id}/activity`);
    setData(d);
    setRole(d.user.role);
  }, [id]);
  useEffect(() => { load().catch((e) => setNotice({ kind: 'error', text: e.message })); }, [load]);
  if (!data) return <section className="card panel"><Notice notice={notice} /></section>;

  const u = data.user;
  const self = u.id === me.id;
  const act = async (fn, success) => {
    const errs = await run(setNotice, fn, success);
    setErrors(errs);
    await load();
    onChanged();
    return errs;
  };

  return (
    <section className="card panel user-detail">
      <h2>{u.fullName}</h2>
      <dl className="facts">
        <dt>Email</dt><dd>{u.email}</dd>
        <dt>Display name</dt><dd>{u.displayName}</dd>
        <dt>Campus</dt><dd>{u.campus || '—'}</dd>
        <dt>Karma</dt><dd>{u.karma} points</dd>
        <dt>Member since</dt><dd>{formatDate(u.createdAt)}</dd>
        <dt>Status</dt><dd>{u.status === 'SUSPENDED' ? 'Suspended' : 'Active'}{u.flagged && ' · Flagged for review (three claims rejected within 30 days)'}</dd>
      </dl>
      <Notice notice={notice} />

      {self ? <p className="hint">This is your account: another administrator can change your role or status.</p> : (
        <>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(() => api.patch(`/users/${id}/role`, { role }), 'Role saved.'); }}>
            <Field id="role" label="Role" error={errors.role}>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
                {ORG_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            <button className="btn secondary" disabled={role === u.role}>Save role</button>
          </form>
          {u.status === 'SUSPENDED' ? (
            <div className="actions">
              <button type="button" className="btn green" onClick={() => act(() => api.post(`/users/${id}/reinstate`), 'Account reinstated.  The user can sign in again.')}>Reinstate account</button>
            </div>
          ) : (
            <form className="inline-form subpanel" onSubmit={(e) => {
              e.preventDefault();
              act(() => api.post(`/users/${id}/suspend`, { reason }), 'Account suspended.  The user is signed out and cannot sign in.').then((errs) => { if (!errs._) setReason(''); });
            }}>
              <Field id="reason" label="Reason for a suspension" error={errors.reason}>
                <input id="reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Repeated false claims" />
              </Field>
              <button className="btn danger">Suspend account</button>
            </form>
          )}
        </>
      )}

      <Activity title="Posts" rows={data.posts} render={(p) => (
        <><Link to={`/posts/${p.id}`}>{p.title}</Link> <span className="hint">{p.type === 'LOST' ? 'Lost' : 'Found'} · {STATUS_LABEL[p.status]}</span></>
      )} />
      <Activity title="Claims" rows={data.claims} render={(c) => (
        <><Link to={`/claims/${c.id}`}>Claim on “{c.title}”</Link> <span className="hint">{CLAIM_LABEL[c.status]}</span></>
      )} />
      <Activity title="Reports made" rows={data.reportsMade} render={(r) => (
        <>{REPORT_REASON[r.reason]} {r.postId && <Link to={`/posts/${r.postId}`}>on post #{r.postId}</Link>} <span className="hint">{r.status.toLowerCase()}</span></>
      )} />
      <Activity title="Reports on their content" rows={data.reportsReceived} render={(r) => (
        <>{REPORT_REASON[r.reason]} {r.postId ? <Link to={`/posts/${r.postId}`}>on post #{r.postId}</Link> : 'on a message'} <span className="hint">{r.status.toLowerCase()}</span></>
      )} />
      <Activity title="Account history" rows={data.accountHistory} render={(a) => (
        <>{ACCOUNT_ACTION[a.action] || a.action} {a.reason && <span className="hint">{a.reason}</span>}</>
      )} />
    </section>
  );
}

function Activity({ title, rows, render }) {
  return (
    <>
      <h3 className="section-title">{title} <span className="hint">({rows.length})</span></h3>
      {rows.length ? (
        <ul className="activity">
          {rows.map((r, i) => <li key={r.id ?? i}><time>{formatDate(r.createdAt, true)}</time> <span>{render(r)}</span></li>)}
        </ul>
      ) : <p className="hint">None.</p>}
    </>
  );
}
