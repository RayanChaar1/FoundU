/* Interactive campus map (FR-11): the map page; the building picker is used by the post form. */
import CampusMap from './CampusMap';
import './map.css';

export default {
  order: 20,
  routes: [{ path: '/map', element: <CampusMap /> }],
  nav: [{ to: '/map', label: 'Map', primary: true }],
};
