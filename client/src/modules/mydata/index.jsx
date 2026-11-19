/* Personal data rights (FR-17.6, FR-17.7, NFR-22): correct, download and delete my data. */
import MyData from './MyData';
import './mydata.css';

export default {
  order: 11,
  routes: [{ path: '/my-data', element: <MyData /> }],
  nav: [{ to: '/my-data', label: 'My data' }],
};
