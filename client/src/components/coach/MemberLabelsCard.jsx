import { useEffect, useState } from 'react';
import { Eyebrow } from '../primitives';
import { getMemberLabels } from '../../api/memberFoods';
import { carbsOf } from '../../lib/day';
import { firstName } from '../../utils/personName';

/**
 * MemberLabelsCard — the food labels a member has typed in themselves.
 *
 * 10 Oct 2026: members can now change a food's protein, carbs and fat (the
 * pack in their hand says 24 g protein, the shared table says 13). Those
 * numbers count in their day and in everything the coach reads from it, so
 * the coach sees each one here: what food, the numbers per 100 g, and when.
 * A label that looks wrong is a conversation with the member — the coach
 * cannot edit it, because it is the member's reading of their own pack.
 */
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

export default function MemberLabelsCard({ memberId, memberName }) {
  const [rows, setRows]   = useState(null);
  const [error, setError] = useState(false);
  const first = firstName(memberName, 'this member');

  useEffect(() => {
    let live = true;
    getMemberLabels(memberId)
      .then(({ data }) => { if (live) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [memberId]);

  return (
    <div data-testid="member-labels">
      <Eyebrow>{`${first}'s own food labels`}</Eyebrow>
      {error ? (
        <p className="text-caption text-lo mt-1">Couldn't load them — pull to refresh.</p>
      ) : rows == null ? (
        <p className="text-caption text-lo mt-1">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-caption text-lo mt-1 leading-snug" data-testid="member-labels-empty">
          None yet. When {first} types the protein, carbs and fat from a pack, the food shows here and those numbers count in their day.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-white/[0.05]" data-testid="member-labels-list">
          {rows.map(l => (
            <li key={l.id} className="py-2 flex items-start justify-between gap-3" data-testid="member-label-row">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{l.name}</p>
                <p className="text-caption text-lo tabular-nums">
                  per 100 g · P {r1(l.per_100g?.protein)} · C {r1(carbsOf(l.per_100g))} · F {r1(l.per_100g?.fat)} g
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-display font-semibold text-white tabular-nums">{Math.round(l.per_100g?.calories || 0)} <span className="text-caption text-lo font-sans">kcal</span></p>
                <p className="text-eyebrow text-lo">
                  {l.updated_at ? new Date(l.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
