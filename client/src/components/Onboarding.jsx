import { useState } from 'react';
import { saveMyOnboarding } from '../api/logs';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { useAIChat } from './AIChatLog';
import { Icon, Eyebrow, Pressable } from './primitives';

/**
 * Onboarding — four screens, one question each (Sprint 7).
 *
 *   1. Who's using FitLife?        child / adult / senior  → app mode
 *   2. What are you working toward?  several goals, in the order they matter
 *   3. Your numbers                start weight · target (both optional)
 *   4. You're set                  avatar, and the AI's first message ready to send
 *
 * Goals are a LIST, not a choice: "lose weight" and "sleep better" are both
 * true for most members. The order tapped is the order of importance —
 * the first becomes the primary goal the coach views show. Saved through
 * PUT /members/me/onboarding as { goals: [...] }; the server derives `goal`.
 *
 * Progress is a hairline at the top; each question is set in Fraunces.
 */
const AVATARS = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];

export const AGE_MODES = [
  { id: 'child',  label: 'Child',  sub: 'Under 18', icon: 'sun',  desc: 'Simple words, friendly view, no calorie pressure' },
  { id: 'adult',  label: 'Adult',  sub: '18–59',    icon: 'user', desc: 'Full detail — macros, nutrients, training' },
  { id: 'senior', label: 'Senior', sub: '60+',      icon: 'moon', desc: 'Large text, plain language, simplified view' },
];

// ids must match GOALS in server/routes/patients.js
export const GOAL_OPTIONS = [
  { id: 'lose',      label: 'Lose weight',        icon: 'scale',    sub: 'Steady fat loss without losing strength' },
  { id: 'gain',      label: 'Build muscle',       icon: 'dumbbell', sub: 'Add lean mass with a plan you can follow' },
  { id: 'strength',  label: 'Get stronger',       icon: 'flame',    sub: 'Lift more, move better' },
  { id: 'energy',    label: 'More energy',        icon: 'sun',      sub: 'Fewer afternoon crashes' },
  { id: 'sleep',     label: 'Sleep better',       icon: 'moon',     sub: 'Fall asleep faster, wake up rested' },
  { id: 'condition', label: 'Manage a condition', icon: 'pill',     sub: 'Diabetes, thyroid, BP — with your doctor' },
  { id: 'maintain',  label: 'Stay healthy',       icon: 'check',    sub: 'Keep what\u2019s working, build the habit' },
];

const SAMPLE_MESSAGE = 'weight 82.5, morning walk done, 2 idli and sambar for breakfast, drank 1 litre water, slept 10:30 to 6:30';

function Screen({ step, total, children }) {
  return (
    <div className="min-h-screen bg-charcoal text-white flex flex-col">
      <div className="h-0.5 bg-white/[0.06]" aria-hidden="true">
        <div className="h-full bg-gold transition-all duration-500" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
      <div className="flex-1 max-w-md w-full mx-auto px-5 pt-8 pb-8 flex flex-col">{children}</div>
    </div>
  );
}

function Question({ eyebrow, title, sub }) {
  return (
    <div className="mb-6">
      <Eyebrow tone="gold">{eyebrow}</Eyebrow>
      <h1 className="font-display text-num-lg leading-tight font-medium text-white mt-1">{title}</h1>
      {sub && <p className="text-sm text-mid mt-2 leading-relaxed">{sub}</p>}
    </div>
  );
}

function Footer({ onBack, onNext, nextLabel = 'Next', disabled, busy }) {
  return (
    <div className="mt-auto pt-6 flex items-center gap-3">
      {onBack && (
        <Pressable variant="ghost" onPress={onBack} aria-label="Back" className="text-mid"><Icon name="chevron-left" size={18} /> Back</Pressable>
      )}
      <Pressable variant="primary" onPress={onNext} disabled={disabled || busy} className="flex-1" data-testid="onb-next">
        {busy ? 'Saving…' : nextLabel} {!busy && <Icon name="arrow-right" size={16} />}
      </Pressable>
    </div>
  );
}

export default function Onboarding({ onDone } = {}) {
  const TOTAL = 4;
  const [step, setStep]         = useState(0);
  const [ageMode, setAgeMode]   = useState(null);
  const [goals, setGoals]       = useState([]);          // ordered as tapped
  const [avatarIdx, setAvatarI] = useState(0);
  const [startW, setStartW]     = useState('');
  const [targetW, setTargetW]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveErr] = useState('');
  const { finishOnboarding, setAvatarIdx } = useSettingsStore();

  const wOk = (v) => { if (!v) return true; const n = parseFloat(v); return Number.isFinite(n) && n >= 20 && n <= 300; };
  const weightsValid = wOk(startW) && wOk(targetW);

  const toggleGoal = (id) => {
    haptic(10);
    setGoals(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]);
  };

  const done = async (thenSend) => {
    setSaving(true); setSaveErr('');
    try {
      await saveMyOnboarding({
        age_mode: ageMode, avatar_idx: avatarIdx, goals,
        start_weight: startW ? parseFloat(startW) : null,
        target_weight: targetW ? parseFloat(targetW) : null,
      });
      setAvatarIdx(avatarIdx);
      finishOnboarding(ageMode);
      if (thenSend) useAIChat.getState().prefill(SAMPLE_MESSAGE);
      onDone?.();
      setSaving(false);
    } catch (err) {
      setSaveErr(err.response?.data?.error || "Couldn't save your setup \u2014 check your connection and tap again.");
      setSaving(false);
    }
  };

  // ── 1. Who ──────────────────────────────────────────────────────────────
  if (step === 0) return (
    <Screen step={0} total={TOTAL}>
      <Question eyebrow="Welcome to FitLife" title="Who\u2019s using FitLife?" sub="We adjust the words, the detail and the text size to suit you." />
      <div className="space-y-2" data-testid="onb-modes">
        {AGE_MODES.map(m => {
          const on = ageMode === m.id;
          return (
            <button key={m.id} type="button" onClick={() => { haptic(10); setAgeMode(m.id); }} aria-pressed={on}
              className={`w-full text-left flex items-center gap-3 rounded-2xl px-4 py-3.5 border transition-all active:scale-[0.99] ${on ? 'bg-gold/[0.12] border-gold/50' : 'bg-white/[0.04] border-hair'}`}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center ${on ? 'bg-gold text-charcoal' : 'bg-white/[0.06] text-mid'}`}><Icon name={m.icon} size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">{m.label} <span className="text-lo font-medium">· {m.sub}</span></span>
                <span className="block text-caption text-mid">{m.desc}</span>
              </span>
              {on && <Icon name="check" size={18} className="text-gold" />}
            </button>
          );
        })}
      </div>
      <Footer onNext={() => setStep(1)} disabled={!ageMode} />
    </Screen>
  );

  // ── 2. Goals (many) ──────────────────────────────────────────────────────
  if (step === 1) return (
    <Screen step={1} total={TOTAL}>
      <Question eyebrow="Your goals" title="What are you working toward?"
        sub="Pick everything that applies. Tap the one that matters most first — that order is how your coach will see it." />
      <div className="space-y-2" data-testid="onb-goals">
        {GOAL_OPTIONS.map(g => {
          const pos = goals.indexOf(g.id);
          const on = pos !== -1;
          return (
            <button key={g.id} type="button" onClick={() => toggleGoal(g.id)} aria-pressed={on} data-testid={`goal-${g.id}`}
              className={`w-full text-left flex items-center gap-3 rounded-2xl px-4 py-3 border transition-all active:scale-[0.99] ${on ? 'bg-gold/[0.12] border-gold/50' : 'bg-white/[0.04] border-hair'}`}>
              <span className={`w-9 h-9 rounded-full flex items-center justify-center ${on ? 'bg-gold text-charcoal' : 'bg-white/[0.06] text-mid'}`}><Icon name={g.icon} size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">{g.label}</span>
                <span className="block text-caption text-mid">{g.sub}</span>
              </span>
              {on && (
                <span className="w-6 h-6 rounded-full bg-gold text-charcoal text-caption font-extrabold flex items-center justify-center tabular-nums" data-testid="goal-order">{pos + 1}</span>
              )}
            </button>
          );
        })}
      </div>
      {goals.length > 1 && <p className="text-caption text-lo mt-3" data-testid="onb-primary">Main goal: <span className="text-gold-light font-semibold">{GOAL_OPTIONS.find(g => g.id === goals[0])?.label}</span> · tap to reorder</p>}
      <Footer onBack={() => setStep(0)} onNext={() => setStep(2)} disabled={goals.length === 0} />
    </Screen>
  );

  // ── 3. Numbers ───────────────────────────────────────────────────────────
  if (step === 2) return (
    <Screen step={2} total={TOTAL}>
      <Question eyebrow="Your numbers" title="Where are you starting from?" sub="Both optional — your coach can set these too. Everything on Progress is measured from here." />
      <div className="grid grid-cols-2 gap-3" data-testid="onb-weights">
        {[['Weight now', startW, setStartW, 'e.g. 82.5', 'onb-start'], ['Target', targetW, setTargetW, 'e.g. 75', 'onb-target']].map(([label, val, set, ph, id]) => (
          <label key={id} className="block">
            <Eyebrow className="mb-1.5">{label}</Eyebrow>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="decimal" step="0.1" value={val} onChange={e => set(e.target.value)} placeholder={ph} data-testid={id}
                style={{ minHeight: 56, fontSize: 24 }}
                className={`w-full font-display font-semibold text-center rounded-2xl border-2 focus:outline-none focus:ring-2 focus:ring-gold/30 tabular-nums ${wOk(val) ? 'border-white/[0.12]' : 'border-red-400/60'}`} />
              <span className="text-lo font-semibold">kg</span>
            </div>
          </label>
        ))}
      </div>
      {!weightsValid && <p className="text-caption text-red-400 mt-2" role="alert">Weights should be between 20 and 300 kg.</p>}
      <Footer onBack={() => setStep(1)} onNext={() => setStep(3)} disabled={!weightsValid} />
    </Screen>
  );

  // ── 4. Ready ─────────────────────────────────────────────────────────────
  const primary = GOAL_OPTIONS.find(g => g.id === goals[0]);
  return (
    <Screen step={3} total={TOTAL}>
      <Question eyebrow="You\u2019re set" title={`Let\u2019s ${primary ? primary.label.toLowerCase() : 'get going'}, together.`}
        sub={goals.length > 1 ? `Also: ${goals.slice(1).map(id => GOAL_OPTIONS.find(g => g.id === id)?.label.toLowerCase()).join(', ')}.` : null} />

      <Eyebrow className="mb-2">Pick an avatar</Eyebrow>
      <div className="grid grid-cols-6 gap-2 mb-6" data-testid="onb-avatars">
        {AVATARS.map((a, i) => (
          <button key={i} type="button" onClick={() => { haptic(8); setAvatarI(i); }} aria-pressed={avatarIdx === i} aria-label={`Avatar ${i + 1}`}
            style={{ minHeight: 44 }}
            className={`rounded-xl text-2xl flex items-center justify-center border transition-all ${avatarIdx === i ? 'bg-gold/[0.15] border-gold/50 scale-105' : 'bg-white/[0.04] border-hair'}`}>{a}</button>
        ))}
      </div>

      <div className="rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3.5" data-testid="onb-ai">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-7 h-7 rounded-full bg-gold/[0.14] text-gold flex items-center justify-center"><Icon name="spark" size={14} /></span>
          <span className="text-sm font-bold text-white">This is how you log — one message a day</span>
        </div>
        <p className="text-body-sm text-mid leading-relaxed">Say it the way you\u2019d tell a friend. I\u2019ll fill weight, food, water, walks and sleep from it and you tap Apply.</p>
        <button type="button" onClick={() => done(true)} disabled={saving} data-testid="onb-send-sample"
          className="mt-3 w-full text-left rounded-xl bg-surface border border-hair px-3 py-2.5 text-body-sm text-white italic active:scale-[0.99] transition-transform disabled:opacity-50">
          \u201C{SAMPLE_MESSAGE}\u201D
          <span className="block not-italic text-caption font-bold text-gold mt-1">Try this message \u203A</span>
        </button>
      </div>

      {saveError && <p className="text-caption text-red-400 mt-3" role="alert">{saveError}</p>}
      <Footer onBack={() => setStep(2)} onNext={() => done(false)} nextLabel="Open FitLife" busy={saving} />
    </Screen>
  );
}
