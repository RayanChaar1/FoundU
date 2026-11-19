/* Karma points and badges (FR-13): the user's points and the semester leaderboard. */
import Leaderboard from './Leaderboard';
import './karma.css';

export default {
  order: 40,
  routes: [{ path: '/leaderboard', element: <Leaderboard /> }],
  nav: [{ to: '/leaderboard', label: 'Karma' }],
};
