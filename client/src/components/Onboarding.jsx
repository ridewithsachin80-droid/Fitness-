import { useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';

const AVATARS = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];

const AGE_MODES = [
  {
    id: 'child',
    label: 'Child',
    sub: 'Ages 5–17',
    emoji: '🌟',
    color: 'from-yellow-400 to-orange-400',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    desc: 'Fun icons, simple words, parent-friendly',
  },
  {
    id: 'adult',
    label: 'Adult',
    sub: 'Ages 18–59',
    emoji: '💪',
    color: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    desc: 'Full detail, macros, nutrition science',
  },
  {
    id: 'senior',
    label: 'Senior',
    sub: 'Ages 60+',
    emoji: '🌿',
    color: 'from-emerald-400 to-teal-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    desc: 'Large text, plain language, simplified view',
  },
];

const THEMES = [
  { id: 'light', label: 'Light', emoji: '☀️' },
  { id: 'dark',  label: 'Dark',  emoji: '🌙' },
  { id: 'system',label: 'Auto',  emoji: '🔄' },
];

export default function Onboarding() {
  const [step, setStep]         = useState(0); // 0=who, 1=avatar, 2=theme
  const [ageMode, setAgeMode]   = useState(null);
  const [avatarIdx, setAvatarI] = useState(0);
  const [theme, setTheme]       = useState('system');
  const { finishOnboarding, setAvatarIdx } = useSettingsStore();

  const done = () => {
    setAvatarIdx(avatarIdx);
    finishOnboarding(ageMode, theme);
  };

  // ── Step 0: Who is using the app ───────────────────────────────────────────
  if (step === 0) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>Who's using FitLife?</h1>
      <p style={s.sub}>We'll adjust the app to suit you</p>
      <div style={s.modeGrid}>
        {AGE_MODES.map(m => (
          <button key={m.id} style={{
            ...s.modeCard,
            border: ageMode === m.id ? '2px solid #7c5cfc' : '2px solid transparent',
            background: ageMode === m.id ? 'rgba(124,92,252,0.08)' : 'rgba(255,255,255,0.04)',
          }} onClick={() => setAgeMode(m.id)}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{m.emoji}</div>
            <div style={s.modeLabel}>{m.label}</div>
            <div style={s.modeSub}>{m.sub}</div>
            <div style={s.modeDesc}>{m.desc}</div>
          </button>
        ))}
      </div>
      <Btn disabled={!ageMode} onClick={() => setStep(1)}>Next →</Btn>
    </Screen>
  );

  // ── Step 1: Pick avatar ────────────────────────────────────────────────────
  if (step === 1) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>Pick your avatar</h1>
      <p style={s.sub}>This will appear on your profile</p>
      <div style={s.avatarGrid}>
        {AVATARS.map((a, i) => (
          <button key={i} style={{
            ...s.avatarBtn,
            border: avatarIdx === i ? '2px solid #7c5cfc' : '2px solid transparent',
            background: avatarIdx === i ? 'rgba(124,92,252,0.15)' : 'rgba(255,255,255,0.04)',
            transform: avatarIdx === i ? 'scale(1.1)' : 'scale(1)',
          }} onClick={() => setAvatarI(i)}>
            <span style={{ fontSize: 32 }}>{a}</span>
          </button>
        ))}
      </div>
      <div style={s.btnRow}>
        <BackBtn onClick={() => setStep(0)} />
        <Btn onClick={() => setStep(2)}>Next →</Btn>
      </div>
    </Screen>
  );

  // ── Step 2: Theme ─────────────────────────────────────────────────────────
  if (step === 2) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>Choose your theme</h1>
      <p style={s.sub}>You can change this any time in Settings</p>
      <div style={s.themeRow}>
        {THEMES.map(t => (
          <button key={t.id} style={{
            ...s.themeBtn,
            border: theme === t.id ? '2px solid #7c5cfc' : '2px solid rgba(255,255,255,0.1)',
            background: theme === t.id ? 'rgba(124,92,252,0.15)' : 'rgba(255,255,255,0.04)',
          }} onClick={() => setTheme(t.id)}>
            <span style={{ fontSize: 28, marginBottom: 6, display: 'block' }}>{t.emoji}</span>
            <span style={s.themeLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ ...s.summaryCard, marginTop: 24 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{AVATARS[avatarIdx]}</div>
        <div style={s.summaryName}>You're all set!</div>
        <div style={s.summarySub}>
          {AGE_MODES.find(m => m.id === ageMode)?.label} mode ·{' '}
          {AGE_MODES.find(m => m.id === ageMode)?.desc}
        </div>
      </div>

      <div style={s.btnRow}>
        <BackBtn onClick={() => setStep(1)} />
        <Btn onClick={done}>Start tracking 🎉</Btn>
      </div>
    </Screen>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Screen({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: '48px 20px 40px',
      overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {children}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>🏃</div>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: '#7c5cfc', textTransform: 'uppercase' }}>
        FitLife
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '16px', borderRadius: 16,
      background: disabled ? 'rgba(124,92,252,0.3)' : '#7c5cfc',
      color: '#fff', fontWeight: 700, fontSize: 16,
      border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      marginTop: 24, transition: 'all .15s',
    }}>
      {children}
    </button>
  );
}

function BackBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '16px', borderRadius: 16,
      background: 'rgba(255,255,255,0.06)',
      color: '#8e8e9a', fontWeight: 600, fontSize: 14,
      border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
      marginTop: 24, marginRight: 8,
    }}>
      ← Back
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  h1:        { fontSize: 24, fontWeight: 700, color: '#ededf0', textAlign: 'center', marginBottom: 8 },
  sub:       { fontSize: 14, color: '#6a6a78', textAlign: 'center', marginBottom: 28 },
  modeGrid:  { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 8 },
  modeCard:  { borderRadius: 16, padding: '16px 10px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center', minHeight: 140 },
  modeLabel: { fontSize: 15, fontWeight: 700, color: '#ededf0', marginBottom: 2 },
  modeSub:   { fontSize: 11, color: '#8e8e9a', marginBottom: 6 },
  modeDesc:  { fontSize: 10, color: '#6a6a78', lineHeight: 1.4 },
  avatarGrid:{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 8 },
  avatarBtn: { borderRadius: 14, padding: '12px 8px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center' },
  themeRow:  { display: 'flex', gap: 10 },
  themeBtn:  { flex: 1, borderRadius: 16, padding: '20px 10px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center' },
  themeLabel:{ fontSize: 14, fontWeight: 600, color: '#ededf0' },
  btnRow:    { display: 'flex', gap: 8 },
  summaryCard:{ background: 'rgba(124,92,252,0.08)', borderRadius: 20, padding: '20px', textAlign: 'center', border: '1px solid rgba(124,92,252,0.2)' },
  summaryName:{ fontSize: 18, fontWeight: 700, color: '#ededf0', marginBottom: 6 },
  summarySub: { fontSize: 13, color: '#8e8e9a', lineHeight: 1.5 },
};
