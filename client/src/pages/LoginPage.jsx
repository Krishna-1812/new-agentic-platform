import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { markAuthenticated } = useAuth();
  const from = location.state?.from || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');

      markAuthenticated();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Top bar */}
      <div className="bg-white border-b border-[#E5E7EB] py-3.5 px-6">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#3DAA8E' }}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="font-semibold text-[#111827] tracking-tight text-sm">SEO Automation</span>
          <span className="text-[#9CA3AF] text-sm">· Gentle Dental</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.04)] border border-[#E5E7EB] overflow-hidden">
            {/* Card header */}
            <div className="px-8 py-7 text-center border-b border-[#E5E7EB]">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: '#3DAA8E1A' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" style={{ color: '#3DAA8E' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h1 className="font-bold text-xl text-[#111827]">Sign in</h1>
              <p className="text-[#6B7280] text-sm mt-1">Access SEO Automation tools</p>
            </div>

            <form onSubmit={handleLogin} className="px-8 py-7 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <span className="text-red-500 flex-shrink-0 mt-0.5 text-xs">✕</span>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  disabled={loading}
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF] transition-shadow"
                  style={{ '--tw-ring-color': '#3DAA8E' }}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    disabled={loading}
                    className="w-full px-4 py-2.5 pr-10 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF] transition-shadow"
                    style={{ '--tw-ring-color': '#3DAA8E' }}
                  />
                  <button type="button" onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
                    {showPassword
                      ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    }
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !username.trim() || !password}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                style={{ backgroundColor: '#111827' }}
              >
                {loading
                  ? <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Signing in…
                    </span>
                  : 'Sign in'
                }
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
