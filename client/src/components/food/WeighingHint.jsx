import { preparationBasis } from '../../utils/foodProvenance';

/**
 * How to weigh the food being added, matching what its numbers are for — the
 * record's own marker first, then its name; a conflict or no answer asks the
 * member to check (17–18 Oct 2026). Never a blanket "weigh before cooking".
 */
export default function WeighingHint({ food, name }) {
  const f = food && typeof food === 'object' ? food : { name: name ?? food };
  if (!String(f.name || '').trim()) return null;
  const p = preparationBasis(f);
  const text = p.from === 'conflict'
    ? `This food’s record says ${p.record} but its name says ${p.name} — check which the numbers are for, and weigh it the same way.`
    // A stored answer (the food's record or the member's label) is said plainly;
    // one read from the name says so, because nobody has checked it (Fixes-2h).
    : p.from === 'name' && p.basis === 'raw' ? 'The name says raw, so these numbers are probably for the raw food — weigh it before cooking.'
    : p.from === 'name' && p.basis === 'cooked' ? 'The name says cooked, so these numbers are probably for the cooked food — weigh it cooked, as you eat it.'
    : p.basis === 'raw' ? 'These numbers are for the raw food — weigh it before cooking.'
    : p.basis === 'cooked' ? 'These numbers are for the cooked food — weigh it cooked, as you eat it.'
    : 'Check whether these numbers are for raw or cooked, and weigh it the same way.';
  return <p className="text-caption text-mid mt-1.5" data-testid="weighing-hint" data-basis={p.from === 'conflict' ? 'conflict' : p.basis || 'unknown'} data-from={p.from || 'none'}>{text}</p>;
}
