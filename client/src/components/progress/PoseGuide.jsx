/**
 * PoseGuide — a faint outline showing how to stand for each progress photo,
 * so every week lines up. Drawn here (no image files): a plain figure, front,
 * side and back. Decorative: the label next to it says the same in words.
 */
const FIGURES = {
  front: 'M50 14a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M38 38h24l6 34-6 2-4-24v30l3 38h-8l-3-34-3 34h-8l3-38V50l-4 24-6-2z',
  side:  'M52 14a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M46 38h12l3 34-4 1-2-20v28l2 39h-8l-1-34-2 34h-7l2-39V54l-2 18-4-1z',
  back:  'M50 14a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M38 38h24l6 34-6 2-4-24v30l3 38h-8l-3-34-3 34h-8l3-38V50l-4 24-6-2z M50 40v28',
};
export default function PoseGuide({ pose, className = '' }) {
  return (
    <svg viewBox="0 0 100 160" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeDasharray="3 3">
      <path d={FIGURES[pose] || FIGURES.front} />
    </svg>
  );
}
