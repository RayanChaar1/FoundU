/* Reporting and moderation (FR-15): the report panel on posts, the moderators' queue and the audit log. */
import ReportPanel from './ReportPanel';
import Queue from './Queue';
import AuditLog from './AuditLog';
import './moderation.css';

const STAFF = ['SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const ADMIN = ['ORG_ADMIN', 'PLATFORM_ADMIN'];

export default {
  order: 60,
  routes: [
    { path: '/moderation', element: <Queue />, roles: STAFF },
    { path: '/moderation/audit', element: <AuditLog />, roles: ADMIN },
  ],
  nav: [{ to: '/moderation', label: 'Moderation', roles: STAFF }],
  postPanels: [ReportPanel],
};
