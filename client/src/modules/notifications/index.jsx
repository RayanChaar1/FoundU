/* Notifications (FR-8): the bell with the unread count in the top bar, and the notifications page. */
import Bell from './Bell';
import NotificationsPage from './NotificationsPage';
import './notifications.css';

export default {
  order: 90,
  routes: [{ path: '/notifications', element: <NotificationsPage /> }],
  header: [Bell],
};
