import { useState, useEffect } from 'react';

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card border border-stone-100 p-4 ${className}`}>
      {children}
    </div>
  );
}

// ── SectionTitle ──────────────────────────────────────────────────────────────
export function SectionTitle({ children, icon }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-base leading-none">{icon}</span>}
      <h3 className="font-semibold text-stone-700 text-xs tracking-widest uppercase">
        {children}
      </h3>
    </div>
  );
}

// ── CheckRow ──────────────────────────────────────────────────────────────────
export function CheckRow({ checked, onChange, label, sub, icon }) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChange(!checked)}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer select-none
        transition-all duration-150 ${
          checked
            ? 'bg-emerald-50 border border-emerald-200'
            : 'bg-stone-50 border border-stone-100 hover:border-stone-200'
        }`}
    >
      {/* Checkbox circle */}
      <div
        className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
          transition-all duration-150 ${
            checked
              ? 'bg-emerald-500 border-emerald-500'
              : 'border-stone-300'
          }`}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium leading-tight ${
          checked ? 'text-emerald-800' : 'text-stone-700'
        }`}>
          {icon && <span className="mr-1">{icon}</span>}
          {label}
        </div>
        {sub && (
          <div className="text-xs text-stone-400 mt-0.5 leading-tight">{sub}</div>
        )}
      </div>
    </div>
  );
}

// ── OfflineBanner ─────────────────────────────────────────────────────────────
export function OfflineBanner() {
  const [offline,    setOffline]    = useState(!navigator.onLine);
  const [justOnline, setJustOnline] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setOffline(false);
      setJustOnline(true);
      setTimeout(() => setJustOnline(false), 3000);
    };
    const goOffline = () => { setOffline(true); setJustOnline(false); };
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (justOnline) {
    return (
      <div className="bg-emerald-500 text-white text-center text-xs py-2 px-4 font-semibold tracking-wide">
        ✓ Back online — syncing saved logs…
      </div>
    );
  }

  if (!offline) return null;

  return (
    <div className="bg-amber-500 text-white text-center text-xs py-2 px-4 font-semibold tracking-wide">
      You're offline — logs are saved locally and will sync automatically
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md', color = 'emerald' }) {
  const sizes = { sm: 'w-4 h-4 border-2', md: 'w-6 h-6 border-2', lg: 'w-8 h-8 border-4' };
  const colors = {
    emerald: 'border-emerald-500 border-t-transparent',
    white:   'border-white border-t-transparent',
    stone:   'border-stone-400 border-t-transparent',
  };
  return (
    <div className={`rounded-full animate-spin ${sizes[size]} ${colors[color]}`} />
  );
}

// ── PageLoader ────────────────────────────────────────────────────────────────
export function PageLoader() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────
// Compact coloured badge — used in monitor log cards
export function StatPill({ value, label, color = 'stone' }) {
  const colors = {
    stone:   'bg-stone-100 text-stone-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber:   'bg-amber-100  text-amber-700',
    red:     'bg-red-100    text-red-700',
    blue:    'bg-blue-100   text-blue-700',
    purple:  'bg-purple-100 text-purple-700',
  };
  return (
    <div className={`text-center rounded-xl py-1.5 px-2 ${colors[color]}`}>
      <div className="font-bold text-sm leading-tight">{value}</div>
      <div className="text-xs opacity-70 mt-0.5">{label}</div>
    </div>
  );
}

// ── BackButton ────────────────────────────────────────────────────────────────
export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-stone-500 hover:text-stone-700
        transition-colors text-sm font-medium py-1"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}
