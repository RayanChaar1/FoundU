/* Administration (FR-16): users, places, drop-off points, parameters and the posts report, for organization
   administrators only (Table 10). */
import AdminPage from './AdminPage';
import './admin.css';

const ADMINS = ['ORG_ADMIN', 'PLATFORM_ADMIN'];

export default {
  order: 70,
  routes: [{ path: '/admin', element: <AdminPage />, roles: ADMINS }],
  nav: [{ to: '/admin', label: 'Admin', roles: ADMINS }],
};
