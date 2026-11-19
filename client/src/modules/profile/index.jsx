/* My Posts and Profile (FR-10): the activity dashboard and public profiles. */
import Activity from './Activity';
import Profile from './Profile';
import './profile.css';

export default {
  order: 10,
  routes: [
    { path: '/activity', element: <Activity /> },
    { path: '/users/:id', element: <Profile /> },
  ],
  nav: [{ to: '/activity', label: 'My activity' }],
};
