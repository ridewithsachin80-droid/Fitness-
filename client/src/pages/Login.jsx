import { useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';

// ── Animated pulse ring decoration ───────────────────────────────────────────
function PulseRing({ delay = 0, size = 80, opacity = 0.06 }) {
  return (
    <div
      className="absolute rounded-full border border-[#2ce89c] animate-ping"
      style={{ width: size, height: size, opacity, animationDuration: '3s', animationDelay: `${delay}s` }}
    />
  );
}

// ── Input field ───────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold text-[#4e4e5c] uppercase tracking-[0.12em]">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls = `w-full bg-[#1a1a20] border border-white/[0.10] rounded-xl px-4 py-3 text-[#ededf0]
  text-sm font-medium placeholder-[#3a3a46] outline-none
  focus:border-[rgba(44,232,156,0.40)] focus:ring-2 focus:ring-[rgba(44,232,156,0.12)]
  transition-all duration-200`;

// ── Member PIN form ───────────────────────────────────────────────────────────
function PinForm({ phone, pin, showPin, loading, error, onPhone, onPin, onTogglePin, onLogin }) {
  return (
    <div className="space-y-4 fade-up">
      <Field label="Mobile Number">
        <div className="flex items-center gap-0 border border-white/[0.10] rounded-xl bg-[#1a1a20]
          focus-within:border-[rgba(44,232,156,0.40)] focus-within:ring-2 focus-within:ring-[rgba(44,232,156,0.12)]
          transition-all duration-200 overflow-hidden">
          <span className="pl-4 pr-3 text-[#4e4e5c] text-sm font-medium border-r border-white/[0.08] py-3">+91</span>
          <input
            type="tel" inputMode="numeric" maxLength={10} value={phone}
            onChange={e => onPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="10-digit number"
            className="flex-1 px-3 py-3 bg-transparent text-[#ededf0] text-sm font-medium placeholder-[#3a3a46] outline-none"
            onKeyDown={e => e.key === 'Enter' && onLogin()}
          />
        </div>
      </Field>

      <Field label="PIN">
        <div className="relative">
          <input
            type={showPin ? 'text' : 'password'} inputMode="numeric" value={pin}
            onChange={e => onPin(e.target.value)} placeholder="Your PIN"
            className={`${inputCls} pr-16 tracking-widest`}
            onKeyDown={e => e.key === 'Enter' && onLogin()}
            autoComplete="current-password"
          />
          <button type="button" onClick={onTogglePin}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4e4e5c] hover:text-[#8e8e9a] text-xs font-semibold transition-colors">
            {showPin ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-[11px] text-[#3a3a46] mt-1">Set by your health coach</p>
      </Field>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button onClick={onLogin} disabled={phone.length !== 10 || !pin || loading}
        className="w-full py-3.5 bg-[#2ce89c] hover:bg-[#34d399] disabled:opacity-40
          disabled:cursor-not-allowed text-[#040c08] font-bold rounded-xl
          transition-all duration-200 text-sm tracking-wide active:scale-[0.98]
          shadow-[0_0_20px_rgba(44,232,156,0.25)]">
        {loading
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-[#040c08]/30 border-t-[#040c08] rounded-full animate-spin" />
              Signing in…
            </span>
          : 'Log In →'}
      </button>
    </div>
  );
}

// ── Monitor / Admin form ──────────────────────────────────────────────────────
function MonitorForm({ email, password, loading, error, onEmail, onPassword, onLogin }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="space-y-4 fade-up">
      <Field label="Email Address">
        <input type="email" value={email} onChange={e => onEmail(e.target.value)}
          placeholder="coach@example.com" className={inputCls}
          onKeyDown={e => e.key === 'Enter' && onLogin()} />
      </Field>
      <Field label="Password">
        <div className="relative">
          <input type={showPw ? 'text' : 'password'} value={password}
            onChange={e => onPassword(e.target.value)} placeholder="••••••••"
            className={`${inputCls} pr-16`}
            onKeyDown={e => e.key === 'Enter' && onLogin()} />
          <button type="button" onClick={() => setShowPw(s => !s)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4e4e5c] hover:text-[#8e8e9a] text-xs font-semibold transition-colors">
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button onClick={onLogin} disabled={!email || !password || loading}
        className="w-full py-3.5 bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.10]
          disabled:opacity-40 disabled:cursor-not-allowed text-[#ededf0] font-bold rounded-xl
          transition-all duration-200 text-sm active:scale-[0.98]">
        {loading
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Signing in…
            </span>
          : 'Sign In →'}
      </button>
    </div>
  );
}

// ── Main Login Page ───────────────────────────────────────────────────────────
export default function Login() {
  const [mode, setMode]         = useState('patient');
  const [phone, setPhone]       = useState('');
  const [pin, setPin]           = useState('');
  const [showPin, setShowPin]   = useState(false);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

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

  const switchMode = m => {
    setMode(m); setError('');
    setPhone(''); setPin(''); setEmail(''); setPassword('');
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e] flex flex-col items-center justify-center px-4 py-12">

      {/* Ambient background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[400px] h-[400px] rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #2ce89c, transparent 70%)' }} />
      </div>

      <div className="w-full max-w-sm relative">

        {/* Logo mark */}
        <div className="text-center mb-10 fade-up">
          <div className="relative inline-flex items-center justify-center w-16 h-16 mb-5">
            <PulseRing delay={0} size={64} opacity={0.08} />
            <PulseRing delay={0.8} size={80} opacity={0.05} />
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0a2318] to-[#040c08]
              border border-[rgba(44,232,156,0.20)] flex items-center justify-center
              shadow-[0_0_30px_rgba(44,232,156,0.12)] relative">
              <svg className="w-7 h-7 text-[#2ce89c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-[#ededf0] tracking-tight">FitLife</h1>
          <p className="text-[#4e4e5c] text-sm mt-2 font-medium">Your personal health coach, every day</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#131317]
          shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.7)]
          overflow-hidden scale-up">

          {/* Mode tabs */}
          <div className="flex border-b border-white/[0.07]">
            {[
              { id: 'patient', label: 'Member',        sub: 'Phone + PIN' },
              { id: 'monitor', label: 'Coach / Admin', sub: 'Email login'  },
            ].map(tab => (
              <button key={tab.id} onClick={() => switchMode(tab.id)}
                className={`flex-1 py-4 text-center transition-all relative ${
                  mode === tab.id ? '' : 'hover:bg-white/[0.03]'
                }`}>
                <div className={`text-sm font-semibold transition-colors ${
                  mode === tab.id ? 'text-[#2ce89c]' : 'text-[#4e4e5c]'
                }`}>{tab.label}</div>
                <div className="text-[10px] text-[#3a3a46] mt-0.5 font-medium">{tab.sub}</div>
                {mode === tab.id && (
                  <div className="absolute bottom-0 left-4 right-4 h-[1.5px] bg-[#2ce89c] rounded-full
                    shadow-[0_0_8px_rgba(44,232,156,0.60)]" />
                )}
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

        <p className="text-center text-[11px] text-[#3a3a46] mt-6 tracking-wide">
          All health data is encrypted and private
        </p>
      </div>
    </div>
  );
}
