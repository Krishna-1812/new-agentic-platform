import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState('loading');
  const [role, setRole] = useState(null); // 'seo' | 'extended' | null

  useEffect(() => {
    fetch('/api/auth/verify', { credentials: 'include' })
      .then(async r => {
        if (r.ok) {
          const data = await r.json();
          setRole(data.role || 'seo');
          setAuthState('authenticated');
        } else {
          setAuthState('unauthenticated');
        }
      })
      .catch(() => setAuthState('unauthenticated'));
  }, []);

  function markAuthenticated(userRole) {
    setRole(userRole || 'seo');
    setAuthState('authenticated');
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setRole(null);
    setAuthState('unauthenticated');
  }

  return (
    <AuthContext.Provider value={{ authState, role, markAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
