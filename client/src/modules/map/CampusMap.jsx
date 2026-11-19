import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import L from 'leaflet';
import { api, query } from '../../api';
import { useAuth } from '../../auth';
import LeafletMap, { esc } from './LeafletMap';

/* FR-11.1 to FR-11.6: campus map with a marker per building with open posts, type and category filters,
   and the hotspot view of the last 90 days. */
export default function CampusMap() {
  const { reference, user } = useAuth();
  const campuses = reference?.campuses || [];
  const [campusId, setCampusId] = useState(String(user.campusId || campuses[0]?.id || ''));
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [view, setView] = useState('posts'); // 'posts' | 'hotspots'
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!campusId) return;
    let live = true;
    setError(null);
    const url = view === 'posts' ? `/campuses/${campusId}/map${query({ type, categoryId })}` : `/campuses/${campusId}/hotspots`;
    api.get(url).then((d) => live && setData({ view, ...d })).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [campusId, type, categoryId, view]);

  useEffect(() => setSelected(null), [campusId, type, categoryId, view]);

  const draw = useCallback((layer) => {
    if (!data) return;
    if (data.view === 'posts') {
      for (const b of data.buildings || []) {
        const icon = L.divIcon({ className: 'map-pin', html: `<span>${b.count}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
        L.marker([b.latitude, b.longitude], { icon, title: `${b.name}: ${b.count} open posts`, keyboard: true })
          .bindTooltip(esc(b.name))
          .on('click', () => setSelected(b.id))
          .addTo(layer);
      }
    } else {
      const max = Math.max(1, ...(data.hotspots || []).map((h) => h.count));
      for (const h of data.hotspots || []) {
        const ratio = h.count / max;
        L.circle([h.latitude, h.longitude], {
          radius: 12 + 28 * ratio, color: '#c62828', weight: 1, fillColor: '#c62828', fillOpacity: 0.15 + 0.55 * ratio,
        }).bindTooltip(`${esc(h.name)}: ${h.count} lost`).addTo(layer);
      }
    }
  }, [data]);

  const campus = campuses.find((c) => String(c.id) === campusId);
  if (!campus) return <div className="card empty"><h3>No campus is defined for your organization yet</h3></div>;
  const building = data?.buildings?.find((b) => b.id === selected);
  const empty = data && (data.view === 'posts' ? !data.buildings?.length : !data.hotspots?.length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campus map</h1>
          <p>{view === 'posts' ? 'Buildings with open posts.  Click a marker to see its posts.' : `Where items were lost most often during the last ${data?.days || 90} days.`}</p>
        </div>
        <div className="segmented" role="group" aria-label="Campus">
          {campuses.map((c) => (
            <button key={c.id} type="button" aria-pressed={String(c.id) === campusId} onClick={() => setCampusId(String(c.id))}>{c.name}</button>
          ))}
        </div>
      </div>

      <div className="card map-toolbar">
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'posts'} onClick={() => setView('posts')}>Open posts</button>
          <button type="button" aria-pressed={view === 'hotspots'} onClick={() => setView('hotspots')}>Hotspots</button>
        </div>
        {view === 'posts' && (
          <>
            <div className="segmented" role="group" aria-label="Type">
              {[['', 'All'], ['LOST', 'Lost'], ['FOUND', 'Found']].map(([v, l]) => (
                <button key={l} type="button" aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
              ))}
            </div>
            <label className="sr-only" htmlFor="map-cat">Category</label>
            <select id="map-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Any category</option>
              {reference.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="map-layout">
        <div className="card map-frame">
          <LeafletMap center={[campus.latitude, campus.longitude]} draw={draw} label={`Map of the ${campus.name} campus`} />
          {empty && <div className="map-empty">{view === 'posts' ? 'No posts' : 'No items lost in the last 90 days'}</div>}
        </div>
        <aside className="card map-side" aria-live="polite">
          {view === 'hotspots' ? (
            <>
              <h3>Most frequent places</h3>
              {data?.hotspots?.length ? (
                <ol className="map-list">
                  {data.hotspots.map((h) => <li key={h.id}><span>{h.name}</span><strong>{h.count}</strong></li>)}
                </ol>
              ) : <p className="hint">Nothing to show.</p>}
            </>
          ) : building ? (
            <>
              <h3>{building.name}</h3>
              <p className="hint">{building.lost} lost, {building.found} found</p>
              <ul className="map-posts">
                {building.posts.map((p) => (
                  <li key={p.id}>
                    <span className={`badge ${p.type.toLowerCase()}`}>{p.type === 'LOST' ? 'Lost' : 'Found'}</span>
                    <Link to={`/posts/${p.id}`}>{p.title}</Link>
                    <span className="hint">{p.category}</span>
                  </li>
                ))}
              </ul>
              {building.count > building.posts.length && (
                <Link to={`/?locationId=${building.id}&campusId=${campusId}`}>See all {building.count} posts</Link>
              )}
            </>
          ) : (
            <>
              <h3>Buildings</h3>
              {data?.buildings?.length ? (
                <ol className="map-list">
                  {data.buildings.map((b) => (
                    <li key={b.id}><button type="button" className="map-link" onClick={() => setSelected(b.id)}>{b.name}</button><strong>{b.count}</strong></li>
                  ))}
                </ol>
              ) : <p className="hint">No open posts match these filters.</p>}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
