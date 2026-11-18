import { useEffect, useRef, useState } from 'react';
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
 *
 * Desktop (18 Oct 2026): from 768 px wide the same sheet opens as a centred
 * dialog sized to its content — `size` "sm" (water, weight, sleep), "md"
 * (default) or "lg" (food, workout) — fading in instead of sliding, no drag
 * handle, at most the window height less 48 px, content scrolling and the
 * footer always visible. Phones keep the bottom sheet. Switching between the
 * two (resizing, zooming) re-styles the SAME panel; nothing is remounted, so
 * anything typed stays.
 */
const DESKTOP = '(min-width: 768px)';
const WIDTH = { sm: 440, md: 560, lg: 720 };
function useWide() {
  const query = () => typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP).matches;
  const [wide, setWide] = useState(query);
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    on(); mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}
export default function Sheet(props) {
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{props.open && <SheetSurface key="sheet" {...props} />}</AnimatePresence>, document.body);
}

function SheetSurface({ onClose, title, eyebrow, children, snap = 'auto', size = 'md', footer, className = '', layerClassName = 'z-[80]', initialFocusRef }) {
  const reduce = useReducedMotion();
  const wide = useWide();
  const present = useIsPresent();
  const panelRef = useRef(null), rootRef = useRef(null), contentRef = useRef(null);
  const modal = useModalScope({ open: present, roots: [rootRef], focusRef: panelRef, onClose,
    initialFocus: () => {
      const target = initialFocusRef?.current;
      if (target && panelRef.current?.contains(target) && visibleEnabled(target)) {
        return target;
      }
      return [...(panelRef.current?.querySelectorAll('input,textarea,select,button:not([data-sheet-close])') || [])]
      .find(node => visibleEnabled(node) && node.tabIndex >= 0);
    },
  });

  // Keyboard-safe height: the sheet sizes to the VISUAL viewport, which shrinks
  // when the soft keyboard opens. Without this, on Android the bottom of the
  // sheet (where Done lives) sits under the keys.
  useEffect(() => {
    if (!present) return undefined;
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      if (panelRef.current) panelRef.current.style.maxHeight = wide
        ? `${Math.max(240, Math.round(h - 48))}px`
        : `${Math.round(h * (snap === 'full' ? 0.98 : 0.92))}px`;
    };
    apply();
    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    return () => { vv?.removeEventListener('resize', apply); window.removeEventListener('resize', apply); };
  }, [present, snap, wide]);

  // Position once after the viewport height is applied. Do not move the list
  // again when foods, macros or the keyboard change while the editor is open.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current, content = contentRef.current;
      if (target && content?.contains(target)) {
        content.scrollTop += target.getBoundingClientRect().top - content.getBoundingClientRect().top - 8;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocusRef]);

  const close = () => { haptic(8); modal.requestClose(); };

  return (
      <ModalScopeContext.Provider value={modal.scopeId}>
        <div ref={rootRef} data-modal-scope="sheet" data-modal-exiting={!present ? "" : undefined} onKeyDown={modal.onKeyDown}
          inert={!present ? true : undefined} aria-hidden={!present ? 'true' : undefined}
          data-sheet-layout={wide ? 'dialog' : 'sheet'}
          className={`fixed inset-0 ${layerClassName} flex flex-col ${wide ? 'items-center justify-center p-6' : 'justify-end'}`} role="presentation">
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
            className={`relative mx-auto w-full max-w-md bg-surface border-hair-med shadow-float flex flex-col outline-none
              ${wide ? 'border rounded-3xl' : 'border-t border-x rounded-t-3xl'} ${className}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)', ...(wide ? { maxWidth: WIDTH[size] || WIDTH.md } : null) }}
            initial={reduce || wide ? { opacity: 0, scale: reduce ? 1 : 0.97 } : { y: '100%' }}
            animate={reduce || wide ? { opacity: 1, scale: 1 } : { y: 0 }}
            exit={reduce || wide ? { opacity: 0, scale: reduce ? 1 : 0.97 } : { y: '100%' }}
            transition={reduce ? { duration: 0.15 } : wide ? { duration: 0.16 } : { type: 'spring', stiffness: 420, damping: 40 }}
            drag={reduce || wide ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) close();
            }}>
            {/* grab handle */}
            {wide ? <div className="pt-4" aria-hidden="true" /> : (
              <div className="flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing" aria-hidden="true">
                <div className="w-10 h-1 rounded-full bg-white/[0.2]" />
              </div>
            )}

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

            <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
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
