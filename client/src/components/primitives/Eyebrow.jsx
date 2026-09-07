/**
 * Eyebrow — the small uppercase label above a number or a section.
 *
 *   <Eyebrow>Calories eaten</Eyebrow>
 *   <Eyebrow tone="gold">From your coach</Eyebrow>
 *
 * Replaces ~160 ad-hoc ten-pixel grey label runs written by hand. One
 * component, one size, so the eye learns what it means: "this describes the
 * thing next to it".
 */
const TONES = {
  lo:   'text-lo',
  mid:  'text-mid',
  gold: 'text-gold-deep',
};

export default function Eyebrow({ children, tone = 'lo', as: Tag = 'span', className = '', ...rest }) {
  return (
    <Tag className={`block text-eyebrow font-semibold uppercase tracking-widest ${TONES[tone] || TONES.lo} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
