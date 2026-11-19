/* Organization management (FR-18): the public access request, and the review of requests by platform
   administrators.  The organization's own settings are a tab of the Admin page (Organization.jsx). */
import RequestAccess from './RequestAccess';
import Platform from './Platform';
import './organizations.css';

const PLATFORM = ['PLATFORM_ADMIN'];

export default {
  order: 80,
  publicRoutes: [{ path: '/join', element: <RequestAccess /> }],
  routes: [{ path: '/platform', element: <Platform />, roles: PLATFORM }],
  nav: [{ to: '/platform', label: 'Organizations', roles: PLATFORM }],
};
