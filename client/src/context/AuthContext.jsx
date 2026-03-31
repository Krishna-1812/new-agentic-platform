import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // 'loading' | 'authenticated' | 'unauthenticated'
  const [authState, setAuthState] = useState('loading');

  useEffect(() => {
    // On app load, verify session cookie with the server
    fetch('/api/auth/verify', { credentials: 'include' })
      .then(r => setAuthState(r.ok ? 'authenticated' : 'unauthenticated'))
      .catch(() => setAuthState('unauthenticated'));
  }, []);

  function markAuthenticated() {
    setAuthState('authenticated');
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthState('unauthenticated');
  }

  return (
    <AuthContext.Provider value={{ authState, markAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
