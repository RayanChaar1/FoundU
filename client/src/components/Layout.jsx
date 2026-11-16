import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth';
import { headerItems, moduleNav } from '../modules/registry';

export default function Layout() {
  const { user, signOut } = useAuth();
  const initials = user.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="FoundU home">
            <img src="/icon.png" alt="" />
            FoundU
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Feed</NavLink>
            <NavLink to="/posts/new">Post an item</NavLink>
            <NavLink to="/claims">Claims</NavLink>
            {['ORG_ADMIN', 'PLATFORM_ADMIN'].includes(user.role) && <NavLink to="/admin/matching">Smart Match</NavLink>}
            {moduleNav(user).map((n) => <NavLink key={n.to} to={n.to}>{n.label}</NavLink>)}
          </nav>
          <div className="user-chip">
            {headerItems().map((Item, i) => <Item key={i} />)}
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span>{user.displayName}</span>
            <button type="button" className="btn secondary small" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
