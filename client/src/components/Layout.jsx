import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { headerItems, moduleNav } from '../modules/registry';
import PageTitle from './PageTitle';

/* The top bar.  The main links stay in the bar; every other link is under "More", so the bar never hides links
   off-screen (NFR-6).  Below 900 pixels, one "Menu" button lists them all (NFR-8.2: 360 to 1920 pixels). */
export default function Layout() {
  const { user, signOut } = useAuth();
  const initials = user.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const links = [
    { to: '/', label: 'Feed', end: true, primary: true },
    { to: '/posts/new', label: 'Post an item', primary: true },
    { to: '/claims', label: 'Claims', primary: true },
    ...moduleNav(user),
    ...(['ORG_ADMIN', 'PLATFORM_ADMIN'].includes(user.role) ? [{ to: '/admin/matching', label: 'Smart Match' }] : []),
  ];
  const primary = links.filter((l) => l.primary);
  const more = links.filter((l) => !l.primary);

  return (
    <>
      <a className="skip-link" href="#main">Skip to the content</a>
      <PageTitle />
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="FoundU home">
            <img src="/icon.png" alt="" />
            FoundU
          </Link>
          <nav className="nav" aria-label="Main">
            {primary.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
            {more.length > 0 && <Menu label="More" className="more-menu" links={more} />}
          </nav>
          <div className="user-chip">
            {headerItems().map((Item, i) => <Item key={i} />)}
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="user-name">{user.displayName}</span>
            <button type="button" className="btn secondary small" onClick={signOut}>Sign out</button>
          </div>
          <nav className="mobile-nav" aria-label="Main">
            <Menu label="Menu" className="mobile-menu" links={links} />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}

/** A disclosure menu of links: opens on click, closes on Escape, on a click outside, and after choosing a link. */
function Menu({ label, className, links }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  const { pathname } = useLocation();
  const current = links.some((l) => (l.end ? pathname === l.to : pathname === l.to || pathname.startsWith(`${l.to}/`)));

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onClick = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const id = `${className}-list`;
  return (
    <div className={`menu ${className}`} ref={box}>
      <button ref={button} type="button" className={`menu-button${current ? ' active' : ''}`} aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}>
        {label} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <ul id={id} className="menu-list" hidden={!open}>
        {links.map((l) => <li key={l.to}><NavLink to={l.to} end={l.end}>{l.label}</NavLink></li>)}
      </ul>
    </div>
  );
}
