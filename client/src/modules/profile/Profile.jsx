import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { formatDate } from '../../format';

/* FR-10.6, FR-10.7: display name, campus, karma points and badges; never the email address. */
export default function Profile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api.get(`/users/${id}`).then((d) => setProfile(d.profile)).catch(setError);
  }, [id]);

  if (error) return <div className="card empty"><h3>{error.status === 404 ? 'Profile not available' : error.message}</h3><Link to="/">Back to the feed</Link></div>;
  if (!profile) return null;
  const initials = profile.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2);

  return (
    <div className="card panel profile-card">
      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">{initials}</span>
        <div>
          <h1>{profile.displayName}</h1>
          <p className="sub">{profile.campus ? `${profile.campus} campus · ` : ''}Member since {formatDate(profile.memberSince)}</p>
        </div>
      </div>
      <dl className="profile-stats">
        {profile.karmaPoints !== undefined && <div><dt>Karma points</dt><dd>{profile.karmaPoints}</dd></div>}
        <div><dt>Items returned</dt><dd>{profile.itemsReturned}</dd></div>
        <div><dt>Badges</dt><dd>{profile.badges.length}</dd></div>
      </dl>
      {profile.badges.length > 0 && (
        <>
          <h2 className="section-title">Badges</h2>
          <ul className="badge-list">
            {profile.badges.map((b) => (
              <li key={b.code}><span aria-hidden="true">🏅</span> <strong>{b.name}</strong> <span className="sub">since {formatDate(b.awardedAt)}</span></li>
            ))}
          </ul>
        </>
      )}
      {profile.isMe && <p className="hint" style={{ marginTop: '1rem' }}>This is how other members see you.  Your email address is never shown.</p>}
    </div>
  );
}
