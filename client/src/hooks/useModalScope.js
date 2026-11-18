import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { handleModalKey, isTopModal, refreshModal, registerModal, unregisterModal } from '../utils/modalStack';

export const ModalScopeContext = createContext(null);

/** Callback/ref changes never tear down an open modal or recapture its opener. */
export default function useModalScope({ open, roots, focusRef, openerRef, initialFocus, onClose }) {
  const parent = useContext(ModalScopeContext);
  const token = useRef({ parent }), entered = useRef(false), opener = useRef(null);
  const latest = useRef(null), scopeRef = useRef(null);
  // Descendant layout effects run first. Capture before any child can move
  // focus, and retain this original launcher through StrictMode effect replay.
  if (open && !entered.current) {
    entered.current = true;
    opener.current = openerRef?.current || (typeof document !== 'undefined' ? document.activeElement : null);
  } else if (!open) entered.current = false;
  token.current.parent = parent;
  latest.current = { roots, focusRef, initialFocus, onClose };
  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const scope = registerModal({
      getRoots: () => latest.current.roots.map(ref => ref.current),
      getFocusRoot: () => latest.current.focusRef?.current,
      token: token.current, opener: opener.current,
      initialFocus: () => latest.current.initialFocus?.(),
      onClose: () => latest.current.onClose?.(),
    });
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null; unregisterModal(scope);
      if (openerRef) openerRef.current = null;
    };
  }, [open]);
  useLayoutEffect(() => { if (scopeRef.current) refreshModal(scopeRef.current); });
  const onKeyDown = useCallback(event => handleModalKey(scopeRef.current, event), []);
  const requestClose = useCallback(() => { if (isTopModal(scopeRef.current)) latest.current.onClose?.(); }, []);
  return { onKeyDown, requestClose, scopeId: token.current };
}
