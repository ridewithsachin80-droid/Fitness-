import { useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';

// ── Member PIN login form ─────────────────────────────────────────────────────
function PinForm({ phone, pin, showPin, loading, error, onPhone, onPin, onTogglePin, onLogin }) {
  return (
    <div className="space-y-4 fade-up">
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Mobile Number
        </label>
        <div className="flex items-center gap-2 border-2 border-stone-200 rounded-2xl px-4 py-3 focus-within:border-emerald-400 transition-colors bg-white">
          <span className="text-stone-400 font-medium text-sm">+91</span>
          <div className="w-px h-4 bg-stone-200" />
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={(e) => onPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your mobile number"
            className="flex-1 outline-none text-stone-800 font-medium text-base bg-transparent placeholder-stone-300"
            onKeyDown={(e) => e.key === 'Enter' && onLogin()}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          PIN
        </label>
        <div className="relative">
          <input
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            value={pin}
            onChange={(e) => onPin(e.target.value)}
            placeholder="Enter your PIN"
            className="w-full border-2 border-stone-200 rounded-2xl px-4 py-3 pr-16 focus:outline-none focus:border-emerald-400 transition-colors text-stone-800 font-medium bg-white text-base tracking-widest"
            onKeyDown={(e) => e.key === 'Enter' && onLogin()}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={onTogglePin}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-sm font-medium"
          >
            {showPin ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-1.5 ml-1">PIN is set by your monitor / admin</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button
        onClick={onLogin}
        disabled={phone.length !== 10 || !pin || loading}
        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl transition-all duration-200 text-base shadow-sm"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Signing in…
          </span>
        ) : 'Log In'}
      </button>
    </div>
  );
}

// ── Monitor / Admin email + password form ─────────────────────────────────────
function MonitorForm({ email, password, loading, error, onEmail, onPassword, onLogin }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="space-y-4 fade-up">
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="sachin@healthmonitor.app"
          className="w-full border-2 border-stone-200 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-400 transition-colors text-stone-800 font-medium bg-white text-base"
          onKeyDown={(e) => e.key === 'Enter' && onLogin()}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Password
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full border-2 border-stone-200 rounded-2xl px-4 py-3 pr-12 focus:outline-none focus:border-emerald-400 transition-colors text-stone-800 font-medium bg-white text-base"
            onKeyDown={(e) => e.key === 'Enter' && onLogin()}
          />
          <button type="button" onClick={() => setShowPw(!showPw)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-sm font-medium">
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button
        onClick={onLogin}
        disabled={!email || !password || loading}
        className="w-full py-4 bg-stone-800 hover:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl transition-all duration-200 text-base shadow-sm"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Signing in…
          </span>
        ) : 'Sign In'}
      </button>
    </div>
  );
}

// ── Main Login page ───────────────────────────────────────────────────────────
export default function Login() {
  const [mode, setMode]       = useState('patient');
  const [phone, setPhone]     = useState('');
  const [pin, setPin]         = useState('');
  const [showPin, setShowPin] = useState(false);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const { login } = useAuthStore();
  const navigate  = useNavigate();

  const pinLogin = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/auth/pin-login', { phone, pin }, { withCredentials: true });
      login(data.accessToken, data.user);
      navigate('/');
    } catch (e) {
      setError(e.response?.data?.error || 'Invalid phone or PIN.');
      setPin('');
    } finally { setLoading(false); }
  };

  const monitorLogin = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/auth/login', { email, password }, { withCredentials: true });
      login(data.accessToken, data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/monitor');
    } catch (e) {
      setError(e.response?.data?.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const switchMode = (m) => {
    setMode(m); setError('');
    setPhone(''); setPin('');
    setEmail(''); setPassword('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-emerald-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 rounded-3xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-800">FitLife</h1>
          <p className="text-stone-500 text-sm mt-1">Transform your health, one day at a time 💚</p>
        </div>

        <div className="bg-white rounded-3xl shadow-float overflow-hidden">
          <div className="flex border-b border-stone-100">
            {[
              { id: 'patient', label: 'Member',          sub: 'Phone + PIN' },
              { id: 'monitor', label: 'Monitor / Admin',  sub: 'Email login' },
            ].map((tab) => (
              <button key={tab.id} onClick={() => switchMode(tab.id)}
                className={`flex-1 py-4 text-center transition-all ${
                  mode === tab.id ? 'border-b-2 border-emerald-500' : 'text-stone-400 hover:text-stone-600'
                }`}>
                <div className={`text-sm font-semibold ${mode === tab.id ? 'text-emerald-700' : ''}`}>{tab.label}</div>
                <div className="text-xs text-stone-400 mt-0.5">{tab.sub}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            {mode === 'patient' ? (
              <PinForm phone={phone} pin={pin} showPin={showPin} loading={loading} error={error}
                onPhone={setPhone} onPin={setPin} onTogglePin={() => setShowPin(s => !s)} onLogin={pinLogin} />
            ) : (
              <MonitorForm email={email} password={password} loading={loading} error={error}
                onEmail={setEmail} onPassword={setPassword} onLogin={monitorLogin} />
            )}
          </div>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">Health data is private and encrypted.</p>
      </div>
    </div>
  );
}
