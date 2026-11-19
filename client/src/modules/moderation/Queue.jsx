import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { timeAgo, formatDate } from '../../format';
import { ACTIONS, actionLabel, reasonLabel } from './shared';

/* FR-15.4 to FR-15.6: the moderators' queue of reports and the four actions. */
export default function Queue() {
  const { user } = useAuth();
  const [status, setStatus] = useState('OPEN');
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => api.get(`/moderation/reports?status=${status}`).then((d) => setReports(d.reports)).catch((e) => setError(e.message));
  useEffect(() => { setReports(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Moderation</h1>
          <p>Reports of posts and messages.  A decision applies to every open report on the same content.</p>
        </div>
        <div className="actions">
          <div className="segmented" role="group" aria-label="Reports">
            <button type="button" aria-pressed={status === 'OPEN'} onClick={() => setStatus('OPEN')}>Open</button>
            <button type="button" aria-pressed={status === 'CLOSED'} onClick={() => setStatus('CLOSED')}>Handled</button>
          </div>
          {['ORG_ADMIN', 'PLATFORM_ADMIN'].includes(user.role) && <Link to="/moderation/audit" className="btn secondary">Audit log</Link>}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {reports && !reports.length && <div className="card empty"><h3>{status === 'OPEN' ? 'No open report' : 'No handled report yet'}</h3></div>}
      <div className="mod-list">
        {reports?.map((r) => (
          <ReportCard key={r.id} report={r} onDone={(text) => { setNotice(text); load(); }} />
        ))}
      </div>
    </>
  );
}

function ReportCard({ report: r, onDone }) {
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [fraud, setFraud] = useState(r.reason === 'FRAUD');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isPost = r.targetType === 'POST';
  const choices = ACTIONS.filter(([a]) => isPost || a !== 'HIDE'); // messages are removed, not hidden

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/moderation/reports/${r.id}`, { action, reason, ...(action === 'REMOVE' ? { fraud } : {}) });
      onDone(`${actionLabel(action)}: done.  ${res.closed} report${res.closed === 1 ? '' : 's'} closed.`);
    } catch (err) {
      setError(Object.values(err.fields)[0] || err.message);
      setBusy(false);
    }
  };

  return (
    <article className="card mod-card">
      <div className="mod-head">
        <span className="badge sensitive">{reasonLabel(r.reason)}</span>
        <span className="badge status">{isPost ? 'Post' : 'Message'}</span>
        {isPost && r.postHidden && <span className="badge status">Hidden</span>}
        {r.openOnTarget > 1 && r.status === 'OPEN' && <span className="badge award">{r.openOnTarget} reports</span>}
        <span className="hint">by {r.reporter} · {timeAgo(r.createdAt)}</span>
      </div>
      {isPost
        ? <h3><Link to={`/posts/${r.postId}`}>{r.postTitle}</Link> <span className="hint">by {r.author}</span></h3>
        : <blockquote className="mod-quote">“{r.messageBody}” <span className="hint">by {r.author}</span></blockquote>}
      {r.details && <p className="mod-details">{r.details}</p>}

      {r.status !== 'OPEN' ? (
        <p className="hint" style={{ margin: 0 }}>{actionLabel(r.action)} by {r.handledBy} on {formatDate(r.handledAt, true)}</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="segmented mod-actions" role="group" aria-label="Action">
            {choices.map(([a, l]) => <button key={a} type="button" aria-pressed={action === a} onClick={() => setAction(a)}>{l}</button>)}
          </div>
          {action && (
            <div className="mod-form">
              <label className="sr-only" htmlFor={`reason-${r.id}`}>Reason</label>
              <input id={`reason-${r.id}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={action === 'DISMISS' ? 'Reason (optional)' : 'Reason, sent to the author'} aria-invalid={!!error} />
              {action === 'REMOVE' && (
                <label className="mod-fraud"><input type="checkbox" checked={fraud} onChange={(e) => setFraud(e.target.checked)} /> Fraud (−20 karma)</label>
              )}
              <button type="submit" className={`btn small${action === 'DISMISS' ? ' secondary' : ''}`} disabled={busy}>Confirm</button>
            </div>
          )}
          {error && <div className="field-error" role="alert">{error}</div>}
        </form>
      )}
    </article>
  );
}
