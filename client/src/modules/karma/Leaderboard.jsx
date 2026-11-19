import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { formatDate } from '../../format';

const REASON = {
  RETURN: 'Item returned to its owner',
  DROPOFF: 'Item handed to a drop-off point',
  HELPFUL_REPORT: 'Helpful report',
  FRAUD: 'Content removed for fraud',
};
const ICON = { FIRST_FIND: '🔎', HELPING_HAND: '🤝', CAMPUS_HERO: '🦸', CAMPUS_GUARDIAN: '🛡️' };

/* FR-13: the user's karma points and badges, and the leaderboard of the semester (FR-13.4, FR-13.5). */
export default function Leaderboard() {
  const { user, refresh } = useAuth();
  const [board, setBoard] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api.get('/leaderboard'), api.get('/me/karma')])
    .then(([b, m]) => { setBoard(b); setMe(m); })
    .catch(setError);
  useEffect(() => { load(); }, []);

  if (error) {
    return <div className="card empty"><h3>{error.status === 404 ? 'Karma points are disabled for your organization' : error.message}</h3></div>;
  }
  if (!board || !me) return null;

  const toggleHidden = async (hidden) => {
    setBusy(true);
    try {
      await api.patch(`/users/${user.id}/settings`, { hideFromLeaderboard: hidden });
      await Promise.all([load(), refresh()]);
    } finally {
      setBusy(false);
    }
  };
  const earned = new Set(me.badges.map((b) => b.code));
  const next = me.allBadges.find((b) => b.threshold && b.threshold > me.points);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Karma</h1>
          <p>Points for returning items, handing them in and helpful reports.  They cannot be transferred or exchanged.</p>
        </div>
      </div>

      <div className="karma-layout">
        <section className="card panel">
          <div className="karma-total">
            <strong>{me.points}</strong>
            <span>karma points{next ? ` · ${next.threshold - me.points} more for ${next.name}` : ''}</span>
          </div>
          <ul className="karma-badges">
            {me.allBadges.map((b) => (
              <li key={b.code} className={earned.has(b.code) ? 'earned' : ''} title={earned.has(b.code) ? 'Earned' : 'Not earned yet'}>
                <span aria-hidden="true">{ICON[b.code] || '🏅'}</span>
                <strong>{b.name}</strong>
                <span className="hint">{b.threshold ? `${b.threshold} points` : 'First return'}</span>
              </li>
            ))}
          </ul>
          <h3>Latest points</h3>
          {me.history.length ? (
            <ul className="karma-history">
              {me.history.map((h, i) => (
                <li key={i}>
                  <span>{REASON[h.reason]}{h.postId && h.postTitle && <> · <Link to={`/posts/${h.postId}`}>{h.postTitle}</Link></>}
                    <span className="hint"> · {formatDate(h.createdAt)}</span></span>
                  <strong className={h.points < 0 ? 'minus' : 'plus'}>{h.points > 0 ? `+${h.points}` : h.points}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="hint">Return an item to its owner to earn your first points and the First Find badge.</p>}
        </section>

        <section className="card panel">
          <h2>Top ten this semester</h2>
          <p className="hint">Since {formatDate(board.since)}</p>
          {board.leaders.length ? (
            <ol className="karma-board">
              {board.leaders.map((l) => (
                <li key={l.id} className={l.id === user.id ? 'me' : ''}>
                  <span className="rank">{l.rank}</span>
                  <span>{l.name}</span>
                  <strong>{l.points}</strong>
                </li>
              ))}
            </ol>
          ) : <p className="hint">Nobody has earned points this semester yet.</p>}
          <label className="karma-hide">
            <input type="checkbox" checked={me.hidden} disabled={busy} onChange={(e) => toggleHidden(e.target.checked)} />
            <span>Hide me from the leaderboard (I keep my points)</span>
          </label>
        </section>
      </div>
    </>
  );
}
