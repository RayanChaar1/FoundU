/* FoundU QR tags (FR-12): the owner's "My tags" page, and the public page a finder reaches by scanning a sticker.
   Both are hidden when the organization turned QR tags off (FR-18.7). */
import MyTags from './MyTags';
import TagPage from './TagPage';
import './tags.css';

const qr = (u) => u?.qrEnabled;

export default {
  order: 45,
  publicRoutes: [{ path: '/t/:token', element: <TagPage /> }], // no sign-in needed (FR-12.4)
  routes: [
    { path: '/tags', element: <MyTags />, show: qr },
    { path: '/t/:token', element: <TagPage /> }, // a signed-in user who scans a tag sees the same page
  ],
  nav: [{ to: '/tags', label: 'My tags', show: qr }],
};
