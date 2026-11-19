import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import Layout from './components/Layout';
import SignIn from './pages/SignIn';
import Feed from './pages/Feed';
import PostDetail from './pages/PostDetail';
import NewPost from './pages/NewPost';
import EditPost from './pages/EditPost';
import Claims from './pages/Claims';
import ClaimDetail from './pages/ClaimDetail';
import MatchSettings from './pages/MatchSettings';
import { moduleRoutes, publicRoutes } from './modules/registry';

export default function App() {
  const { user } = useAuth();
  if (user === undefined) return null; // checking the session
  const isAdmin = ['ORG_ADMIN', 'PLATFORM_ADMIN'].includes(user?.role);

  if (!user) {
    return (
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        {publicRoutes().map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Feed />} />
        <Route path="/posts/new" element={<NewPost />} />
        <Route path="/posts/:id" element={<PostDetail />} />
        <Route path="/posts/:id/edit" element={<EditPost />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        {isAdmin && <Route path="/admin/matching" element={<MatchSettings />} />}
        {moduleRoutes(user).map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
