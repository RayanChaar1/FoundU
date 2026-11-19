import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { formatDate } from '../../format';
import { AUDIT_LABEL } from './shared';

/* FR-15.7: every moderation and administration action with its author, date, time and reason (read only). */
export default function AuditLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/audit').then((d) => setEntries(d.entries)).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <p><Link to="/moderation">← Moderation</Link></p>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Entries are only ever added; none can be changed or deleted.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {entries && (
        <div className="card">
          <table className="audit-table">
            <thead><tr><th>Date and time</th><th>Action</th><th>Target</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.createdAt, true)}</td>
                  <td>{AUDIT_LABEL[e.action] || e.action.replaceAll('_', ' ').toLowerCase()}</td>
                  <td>{e.targetType === 'POST' ? <Link to={`/posts/${e.targetId}`}>Post #{e.targetId}</Link> : `${e.targetType.toLowerCase()} #${e.targetId}`}</td>
                  <td>{e.actor || 'FoundU'}</td>
                  <td>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <p className="empty">No action yet.</p>}
        </div>
      )}
    </>
  );
}
