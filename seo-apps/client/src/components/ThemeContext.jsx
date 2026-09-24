import { createContext, useContext } from 'react';

// One theme — the light Outcomes palette this app's CSS tokens now resolve
// to (see index.css), matching the rest of the Northaxis platform, which
// has no dark mode either. The context is kept, with a no-op toggle, only so
// any existing useTheme() consumer keeps compiling without a change.
const ThemeContext = createContext({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }) {
  return (
    <ThemeContext.Provider value={{ theme: 'light', toggle: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
