import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';

/* NFR-22.1, NFR-23.1: what FoundU keeps and why, the user's rights, and the rules of use.  Readable before signing in. */
export default function Privacy() {
  const { user } = useAuth();
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/privacy').then(setNotice).catch(setError); }, []);

  const body = (
    <>
      <h1>Privacy and rules of use</h1>
      <p className="hint">FoundU keeps only what it needs to return lost items, in line with Lebanese Law No. 81 of 2018 on
        personal data.  It never shows your email address or phone number to other users.</p>
      {error && <div className="alert error">{error.message}</div>}
      {notice && (
        <>
          <h2 className="section-title">What we keep and why</h2>
          <div className="privacy-table">
            <table>
              <thead><tr><th>Data</th><th>Why we keep it</th><th>How long</th></tr></thead>
              <tbody>
                {notice.items.filter((i) => i.personal).map((i) => (
                  <tr key={i.data}><th scope="row">{i.data}</th><td>{i.purpose}</td><td>{i.kept}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="section-title">Your rights</h2>
          <ul>{notice.rights.map((r) => <li key={r}>{r}</li>)}</ul>
          <h2 className="section-title">Rules of use</h2>
          <ul>{notice.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      <p>{user ? <Link to="/my-data">Go to My data</Link> : <Link to="/signin">Back to sign in</Link>}</p>
    </>
  );

  if (user) return <div className="card privacy-page">{body}</div>;
  return (
    <div className="join-page">
      <div className="card privacy-page">
        <div className="brand"><img src="/icon.png" alt="" width={28} height={28} /> FoundU</div>
        {body}
      </div>
    </div>
  );
}
