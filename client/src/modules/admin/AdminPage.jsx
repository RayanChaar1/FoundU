import { useSearchParams } from 'react-router';
import Users from './Users';
import Places from './Places';
import Dropoffs from './Dropoffs';
import Settings from './Settings';
import Report from './Report';
import Organization from '../organizations/Organization';

const TABS = [
  ['users', 'Users', Users],
  ['places', 'Places and categories', Places],
  ['dropoffs', 'Drop-off points', Dropoffs],
  ['settings', 'Parameters', Settings],
  ['report', 'Report', Report],
  ['organization', 'Organization', Organization], // FR-18.5 to FR-18.8
];

/* The administration page: one tab per part of FR-16; the tab is kept in the address so it can be bookmarked. */
export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const current = TABS.find(([key]) => key === params.get('tab')) || TABS[0];
  const Tab = current[2];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Users, places, drop-off points and parameters of your organization.  Every change is written to the audit log.</p>
        </div>
      </div>
      <div className="segmented admin-tabs" role="group" aria-label="Administration sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={key === current[0]} onClick={() => setParams({ tab: key })}>{label}</button>
        ))}
      </div>
      <Tab />
    </>
  );
}
