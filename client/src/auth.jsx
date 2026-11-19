import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined while loading, null when signed out
  const [reference, setReference] = useState(null);
  const [notice, setNotice] = useState(null); // shown on the sign-in page: session expired, data deleted

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get('/auth/me');
      const ref = await api.get('/reference');
      setReference(ref); // set together, so pages never see a user without reference data
      setUser(me);
    } catch {
      setUser(null);
      setReference(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onSignedOut = () => { // FR-1.9: the session ended after 30 minutes of inactivity
      setUser((was) => {
        if (was) setNotice('Your session expired.  Sign in again.');
        return null;
      });
    };
    window.addEventListener('foundu:signed-out', onSignedOut);
    return () => window.removeEventListener('foundu:signed-out', onSignedOut);
  }, [refresh]);

  const signOut = async () => {
    await api.post('/auth/logout');
    setNotice(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, reference, refresh, signOut, notice, setNotice }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
