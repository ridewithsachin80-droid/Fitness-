import { useEffect, useState } from 'react';

/**
 * useKeyboardInset — how many pixels of the layout viewport the soft keyboard
 * is covering right now. 0 when the keyboard is closed.
 *
 * Android Chrome (with `interactive-widget=resizes-content` in the viewport
 * meta) shrinks the layout viewport when the keyboard opens, so fixed-bottom
 * elements rise by themselves and this returns 0. iOS Safari never resizes the
 * layout viewport; it only shrinks the VISUAL viewport, so a fixed-bottom bar
 * would sit under the keys. The difference between the two viewports is the
 * inset a docked composer must add to its `bottom`.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      setInset(covered > 40 ? covered : 0);   // <40px is browser chrome jitter, not a keyboard
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return inset;
}

export default useKeyboardInset;
