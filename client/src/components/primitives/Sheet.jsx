import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import useModalScope, { ModalScopeContext } from '../../hooks/useModalScope';
import { visibleEnabled } from '../../utils/modalStack';
import Icon from './Icon';
import { haptic } from '../../store/settingsStore';

/**
 * Sheet — a bottom sheet that behaves like the phone's own.
 *
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Morning weight">
 *     …form…
 *   </Sheet>
 *
 * What it does that an inline panel could not:
 *   · slides up on a spring; drag it down past 90px (or flick it) to close
 *   · backdrop tap and Escape close it
 *   · stays above the keyboard — height follows `visualViewport`, so the
 *     Done button is never hidden behind the keys on Android
 *   · locks page scroll while open, restores it on close
 *   · returns focus to whatever opened it
 *   · respects reduce-motion (fades instead of slides)
 *
 * Content scrolls inside the sheet; the sheet itself is at most 92% of the
 * visible height. Pass `snap="full"` for editors that want the whole screen.
 */
export default function Sheet(props) {
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{props.open && <SheetSurface key="sheet" {...props} />}</AnimatePresence>, document.body);
}

function SheetSurface({ onClose, title, eyebrow, children, snap = 'auto', footer, className = '' }) {
  const reduce = useReducedMotion();
  const present = useIsPresent();
  const panelRef = useRef(null), rootRef = useRef(null);
  const modal = useModalScope({ open: present, roots: [rootRef], focusRef: panelRef, onClose,
    initialFocus: () => [...(panelRef.current?.querySelectorAll('input,textarea,select,button:not([data-sheet-close])') || [])]
      .find(node => visibleEnabled(node) && node.tabIndex >= 0),
  });

  // Keyboard-safe height: the sheet sizes to the VISUAL viewport, which shrinks
  // when the soft keyboard opens. Without this, on Android the bottom of the
  // sheet (where Done lives) sits under the keys.
  useEffect(() => {
    if (!present) return undefined;
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      if (panelRef.current) panelRef.current.style.maxHeight = `${Math.round(h * (snap === 'full' ? 0.98 : 0.92))}px`;
    };
    apply();
    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    return () => { vv?.removeEventListener('resize', apply); window.removeEventListener('resize', apply); };
  }, [present, snap]);

  const close = () => { haptic(8); modal.requestClose(); };

  return (
      <ModalScopeContext.Provider value={modal.scopeId}>
        <div ref={rootRef} data-modal-scope="sheet" data-modal-exiting={!present ? "" : undefined} onKeyDown={modal.onKeyDown}
          inert={!present ? true : undefined} aria-hidden={!present ? 'true' : undefined}
          className="fixed inset-0 z-[80] flex flex-col justify-end" role="presentation">
          <motion.div
            key="backdrop"
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close} />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog" aria-modal="true" aria-label={title || 'Sheet'}
            tabIndex={-1}
            className={`relative mx-auto w-full max-w-md bg-surface border-t border-x border-hair-med
              rounded-t-3xl shadow-float flex flex-col outline-none ${className}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 420, damping: 40 }}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) close();
            }}>
            {/* grab handle */}
            <div className="flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-white/[0.2]" />
            </div>

            {(title || eyebrow) && (
              <div className="flex items-start justify-between gap-3 px-5 pt-1 pb-3">
                <div className="min-w-0">
                  {eyebrow && <span className="block text-eyebrow font-semibold uppercase tracking-widest text-gold-deep mb-0.5">{eyebrow}</span>}
                  {title && <h2 className="font-display text-xl font-medium text-white leading-tight break-words">{title}</h2>}
                </div>
                <button type="button" data-sheet-close onClick={close} aria-label="Close"
                  style={{ minWidth: 44, minHeight: 44 }}
                  className="-mr-2 -mt-1 flex-shrink-0 flex items-center justify-center rounded-full text-lo hover:text-white active:scale-95 transition">
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
              {children}
            </div>

            {footer && (
              <div className="px-5 pt-3 pb-3 border-t border-hair">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      </ModalScopeContext.Provider>
  );
}
