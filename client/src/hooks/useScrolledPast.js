import { useEffect, useState } from 'react';

/** true once the page has scrolled more than `px` (16 Oct 2026: slims the
 *  Today logging bar so the bar plus the tabs no longer take a sixth of the
 *  screen while reading). Passive listener; no layout work on scroll. */
export default function useScrolledPast(px = 120) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > px);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [px]);
  return past;
}
