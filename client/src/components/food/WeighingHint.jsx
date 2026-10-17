import { weighingBasis } from '../../utils/foodProvenance';

/**
 * How to weigh the food being added, matching what its numbers are for
 * (17 Oct 2026) — never a blanket "weigh before cooking".
 */
export default function WeighingHint({ name }) {
  const food = String(name || '').trim();
  if (!food) return null;
  const basis = weighingBasis(food);
  const text = basis === 'raw' ? 'These numbers are for the raw food — weigh it before cooking.'
    : basis === 'cooked' ? 'These numbers are for the cooked food — weigh it cooked, as you eat it.'
    : 'Check whether these numbers are for raw or cooked, and weigh it the same way.';
  return <p className="text-caption text-mid mt-1.5" data-testid="weighing-hint" data-basis={basis || 'unknown'}>{text}</p>;
}
