/**
 * store/aiChatStore.js — the AI chat's shared state (Sprint 12).
 *
 * Lived inside components/AIChatLog.jsx, which meant every screen that only
 * needed to OPEN the chat (the nav orb, Today's read, Onboarding, the sheets'
 * banners) imported a 1,500-line component to get a one-line store — and
 * UI.jsx importing AIChatLog importing UI.jsx was a cycle waiting to bite.
 * Now the store is a store. AIChatLog re-exports it, so existing imports
 * keep working; new code imports from here.
 */
import { create } from 'zustand';

// ── Shared chat store — FoodLog banner + DailyLog FAB both use this ─────────
//
// The conversation lives HERE, not in component state. AIChatLog is mounted
// inside DailyLog, so tapping Progress unmounts it — and with `messages` in
// useState that destroyed the whole exchange, including any preview card the
// member had not applied yet. They then had to re-dictate the entire day.
//
// setMessages/setInput accept either a value or an updater function so every
// existing call site (`setMessages(m => [...m, x])`) works unchanged.
export const useAIChat = create((set, get) => ({
  // Sprint 4: the chat is no longer a full-screen overlay — the thread lives on
  // the Today page and the composer is docked above the nav. `open` now means
  // "the member asked for the chat" (kept for callers that read it), and
  // `focusRequest` is a counter: every openChat() bumps it, and the composer
  // reacts by closing any sheet, scrolling the thread into view and focusing
  // the input. A counter, not a boolean, so a second tap while already
  // "open" still brings the composer up.
  open: false,
  focusRequest: 0,
  // Sprint 5b.3: the composer is summoned, not permanent. openChat() shows it
  // (and focuses it); closeComposer() hides it. The thread stays on the page.
  composerOpen: false,
  openChat:  () => set((s) => ({ open: true, composerOpen: true, focusRequest: s.focusRequest + 1 })),
  closeComposer: () => set({ composerOpen: false, composerFocused: false }),
  toggleComposer: () => set((s) => s.composerOpen
    ? { composerOpen: false, composerFocused: false }
    : { open: true, composerOpen: true, focusRequest: s.focusRequest + 1 }),
  closeChat: () => set({ open: false }),

  // Bumped after every successful Apply. useTodayModel refreshes the workout
  // summary from it (it used to watch the overlay closing — there is no
  // overlay to close any more).
  lastAppliedAt: null,
  markApplied: () => set({ lastAppliedAt: Date.now() }),
  // While the member is typing, the bottom nav steps aside so the keyboard,
  // the composer and the thread share the screen (MemberBottomNav reads this).
  composerFocused: false,
  setComposerFocused: (v) => set({ composerFocused: !!v }),
  // Text to drop into the composer the next time it mounts (onboarding's
  // sample message). Consumed once.
  prefillText: '',
  prefill: (text) => set((s) => ({ prefillText: text || '', open: true, composerOpen: true, focusRequest: s.focusRequest + 1 })),

  messages: [],
  input: '',
  // The day the conversation belongs to. A preview parsed last night must not
  // be applicable to today's log after the date rolls over.
  dayKey: null,

  setMessages: (next) =>
    set((s) => ({ messages: typeof next === 'function' ? next(s.messages) : next })),
  setInput: (next) =>
    set((s) => ({ input: typeof next === 'function' ? next(s.input) : next })),

  /** Wipe the transcript — on logout, or when the day has rolled over. */
  resetChat: () => {
    undoSnap.current = null;
    workoutUndoSnap.current = null;
    set({ messages: [], input: '', dayKey: null });
  },

  /** Called when the panel opens; clears a conversation left over from a previous day. */
  ensureFreshDay: (todayKey) => {
    if (get().dayKey && get().dayKey !== todayKey) get().resetChat();
    set({ dayKey: todayKey });
  },
}));

// ── Pre-apply snapshots for Undo ─────────────────────────────────────────────
// Module-level rather than useRef for the same reason as the messages above:
// the component unmounts on navigation but the "Applied ✓ · Undo" card now
// survives, so the snapshot behind that Undo button has to survive with it.
// Without this, Undo would render as an active button and silently do nothing.
//
// Safe across accounts: authStore.logout() sets window.location.href, which is
// a full document load — this module is re-evaluated and both snapshots reset.
export const undoSnap        = { current: null };
export const workoutUndoSnap = { current: null };

