import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normalizeVoiceLang } from '../utils/voiceLanguage';

// ── Theme / font helpers ──────────────────────────────────────────────────────
// 'dark' | 'light' | 'system'. "system" (the default since 16 Oct 2026)
// follows the phone's own dark/light setting until the member picks one.
export function resolvedTheme(theme) {
  const choice = theme || useSettingsStore.getState().theme || 'system';
  if (choice === 'dark' || choice === 'light') return choice;
  try { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'dark'; }
}
export function applyTheme(theme) {
  const selected = resolvedTheme(theme);
  document.documentElement.setAttribute('data-theme', selected);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = selected === 'dark' ? '#141817' : '#f8f9f6';
  // iPhone status bar: white icons on dark, dark icons on light (read at launch).
  const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (ios) ios.content = selected === 'dark' ? 'black-translucent' : 'default';
}
// Keep "system" in step when the phone switches at sunset.
try {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if ((useSettingsStore.getState().theme || 'system') === 'system') applyTheme('system');
  });
} catch (_) {}

export function applyFontSize(size) {
  document.documentElement.setAttribute('data-fontsize', size);
}

// ── Haptic helper ─────────────────────────────────────────────────────────────
export function haptic(ms = 18) {
  try { navigator.vibrate?.(ms); } catch (_) {}
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useSettingsStore = create(
  persist(
    (set, get) => ({
      // 'child' | 'adult' | 'senior' | null (null triggers onboarding)
      ageMode: null,
      theme: 'system',
      setTheme: (theme) => { const value = ['dark', 'light'].includes(theme) ? theme : 'system'; set({ theme: value }); applyTheme(value); },
      // 'normal' | 'large'
      fontSize: 'normal',
      // 'simple' | 'detailed'
      nutritionView: 'simple',
      // Guardian/parent email (stored locally, manually shared)
      guardianEmail: '',
      // Emergency contact
      emergencyContact: { name: '', phone: '' },
      // Meal slot names (user-configurable)
      mealSlots: ['Breakfast', 'Lunch', 'Dinner'],
      // Avatar index (0-11)
      avatarIdx: 0,
      // Whether first-launch onboarding is complete
      onboardingDone: false,

      setAgeMode: (mode) => {
        set({ ageMode: mode });
        if (mode === 'senior') applyFontSize('large');
        else applyFontSize(get().fontSize);
      },
      setFontSize: (size) => {
        set({ fontSize: size });
        applyFontSize(size);
      },
      setNutritionView: (view) => set({ nutritionView: view }),
      setGuardianEmail: (email) => set({ guardianEmail: email }),
      setEmergencyContact: (contact) => set({ emergencyContact: contact }),
      setMealSlots: (slots) => set({ mealSlots: slots }),
      // Used by live recognition and the recorded-audio transcription hint.
      voiceLang: 'en-IN',
      setVoiceLang: (lang) => set({ voiceLang: normalizeVoiceLang(lang) }),
      setAvatarIdx: (idx) => set({ avatarIdx: idx }),
      finishOnboarding: (mode) => {
        set({ ageMode: mode, onboardingDone: true,
              fontSize: mode === 'senior' ? 'large' : 'normal',
              nutritionView: mode === 'adult' ? 'detailed' : 'simple' });
        applyTheme();
        applyFontSize(mode === 'senior' ? 'large' : 'normal');
      },
    }),
    {
      name: 'fitlife-settings-v2',
      // Validate on hydration too: old or edited storage cannot inject a locale.
      merge: (stored, current) => ({
        ...current, ...stored, voiceLang: normalizeVoiceLang(stored?.voiceLang),
      }),
    }
  )
);

// ── Age-aware terminology ─────────────────────────────────────────────────────
export function useTerms() {
  const ageMode = useSettingsStore(s => s.ageMode);
  const mode = ageMode || 'adult';
  return {
    compliance:  mode === 'child' ? 'Your star score' : mode === 'senior' ? 'Your daily score' : 'Compliance',
    macros:      mode === 'child' ? 'Food groups'      : mode === 'senior' ? 'Main nutrients' : 'Macros',
    kcal:        mode === 'child' ? 'energy'           : 'kcal',
    protein:     mode === 'child' ? 'building blocks'  : 'Protein',
    supplements: mode === 'child' ? 'vitamins'         : 'Supplements',
    water:       mode === 'child' ? 'drinking water'   : 'Water intake',
    sleep:       mode === 'child' ? 'bedtime'          : 'Sleep',
    activities:  mode === 'child' ? 'exercise & play'  : 'Physical activity',
    notes:       mode === 'child' ? 'how I feel today' : 'Notes',
    acv:         'Apple cider vinegar',
    netCarbs:    mode === 'adult' ? 'Net carbs'        : 'Carbs',
    rda:         mode === 'adult' ? 'RDA'              : 'daily need',
  };
}
