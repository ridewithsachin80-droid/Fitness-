import { useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { saveMyOnboarding } from '../api/logs';

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
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
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

const GOALS = [
  { id: 'lose',     label: 'Lose weight',   emoji: '\u2696\ufe0f' },
  { id: 'maintain', label: 'Stay healthy',  emoji: '\ud83c\udf3f' },
  { id: 'gain',     label: 'Build muscle',  emoji: '\ud83d\udcaa' },
  { id: 'strength', label: 'Get stronger',  emoji: '\ud83c\udfcb\ufe0f' },
];

export default function Onboarding() {
  const [step, setStep]         = useState(0); // 0=who, 1=goal+weights, 2=avatar, 3=finish
  const [ageMode, setAgeMode]   = useState(null);
  const [avatarIdx, setAvatarI] = useState(0);
  const [goal, setGoal]         = useState(null);
  const [startW, setStartW]     = useState('');
  const [targetW, setTargetW]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveErr] = useState('');
  const { finishOnboarding, setAvatarIdx } = useSettingsStore();

  // Same plausibility gate the server applies, so the member is told here
  // rather than bounced by a 400 after tapping through to the end.
  const wOk = (v) => {
    if (!v) return true;                       // optional
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 20 && n <= 300;
  };
  const weightsValid = wOk(startW) && wOk(targetW);

  const done = async () => {
    setSaving(true);
    setSaveErr('');
    try {
      await saveMyOnboarding({
        age_mode:      ageMode,
        avatar_idx:    avatarIdx,
        goal,
        start_weight:  startW  ? parseFloat(startW)  : null,
        target_weight: targetW ? parseFloat(targetW) : null,
      });
      // Only mirror locally once the server has it. Flipping the local flag
      // first would strand a member whose save failed: the gate in App.jsx
      // would let them through with nothing actually recorded.
      setAvatarIdx(avatarIdx);
      finishOnboarding(ageMode);
    } catch (err) {
      setSaveErr(
        err.response?.data?.error ||
        "Couldn't save your setup \u2014 check your connection and tap again."
      );
      setSaving(false);
    }
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
            border: ageMode === m.id ? '2px solid #D4AF37' : '2px solid transparent',
            background: ageMode === m.id ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.04)',
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

  // ── Step 1: Goal + starting numbers ────────────────────────────
  // Onboarding used to ask only for an emoji and an age band, so a new member
  // landed on a dashboard with no target at all — and the journey bar on
  // Progress silently refused to render, making the page look broken.
  if (step === 1) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>What are you here for?</h1>
      <p style={s.sub}>Your coach can fine-tune this later</p>
      <div style={s.goalGrid}>
        {GOALS.map(g => (
          <button key={g.id} style={{
            ...s.goalCard,
            border: goal === g.id ? '2px solid #D4AF37' : '2px solid transparent',
            background: goal === g.id ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.04)',
          }} onClick={() => setGoal(g.id)}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{g.emoji}</div>
            <div style={s.goalLabel}>{g.label}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Weight today (kg)</label>
          <input value={startW} onChange={e => setStartW(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal" placeholder="e.g. 82.5" style={s.input} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Goal weight (kg)</label>
          <input value={targetW} onChange={e => setTargetW(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal" placeholder="optional" style={s.input} />
        </div>
      </div>
      {!weightsValid && (
        <p style={s.warn}>That doesn't look right — please enter a weight between 20 and 300 kg.</p>
      )}
      <p style={s.hint}>You can skip the numbers and add them later from your daily log.</p>

      <div style={s.btnRow}>
        <BackBtn onClick={() => setStep(0)} />
        <Btn disabled={!goal || !weightsValid} onClick={() => setStep(2)}>Next →</Btn>
      </div>
    </Screen>
  );

  // ── Step 2: Pick avatar ────────────────────────────────────────────────────
  if (step === 2) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>Pick your avatar</h1>
      <p style={s.sub}>This will appear on your profile</p>
      <div style={s.avatarGrid}>
        {AVATARS.map((a, i) => (
          <button key={i} style={{
            ...s.avatarBtn,
            border: avatarIdx === i ? '2px solid #D4AF37' : '2px solid transparent',
            background: avatarIdx === i ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
            transform: avatarIdx === i ? 'scale(1.1)' : 'scale(1)',
          }} onClick={() => setAvatarI(i)}>
            <span style={{ fontSize: 32 }}>{a}</span>
          </button>
        ))}
      </div>
      <div style={s.btnRow}>
        <BackBtn onClick={() => setStep(1)} />
        <Btn onClick={() => setStep(3)}>Next →</Btn>
      </div>
    </Screen>
  );

  // ── Step 3: Finish ────────────────────────────────────────────────────────
  if (step === 3) return (
    <Screen>
      <Logo />
      <h1 style={s.h1}>You're all set!</h1>
      <p style={s.sub}>Let's start building healthy habits</p>

      <div style={{ ...s.summaryCard, marginTop: 8 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{AVATARS[avatarIdx]}</div>
        <div style={s.summaryName}>You're all set!</div>
        <div style={s.summarySub}>
          {AGE_MODES.find(m => m.id === ageMode)?.label} mode ·{' '}
          {AGE_MODES.find(m => m.id === ageMode)?.desc}
        </div>
      </div>

      <div style={s.btnRow}>
        <BackBtn onClick={() => setStep(2)} />
        <Btn disabled={saving} onClick={done}>
          {saving ? 'Saving…' : 'Start tracking 🎉'}
        </Btn>
      </div>
      {saveError && <p style={s.saveErr}>{saveError}</p>}
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
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: '#D4AF37', textTransform: 'uppercase', fontFamily: 'Outfit, sans-serif' }}>
        FitLife
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '16px', borderRadius: 16,
      background: disabled ? 'rgba(212,175,55,0.3)' : '#D4AF37',
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
  h1:        { fontSize: 24, fontWeight: 600, fontFamily: 'Fraunces, serif', color: '#ededf0', textAlign: 'center', marginBottom: 8 },
  sub:       { fontSize: 14, color: '#6a6a78', textAlign: 'center', marginBottom: 28 },
  modeGrid:  { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 8 },
  modeCard:  { borderRadius: 16, padding: '16px 10px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center', minHeight: 140 },
  modeLabel: { fontSize: 15, fontWeight: 700, color: '#ededf0', marginBottom: 2 },
  modeSub:   { fontSize: 11, color: '#8e8e9a', marginBottom: 6 },
  modeDesc:  { fontSize: 10, color: '#6a6a78', lineHeight: 1.4 },
  goalGrid:  { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 },
  goalCard:  { borderRadius: 16, padding: '16px 10px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center' },
  goalLabel: { fontSize: 14, fontWeight: 600, color: '#ededf0' },
  fieldLabel:{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#7E8596', marginBottom: 6 },
  input:     { width: '100%', boxSizing: 'border-box', background: '#1A1C20', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '12px 14px', color: '#FFFFFF', fontSize: 15, fontWeight: 600, outline: 'none' },
  warn:      { fontSize: 12, color: '#f87171', marginTop: 10, textAlign: 'center' },
  hint:      { fontSize: 11, color: '#6a6a78', marginTop: 10, textAlign: 'center', lineHeight: 1.5 },
  saveErr:   { fontSize: 12, color: '#f87171', marginTop: 12, textAlign: 'center', lineHeight: 1.5 },
  avatarGrid:{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 8 },
  avatarBtn: { borderRadius: 14, padding: '12px 8px', cursor: 'pointer', transition: 'all .15s', textAlign: 'center' },
  btnRow:    { display: 'flex', gap: 8 },
  summaryCard:{ background: 'linear-gradient(135deg, rgba(212,175,55,0.10), rgba(212,175,106,0.08))', borderRadius: 20, padding: '20px', textAlign: 'center', border: '1px solid rgba(212,175,106,0.20)' },
  summaryName:{ fontSize: 18, fontWeight: 600, fontFamily: 'Fraunces, serif', color: '#ededf0', marginBottom: 6 },
  summarySub: { fontSize: 13, color: '#8e8e9a', lineHeight: 1.5 },
};
