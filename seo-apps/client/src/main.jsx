import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import './index.css'
import App from './App.jsx'
import { captureStudioToken, installStudioTokenTransport } from './lib/studioToken'


// Embedded in the Northaxis platform iframe
if (window.self !== window.top) {
  document.documentElement.classList.add('embedded');
}

// Take the studio pass out of the URL and send it with every API call, before
// anything renders (see lib/studioToken.js and server/routes/auth.js).
captureStudioToken();
installStudioTokenTransport();

function StudioGate({ children }) {
  const [state, setState] = useState('checking');
  useEffect(() => {
    // Only a definite "no valid pass" shows the screen below. Anything else
    // (a throttled or failed check) lets the studio render: every API call
    // checks the pass again anyway.
    fetch('/api/auth/verify')
      .then(r => (r.ok ? r.json() : { valid: true }))
      .then(d => setState(d.valid ? 'ok' : 'denied'))
      .catch(() => setState('ok')); // a network blip shouldn't lock people out; the API still checks
  }, []);
  if (state === 'checking') return null;
  if (state === 'denied') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
                    fontFamily: 'var(--font-sans)', color: 'var(--text)', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>Open SEO Studio from Northaxis</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-2)', margin: 0 }}>
            These tools run inside the Northaxis platform. Sign in there and open
            SEO + AEO. If you were already using it, your session expired: reload that page.
          </p>
        </div>
      </div>
    );
  }
  return children;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StudioGate>
          <App />
        </StudioGate>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
