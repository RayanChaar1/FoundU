import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined while loading, null when signed out
  const [reference, setReference] = useState(null);

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
    const onSignedOut = () => setUser(null); // FR-1.9: the session ended after 30 minutes of inactivity
    window.addEventListener('foundu:signed-out', onSignedOut);
    return () => window.removeEventListener('foundu:signed-out', onSignedOut);
  }, [refresh]);

  const signOut = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, reference, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
