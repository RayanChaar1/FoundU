/* Client modules.  Every folder in src/modules/ with an index.jsx is picked up automatically, so a new module only
   adds files.  index.jsx exports default {
     order,                       // position of its nav links (lower first, default 50)
     routes: [{ path, element, roles, show }],
     publicRoutes: [{ path, element }],  // pages for visitors who are not signed in (e.g. the access request)
     nav: [{ to, label, roles, show }],
     header: [Component],         // small items in the top bar, before the user chip (e.g. a notification bell)
     postPanels: [Component],     // sections at the bottom of a post page, given { post }
     claimPanels: [Component],    // sections at the bottom of a claim page, given { claim, reload }
   }
   roles (optional) limits an entry to users with one of these roles (Table 10).
   show (optional) is a function of the user that hides an entry, e.g. when the organization turned a feature off. */
const found = import.meta.glob('./*/index.jsx', { eager: true });

const modules = Object.values(found)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

const allowed = (user) => (entry) => (!entry.roles || entry.roles.includes(user?.role)) && (!entry.show || entry.show(user));
const collect = (key, user) => modules.flatMap((m) => m[key] || []).filter(allowed(user));

export const moduleRoutes = (user) => collect('routes', user);
export const moduleNav = (user) => collect('nav', user);
export const publicRoutes = () => modules.flatMap((m) => m.publicRoutes || []);
export const headerItems = () => modules.flatMap((m) => m.header || []);
export const postPanels = () => modules.flatMap((m) => m.postPanels || []);
export const claimPanels = () => modules.flatMap((m) => m.claimPanels || []);
