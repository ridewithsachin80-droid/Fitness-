/**
 * components/primitives — the primitive kit. Import from here:
 *   import { Sheet, Segmented, HeroNumber, Eyebrow, Icon, Pressable, EmptyState, Skeleton, Stagger } from '../components/primitives';
 *
 * These are the building blocks every screen from Sprint 3 onward is made
 * of. `components/UI.jsx` (Card, SectionTitle, nav) re-exports them too, so
 * existing imports keep working.
 */
export { default as Icon, ICON_NAMES } from './Icon';
export { default as Eyebrow }          from './Eyebrow';
export { default as Pressable }        from './Pressable';
export { default as HeroNumber }       from './HeroNumber';
export { default as Segmented }        from './Segmented';
export { default as Sheet }            from './Sheet';
export { default as Stagger }          from './Stagger';
export { default as EmptyState }       from './EmptyState';
export { default as Collapsible }      from './Collapsible';
export { Skeleton, SkeletonText, SkeletonCard } from './Skeleton';
