/* Karma points and badges (FR-13): the user's points and the semester leaderboard. */
import Leaderboard from './Leaderboard';
import './karma.css';

export default {
  order: 40,
  // FR-18.6: hidden when the organization turned karma points off
  routes: [{ path: '/leaderboard', element: <Leaderboard />, show: (u) => u?.karmaEnabled }],
  nav: [{ to: '/leaderboard', label: 'Karma', show: (u) => u?.karmaEnabled }],
};
