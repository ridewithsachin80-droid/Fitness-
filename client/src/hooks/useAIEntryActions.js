import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { registerAIEntryAction, useAIChat } from '../store/aiChatStore';
import { today } from '../constants';

/** Keep browser-gated actions inside the original tap, including on iOS.
 * Rendering the portal must complete before focusing or clicking its input.
 * Effects only provide focus after route navigation; they never start capture. */
export default function useAIEntryActions({ inputRef, fileRef, overlayRef, bottomRef, previousFocus, vc, canPhoto, focusRequest, composerOpen }) {
  const latest = useRef(null);
  latest.current = { vc, canPhoto };
  useLayoutEffect(() => registerAIEntryAction((mode, open) => {
    if (!useAIChat.getState().composerOpen) previousFocus.current = document.activeElement;
    flushSync(() => { useAIChat.getState().ensureFreshDay(today()); open(); });
    if (mode === 'voice') latest.current.vc.startRecording();
    else if (mode === 'photo' && latest.current.canPhoto) fileRef.current?.click();
    else if (mode === 'text') inputRef.current?.focus({ preventScroll: true });
  }), []);

  useLayoutEffect(() => {
    if (!composerOpen || !focusRequest) return;
    (bottomRef.current)?.scrollIntoView?.({ block: 'end' });
    if (useAIChat.getState().entryMode === 'text') inputRef.current?.focus({ preventScroll: true });
    else overlayRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [focusRequest, composerOpen]);

  useLayoutEffect(() => {
    if (!composerOpen) latest.current.vc.cancelCapture();
  }, [composerOpen]);
}
