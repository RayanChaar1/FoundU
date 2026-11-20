import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import Field from '../components/Field';

// FR-1.2: what the server reports when a sign-in through the identity provider does not go through
const SSO_ERRORS = {
  denied: 'The sign-in was cancelled or refused at your organization\'s sign-in page.  Try again.',
  expired: 'Your sign-in took too long or was already used.  Start again.',
  invalid: 'Your organization\'s sign-in could not be verified, so you were not signed in.  Try again.',
  unavailable: 'Single sign-on is no longer connected for your organization.  Start again to get a code by email.',
  unreachable: 'Your organization\'s sign-in page cannot be reached right now.  Try again in a few minutes.',
  'other-org': 'You signed in with an address of another organization.  Use your address of this organization.',
  suspended: 'This account is suspended.',
};

/* FR-1.2 to FR-1.7: sign in through the organization's identity provider when it is connected, otherwise with a
   one-time code sent to the organization email; then create the profile on the first sign-in. */
export default function SignIn() {
  const { refresh, notice } = useAuth();
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState(params.get('step') === 'profile' ? 'loading' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [org, setOrg] = useState('');
  const [campuses, setCampuses] = useState([]);
  const [fullName, setFullName] = useState('');
  const [campusId, setCampusId] = useState('');
  const [error, setError] = useState(() => (SSO_ERRORS[params.get('sso')] ? { message: SSO_ERRORS[params.get('sso')], fields: {} } : null));
  const [busy, setBusy] = useState(false);

  // Back from the identity provider on a first sign-in: the profile step, with the name the provider gave
  useEffect(() => {
    if (params.get('step') !== 'profile') return;
    api.get('/auth/pending')
      .then((p) => { setEmail(p.email); setFullName(p.fullName); setCampuses(p.campuses); setStep('profile'); })
      .catch((err) => { setError(err); setStep('email'); });
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn) => async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const start = run(async () => {
    const res = await api.post('/auth/start', { email });
    setParams({}, { replace: true });
    setOrg(res.organization);
    setCode('');
    setStep(res.sso ? 'sso' : 'code');
  });

  const verify = run(async () => {
    const res = await api.post('/auth/verify', { email, code });
    if (res.signedIn) return refresh();
    setCampuses(res.campuses);
    setStep('profile');
  });

  const createProfile = run(async () => {
    await api.post('/auth/profile', { fullName, campusId });
    await refresh();
  });

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand">
          <img src="/icon.png" alt="" style={{ width: 40, height: 40 }} />
          FoundU
        </div>
        <div>
          <h1>Lost something? Find your way back to it.</h1>
          <p>The lost and found of your campus: post an item, get matched automatically, prove it is yours, and get it back safely.</p>
          <ul>
            <li>✓ Only members of your organization can sign in</li>
            <li>✓ Smart Match connects lost and found items</li>
            <li>✓ A secret question stops false claims</li>
            <li>✓ Your email and phone number stay private</li>
          </ul>
        </div>
        <small style={{ color: '#bcd2ff' }}>CSC490 Software Engineering · LAU · Team AJMR²</small>
      </section>

      <section className="auth-form">
        <div className="card">
          {step === 'email' && (
            <form onSubmit={start} noValidate>
              <h2>Sign in</h2>
              <p className="hint">Use the email address of your university or company.</p>
              {notice && !error && <div className="alert info" role="status">{notice}</div>}
              {error && <div className="alert error">{error.message}</div>}
              <Field id="email" label="Organization email" error={error?.fields?.email}>
                <input id="email" type="email" autoComplete="email" autoFocus required value={email}
                  placeholder="name@lau.edu" onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <button className="btn block" disabled={busy || !email}>{busy ? 'Checking…' : 'Continue'}</button>
              <p className="hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
                Is your organization not on FoundU yet?  <Link to="/join">Request access</Link>
              </p>
              <p className="hint" style={{ textAlign: 'center' }}><Link to="/privacy">Privacy and rules of use</Link></p>
            </form>
          )}

          {step === 'sso' && (
            <div>
              <h2>Sign in with {org}</h2>
              <p className="hint">{org} signs you in on its own sign-in page, then sends you back to FoundU.</p>
              <a className="btn block" href="/api/auth/sso/start">Sign in with {org}</a>
              <p style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button type="button" className="btn secondary small" onClick={() => setStep('email')}>Use another email</button>
              </p>
            </div>
          )}

          {step === 'code' && (
            <form onSubmit={verify} noValidate>
              <h2>Check your email</h2>
              <p className="hint">We sent a 6-digit code to <strong>{email}</strong> ({org}).  It expires in 10 minutes.</p>
              {error && <div className="alert error">{error.message}</div>}
              <Field id="code" label="Code" error={error?.fields?.code}>
                <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <button className="btn block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
              <p style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button type="button" className="btn secondary small" onClick={() => setStep('email')}>Use another email</button>
              </p>
            </form>
          )}

          {step === 'profile' && (
            <form onSubmit={createProfile} noValidate>
              <h2>Welcome to FoundU</h2>
              <p className="hint">Tell us who you are to create your profile.</p>
              {error && !Object.keys(error.fields).length && <div className="alert error">{error.message}</div>}
              <Field id="fullName" label="Full name" error={error?.fields?.fullName}>
                <input id="fullName" autoComplete="name" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field id="campus" label="Campus" error={error?.fields?.campusId}>
                <select id="campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
                  <option value="">Choose your campus</option>
                  {campuses.map((c) => <option key={c.campus_id} value={c.campus_id}>{c.name}</option>)}
                </select>
              </Field>
              <button className="btn block" disabled={busy}>Create my profile</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
