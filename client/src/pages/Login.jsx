import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuthStore, takeLogoutReason } from '../store/authStore';
import { getRememberedMember, forgetMember } from '../utils/session';
import { useNavigate } from 'react-router-dom';

// ── Animated pulse ring decoration ───────────────────────────────────────────
function PulseRing({ delay = 0, size = 80, opacity = 0.06 }) {
  return (
    <div
      className="absolute rounded-full border border-[#D4AF37] animate-ping"
      style={{ width: size, height: size, opacity, animationDuration: '3s', animationDelay: `${delay}s` }}
    />
  );
}

// ── Input field ───────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold text-[#7E8596]">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls = `w-full bg-[#1A1C20] border border-white/[0.1] rounded-xl px-4 py-3 text-[#FFFFFF]
  text-sm font-medium placeholder-[#4A4E5A] outline-none
  focus:border-[rgba(212,175,55,0.40)] focus:ring-2 focus:ring-[rgba(212,175,55,0.12)]
  transition-all duration-200`;

// ── Member PIN form ───────────────────────────────────────────────────────────
function PinForm({ phone, pin, showPin, loading, error, onPhone, onPin, onTogglePin, onLogin, onForgot }) {
  return (
    <div className="space-y-4 fade-up">
      <Field label="Mobile Number">
        <div className="flex items-center gap-0 border border-white/[0.1] rounded-xl bg-[#1A1C20]
          focus-within:border-[rgba(212,175,55,0.40)] focus-within:ring-2 focus-within:ring-[rgba(212,175,55,0.12)]
          transition-all duration-200 overflow-hidden">
          <span className="pl-4 pr-3 text-[#7E8596] text-sm font-medium border-r border-white/[0.08] py-3">+91</span>
          <input
            type="tel" inputMode="numeric" maxLength={10} value={phone}
            onChange={e => onPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="10-digit number"
            className="flex-1 px-3 py-3 bg-transparent text-[#FFFFFF] text-sm font-medium placeholder-[#4A4E5A] outline-none"
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
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7E8596] hover:text-[#9EA3B0] text-xs font-semibold transition-colors">
            {showPin ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-[#4A4E5A]">Set by your health coach</p>
          {/* There was no recovery path at all: the PIN is set by the coach and
              a member who forgot it had nothing to tap. */}
          <button type="button" onClick={onForgot}
            className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#F0E2B6] transition-colors">
            Forgot PIN?
          </button>
        </div>
      </Field>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button onClick={onLogin} disabled={phone.length !== 10 || !pin || loading}
        className="w-full py-3.5 bg-[#D4AF37] hover:bg-[#F0E2B6] disabled:opacity-40
          disabled:cursor-not-allowed text-[#121316] font-bold rounded-xl
          transition-all duration-200 text-sm tracking-wide active:scale-[0.98]
          shadow-[0_0_24px_rgba(212,175,55,0.35)]">
        {loading
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-[#121316]/30 border-t-[#121316] rounded-full animate-spin" />
              Signing in…
            </span>
          : 'Log In →'}
      </button>
    </div>
  );
}

// ── Coach / Admin form ──────────────────────────────────────────────────────
function CoachForm({ email, password, loading, error, onEmail, onPassword, onLogin }) {
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
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7E8596] hover:text-[#9EA3B0] text-xs font-semibold transition-colors">
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button onClick={onLogin} disabled={!email || !password || loading}
        className="w-full py-3.5 bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.1]
          disabled:opacity-40 disabled:cursor-not-allowed text-[#FFFFFF] font-bold rounded-xl
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
  // Who was signed in on this device last. Only a display hint — the PIN is
  // still required — but it is what turns an unexpected logout into "welcome
  // back" instead of what looks like a registration form to a member who has
  // been using FitLife for months.
  const remembered = useState(() => getRememberedMember())[0];

  const [mode, setMode]         = useState('patient');
  const [phone, setPhone]       = useState(remembered?.phone || '');
  const [pin, setPin]           = useState('');
  const [showPin, setShowPin]   = useState(false);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const { login } = useAuthStore();
  const navigate  = useNavigate();

  // Why we're back here. An expired refresh token drops the member on this
  // screen mid-task; without a word it reads as the app having crashed.
  const [notice, setNotice] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  useEffect(() => {
    const reason = takeLogoutReason();
    if (reason === 'expired') {
      setNotice('Your session timed out. Please log in again — nothing you logged has been lost.');
    }
  }, []);

  const pinLogin = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const { data } = await axios.post('/api/auth/pin-login', { phone, pin }, { withCredentials: true });
      // Third argument is the fallback copy of the refresh token. Without it
      // an iPhone whose cookie jar does not persist is signed out again on the
      // very next cold start.
      login(data.accessToken, data.user, data.refreshToken || null);
      navigate('/');
    } catch (e) {
      const data = e.response?.data;
      setError(data?.error || 'Invalid phone or PIN.');
      // A paused account is not a typo — clearing the PIN box invites a retry
      // that cannot succeed, and drives them into the rate limit.
      if (data?.code !== 'account_inactive') setPin('');
    } finally { setLoading(false); }
  };

  const coachLogin = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const { data } = await axios.post('/api/auth/login', { email, password }, { withCredentials: true });
      login(data.accessToken, data.user, data.refreshToken || null);
      navigate(data.user.role === 'admin' ? '/admin' : '/coach');
    } catch (e) {
      setError(e.response?.data?.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const switchMode = m => {
    setMode(m); setError('');
    // Returning to the member tab restores the remembered number rather than
    // clearing it — retyping a phone number you did not choose to erase is
    // exactly the friction this change exists to remove.
    setPhone(m === 'patient' ? (remembered?.phone || '') : '');
    setPin(''); setEmail(''); setPassword('');
  };

  /** "Not you?" — clears the hint and the prefilled number. */
  const notMe = () => {
    forgetMember();
    setPhone(''); setPin(''); setError(''); setNotice('');
  };

  return (
    <div className="min-h-screen bg-[#121316] flex flex-col items-center justify-center px-4 py-12">

      {/* Ambient background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[400px] h-[400px] rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #D4AF37, #F0E2B6 30%, transparent 70%)' }} />
      </div>

      <div className="w-full max-w-sm relative">

        {/* Logo mark */}
        <div className="text-center mb-10 fade-up">
          {/* The lockup carries the wordmark, so no separate <h1> — a text
              "FitLife" beside the logo's own FITLIFE read as a duplicate. */}
          <div className="relative inline-flex items-center justify-center mb-4">
            <PulseRing delay={0} size={150} opacity={0.07} />
            <PulseRing delay={0.8} size={180} opacity={0.04} />
            <img
              src="/logo-full.png"
              alt="FitLife"
              className="relative w-[150px] h-auto select-none"
              draggable="false"
            />
          </div>
          <p className="text-[#9EA3B0] text-sm font-medium italic font-display">Your personal health coach, every day</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#1A1C20]
          shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.7)]
          overflow-hidden scale-up">

          {showForgot && (
            <div className="bg-[#121316] border-b border-white/[0.07] px-5 py-4">
              <p className="text-sm font-semibold text-white">Forgotten your PIN?</p>
              <p className="text-xs text-[#9EA3B0] mt-1.5 leading-relaxed">
                Your PIN is set by your coach, so they're the one who can reset
                it. Message them and they'll send you a new one — it takes a
                minute. Nothing you've logged is affected.
              </p>
              <button type="button" onClick={() => setShowForgot(false)}
                style={{ minHeight: 36 }}
                className="mt-2 text-[11px] font-bold text-[#D4AF37] px-1">
                Back to login
              </button>
            </div>
          )}

          {notice && (
            <div className="bg-[rgba(212,175,55,0.08)] border-b border-[rgba(212,175,55,0.20)]
              text-[#F0E2B6] text-xs leading-relaxed px-5 py-3">
              {notice}
            </div>
          )}

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
                  mode === tab.id ? 'text-[#D4AF37]' : 'text-[#7E8596]'
                }`}>{tab.label}</div>
                <div className="text-[10px] text-[#4A4E5A] mt-0.5 font-medium">{tab.sub}</div>
                {mode === tab.id && (
                  <div className="absolute bottom-0 left-4 right-4 h-[1.5px] bg-[#D4AF37] rounded-full
                    shadow-[0_0_10px_rgba(212,175,55,0.70)]" />
                )}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Welcome back.
                A member whose session was lost — an iPhone that shed its
                cookie, a cleared cache — used to arrive at a blank form and
                read it as being asked to register from scratch. Naming them
                makes it obviously the same account, and the number is already
                filled in, so it is one PIN away rather than a fresh start. */}
            {mode === 'patient' && remembered?.name && (
              <div className="mb-5 text-center">
                <div className="text-[#E8E6E1] text-base">
                  Welcome back, <span className="text-[#D4AF37] font-semibold">{remembered.name.split(' ')[0]}</span>
                </div>
                <button onClick={notMe}
                  className="mt-1 text-xs text-[#7E8596] underline underline-offset-2">
                  Not you?
                </button>
              </div>
            )}

            {mode === 'patient' ? (
              <PinForm phone={phone} pin={pin} showPin={showPin} loading={loading} error={error}
                onPhone={setPhone} onPin={setPin} onTogglePin={() => setShowPin(s => !s)} onLogin={pinLogin}
                onForgot={() => setShowForgot(true)} />
            ) : (
              <CoachForm email={email} password={password} loading={loading} error={error}
                onEmail={setEmail} onPassword={setPassword} onLogin={coachLogin} />
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-[#4A4E5A] mt-6 tracking-wide">
          All health data is encrypted and private
        </p>
      </div>
    </div>
  );
}
