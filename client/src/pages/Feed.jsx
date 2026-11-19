import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, query } from '../api';
import { useAuth } from '../auth';
import PostCard from '../components/PostCard';

const FILTERS = ['q', 'type', 'categoryId', 'campusId', 'locationId', 'from', 'to', 'status', 'page'];

/* FR-4.1 to FR-4.6, FR-4.9: feed of open posts, keyword search, combinable filters, pages of 20. */
export default function Feed() {
  const { reference } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || '']));
  const [q, setQ] = useState(filters.q);
  const [data, setData] = useState(null);
  const [showFilters, setShowFilters] = useState(false); // phones only: the filters start folded (NFR-8.2)
  const [error, setError] = useState(null);
  const key = params.toString();

  useEffect(() => {
    let live = true;
    setError(null);
    api.get(`/posts${query(Object.fromEntries(params))}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (changes) => {
    const next = { ...filters, page: '', ...changes };
    if ('campusId' in changes) next.locationId = '';
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };
  const buildings = reference?.buildings.filter((b) => !filters.campusId || String(b.campusId) === filters.campusId) || [];
  const anyFilter = FILTERS.some((k) => k !== 'page' && filters[k]);
  const activeCount = FILTERS.filter((k) => !['page', 'q'].includes(k) && filters[k]).length;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lost and found</h1>
          <p>{data ? `${data.total} ${filters.status ? filters.status.toLowerCase() : 'open'} post${data.total === 1 ? '' : 's'}` : 'Loading…'}</p>
        </div>
        <Link to="/posts/new" className="btn">+ Post an item</Link>
      </div>

      <div className="feed-layout">
        <aside className={`card filters${showFilters ? ' open' : ''}`} aria-label="Filters">
          <button type="button" className="btn secondary block filters-toggle" aria-expanded={showFilters}
            onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? 'Hide filters' : `Filters${activeCount ? ` (${activeCount})` : ''}`}
          </button>
          <div className="field">
            <span className="sr-only" id="type-label">Type</span>
            <div className="segmented" role="group" aria-labelledby="type-label" style={{ width: '100%' }}>
              {[['', 'All'], ['LOST', 'Lost'], ['FOUND', 'Found']].map(([v, l]) => (
                <button key={l} type="button" style={{ flex: 1 }} aria-pressed={filters.type === v} onClick={() => set({ type: v })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select id="f-cat" value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">Any category</option>
              {reference?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-campus">Campus</label>
            <select id="f-campus" value={filters.campusId} onChange={(e) => set({ campusId: e.target.value })}>
              <option value="">Any campus</option>
              {reference?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-bld">Building</label>
            <select id="f-bld" value={filters.locationId} onChange={(e) => set({ locationId: e.target.value })}>
              <option value="">Any building</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Open</option>
              <option value="CLAIMED">Claimed</option>
              <option value="RETURNED">Returned</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          {anyFilter && (
            <button type="button" className="btn secondary block small" onClick={() => { setQ(''); setParams({}); }}>Clear all</button>
          )}
        </aside>

        <section>
          <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }}>
            <label htmlFor="q" className="sr-only">Search posts</label>
            <input id="q" type="search" placeholder="Search by keyword, e.g. black wallet, AirPods, keys…" value={q}
              onChange={(e) => setQ(e.target.value)} />
            <button className="btn">Search</button>
          </form>

          {error && <div className="alert error">{error}</div>}
          {data && !data.items.length && (
            <div className="card empty">
              <h3>No posts found</h3>
              <p>{anyFilter ? 'Try fewer filters or other keywords.' : 'Nothing has been posted yet.  Be the first!'}</p>
            </div>
          )}
          <div className="grid">
            {data?.items.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
          {data && pages > 1 && (
            <nav className="pager" aria-label="Pages">
              <button type="button" className="btn secondary small" disabled={data.page <= 1} onClick={() => set({ ...filters, page: String(data.page - 1) })}>← Previous</button>
              <span>Page {data.page} of {pages}</span>
              <button type="button" className="btn secondary small" disabled={data.page >= pages} onClick={() => set({ ...filters, page: String(data.page + 1) })}>Next →</button>
            </nav>
          )}
        </section>
      </div>
    </>
  );
}
