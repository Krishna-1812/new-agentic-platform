import { createContext, useContext, useEffect } from 'react';

// Dark mode is forced app-wide. The context keeps its { theme, toggle } shape so
// existing consumers of useTheme() keep working; theme is always 'dark' and
// toggle is a no-op.
const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('seo-studio-theme', 'dark'); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
