import { useEffect, useState } from 'react';
import { api } from '../api';
import { ClaimList } from '../components/ClaimPanel';

/* Claims the user submitted and claims waiting for the user's review. */
export default function Claims() {
  const [claims, setClaims] = useState(null);
  useEffect(() => { api.get('/claims').then((d) => setClaims(d.claims)).catch(() => setClaims([])); }, []);
  if (!claims) return null;

  const toReview = claims.filter((c) => c.isReviewer && !c.isClaimant);
  const mine = claims.filter((c) => c.isClaimant);
  const pending = toReview.filter((c) => c.status === 'PENDING').length;

  return (
    <>
      <div className="page-head">
        <h1>Claims</h1>
        <p>{pending ? `${pending} claim${pending > 1 ? 's' : ''} waiting for your review.` : 'Claims you made and claims on items you found.'}</p>
      </div>
      <h2 className="section-title">To review</h2>
      {toReview.length ? <ClaimList claims={toReview} showPost /> : <p className="hint">Nobody has claimed an item you found yet.</p>}
      <h2 className="section-title">My claims</h2>
      {mine.length ? <ClaimList claims={mine} showPost /> : <p className="hint">Press "This is mine" on a found post to claim it.</p>}
    </>
  );
}
