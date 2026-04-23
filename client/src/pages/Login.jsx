import { useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';

// ── Sub-components ────────────────────────────────────────────────────────────

function OTPStep({ step, phone, otp, loading, error, onPhone, onOtp, onSendOtp, onVerify, onBack }) {
  if (step === 1) {
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
              onKeyDown={(e) => e.key === 'Enter' && phone.length === 10 && onSendOtp()}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <button
          onClick={onSendOtp}
          disabled={phone.length !== 10 || loading}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl transition-all duration-200 text-base shadow-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Sending…
            </span>
          ) : (
            'Send OTP'
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 fade-up">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
        OTP sent to <span className="font-semibold">+91 {phone}</span>
        <button onClick={onBack} className="ml-2 text-emerald-600 underline text-xs">Change</button>
      </div>

      <div>
        <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
          Enter 6-digit OTP
        </label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => onOtp(e.target.value.replace(/\D/g, ''))}
          placeholder="_ _ _ _ _ _"
          className="w-full text-center text-3xl font-bold tracking-[0.4em] border-2 border-stone-200 rounded-2xl py-4 focus:outline-none focus:border-emerald-400 transition-colors text-stone-800"
          onKeyDown={(e) => e.key === 'Enter' && otp.length === 6 && onVerify()}
          autoFocus
        />
        <p className="text-xs text-stone-400 text-center mt-2">
          Valid for 10 minutes · In dev mode, check server console
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <button
        onClick={onVerify}
        disabled={otp.length !== 6 || loading}
        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl transition-all duration-200 text-base shadow-sm"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Verifying…
          </span>
        ) : (
          'Verify & Log In'
        )}
      </button>
    </div>
  );
}

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
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-sm font-medium"
          >
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
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
        ) : (
          'Sign In'
        )}
      </button>
    </div>
  );
}

// ── Main Login page ───────────────────────────────────────────────────────────
export default function Login() {
  const [mode, setMode] = useState('patient'); // 'patient' | 'monitor'

  // Patient OTP state
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState('');
  const [step,    setStep]    = useState(1);   // 1 = enter phone, 2 = enter OTP

  // Monitor state
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const { login } = useAuthStore();
  const navigate  = useNavigate();

  const resetErrors = () => setError('');

  // ── Patient handlers ────────────────────────────────────────────────────
  const sendOTP = async () => {
    setLoading(true);
    resetErrors();
    try {
      await axios.post('/api/auth/send-otp', { phone });
      setStep(2);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    setLoading(true);
    resetErrors();
    try {
      const { data } = await axios.post(
        '/api/auth/verify-otp',
        { phone, otp },
        { withCredentials: true }
      );
      login(data.accessToken, data.user);
      navigate('/');
    } catch (e) {
      setError(e.response?.data?.error || 'Incorrect OTP. Please try again.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  // ── Monitor handlers ────────────────────────────────────────────────────
  const monitorLogin = async () => {
    setLoading(true);
    resetErrors();
    try {
      const { data } = await axios.post(
        '/api/auth/login',
        { email, password },
        { withCredentials: true }
      );
      login(data.accessToken, data.user);
      navigate('/monitor');
    } catch (e) {
      setError(e.response?.data?.error || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setStep(1);
    setPhone('');
    setOtp('');
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-emerald-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 rounded-3xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-800">Health Monitor</h1>
          <p className="text-stone-500 text-sm mt-1">Daily tracking for Mrs. Padmini</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-float overflow-hidden">

          {/* Tab bar */}
          <div className="flex border-b border-stone-100">
            {[
              { id: 'patient',  label: 'Patient',  sub: 'OTP login' },
              { id: 'monitor',  label: 'Monitor',  sub: 'Email login' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => switchMode(tab.id)}
                className={`flex-1 py-4 text-center transition-all ${
                  mode === tab.id
                    ? 'border-b-2 border-emerald-500'
                    : 'text-stone-400 hover:text-stone-600'
                }`}
              >
                <div className={`text-sm font-semibold ${mode === tab.id ? 'text-emerald-700' : ''}`}>
                  {tab.label}
                </div>
                <div className="text-xs text-stone-400 mt-0.5">{tab.sub}</div>
              </button>
            ))}
          </div>

          {/* Form body */}
          <div className="p-6">
            {mode === 'patient' ? (
              <OTPStep
                step={step}
                phone={phone}
                otp={otp}
                loading={loading}
                error={error}
                onPhone={setPhone}
                onOtp={setOtp}
                onSendOtp={sendOTP}
                onVerify={verifyOTP}
                onBack={() => { setStep(1); setOtp(''); resetErrors(); }}
              />
            ) : (
              <MonitorForm
                email={email}
                password={password}
                loading={loading}
                error={error}
                onEmail={setEmail}
                onPassword={setPassword}
                onLogin={monitorLogin}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-stone-400 mt-6">
          Health data is private and encrypted.
        </p>
      </div>
    </div>
  );
}
