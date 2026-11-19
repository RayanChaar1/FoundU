import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../../api';
import { formatDate } from '../../format';
import Field from '../../components/Field';
import { Notice, run } from '../admin/shared';

const FILTERS = [['PENDING', 'Pending'], ['ACTIVE', 'Active'], ['REJECTED', 'Rejected'], ['', 'All']];
const STATUS = { PENDING: 'Pending', ACTIVE: 'Active', REJECTED: 'Rejected' };
const TYPE = { UNIVERSITY: 'University', COMPANY: 'Company' };

/* FR-18.2: platform administrators review access requests.  An organization is activated only once every one of
   its domains carries its TXT record. */
export default function Platform() {
  const [status, setStatus] = useState('PENDING');
  const [orgs, setOrgs] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setOrgs((await api.get(`/platform/organizations${query({ status })}`)).organizations);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Organizations</h1>
          <p>Access requests and the organizations on FoundU.  Activate a request only after its domains are verified.</p>
        </div>
      </div>
      <div className="segmented admin-tabs" role="group" aria-label="Status">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={key === status} onClick={() => setStatus(key)}>{label}</button>
        ))}
      </div>
      <Notice notice={notice} />
      {orgs && !orgs.length && <div className="card panel empty">No {status ? STATUS[status].toLowerCase() : ''} organization.</div>}
      {orgs?.map((o) => <Request key={o.id} org={o} onChanged={(text) => { setNotice({ kind: 'success', text }); load(); }} />)}
    </>
  );
}

function Request({ org, onChanged }) {
  const [checks, setChecks] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const check = () => run(setNotice, async () => {
    setChecks((await api.get(`/platform/organizations/${org.id}/dns`)).checks);
  });
  const activate = () => run(setNotice, async () => {
    await api.post(`/platform/organizations/${org.id}/activate`);
    onChanged(`${org.name} is active.  ${org.contactEmail} is its administrator.`);
  });
  const reject = async (e) => {
    e.preventDefault();
    setErrors(await run(setNotice, async () => {
      await api.post(`/platform/organizations/${org.id}/reject`, { reason });
      onChanged(`The request of ${org.name} was rejected.`);
    }));
  };

  return (
    <section className="card request-card">
      <div className="section-head">
        <h2>{org.name}</h2>
        <span className={`badge ${org.status === 'REJECTED' ? 'sensitive' : 'status'}`}>{STATUS[org.status]}</span>
      </div>
      <Notice notice={notice} />
      <dl>
        <dt>Type</dt><dd>{TYPE[org.type]}</dd>
        <dt>Email domains</dt><dd>{org.domains.join(', ')}</dd>
        <dt>Campuses</dt><dd>{org.campuses.join(', ') || '—'}</dd>
        <dt>Contact</dt><dd>{org.contactName}, {org.contactEmail}</dd>
        <dt>Requested on</dt><dd>{formatDate(org.requestedAt)}</dd>
        {org.reviewedAt && <><dt>Reviewed on</dt><dd>{formatDate(org.reviewedAt)}</dd></>}
        {org.rejectionReason && <><dt>Reason</dt><dd>{org.rejectionReason}</dd></>}
      </dl>
      {org.status === 'PENDING' && (
        <>
          <p className="hint">Each domain needs this TXT record:</p>
          <code className="dns-record">{org.dnsRecord}</code>
          {checks && (
            <ul className="checks">
              {checks.map((c) => <li key={c.domain}>{c.verified ? '✓' : '✗'} {c.domain}: {c.verified ? 'record found' : 'no record yet'}</li>)}
            </ul>
          )}
          {!rejecting ? (
            <div className="actions">
              <button type="button" className="btn secondary" onClick={check}>Check the domains</button>
              <button type="button" className="btn" onClick={activate}>Verify and activate</button>
              <button type="button" className="btn danger" onClick={() => setRejecting(true)}>Reject</button>
            </div>
          ) : (
            <form className="inline-form" onSubmit={reject} noValidate>
              <Field id={`reason-${org.id}`} label="Reason, sent to the contact" error={errors.reason}>
                <input id={`reason-${org.id}`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
              <button className="btn danger">Reject the request</button>
              <button type="button" className="btn secondary" onClick={() => setRejecting(false)}>Cancel</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
