import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import './index.css'
import App from './App.jsx'


// Embedded in the Position2 Intelligence Platform iframe
if (window.self !== window.top) {
  document.documentElement.classList.add('embedded');

  // Auto-login with platform token so users never see the login page
  const params = new URLSearchParams(window.location.search);
  const pt = params.get('pt');
  if (pt) {
    fetch('/api/auth/verify')
      .then(r => r.json())
      .then(d => {
        if (!d.valid) {
          fetch('/api/auth/platform-login?token=' + encodeURIComponent(pt))
            .then(r => r.json())
            .then(result => { if (result.ok) window.location.reload(); });
        }
      })
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
