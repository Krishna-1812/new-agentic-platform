import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState('authenticated');
  const [role, setRole] = useState('seo');

  function markAuthenticated(userRole) {
    setRole(userRole || 'seo');
    setAuthState('authenticated');
  }

  async function logout() {
    setRole('seo');
    setAuthState('authenticated');
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
