import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { haptic } from '../store/settingsStore';
import { useAIChat } from './AIChatLog';

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl p-4 border border-white/[0.07] bg-[#1A1C20] shadow-card-raised ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, icon, tooltip }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-base leading-none">{icon}</span>}
      <h3 className="font-semibold text-[#6a6a78] text-[10px] tracking-[0.12em] uppercase flex-1">
        {children}
      </h3>
      {tooltip && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShow(v => !v)}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#9EA3B0', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>?</button>
          {show && (
            <div style={{
              position: 'absolute', right: 0, top: 26, zIndex: 50,
              background: '#1A1C20', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#FFFFFF',
              lineHeight: 1.5, width: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              {tooltip}
              <button onClick={() => setShow(false)} style={{
                display: 'block', marginTop: 8, fontSize: 11, color: '#D4AF37',
                fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}>Got it ✓</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CheckRow({ checked, onChange, label, sub, icon, burnKcal }) {
  const handleToggle = () => { haptic(22); onChange(!checked); };
  return (
    <div
      role="checkbox" aria-checked={checked} tabIndex={0}
      onClick={handleToggle}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && handleToggle()}
      style={{ minHeight: 52 }}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer select-none
        transition-all duration-150 border ${
          checked
            ? 'bg-[rgba(212,175,55,0.07)] border-[rgba(212,175,55,0.20)]'
            : 'bg-[#1A1C20] border-white/[0.07] hover:border-white/[0.14]'
        }`}>
      <div style={{ width: 24, height: 24, minWidth: 24 }}
        className={`rounded-full border-2 flex-shrink-0 flex items-center justify-center
          transition-all duration-150 ${checked ? 'bg-[#D4AF37] border-[#D4AF37]' : 'border-white/[0.2]'}`}>
        {checked && (
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium leading-tight ${checked ? 'text-[#FFFFFF]' : 'text-[#FFFFFF]'}`}>
          {icon && <span className="mr-1">{icon}</span>}{label}
        </div>
        {sub && <div className="text-xs text-[#7E8596] mt-0.5 leading-tight">{sub}</div>}
      </div>
      {checked && burnKcal > 0 && (
        <span className="flex-shrink-0 text-xs font-semibold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full border border-orange-400/20">
          -{burnKcal} kcal
        </span>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [justOnline, setJustOnline] = useState(false);
  useEffect(() => {
    const goOnline = () => { setOffline(false); setJustOnline(true); setTimeout(() => setJustOnline(false), 3000); };
    const goOffline = () => { setOffline(true); setJustOnline(false); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);
  if (justOnline) return <div className="bg-[#D4AF37] text-[#121316] text-center text-xs py-2 px-4 font-semibold tracking-wide">✓ Back online — syncing…</div>;
  if (!offline) return null;
  return <div className="bg-amber-500/90 text-white text-center text-xs py-2 px-4 font-semibold tracking-wide">Offline — logs save locally and sync automatically</div>;
}

export function Spinner({ size = 'md', color = 'emerald' }) {
  const sizes  = { sm: 'w-4 h-4 border-2', md: 'w-6 h-6 border-2', lg: 'w-8 h-8 border-[3px]' };
  const colors = { emerald: 'border-[#D4AF37]/30 border-t-[#D4AF37]', white: 'border-white/30 border-t-white', stone: 'border-white/10 border-t-white/40' };
  return <div className={`rounded-full animate-spin ${sizes[size]} ${colors[color]}`} />;
}

export function PageLoader() {
  return (
    <div className="min-h-screen bg-[#121316] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-[#7E8596] text-sm font-medium tracking-wide">Loading…</p>
      </div>
    </div>
  );
}

// Lightweight skeleton for cards that load inline (below a page that's
// already rendered) — avoids the abrupt "nothing, then sudden pop-in" effect
// that plain `return null` while loading creates, without the cost/risk of
// a full animation library.
export function CardSkeleton({ lines = 3, className = '' }) {
  return (
    <div className={`animate-pulse space-y-2.5 ${className}`}>
      <div className="h-3 w-1/3 bg-white/[0.07] rounded-full" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-9 bg-white/[0.04] rounded-xl" style={{ width: `${85 - i * 8}%` }} />
      ))}
    </div>
  );
}

export function StatPill({ value, label, color = 'stone' }) {
  const colors = {
    stone: 'bg-white/[0.06] text-[#FFFFFF]', emerald: 'bg-[rgba(212,175,55,0.10)] text-[#D4AF37]',
    amber: 'bg-[rgba(251,191,36,0.10)] text-amber-400', red: 'bg-[rgba(248,113,113,0.10)] text-red-400',
    blue: 'bg-[rgba(96,165,250,0.10)] text-blue-400', purple: 'bg-[rgba(212,175,55,0.10)] text-amber-400',
  };
  return (
    <div className={`text-center rounded-xl py-1.5 px-2 border border-white/[0.06] ${colors[color]}`}>
      <div className="font-bold text-sm leading-tight">{value}</div>
      <div className="text-xs opacity-60 mt-0.5">{label}</div>
    </div>
  );
}

// ── Member Bottom Nav ────────────────────────────────────────────────────────
export function MemberBottomNav() {
  const navigate = useNavigate();
  // Shared AI chat store — the chat itself is mounted once on the Today page,
  // so from anywhere else we navigate there first and it opens on arrival.
  const openAIChat = useAIChat(s => s.openChat);
  const { pathname } = useLocation();
  const tabs = [
    { label: 'Today', path: '/', active: pathname === '/', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )},
    { label: 'Progress', path: '/progress', active: pathname === '/progress', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
    { label: 'Profile', path: '/profile', active: pathname === '/profile', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    )},
    { label: 'Settings', path: '/settings', active: pathname === '/settings', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
  ];
  const openChatFromNav = () => {
    haptic(20);
    // Opening the store flag first means the chat is already "open" by the time
    // the Today page mounts it, so there's no visible delay on arrival.
    openAIChat();
    if (pathname !== '/') navigate('/');
  };

  const renderTab = (tab) => (
    <button key={tab.path} onClick={() => { haptic(15); navigate(tab.path); }}
      style={{ minHeight: 56, flex: 1 }}
      className={`flex flex-col items-center justify-center gap-1 py-2 transition-all rounded-2xl ${
        tab.active ? 'text-[#D4AF37]' : 'text-[#7E8596] hover:text-[#9EA3B0]'}`}>
      {tab.icon}
      <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
      {tab.active && <div className="w-1 h-1 bg-[#D4AF37] rounded-full shadow-[0_0_6px_rgba(212,175,55,0.8)]" />}
    </button>
  );

  return (
    <>
      <div style={{ height: 80 }} />
      <div className="fixed bottom-0 left-0 right-0 z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-md mx-auto px-3 pb-3">
          <div className="glass rounded-2xl shadow-float flex items-center relative">
            {tabs.slice(0, 2).map(renderTab)}

            {/* AI orb — always reachable, never scrolls away with the page */}
            <div style={{ width: 68, flexShrink: 0 }} className="flex items-start justify-center">
              <button
                onClick={openChatFromNav}
                aria-label="Log with AI Chat"
                style={{ width: 56, height: 56, marginTop: -22 }}
                className="orb-breathe rounded-full bg-gradient-to-br from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
                  flex items-center justify-center text-xl border-4 border-[#121316]
                  active:scale-90 transition-transform">
                ✨
              </button>
            </div>

            {tabs.slice(2).map(renderTab)}
          </div>
        </div>
      </div>
    </>
  );
}

export function BottomNav({ role }) {
  const navigate = useNavigate?.() ?? null;
  const pathname = useLocation?.()?.pathname ?? '';
  const tabs = [
    { label: 'Members', path: '/coach', active: pathname.startsWith('/coach'), roles: ['monitor', 'admin'], icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    )},
    { label: 'Admin', path: '/admin', active: pathname === '/admin', roles: ['admin'], icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    )},
    { label: 'Settings', path: '/settings', active: pathname === '/settings', roles: ['monitor', 'admin'], icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    )},
  ].filter(t => t.roles.includes(role));
  if (!navigate) return null;
  return (
    <>
      <div className="h-24" />
      <div className="fixed bottom-0 left-0 right-0 z-40 pb-safe">
        <div className="max-w-md mx-auto px-3 pb-3">
          <div className="glass rounded-2xl shadow-float flex items-center">
            {tabs.map(tab => (
              <button key={tab.path} onClick={() => { haptic(15); navigate(tab.path); }}
                style={{ minHeight: 56, flex: 1 }}
                className={`flex flex-col items-center gap-1 py-3.5 transition-all rounded-2xl ${tab.active ? 'text-[#D4AF37]' : 'text-[#7E8596] hover:text-[#9EA3B0]'}`}>
                {tab.icon}
                <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
                {tab.active && <div className="w-1 h-1 bg-[#D4AF37] rounded-full shadow-[0_0_6px_rgba(212,175,55,0.8)]" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button onClick={onClick}
      style={{ minHeight: 44 }}
      className="flex items-center gap-1.5 text-[#7E8596] hover:text-[#9EA3B0] transition-colors text-sm font-medium py-1">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}

export function QuickJump({ sections }) {
  const [open, setOpen] = useState(false);
  const scrollTo = (id) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setOpen(false); haptic(15); };
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 100, zIndex: 40 }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: 52, right: 0, background: '#1A1C20',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '8px 0', minWidth: 160,
          boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
        }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => scrollTo(s.id)} style={{
              display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
              background: 'none', border: 'none', color: '#FFFFFF', fontSize: 13, cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>{s.icon} {s.label}</button>
          ))}
        </div>
      )}
      <button onClick={() => { setOpen(v => !v); haptic(15); }} style={{
        width: 44, height: 44, borderRadius: 22, background: '#D4AF37', color: '#fff', fontSize: 18,
        border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(212,175,55,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{open ? '✕' : '⚡'}</button>
    </div>
  );
}
