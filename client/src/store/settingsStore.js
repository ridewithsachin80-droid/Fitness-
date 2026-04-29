import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Theme / font helpers ──────────────────────────────────────────────────────
export function applyTheme(theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', useDark ? 'dark' : 'light');
}

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
      // 'dark' | 'light' | 'system'
      theme: 'dark',
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
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      setFontSize: (size) => {
        set({ fontSize: size });
        applyFontSize(size);
      },
      setNutritionView: (view) => set({ nutritionView: view }),
      setGuardianEmail: (email) => set({ guardianEmail: email }),
      setEmergencyContact: (contact) => set({ emergencyContact: contact }),
      setMealSlots: (slots) => set({ mealSlots: slots }),
      setAvatarIdx: (idx) => set({ avatarIdx: idx }),
      finishOnboarding: (mode, theme) => {
        set({ ageMode: mode, theme, onboardingDone: true,
              fontSize: mode === 'senior' ? 'large' : 'normal',
              nutritionView: mode === 'adult' ? 'detailed' : 'simple' });
        applyTheme(theme);
        applyFontSize(mode === 'senior' ? 'large' : 'normal');
      },
    }),
    { name: 'fitlife-settings-v2' }
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
