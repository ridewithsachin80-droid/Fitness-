import { create } from 'zustand';

/**
 * store/coachAIStore.js — is the Coach AI chat open?
 *
 * Lived inside components/CoachAIChat.jsx. It moved here when the button that
 * opens the chat moved into the coach's bottom bar (components/UI.jsx): the
 * bar must not import the whole chat screen just to flip one flag. The member
 * side has the same split (store/aiChatStore.js).
 *
 * CoachAIChat.jsx re-exports useCoachAI, so every existing import still works.
 */
export const useCoachAI = create((set) => ({
  open: false,
  openChat:  () => set({ open: true }),
  closeChat: () => set({ open: false }),
}));
