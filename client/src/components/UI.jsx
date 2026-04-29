import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl p-4 border border-white/[0.07] bg-[#131317] shadow-card ${className}`}>
      {children}
    </div>
  );
}

// ── SectionTitle ──────────────────────────────────────────────────────────────
export function SectionTitle({ children, icon }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-base leading-none">{icon}</span>}
      <h3 className="font-semibold text-[#6a6a78] text-[10px] tracking-[0.12em] uppercase">
        {children}
      </h3>
    </div>
  );
}

// ── CheckRow ──────────────────────────────────────────────────────────────────
export function CheckRow({ checked, onChange, label, sub, icon, burnKcal }) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChange(!checked)}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer select-none
        transition-all duration-150 border ${
          checked
            ? 'bg-[rgba(44,232,156,0.07)] border-[rgba(44,232,156,0.20)]'
            : 'bg-[#1a1a20] border-white/[0.07] hover:border-white/[0.14]'
        }`}
    >
      {/* Check circle */}
      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
        transition-all duration-150 ${
          checked ? 'bg-[#2ce89c] border-[#2ce89c]' : 'border-white/[0.20]'
        }`}>
        {checked && (
          <svg className="w-3 h-3 text-[#0a2318]" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium leading-tight ${checked ? 'text-[#ededf0]' : 'text-[#d8d8de]'}`}>
          {icon && <span className="mr-1">{icon}</span>}
          {label}
        </div>
        {sub && (
          <div className="text-xs text-[#4e4e5c] mt-0.5 leading-tight">{sub}</div>
        )}
      </div>

      {checked && burnKcal > 0 && (
        <span className="flex-shrink-0 text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full border border-orange-400/20">
          −{burnKcal} kcal
        </span>
      )}
    </div>
  );
}

// ── OfflineBanner ─────────────────────────────────────────────────────────────
export function OfflineBanner() {
  const [offline, setOffline]       = useState(!navigator.onLine);
  const [justOnline, setJustOnline] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setOffline(false); setJustOnline(true);
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
      <div className="bg-[#2ce89c] text-[#040c08] text-center text-xs py-2 px-4 font-semibold tracking-wide">
        ✓ Back online — syncing…
      </div>
    );
  }
  if (!offline) return null;
  return (
    <div className="bg-amber-500/90 text-white text-center text-xs py-2 px-4 font-semibold tracking-wide">
      Offline — logs save locally and sync automatically
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md', color = 'emerald' }) {
  const sizes  = { sm: 'w-4 h-4 border-2', md: 'w-6 h-6 border-2', lg: 'w-8 h-8 border-[3px]' };
  const colors = {
    emerald: 'border-[#2ce89c]/30 border-t-[#2ce89c]',
    white:   'border-white/30 border-t-white',
    stone:   'border-white/10 border-t-white/40',
  };
  return <div className={`rounded-full animate-spin ${sizes[size]} ${colors[color]}`} />;
}

// ── PageLoader ────────────────────────────────────────────────────────────────
export function PageLoader() {
  return (
    <div className="min-h-screen bg-[#0b0b0e] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-[#4e4e5c] text-sm font-medium tracking-wide">Loading…</p>
      </div>
    </div>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────
export function StatPill({ value, label, color = 'stone' }) {
  const colors = {
    stone:   'bg-white/[0.06] text-[#d8d8de]',
    emerald: 'bg-[rgba(44,232,156,0.10)] text-[#2ce89c]',
    amber:   'bg-[rgba(251,191,36,0.10)] text-amber-400',
    red:     'bg-[rgba(248,113,113,0.10)] text-red-400',
    blue:    'bg-[rgba(96,165,250,0.10)] text-blue-400',
    purple:  'bg-[rgba(192,132,252,0.10)] text-purple-400',
  };
  return (
    <div className={`text-center rounded-xl py-1.5 px-2 border border-white/[0.06] ${colors[color]}`}>
      <div className="font-bold text-sm leading-tight">{value}</div>
      <div className="text-xs opacity-60 mt-0.5">{label}</div>
    </div>
  );
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
export function BottomNav({ role }) {
  const navigate = useNavigate?.() ?? null;
  const pathname = useLocation?.()?.pathname ?? '';

  const tabs = [
    {
      label: 'Patients',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      path: '/monitor', active: pathname.startsWith('/monitor'), roles: ['monitor', 'admin'],
    },
    {
      label: 'Admin',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      path: '/admin', active: pathname === '/admin', roles: ['admin'],
    },
    {
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      path: '/settings', active: pathname === '/settings', roles: ['monitor', 'admin'],
    },
  ].filter(t => t.roles.includes(role));

  if (!navigate) return null;

  return (
    <>
      <div className="h-24" />
      <div className="fixed bottom-0 left-0 right-0 z-40 pb-safe">
        <div className="max-w-md mx-auto px-3 pb-3">
          <div className="glass rounded-2xl shadow-float flex items-center">
            {tabs.map(tab => (
              <button key={tab.path} onClick={() => navigate(tab.path)}
                className={`flex-1 flex flex-col items-center gap-1 py-3.5 transition-all rounded-2xl ${
                  tab.active ? 'text-[#2ce89c]' : 'text-[#4e4e5c] hover:text-[#8e8e9a]'
                }`}>
                {tab.icon}
                <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
                {tab.active && (
                  <div className="absolute bottom-2.5 w-1 h-1 bg-[#2ce89c] rounded-full shadow-glow" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── BackButton ────────────────────────────────────────────────────────────────
export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-[#4e4e5c] hover:text-[#8e8e9a] transition-colors text-sm font-medium py-1">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}
