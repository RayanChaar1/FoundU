/* Privacy notice and rules of use (NFR-22.1, NFR-23.1), for visitors and signed-in users alike. */
import Privacy from './Privacy';
import './privacy.css';

export default {
  order: 12,
  publicRoutes: [{ path: '/privacy', element: <Privacy /> }],
  routes: [{ path: '/privacy', element: <Privacy /> }],
};
