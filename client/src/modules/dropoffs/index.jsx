/* Drop-off points (FR-14): the official list for everyone and the officers' desk for each point. */
import DropoffList from './DropoffList';
import DropoffDesk from './DropoffDesk';
import './dropoffs.css';

const STAFF = ['SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export default {
  order: 30,
  routes: [
    { path: '/dropoffs', element: <DropoffList /> },
    { path: '/dropoffs/:id', element: <DropoffDesk />, roles: STAFF },
  ],
  nav: [{ to: '/dropoffs', label: 'Drop-off points' }],
};
