/* Client modules.  Every folder in src/modules/ with an index.jsx is picked up automatically, so a new module only
   adds files.  index.jsx exports default {
     order,                       // position of its nav links (lower first, default 50)
     routes: [{ path, element, roles }],
     nav: [{ to, label, roles }],
     header: [Component],         // small items in the top bar, before the user chip (e.g. a notification bell)
     postPanels: [Component],     // sections at the bottom of a post page, given { post }
     claimPanels: [Component],    // sections at the bottom of a claim page, given { claim, reload }
   }
   roles (optional) limits an entry to users with one of these roles (Table 10). */
const found = import.meta.glob('./*/index.jsx', { eager: true });

const modules = Object.values(found)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

const allowed = (user) => (entry) => !entry.roles || entry.roles.includes(user?.role);
const collect = (key, user) => modules.flatMap((m) => m[key] || []).filter(allowed(user));

export const moduleRoutes = (user) => collect('routes', user);
export const moduleNav = (user) => collect('nav', user);
export const headerItems = () => modules.flatMap((m) => m.header || []);
export const postPanels = () => modules.flatMap((m) => m.postPanels || []);
export const claimPanels = () => modules.flatMap((m) => m.claimPanels || []);
